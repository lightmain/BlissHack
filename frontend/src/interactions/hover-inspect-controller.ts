import type {
  GlyphInfo,
  TextLine,
} from "../game-state";
import type { MapInteractionOrigin } from "../map/MapViewport";
import type { LocalInspectRequest } from "./InspectTooltip";

export interface MapInspectTarget {
  kind: "map";
  moduleId: string;
  sessionId: string;
  mapRevision: number;
  glyph: GlyphInfo | null;
  origin: MapInteractionOrigin;
}

export interface LocalInspectTarget extends LocalInspectRequest {
  moduleId: string;
  sessionId: string;
}

export type HoverInspectTarget = MapInspectTarget | LocalInspectTarget;

export type HoverInspectTooltip =
  | {
    kind: "map";
    key: string;
    lines: readonly TextLine[];
    origin: MapInteractionOrigin;
  }
  | LocalInspectTarget;

export interface HoverInspectEnvironment {
  commandBoundary: boolean;
  dragging: boolean;
  mapRevision: number;
  modalOpen: boolean;
  moduleId: string;
  paused: boolean;
  sessionId: string;
}

interface HoverInspectControllerOptions {
  delayMs: number;
  hideTooltip(): void;
  requestMapInspect(target: MapInspectTarget): Promise<readonly TextLine[]>;
  showTooltip(tooltip: HoverInspectTooltip): void;
}

export interface HoverInspectController {
  observe(environment: HoverInspectEnvironment): void;
  hover(target: HoverInspectTarget): void;
  leave(key?: string): void;
  dispose(): void;
}

/**
 * Coordinate delayed local tooltips and one non-queued map inspection.
 * @param options - timer-independent side effects for core requests and overlays.
 * @returns a session-aware hover controller.
 */
export function createHoverInspectController(
  options: HoverInspectControllerOptions,
): HoverInspectController {
  let environment: HoverInspectEnvironment | null = null;
  let current: HoverInspectTarget | null = null;
  let currentKey: string | null = null;
  let generation = 0;
  let visibleKey: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waitingForBoundary = false;
  let inFlightKey: string | null = null;
  let disposed = false;
  const mapCache = new Map<string, readonly TextLine[]>();

  /** Cancel the pending delay without affecting an in-flight core command. */
  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    waitingForBoundary = false;
  }

  /** Hide the current overlay and forget which target supplied it. */
  function hide(): void {
    visibleKey = null;
    options.hideTooltip();
  }

  /** Return whether the environment permits this target to be inspected. */
  function canInspect(target: HoverInspectTarget): boolean {
    if (
      !environment
      || environment.moduleId !== target.moduleId
      || environment.sessionId !== target.sessionId
      || environment.modalOpen
      || environment.paused
      || environment.dragging
    ) {
      return false;
    }
    return target.kind !== "map"
      || (
        environment.commandBoundary
        && environment.mapRevision === target.mapRevision
      );
  }

  /** Resolve the active delayed target without creating an intent queue. */
  function inspectCurrent(): void {
    timer = null;
    const target = current;
    const key = currentKey;
    if (!target || !key || !canInspect(target)) {
      waitingForBoundary = target?.kind === "map"
        && environment !== null
        && !environment.commandBoundary;
      return;
    }

    waitingForBoundary = false;
    if (target.kind !== "map") {
      visibleKey = key;
      options.showTooltip(target);
      return;
    }
    if (inFlightKey !== null) return;
    const cached = mapCache.get(key);
    if (cached) {
      visibleKey = key;
      options.showTooltip({
        kind: "map",
        key,
        lines: cached,
        origin: target.origin,
      });
      return;
    }

    const requestGeneration = generation;
    inFlightKey = key;
    void options.requestMapInspect(target).then(
      (lines) => {
        const completedKey = inFlightKey;
        inFlightKey = null;
        if (
          disposed
          || generation !== requestGeneration
          || completedKey !== key
          || currentKey !== key
          || current?.kind !== "map"
          || !canInspect(current)
          || lines.length === 0
        ) {
          return;
        }
        mapCache.set(key, [...lines]);
        visibleKey = key;
        options.showTooltip({
          kind: "map",
          key,
          lines,
          origin: current.origin,
        });
      },
      () => {
        inFlightKey = null;
      },
    );
  }

  /** Start the configured dwell delay for the current target. */
  function schedule(): void {
    clearTimer();
    timer = setTimeout(inspectCurrent, options.delayMs);
  }

  /** Clear pending and visible state while letting an active command finish. */
  function leave(key?: string): void {
    if (
      key !== undefined
      && (current?.kind === "map" || current?.key !== key)
    ) {
      return;
    }
    clearTimer();
    generation += 1;
    current = null;
    currentKey = null;
    hide();
  }

  return {
    /**
     * Publish the current command, modal, drag, map, and session boundaries.
     * @param next - authoritative environment for the active game session.
     */
    observe(next): void {
      if (disposed) return;
      const sessionChanged = environment !== null
        && (
          environment.moduleId !== next.moduleId
          || environment.sessionId !== next.sessionId
        );
      const mapChanged = environment !== null
        && environment.mapRevision !== next.mapRevision;
      environment = next;
      if (sessionChanged) {
        mapCache.clear();
        leave();
        return;
      }
      if (mapChanged) {
        mapCache.clear();
        if (current?.kind === "map") {
          leave();
          return;
        }
      }
      if (next.modalOpen || next.paused || next.dragging) {
        leave();
        return;
      }
      if (
        waitingForBoundary
        && next.commandBoundary
        && current?.kind === "map"
        && inFlightKey === null
      ) {
        inspectCurrent();
      }
    },

    /**
     * Replace the hovered target and start one debounce interval.
     * @param target - map, inventory, or status target under the pointer/focus.
     */
    hover(target): void {
      if (disposed) return;
      const key = inspectTargetKey(target);
      if (key === currentKey) {
        current = target;
        if (visibleKey === key) {
          if (target.kind !== "map") {
            options.showTooltip(target);
          } else {
            const lines = mapCache.get(key);
            if (lines) {
              options.showTooltip({
                kind: "map",
                key,
                lines,
                origin: target.origin,
              });
            }
          }
        }
        return;
      }
      clearTimer();
      hide();
      generation += 1;
      current = target;
      currentKey = key;
      schedule();
    },

    leave,

    /** Release timers and prevent late promises from publishing overlays. */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearTimer();
      generation += 1;
      current = null;
      currentKey = null;
      visibleKey = null;
      mapCache.clear();
      options.hideTooltip();
    },
  };
}

/**
 * Build a stable cache/debounce key without retaining DOM geometry.
 * @param target - current inspect target.
 * @returns identity including map revision, coordinate, and visible glyph.
 */
function inspectTargetKey(target: HoverInspectTarget): string {
  if (target.kind !== "map") {
    return `${target.moduleId}:${target.sessionId}:${target.kind}:${target.key}`;
  }
  return [
    target.moduleId,
    target.sessionId,
    target.kind,
    target.mapRevision,
    target.origin.mapX,
    target.origin.mapY,
    glyphKey(target.glyph),
  ].join(":");
}

/** Serialize only glyph fields already exposed through the shim callback. */
function glyphKey(glyph: GlyphInfo | null): string {
  if (!glyph) return "empty";
  return [
    glyph.glyph,
    glyph.ttyChar,
    glyph.frameColor,
    glyph.glyphFlags,
    glyph.color,
    glyph.symbolIndex,
    glyph.customColor,
    glyph.color256,
    glyph.tileIndex,
  ].join(",");
}

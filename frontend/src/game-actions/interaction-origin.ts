import type { InputRequest } from "../game-state";

/** Stable interaction metadata without retaining DOM element references. */
export type InteractionOrigin =
  | { kind: "keyboard" }
  | { kind: "action-dock"; actionName: string }
  | {
    kind: "map";
    clientX: number;
    clientY: number;
    mapX: number;
    mapY: number;
  }
  | {
    kind: "inventory";
    clientX: number;
    clientY: number;
    inventoryRevision: number;
    accelerator: number;
  };

export interface MapInteractionContext {
  completion: "click" | "drag";
  commandInput: boolean;
  inputRequest: InputRequest | null;
  moduleId: string;
  sessionId: string;
  snapshotRevision: number;
  origin: Extract<InteractionOrigin, { kind: "map" }>;
}

export type MapInteractionResolution =
  | {
    kind: "position";
    x: number;
    y: number;
    modifier: 1 | 2;
  }
  | {
    kind: "intent";
    intent: {
      kind: "map-context";
      moduleId: string;
      sessionId: string;
      snapshotRevision: number;
      origin: Extract<InteractionOrigin, { kind: "map" }>;
    };
  };

/**
 * Route a completed secondary gesture without conflating command and getpos input.
 * @param context - gesture result and current authoritative input state.
 * @returns a position response, a context intent, or null for a drag/busy core.
 */
export function resolveMapSecondaryInteraction(
  context: MapInteractionContext,
): MapInteractionResolution | null {
  if (context.completion === "drag") return null;
  if (
    context.inputRequest?.kind === "position"
    && !context.commandInput
  ) {
    return {
      kind: "position",
      x: context.origin.mapX,
      y: context.origin.mapY,
      modifier: 2,
    };
  }
  if (!context.commandInput) return null;
  return {
    kind: "intent",
    intent: {
      kind: "map-context",
      moduleId: context.moduleId,
      sessionId: context.sessionId,
      snapshotRevision: context.snapshotRevision,
      origin: context.origin,
    },
  };
}

/**
 * Route a primary click to the active position-capable command input.
 * @param context - pointer origin and current input state.
 * @returns a primary position response, or null while the core is busy.
 */
export function resolveMapPrimaryInteraction(
  context: Omit<MapInteractionContext, "completion">,
): Extract<MapInteractionResolution, { kind: "position" }> | null {
  if (context.inputRequest?.kind !== "position") return null;
  return {
    kind: "position",
    x: context.origin.mapX,
    y: context.origin.mapY,
    modifier: 1,
  };
}

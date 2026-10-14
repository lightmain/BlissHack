import type { GlyphInfo, MapCell, MenuItem } from "../game-state";
import type {
  GlyphBinding,
  GlyphBindingResult,
} from "./core-schema";
import {
  entityIdForBinding,
  glyphsEqual,
  type InventoryExamineCapture,
  type MapExamineCapture,
} from "./examine-target";
import { validateVisibleEntityToken } from "./visible-entity-token";

export interface ResolvedVisibleEntity {
  entityId: string;
  glyph: number;
  source: "map-foreground" | "map-background" | "inventory";
  binding: GlyphBinding;
}

export interface EntityResolver {
  resolveMapCell(cell: MapCell): ResolvedVisibleEntity | null;
  resolveInventoryItem(
    item: MenuItem,
    visibleEntityToken: unknown,
  ): ResolvedVisibleEntity | null;
}

interface MapTargetState {
  moduleId: string;
  sessionId: string;
  mapRevision: number;
  mapX: number;
  mapY: number;
  cell: MapCell;
}

interface InventoryTargetState {
  moduleId: string;
  sessionId: string;
  inventoryRevision: number;
  item: MenuItem;
  visibleEntityToken: string | null;
}

/**
 * Create a resolver which maps only final display glyphs to catalog entities.
 * @param options Bound public and exact-visible identity lookups.
 * @returns Synchronous map and inventory resolution methods.
 */
export function createEntityResolver(options: {
  maxGlyph: number;
  bindingForGlyph: (glyph: number) => GlyphBindingResult | null;
  artifactBaseObjects: ReadonlyMap<string, string>;
  knownObjectIds: ReadonlySet<string>;
  objectIdForGlyph: (glyph: number) => string | null;
}): EntityResolver {
  /**
   * Resolve one in-range display glyph without applying hidden-state fallback.
   * @param glyphInfo Final glyph selected by the NetHack core.
   * @param source UI surface which supplied the glyph.
   * @returns Supported visible entity, or null.
   */
  function resolveGlyph(
    glyphInfo: GlyphInfo,
    source: ResolvedVisibleEntity["source"],
  ): ResolvedVisibleEntity | null {
    if (
      !Number.isSafeInteger(glyphInfo.glyph)
      || glyphInfo.glyph < 0
      || glyphInfo.glyph >= options.maxGlyph
    ) {
      return null;
    }
    const result = options.bindingForGlyph(glyphInfo.glyph);
    if (!result || result.status !== "supported") return null;
    return {
      entityId: entityIdForBinding(result.binding),
      glyph: glyphInfo.glyph,
      source,
      binding: result.binding,
    };
  }

  return {
    resolveMapCell(cell): ResolvedVisibleEntity | null {
      if (cell.foreground) {
        return resolveGlyph(cell.foreground, "map-foreground");
      }
      return cell.background
        ? resolveGlyph(cell.background, "map-background")
        : null;
    },

    resolveInventoryItem(
      item,
      visibleEntityToken,
    ): ResolvedVisibleEntity | null {
      if (!item.glyph) return null;
      const resolved = resolveGlyph(item.glyph, "inventory");
      if (!resolved) return null;
      if (
        resolved.binding.kind !== "object"
        && resolved.binding.kind !== "generic-object"
      ) {
        return resolved;
      }
      const displayedObjectId = resolved.binding.kind === "object"
        ? resolved.binding.objectId
        : options.objectIdForGlyph(resolved.glyph);
      if (displayedObjectId === null) return resolved;
      const visibleEntityId = validateVisibleEntityToken(
        visibleEntityToken,
        {
          displayedObjectId,
          knownObjectIds: options.knownObjectIds,
          artifactBaseObjects: options.artifactBaseObjects,
        },
      );
      return visibleEntityId === null
        ? resolved
        : { ...resolved, entityId: visibleEntityId };
    },
  };
}

/**
 * Capture the displayed map target by value at the moment intent begins.
 * @param state Current module, session, revision, coordinate, and map cell.
 * @returns Immutable target identity, or null for an empty cell.
 */
export function captureMapExamineTarget(
  state: MapTargetState,
): MapExamineCapture | null {
  const glyph = state.cell.foreground ?? state.cell.background;
  if (!glyph) return null;
  return {
    surface: "map",
    moduleId: state.moduleId,
    sessionId: state.sessionId,
    mapRevision: state.mapRevision,
    mapX: state.mapX,
    mapY: state.mapY,
    source: state.cell.foreground
      ? "map-foreground"
      : "map-background",
    glyph: { ...glyph },
  };
}

/**
 * Check whether a captured map identity still matches the live display.
 * @param target Previously captured target.
 * @param state Current state at handoff time.
 * @returns True only while every bound identity field remains unchanged.
 */
export function isMapExamineTargetCurrent(
  target: MapExamineCapture,
  state: MapTargetState,
): boolean {
  const glyph = state.cell.foreground ?? state.cell.background;
  const source = state.cell.foreground
    ? "map-foreground"
    : "map-background";
  return target.moduleId === state.moduleId
    && target.sessionId === state.sessionId
    && target.mapRevision === state.mapRevision
    && target.mapX === state.mapX
    && target.mapY === state.mapY
    && target.source === source
    && glyphsEqual(target.glyph, glyph);
}

/**
 * Capture the displayed inventory row identity by value.
 * @param state Current module, session, inventory revision, and row.
 * @returns Immutable target identity, or null for a row without a glyph.
 */
export function captureInventoryExamineTarget(
  state: InventoryTargetState,
): InventoryExamineCapture | null {
  if (!state.item.glyph || state.item.identifier === null) return null;
  return {
    surface: "inventory",
    moduleId: state.moduleId,
    sessionId: state.sessionId,
    inventoryRevision: state.inventoryRevision,
    identifier: state.item.identifier,
    accelerator: state.item.accelerator,
    source: "inventory",
    glyph: { ...state.item.glyph },
    visibleEntityToken: state.visibleEntityToken,
  };
}

/**
 * Check whether a captured inventory identity still matches the live row.
 * @param target Previously captured target.
 * @param state Current state at handoff time.
 * @returns True only while every bound identity field remains unchanged.
 */
export function isInventoryExamineTargetCurrent(
  target: InventoryExamineCapture,
  state: InventoryTargetState,
): boolean {
  return target.moduleId === state.moduleId
    && target.sessionId === state.sessionId
    && target.inventoryRevision === state.inventoryRevision
    && target.identifier === state.item.identifier
    && target.accelerator === state.item.accelerator
    && target.visibleEntityToken === state.visibleEntityToken
    && glyphsEqual(target.glyph, state.item.glyph);
}

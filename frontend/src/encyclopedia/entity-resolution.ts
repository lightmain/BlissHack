import type { GlyphInfo, MapCell, MenuItem } from "../game-state";
import type {
  GlyphBinding,
  GlyphBindingResult,
} from "./core-schema";
import { validateVisibleArtifactToken } from "./visible-entity-token";

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

export interface MapExamineTarget {
  moduleId: string;
  sessionId: string;
  mapRevision: number;
  mapX: number;
  mapY: number;
  glyph: GlyphInfo;
}

interface InventoryTargetState {
  moduleId: string;
  sessionId: string;
  inventoryRevision: number;
  item: MenuItem;
  visibleEntityToken: string | null;
}

export interface InventoryExamineTarget {
  moduleId: string;
  sessionId: string;
  inventoryRevision: number;
  identifier: number | null;
  accelerator: number;
  glyph: GlyphInfo;
  visibleEntityToken: string | null;
}

/**
 * Create a resolver which maps only final display glyphs to catalog entities.
 * @param options Bound glyph lookup and artifact-to-base-object catalog.
 * @returns Synchronous map and inventory resolution methods.
 */
export function createEntityResolver(options: {
  maxGlyph: number;
  bindingForGlyph: (glyph: number) => GlyphBindingResult | null;
  artifactBaseObjects: ReadonlyMap<string, string>;
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
      if (resolved.binding.kind !== "object") return resolved;
      const artifactId = validateVisibleArtifactToken(
        visibleEntityToken,
        resolved.binding.objectId,
        options.artifactBaseObjects,
      );
      return artifactId === null
        ? resolved
        : { ...resolved, entityId: artifactId };
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
): MapExamineTarget | null {
  const glyph = state.cell.foreground ?? state.cell.background;
  if (!glyph) return null;
  return {
    moduleId: state.moduleId,
    sessionId: state.sessionId,
    mapRevision: state.mapRevision,
    mapX: state.mapX,
    mapY: state.mapY,
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
  target: MapExamineTarget,
  state: MapTargetState,
): boolean {
  const glyph = state.cell.foreground ?? state.cell.background;
  return target.moduleId === state.moduleId
    && target.sessionId === state.sessionId
    && target.mapRevision === state.mapRevision
    && target.mapX === state.mapX
    && target.mapY === state.mapY
    && glyphsEqual(target.glyph, glyph);
}

/**
 * Capture the displayed inventory row identity by value.
 * @param state Current module, session, inventory revision, and row.
 * @returns Immutable target identity, or null for a row without a glyph.
 */
export function captureInventoryExamineTarget(
  state: InventoryTargetState,
): InventoryExamineTarget | null {
  if (!state.item.glyph) return null;
  return {
    moduleId: state.moduleId,
    sessionId: state.sessionId,
    inventoryRevision: state.inventoryRevision,
    identifier: state.item.identifier,
    accelerator: state.item.accelerator,
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
  target: InventoryExamineTarget,
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

/**
 * Select the public entity represented by one validated glyph binding.
 * @param binding Binding produced by the generated core catalog.
 * @returns Stable entity ID to load.
 */
function entityIdForBinding(binding: GlyphBinding): string {
  switch (binding.kind) {
    case "monster":
      return binding.monsterId;
    case "corpse":
    case "statue":
      return binding.monsterId;
    case "generic-object":
      return binding.appearanceId;
    case "object":
      return binding.objectId;
    case "terrain":
      return binding.terrainId;
    case "trap":
      return binding.trapId;
  }
}

/**
 * Compare every copied field in two display glyph structures.
 * @param left First glyph.
 * @param right Second glyph.
 * @returns True when both glyph values are identical.
 */
function glyphsEqual(
  left: GlyphInfo | null,
  right: GlyphInfo | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return left.glyph === right.glyph
    && left.ttyChar === right.ttyChar
    && left.frameColor === right.frameColor
    && left.glyphFlags === right.glyphFlags
    && left.color === right.color
    && left.symbolIndex === right.symbolIndex
    && left.customColor === right.customColor
    && left.color256 === right.color256
    && left.tileIndex === right.tileIndex;
}

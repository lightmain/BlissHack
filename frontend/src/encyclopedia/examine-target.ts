import type { GlyphInfo } from "../game-state";
import type { GlyphBinding } from "./core-schema";
import type { EncyclopediaLoader } from "./encyclopedia-loader";
import { validateVisibleArtifactToken } from "./visible-entity-token";

/** Display identity captured from one committed map cell. */
export interface MapExamineCapture {
  surface: "map";
  moduleId: string;
  sessionId: string;
  mapRevision: number;
  mapX: number;
  mapY: number;
  source: "map-foreground" | "map-background";
  glyph: GlyphInfo;
}

/** Display identity captured from one committed permanent-inventory row. */
export interface InventoryExamineCapture {
  surface: "inventory";
  moduleId: string;
  sessionId: string;
  inventoryRevision: number;
  identifier: number;
  accelerator: number;
  source: "inventory";
  glyph: GlyphInfo;
  visibleEntityToken: string | null;
}

export type ExamineCapture = MapExamineCapture | InventoryExamineCapture;

export interface MapExamineTarget extends MapExamineCapture {
  entityId: string;
}

export interface InventoryExamineTarget extends InventoryExamineCapture {
  entityId: string;
}

export type ExamineTarget = MapExamineTarget | InventoryExamineTarget;

/**
 * Resolve one copied display identity through the runtime-bound local catalog.
 * @param loader Loader bound to the active module's immutable runtime identity.
 * @param capture Final glyph and revision copied when the context request began.
 * @param signal Caller-owned cancellation signal.
 * @returns A supported semantic target, or null without guessing.
 */
export async function resolveExamineCapture(
  loader: EncyclopediaLoader,
  capture: ExamineCapture,
  signal?: AbortSignal,
): Promise<ExamineTarget | null> {
  const result = await loader.loadGlyphBinding(capture.glyph.glyph, { signal });
  if (!result || result.status !== "supported") return null;

  let entityId = entityIdForBinding(result.binding);
  if (
    capture.surface === "inventory"
    && result.binding.kind === "object"
    && capture.visibleEntityToken !== null
  ) {
    const artifactBaseObjects = await loader.loadArtifactBaseObjects({ signal });
    entityId = validateVisibleArtifactToken(
      capture.visibleEntityToken,
      result.binding.objectId,
      artifactBaseObjects,
    ) ?? entityId;
  }
  return cloneExamineTarget({ ...capture, entityId });
}

/**
 * Select the public entity represented by one validated glyph binding.
 * @param binding Binding produced by the generated core catalog.
 * @returns Stable entity ID to load.
 */
export function entityIdForBinding(binding: GlyphBinding): string {
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
 * Copy every target field before crossing controller and React boundaries.
 * @param target Validated visible target.
 * @returns An independent target and glyph value.
 */
export function cloneExamineTarget(target: ExamineTarget): ExamineTarget {
  return target.surface === "map"
    ? { ...target, glyph: { ...target.glyph } }
    : { ...target, glyph: { ...target.glyph } };
}

/**
 * Compare complete visible target identities without using object identity.
 * @param left First copied target.
 * @param right Second copied target.
 * @returns Whether both targets describe the same committed display identity.
 */
export function examineTargetsEqual(
  left: ExamineTarget | null,
  right: ExamineTarget | null,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.surface !== right.surface) return false;
  if (
    left.entityId !== right.entityId
    || left.moduleId !== right.moduleId
    || left.sessionId !== right.sessionId
    || left.source !== right.source
    || !glyphsEqual(left.glyph, right.glyph)
  ) {
    return false;
  }
  if (left.surface === "map" && right.surface === "map") {
    return left.mapRevision === right.mapRevision
      && left.mapX === right.mapX
      && left.mapY === right.mapY;
  }
  if (left.surface === "inventory" && right.surface === "inventory") {
    return left.inventoryRevision === right.inventoryRevision
      && left.identifier === right.identifier
      && left.accelerator === right.accelerator
      && left.visibleEntityToken === right.visibleEntityToken;
  }
  return false;
}

/**
 * Compare all copied glyph fields supplied by the core.
 * @param left First glyph.
 * @param right Second glyph.
 * @returns Whether both glyph values are identical.
 */
export function glyphsEqual(
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

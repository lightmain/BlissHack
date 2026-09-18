import type { CharacterSetupStyle } from "../settings/profile";
import type { SaveIdentity } from "../storage/storage-service";

/** One selectable character aspect copied from the current NetHack build. */
export interface CharacterOption {
  index: number;
  name: string;
  fileCode: string;
  accelerator: string;
  allow: number;
  femaleName?: string;
  maleGlyph?: number;
  femaleGlyph?: number;
  maleTileIndex?: number;
  femaleTileIndex?: number;
}

/** Authoritative character metadata copied into JavaScript during WASM startup. */
export interface CharacterCatalog {
  schemaVersion: 1;
  masks: {
    race: number;
    gender: number;
    alignment: number;
  };
  roles: CharacterOption[];
  races: CharacterOption[];
  genders: CharacterOption[];
  alignments: CharacterOption[];
  legalTupleCount: number;
}

/** One complete role, race, gender, and alignment selection. */
export interface CharacterTuple {
  role: number;
  race: number;
  gender: number;
  alignment: number;
}

/** A partial selection being edited by the character setup UI. */
export interface CharacterSelection {
  role: number | null;
  race: number | null;
  gender: number | null;
  alignment: number | null;
}

/** One independently selectable character aspect. */
export type CharacterAspect = keyof CharacterSelection;

/** Stable ownership token carried by every character setup command. */
export interface CharacterSetupOwnerToken {
  moduleId: string;
  sessionId: string;
}

/** Session-owned inputs needed before the NetHack character callbacks run. */
export interface CharacterSetupContext extends CharacterSetupOwnerToken {
  style: CharacterSetupStyle;
  saveIdentities: readonly SaveIdentity[];
}

const OPTION_KEYS = new Set([
  "index",
  "name",
  "fileCode",
  "accelerator",
  "allow",
  "femaleName",
  "maleGlyph",
  "femaleGlyph",
  "maleTileIndex",
  "femaleTileIndex",
]);
const CATALOG_KEYS = new Set([
  "schemaVersion",
  "masks",
  "roles",
  "races",
  "genders",
  "alignments",
  "legalTupleCount",
]);
const MASK_KEYS = new Set(["race", "gender", "alignment"]);
const CHARACTER_ASPECTS: readonly CharacterAspect[] = [
  "role",
  "race",
  "gender",
  "alignment",
];

/**
 * Decode the versioned character catalog supplied by the current WASM build.
 * @param value - untrusted global value created by Emscripten.
 * @returns a validated catalog without any handwritten fallback entries.
 */
export function decodeCharacterCatalog(value: unknown): CharacterCatalog {
  const source = requireRecord(value, "character metadata");
  requireKnownKeys(source, CATALOG_KEYS, "character metadata");
  if (source.schemaVersion !== 1) {
    throw new Error("Unsupported character metadata schema");
  }

  const masks = requireRecord(source.masks, "character metadata masks");
  requireKnownKeys(masks, MASK_KEYS, "character metadata masks");
  const catalog: CharacterCatalog = {
    schemaVersion: 1,
    masks: {
      race: requireInteger(masks.race, "character metadata race mask", 1),
      gender: requireInteger(masks.gender, "character metadata gender mask", 1),
      alignment: requireInteger(
        masks.alignment,
        "character metadata alignment mask",
        1,
      ),
    },
    roles: decodeOptions(source.roles, "roles"),
    races: decodeOptions(source.races, "races"),
    genders: decodeOptions(source.genders, "genders"),
    alignments: decodeOptions(source.alignments, "alignments"),
    legalTupleCount: requireInteger(
      source.legalTupleCount,
      "character metadata legal tuple count",
      1,
    ),
  };
  return catalog;
}

/**
 * Enumerate every complete selection allowed by the catalog compatibility masks.
 * @param catalog - validated metadata from the current NetHack build.
 * @returns tuples in stable role, race, gender, and alignment order.
 */
export function buildLegalCharacterTuples(
  catalog: CharacterCatalog,
): CharacterTuple[] {
  const tuples: CharacterTuple[] = [];
  for (const role of catalog.roles) {
    for (const race of catalog.races) {
      if ((role.allow & race.allow & catalog.masks.race) === 0) continue;
      for (const gender of catalog.genders) {
        if (
          (role.allow & race.allow & gender.allow & catalog.masks.gender) === 0
        ) {
          continue;
        }
        for (const alignment of catalog.alignments) {
          if (
            (
              role.allow
              & race.allow
              & alignment.allow
              & catalog.masks.alignment
            ) === 0
          ) {
            continue;
          }
          tuples.push({
            role: role.index,
            race: race.index,
            gender: gender.index,
            alignment: alignment.index,
          });
        }
      }
    }
  }
  if (tuples.length !== catalog.legalTupleCount) {
    throw new Error(
      "Character metadata compatibility masks disagree with the core",
    );
  }
  return tuples;
}

/**
 * Keep legal tuples which contain every currently selected aspect.
 * @param tuples - complete legal tuple set.
 * @param selection - partial selection used as constraints.
 * @returns matching tuples in their original stable order.
 */
export function filterCharacterTuples(
  tuples: readonly CharacterTuple[],
  selection: CharacterSelection,
): CharacterTuple[] {
  return tuples.filter((tuple) =>
    CHARACTER_ASPECTS.every((aspect) =>
      selection[aspect] === null || tuple[aspect] === selection[aspect]));
}

/**
 * Apply one choice and clear the first incompatible trailing choice and suffix.
 * @param tuples - complete legal tuple set.
 * @param selection - current partial selection.
 * @param aspect - aspect being changed.
 * @param value - authoritative option index being selected.
 * @returns the updated partial selection.
 */
export function updateCharacterSelection(
  tuples: readonly CharacterTuple[],
  selection: CharacterSelection,
  aspect: CharacterAspect,
  value: number,
): CharacterSelection {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Character selection index must be a non-negative integer");
  }
  const changedIndex = CHARACTER_ASPECTS.indexOf(aspect);
  const updated: CharacterSelection = { ...selection, [aspect]: value };

  for (
    let index = changedIndex + 1;
    index < CHARACTER_ASPECTS.length;
    index += 1
  ) {
    const trailingAspect = CHARACTER_ASPECTS[index];
    if (updated[trailingAspect] === null) continue;
    const prefix: CharacterSelection = {
      role: updated.role,
      race: index >= 1 ? updated.race : null,
      gender: index >= 2 ? updated.gender : null,
      alignment: index >= 3 ? updated.alignment : null,
    };
    if (filterCharacterTuples(tuples, prefix).length > 0) continue;
    for (
      let suffixIndex = index;
      suffixIndex < CHARACTER_ASPECTS.length;
      suffixIndex += 1
    ) {
      updated[CHARACTER_ASPECTS[suffixIndex]] = null;
    }
    break;
  }
  return updated;
}

/**
 * Decode one ordered option list and require contiguous build indices.
 * @param value - untrusted option array.
 * @param label - aspect name used in validation failures.
 * @returns validated options.
 */
function decodeOptions(value: unknown, label: string): CharacterOption[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Character metadata ${label} must be a non-empty array`);
  }
  return value.map((entry, expectedIndex) => {
    const source = requireRecord(entry, `character metadata ${label} option`);
    requireKnownKeys(
      source,
      OPTION_KEYS,
      `character metadata ${label} option`,
    );
    const index = requireInteger(
      source.index,
      `character metadata ${label} index`,
      0,
    );
    if (index !== expectedIndex) {
      throw new Error(`Character metadata ${label} indices are not contiguous`);
    }
    const option: CharacterOption = {
      index,
      name: requireString(source.name, `character metadata ${label} name`),
      fileCode: requireString(
        source.fileCode,
        `character metadata ${label} file code`,
      ),
      accelerator: requireAccelerator(
        source.accelerator,
        `character metadata ${label} accelerator`,
      ),
      allow: requireInteger(
        source.allow,
        `character metadata ${label} allow mask`,
        0,
      ),
    };
    copyOptionalString(source, option, "femaleName", label);
    copyOptionalInteger(source, option, "maleGlyph", label);
    copyOptionalInteger(source, option, "femaleGlyph", label);
    copyOptionalInteger(source, option, "maleTileIndex", label);
    copyOptionalInteger(source, option, "femaleTileIndex", label);
    return option;
  });
}

/**
 * Copy one optional string field after validation.
 * @param source - untrusted option record.
 * @param target - validated option under construction.
 * @param key - supported optional string field.
 * @param label - aspect name used in validation failures.
 */
function copyOptionalString(
  source: Record<string, unknown>,
  target: CharacterOption,
  key: "femaleName",
  label: string,
): void {
  if (source[key] !== undefined) {
    target[key] = requireString(
      source[key],
      `character metadata ${label} ${key}`,
    );
  }
}

/**
 * Copy one optional integer field after validation.
 * @param source - untrusted option record.
 * @param target - validated option under construction.
 * @param key - supported optional integer field.
 * @param label - aspect name used in validation failures.
 */
function copyOptionalInteger(
  source: Record<string, unknown>,
  target: CharacterOption,
  key: "maleGlyph" | "femaleGlyph" | "maleTileIndex" | "femaleTileIndex",
  label: string,
): void {
  if (source[key] !== undefined) {
    target[key] = requireInteger(
      source[key],
      `character metadata ${label} ${key}`,
      0,
    );
  }
}

/**
 * Require a plain object from the WASM metadata boundary.
 * @param value - untrusted value.
 * @param label - value name used in validation failures.
 * @returns the object record.
 */
function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Reject fields not defined by the current versioned metadata schema.
 * @param value - object whose own keys are checked.
 * @param keys - allowed field names.
 * @param label - value name used in validation failures.
 */
function requireKnownKeys(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown) throw new Error(`${label} contains unknown field ${unknown}`);
}

/**
 * Require a finite integer at or above a lower bound.
 * @param value - untrusted value.
 * @param label - value name used in validation failures.
 * @param minimum - smallest accepted integer.
 * @returns the validated integer.
 */
function requireInteger(
  value: unknown,
  label: string,
  minimum: number,
): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < minimum
  ) {
    throw new Error(`${label} must be an integer at least ${minimum}`);
  }
  return value;
}

/**
 * Require a non-empty metadata string.
 * @param value - untrusted value.
 * @param label - value name used in validation failures.
 * @returns the validated string.
 */
function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

/**
 * Require exactly one Unicode character for a keyboard accelerator.
 * @param value - untrusted value.
 * @param label - value name used in validation failures.
 * @returns the validated accelerator.
 */
function requireAccelerator(value: unknown, label: string): string {
  const accelerator = requireString(value, label);
  if ([...accelerator].length !== 1) {
    throw new Error(`${label} must contain exactly one character`);
  }
  return accelerator;
}

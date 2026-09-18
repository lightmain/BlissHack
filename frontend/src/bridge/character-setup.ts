import type { CharacterSetupStyle } from "../settings/profile";
import type { MapRenderer } from "../settings/profile";
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

/** Keyboard focus targets within the unified setup screen. */
export type CharacterSetupFocus = "name" | CharacterAspect | "confirm";

/** User-visible phases of one character setup flow. */
export type CharacterSetupPhase =
  | "entering-name"
  | "selecting"
  | "ready"
  | "continuing-save"
  | "auto-selecting"
  | "starting"
  | "cancelled";

/** Availability and selection state for one catalog option. */
export interface CharacterCandidateState {
  index: number;
  enabled: boolean;
  selected: boolean;
  locked: boolean;
}

/** Immutable state exposed by the character setup controller. */
export interface CharacterSetupState {
  owner: CharacterSetupOwnerToken;
  phase: CharacterSetupPhase;
  name: string;
  normalizedName: string;
  matchedSave: SaveIdentity | null;
  selection: CharacterSelection;
  focus: CharacterSetupFocus;
  locked: boolean;
  canConfirm: boolean;
  canAuto: boolean;
  candidates: Record<CharacterAspect, readonly CharacterCandidateState[]>;
  preview:
    | { kind: "tiles"; tileIndex: number | null }
    | { kind: "ascii"; text: "@" };
}

/** External effects invoked only after an owner-safe state transition. */
export interface CharacterSetupControllerOptions {
  scope: CharacterSetupOwnerToken;
  catalog: CharacterCatalog;
  mapRenderer: MapRenderer;
  saveIdentities: readonly SaveIdentity[];
  initialSelection?: CharacterTuple | null;
  onSubmitName(
    name: string,
    owner: CharacterSetupOwnerToken,
  ): void;
  onSubmitSelection(
    selection: CharacterTuple,
    owner: CharacterSetupOwnerToken,
  ): void;
  onNativeChoice(
    choice: "y" | "a",
    owner: CharacterSetupOwnerToken,
  ): boolean;
  onNativeConfirm(owner: CharacterSetupOwnerToken): void;
  onCancel(owner: CharacterSetupOwnerToken): void;
}

/** Pure coordinator for setup editing and bridge commands. */
export interface CharacterSetupController {
  getState(): CharacterSetupState;
  subscribe(listener: () => void): () => void;
  setName(value: string, owner: CharacterSetupOwnerToken): boolean;
  pressEnter(owner: CharacterSetupOwnerToken): boolean;
  selectOption(
    aspect: CharacterAspect,
    index: number,
    owner: CharacterSetupOwnerToken,
  ): boolean;
  pressAccelerator(
    accelerator: string,
    owner: CharacterSetupOwnerToken,
  ): boolean;
  requestAuto(owner: CharacterSetupOwnerToken): boolean;
  requestAutoAndStart(owner: CharacterSetupOwnerToken): boolean;
  acceptNativeSelection(
    selection: CharacterTuple,
    owner: CharacterSetupOwnerToken,
  ): boolean;
  applyCoreSelection(
    selection: CharacterTuple,
    owner: CharacterSetupOwnerToken,
  ): boolean;
  pressEscape(owner: CharacterSetupOwnerToken): boolean;
  cancel(owner: CharacterSetupOwnerToken): boolean;
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
const PLAYER_NAME_MAX_BYTES = 31;

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
 * Normalize a player name before submitting it to plnamesuffix().
 * @param value - editable browser input.
 * @returns trimmed text capped to NetHack's 31-byte UTF-8 payload.
 */
export function normalizeCharacterNameInput(value: string): string {
  const encoder = new TextEncoder();
  const trimmed = value.trim();
  let result = "";
  let used = 0;
  for (const character of trimmed) {
    const bytes = encoder.encode(character).length;
    if (used + bytes > PLAYER_NAME_MAX_BYTES) break;
    result += character;
    used += bytes;
  }
  return result;
}

/**
 * Apply the name rewriting performed by the core before save lookup.
 * @param value - already normalized player input.
 * @returns the effective save identity name.
 */
export function playerNameForSaveLookup(value: string): string {
  return value.split("-", 1)[0].replaceAll(",", " ");
}

/**
 * Create one session-owned controller for the unified setup screen.
 * @param options - authoritative metadata, save identities, and bridge effects.
 * @returns an observable pure state machine.
 */
export function createCharacterSetupController(
  options: CharacterSetupControllerOptions,
): CharacterSetupController {
  const tuples = buildLegalCharacterTuples(options.catalog);
  const listeners = new Set<() => void>();
  let nativeConfirmation = false;
  let state = createCharacterSetupState(options, tuples);

  /** Publish a complete immutable state replacement. */
  function publish(next: CharacterSetupState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  /** Reject commands from stale mounted screens. */
  function owns(owner: CharacterSetupOwnerToken): boolean {
    return owner.moduleId === options.scope.moduleId
      && owner.sessionId === options.scope.sessionId;
  }

  /** Recompute all derived controls after a selection change. */
  function publishSelection(
    selection: CharacterSelection,
    preferredFocus?: CharacterSetupFocus,
  ): void {
    const complete = completeCharacterSelection(selection);
    publish(deriveCharacterSetupState(
      {
        ...state,
        phase: complete ? "ready" : "selecting",
        selection,
        focus: preferredFocus
          ?? (complete ? "confirm" : firstMissingAspect(selection)),
      },
      options,
      tuples,
      nativeConfirmation,
    ));
  }

  /** Apply a complete legal tuple without invoking a bridge effect. */
  function applyCompleteSelection(
    selection: CharacterTuple,
    owner: CharacterSetupOwnerToken,
    native: boolean,
  ): boolean {
    if (!owns(owner) || !isLegalCharacterTuple(tuples, selection)) return false;
    nativeConfirmation = native;
    publishSelection({ ...selection }, "confirm");
    return true;
  }

  return {
    /** Read the current immutable state. */
    getState: () => state,

    /** Subscribe to state replacements. */
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Update the editable name and any exact save match. */
    setName(value, owner): boolean {
      if (!owns(owner) || state.phase !== "entering-name") return false;
      const normalizedName = normalizeCharacterNameInput(value);
      const lookupName = playerNameForSaveLookup(normalizedName);
      const candidateSave = options.saveIdentities.find(
        (identity) => identity.playerName === lookupName,
      ) ?? null;
      const saveSelection = candidateSave
        ? characterSelectionFromSave(options.catalog, tuples, candidateSave)
        : null;
      const matchedSave = saveSelection ? candidateSave : null;
      nativeConfirmation = false;
      publish(deriveCharacterSetupState(
        {
          ...state,
          name: value,
          normalizedName,
          matchedSave,
          selection: saveSelection ?? emptyCharacterSelection(),
          focus: "name",
          locked: matchedSave !== null,
        },
        options,
        tuples,
        nativeConfirmation,
      ));
      return true;
    },

    /** Advance name entry or submit a complete setup. */
    pressEnter(owner): boolean {
      if (!owns(owner)) return false;
      if (state.phase === "entering-name") {
        if (!state.normalizedName) return false;
        options.onSubmitName(state.normalizedName, owner);
        if (state.matchedSave) {
          publish({ ...state, phase: "continuing-save" });
        } else {
          publish(deriveCharacterSetupState(
            { ...state, phase: "selecting", focus: "role" },
            options,
            tuples,
            nativeConfirmation,
          ));
        }
        return true;
      }
      if (state.phase !== "ready") return false;
      const selection = completeCharacterSelection(state.selection);
      if (!selection) return false;
      publish({ ...state, phase: "starting" });
      if (nativeConfirmation) options.onNativeConfirm(owner);
      else options.onSubmitSelection(selection, owner);
      return true;
    },

    /** Select one enabled option and move focus to the next incomplete column. */
    selectOption(aspect, index, owner): boolean {
      if (
        !owns(owner)
        || state.locked
        || (state.phase !== "selecting" && state.phase !== "ready")
      ) {
        return false;
      }
      const candidate = state.candidates[aspect].find(
        (entry) => entry.index === index,
      );
      if (!candidate?.enabled) return false;
      const selection = updateCharacterSelection(
        tuples,
        state.selection,
        aspect,
        index,
      );
      const aspectIndex = CHARACTER_ASPECTS.indexOf(aspect);
      const nextFocus = CHARACTER_ASPECTS
        .slice(aspectIndex + 1)
        .find((entry) => selection[entry] === null)
        ?? firstMissingAspect(selection);
      publishSelection(selection, nextFocus);
      return true;
    },

    /** Select the enabled option matching the focused column accelerator. */
    pressAccelerator(accelerator, owner): boolean {
      if (!owns(owner) || !CHARACTER_ASPECTS.includes(
        state.focus as CharacterAspect,
      )) {
        return false;
      }
      const aspect = state.focus as CharacterAspect;
      const optionsForAspect = characterOptionsFor(
        options.catalog,
        aspect,
      );
      const match = optionsForAspect.find(
        (option) =>
          option.accelerator === accelerator
          && state.candidates[aspect].some(
            (candidate) =>
              candidate.index === option.index && candidate.enabled,
          ),
      );
      return match ? this.selectOption(aspect, match.index, owner) : false;
    },

    /** Delegate random selection to the core and wait for its confirmation. */
    requestAuto(owner): boolean {
      if (!owns(owner) || !state.canAuto) return false;
      if (!options.onNativeChoice("y", owner)) return false;
      nativeConfirmation = true;
      publish({ ...state, phase: "auto-selecting" });
      return true;
    },

    /** Delegate random selection and immediate start to the core. */
    requestAutoAndStart(owner): boolean {
      if (!owns(owner) || !state.canAuto) return false;
      if (!options.onNativeChoice("a", owner)) return false;
      nativeConfirmation = false;
      publish({ ...state, phase: "starting" });
      return true;
    },

    /** Accept the core's generated tuple at the intercepted confirmation menu. */
    acceptNativeSelection(selection, owner): boolean {
      if (state.phase !== "auto-selecting") return false;
      return applyCompleteSelection(selection, owner, true);
    },

    /** Import command-line or configuration selections before manual editing. */
    applyCoreSelection(selection, owner): boolean {
      if (state.phase !== "selecting") return false;
      return applyCompleteSelection(selection, owner, false);
    },

    /** Treat Escape as the explicit setup cancellation command. */
    pressEscape(owner): boolean {
      return this.cancel(owner);
    },

    /** End setup through the owner-safe bridge cancellation path. */
    cancel(owner): boolean {
      if (
        !owns(owner)
        || state.phase === "starting"
        || state.phase === "continuing-save"
        || state.phase === "cancelled"
      ) {
        return false;
      }
      nativeConfirmation = false;
      publish({ ...state, phase: "cancelled" });
      options.onCancel(owner);
      return true;
    },
  };
}

/**
 * Build the initial controller state, optionally honoring complete core flags.
 * @param options - controller configuration.
 * @param tuples - complete legal tuple set.
 * @returns initial immutable state.
 */
function createCharacterSetupState(
  options: CharacterSetupControllerOptions,
  tuples: readonly CharacterTuple[],
): CharacterSetupState {
  const initialSelection = options.initialSelection
    && isLegalCharacterTuple(tuples, options.initialSelection)
    ? { ...options.initialSelection }
    : emptyCharacterSelection();
  return deriveCharacterSetupState(
    {
      owner: { ...options.scope },
      phase: "entering-name",
      name: "",
      normalizedName: "",
      matchedSave: null,
      selection: initialSelection,
      focus: "name",
      locked: false,
      canConfirm: false,
      canAuto: false,
      candidates: {
        role: [],
        race: [],
        gender: [],
        alignment: [],
      },
      preview: options.mapRenderer === "tiles"
        ? { kind: "tiles", tileIndex: null }
        : { kind: "ascii", text: "@" },
    },
    options,
    tuples,
    false,
  );
}

/**
 * Recompute candidates, actions, and preview from primary controller fields.
 * @param state - primary state after one transition.
 * @param options - immutable controller configuration.
 * @param tuples - complete legal tuple set.
 * @param nativeConfirmation - whether the core confirmation menu is pending.
 * @returns state with current derived values.
 */
function deriveCharacterSetupState(
  state: CharacterSetupState,
  options: CharacterSetupControllerOptions,
  tuples: readonly CharacterTuple[],
  nativeConfirmation: boolean,
): CharacterSetupState {
  const complete = completeCharacterSelection(state.selection);
  const canInteract = state.phase === "selecting" || state.phase === "ready";
  return {
    ...state,
    canConfirm: state.locked
      ? state.normalizedName.length > 0
      : Boolean(complete) && canInteract,
    canAuto: !state.locked && !nativeConfirmation && canInteract,
    candidates: {
      role: buildCandidates("role", state, options.catalog, tuples),
      race: buildCandidates("race", state, options.catalog, tuples),
      gender: buildCandidates("gender", state, options.catalog, tuples),
      alignment: buildCandidates(
        "alignment",
        state,
        options.catalog,
        tuples,
      ),
    },
    preview: characterPreview(
      options.catalog,
      options.mapRenderer,
      state.selection,
    ),
  };
}

/**
 * Build one column's availability from the selected prefix only.
 * @param aspect - column represented by the candidates.
 * @param state - current setup state.
 * @param catalog - authoritative option metadata.
 * @param tuples - complete legal tuple set.
 * @returns ordered candidate state for rendering.
 */
function buildCandidates(
  aspect: CharacterAspect,
  state: CharacterSetupState,
  catalog: CharacterCatalog,
  tuples: readonly CharacterTuple[],
): CharacterCandidateState[] {
  const aspectIndex = CHARACTER_ASPECTS.indexOf(aspect);
  return characterOptionsFor(catalog, aspect).map((option) => {
    const constraints = emptyCharacterSelection();
    for (let index = 0; index < aspectIndex; index += 1) {
      const prefixAspect = CHARACTER_ASPECTS[index];
      constraints[prefixAspect] = state.selection[prefixAspect];
    }
    constraints[aspect] = option.index;
    return {
      index: option.index,
      enabled: !state.locked
        && filterCharacterTuples(tuples, constraints).length > 0,
      selected: state.selection[aspect] === option.index,
      locked: state.locked && state.selection[aspect] === option.index,
    };
  });
}

/**
 * Resolve the option list associated with one selection aspect.
 * @param catalog - authoritative metadata.
 * @param aspect - requested selection column.
 * @returns the corresponding ordered option list.
 */
export function characterOptionsFor(
  catalog: CharacterCatalog,
  aspect: CharacterAspect,
): readonly CharacterOption[] {
  switch (aspect) {
    case "role":
      return catalog.roles;
    case "race":
      return catalog.races;
    case "gender":
      return catalog.genders;
    case "alignment":
      return catalog.alignments;
  }
}

/**
 * Convert a complete partial selection into a tuple.
 * @param selection - selection which may still contain null fields.
 * @returns a complete tuple, or null when any aspect is missing.
 */
export function completeCharacterSelection(
  selection: CharacterSelection,
): CharacterTuple | null {
  return CHARACTER_ASPECTS.every((aspect) => selection[aspect] !== null)
    ? selection as CharacterTuple
    : null;
}

/** Create a fresh empty partial selection. */
function emptyCharacterSelection(): CharacterSelection {
  return {
    role: null,
    race: null,
    gender: null,
    alignment: null,
  };
}

/**
 * Find the first incomplete aspect, falling back to confirmation.
 * @param selection - current partial selection.
 * @returns next keyboard focus target.
 */
function firstMissingAspect(
  selection: CharacterSelection,
): CharacterSetupFocus {
  return CHARACTER_ASPECTS.find((aspect) => selection[aspect] === null)
    ?? "confirm";
}

/**
 * Check tuple membership without relying on display strings.
 * @param tuples - authoritative legal tuple set.
 * @param candidate - complete candidate tuple.
 * @returns whether the tuple is legal.
 */
function isLegalCharacterTuple(
  tuples: readonly CharacterTuple[],
  candidate: CharacterTuple,
): boolean {
  return tuples.some((tuple) =>
    CHARACTER_ASPECTS.every(
      (aspect) => tuple[aspect] === candidate[aspect],
    ));
}

/**
 * Convert one validated save identity from file codes to catalog indices.
 * @param catalog - current build metadata.
 * @param tuples - current build legal tuples.
 * @param identity - save metadata selected by exact normalized name.
 * @returns a legal tuple when all file codes still match this build.
 */
function characterSelectionFromSave(
  catalog: CharacterCatalog,
  tuples: readonly CharacterTuple[],
  identity: SaveIdentity,
): CharacterTuple | null {
  const role = catalog.roles.find((option) => option.fileCode === identity.role);
  const race = catalog.races.find((option) => option.fileCode === identity.race);
  const gender = catalog.genders.find(
    (option) => option.fileCode === identity.gender,
  );
  const alignment = catalog.alignments.find(
    (option) => option.fileCode === identity.alignment,
  );
  if (!role || !race || !gender || !alignment) return null;
  const selection = {
    role: role.index,
    race: race.index,
    gender: gender.index,
    alignment: alignment.index,
  };
  return isLegalCharacterTuple(tuples, selection) ? selection : null;
}

/**
 * Select the role preview without consulting uninitialized character status.
 * @param catalog - authoritative role and gender metadata.
 * @param renderer - active profile renderer.
 * @param selection - current partial selection.
 * @returns stable Tiles or ASCII preview data.
 */
function characterPreview(
  catalog: CharacterCatalog,
  renderer: MapRenderer,
  selection: CharacterSelection,
): CharacterSetupState["preview"] {
  if (renderer === "ascii") return { kind: "ascii", text: "@" };
  const role = selection.role === null
    ? null
    : catalog.roles[selection.role] ?? null;
  const gender = selection.gender === null
    ? null
    : catalog.genders[selection.gender] ?? null;
  const female = gender?.fileCode.toLocaleLowerCase() === "fem"
    || gender?.name.toLocaleLowerCase() === "female";
  return {
    kind: "tiles",
    tileIndex: female
      ? role?.femaleTileIndex ?? role?.maleTileIndex ?? null
      : role?.maleTileIndex ?? role?.femaleTileIndex ?? null,
  };
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

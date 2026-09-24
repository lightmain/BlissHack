import {
  createDefaultActionBarLayout,
  validateActionBarLayout,
  type ActionBarLayout,
} from "../action-bar/action-bar-layout";

/** Current browser and export schema version for BlissHack settings. */
export const PROFILE_SCHEMA_VERSION = 4;
/** Oldest profile schema accepted for migration. */
export const LEGACY_PROFILE_SCHEMA_VERSION = 1;
/** Intermediate profile schema which introduced the map renderer. */
export const PROFILE_SCHEMA_VERSION_V2 = 2;
/** Direct predecessor accepted for migration. */
export const PREVIOUS_PROFILE_SCHEMA_VERSION = 3;
/** Maximum accepted size of an imported profile document. */
export const PROFILE_IMPORT_MAX_BYTES = 1024 * 1024;

export const MAP_RENDERERS = ["tiles", "ascii"] as const;
export type MapRenderer = (typeof MAP_RENDERERS)[number];

export const INFORMATION_LEVELS = ["original", "detailed"] as const;
export type InformationLevel = (typeof INFORMATION_LEVELS)[number];

export const ENDGAME_STYLES = ["original", "blisshack"] as const;
export type EndgameStyle = (typeof ENDGAME_STYLES)[number];

export const CHARACTER_SETUP_STYLES = ["original", "blisshack"] as const;
export type CharacterSetupStyle = (typeof CHARACTER_SETUP_STYLES)[number];

export const ACTION_BAR_STYLES = ["original", "blisshack"] as const;
export type ActionBarStyle = (typeof ACTION_BAR_STYLES)[number];

export const TERMINAL_FONT_SIZES = ["small", "medium", "large"] as const;
export type TerminalFontSize = (typeof TERMINAL_FONT_SIZES)[number];

export const MESSAGE_HISTORY_LINES = [3, 5] as const;
export type MessageHistoryLines = (typeof MESSAGE_HISTORY_LINES)[number];

export const PERMANENT_INVENTORY_POSITIONS = [
  "right",
  "right-short",
  "below",
] as const;
const LEGACY_PERMANENT_INVENTORY_POSITIONS = ["right", "below"] as const;
export type PermanentInventoryPosition =
  (typeof PERMANENT_INVENTORY_POSITIONS)[number];

export const NUMBER_PAD_MODES = [0, 1, 2, 3, 4, -1] as const;
export type NumberPadMode = (typeof NUMBER_PAD_MODES)[number];

export const PERMINV_MODES = ["all", "full", "in-use"] as const;
export type PerminvMode = (typeof PERMINV_MODES)[number];

/**
 * Pickable object class symbols in NetHack's default inventory order.
 * Illegal objects and wizard-only venom are intentionally omitted.
 */
export const PICKUP_CLASS_SYMBOLS = [
  "$",
  "\"",
  ")",
  "[",
  "%",
  "?",
  "+",
  "!",
  "=",
  "/",
  "(",
  "*",
  "`",
  "0",
  "_",
] as const;
export type PickupClassSymbol = (typeof PICKUP_CLASS_SYMBOLS)[number];

export interface InterfaceSettingsV1 {
  terminalFontSize: TerminalFontSize;
  messageHistoryLines: MessageHistoryLines;
  followPlayer: boolean;
  permanentInventoryPosition: PermanentInventoryPosition;
  permanentInventoryCollapsed: boolean;
}

export interface InterfaceSettingsV2 extends InterfaceSettingsV1 {
  mapRenderer: MapRenderer;
}

export interface InterfaceSettingsV3 extends InterfaceSettingsV2 {
  informationLevel: InformationLevel;
  endgameStyle: EndgameStyle;
  characterSetupStyle: CharacterSetupStyle;
}

export interface InterfaceSettingsV4 extends InterfaceSettingsV3 {
  actionBarStyle: ActionBarStyle;
  actionBarLayout: ActionBarLayout;
}

export type InterfaceSettings = InterfaceSettingsV4;

export type PickupTypesV1 =
  | { mode: "all" }
  | { mode: "selected"; classes: PickupClassSymbol[] };

export interface NetHackSettingsV1 {
  tutorial: boolean;
  autopickup: boolean;
  pickupTypes: PickupTypesV1;
  numberPad: NumberPadMode;
  safePet: boolean;
  sortpack: boolean;
  showExperience: boolean;
  showTime: boolean;
  permInvent: boolean;
  perminvMode: PerminvMode;
}

export interface BlissHackProfileV1 {
  schemaVersion: 1;
  interface: InterfaceSettingsV1;
  nethack: NetHackSettingsV1;
}

export interface BlissHackProfileV2 {
  schemaVersion: 2;
  interface: InterfaceSettingsV2;
  nethack: NetHackSettingsV1;
}

export interface BlissHackProfileV3 {
  schemaVersion: 3;
  interface: InterfaceSettingsV3;
  nethack: NetHackSettingsV1;
}

export interface BlissHackProfileV4 {
  schemaVersion: 4;
  interface: InterfaceSettingsV4;
  nethack: NetHackSettingsV1;
}

export type BlissHackProfile = BlissHackProfileV4;

export interface BlissHackProfileExportV4 extends BlissHackProfileV4 {
  productVersion: string;
  exportedAt: string;
}

export type BlissHackProfileExport = BlissHackProfileExportV4;

export type ProfileFormatErrorCode =
  | "invalid-json"
  | "invalid-profile"
  | "unsupported-schema"
  | "invalid-encoding"
  | "file-too-large";

/** Validation failure with a stable code suitable for user-facing mapping. */
export class ProfileFormatError extends Error {
  readonly code: ProfileFormatErrorCode;

  constructor(code: ProfileFormatErrorCode, message: string) {
    super(message);
    this.name = "ProfileFormatError";
    this.code = code;
  }
}

type SupportedProfileSchemaVersion =
  | typeof LEGACY_PROFILE_SCHEMA_VERSION
  | typeof PROFILE_SCHEMA_VERSION_V2
  | typeof PREVIOUS_PROFILE_SCHEMA_VERSION
  | typeof PROFILE_SCHEMA_VERSION;

type ProfileDocumentMigrator = (
  profile: Record<string, unknown>,
) => BlissHackProfile;

const PROFILE_DOCUMENT_MIGRATORS: Record<
  SupportedProfileSchemaVersion,
  ProfileDocumentMigrator
> = {
  [LEGACY_PROFILE_SCHEMA_VERSION]: migrateProfileV1Document,
  [PROFILE_SCHEMA_VERSION_V2]: migrateProfileV2Document,
  [PREVIOUS_PROFILE_SCHEMA_VERSION]: migrateProfileV3Document,
  [PROFILE_SCHEMA_VERSION]: validateProfileV4Document,
};

/** Return a fresh profile so callers cannot mutate shared defaults. */
export function createDefaultProfile(): BlissHackProfile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    interface: {
      mapRenderer: "tiles",
      terminalFontSize: "medium",
      messageHistoryLines: 5,
      followPlayer: true,
      permanentInventoryPosition: "right",
      permanentInventoryCollapsed: false,
      informationLevel: "original",
      endgameStyle: "original",
      characterSetupStyle: "original",
      actionBarStyle: "original",
      actionBarLayout: createDefaultActionBarLayout(),
    },
    nethack: {
      tutorial: true,
      autopickup: true,
      pickupTypes: { mode: "all" },
      numberPad: 0,
      safePet: true,
      sortpack: true,
      showExperience: false,
      showTime: false,
      permInvent: false,
      perminvMode: "all",
    },
  };
}

/**
 * Migrate one strictly validated profile document to the current schema.
 * @param value - unknown persisted, imported, or embedded profile value.
 * @returns detached profile using the current schema.
 */
export function migrateProfileDocument(value: unknown): BlissHackProfile {
  const profile = requireRecord(value, "profile");
  assertExactKeys(profile, ["schemaVersion", "interface", "nethack"], "profile");
  const schemaVersion = profileSchemaVersion(profile.schemaVersion);
  return PROFILE_DOCUMENT_MIGRATORS[schemaVersion](profile);
}

/**
 * Validate and normalize an unknown profile into a detached current value.
 * Unknown and missing properties are rejected at every object level.
 */
export function validateProfile(value: unknown): BlissHackProfile {
  return migrateProfileDocument(value);
}

/**
 * Migrate a strict schema-v1 document to the current profile.
 * @param profile - untrusted profile object after root-key validation.
 * @returns a detached schema-v4 profile.
 */
function migrateProfileV1Document(
  profile: Record<string, unknown>,
): BlissHackProfile {
  const v2: BlissHackProfileV2 = {
    schemaVersion: PROFILE_SCHEMA_VERSION_V2,
    interface: migrateInterfaceSettingsV1(profile.interface),
    nethack: validateNetHackSettings(profile.nethack),
  };
  return migrateProfileV2Document(v2 as unknown as Record<string, unknown>);
}

/**
 * Migrate a strict schema-v2 document through the v3 presentation defaults.
 * @param profile - untrusted profile object after root-key validation.
 * @returns a detached schema-v4 profile.
 */
function migrateProfileV2Document(
  profile: Record<string, unknown>,
): BlissHackProfile {
  const v3: BlissHackProfileV3 = {
    schemaVersion: PREVIOUS_PROFILE_SCHEMA_VERSION,
    interface: migrateInterfaceSettingsV2(profile.interface),
    nethack: validateNetHackSettings(profile.nethack),
  };
  return migrateProfileV3Document(v3 as unknown as Record<string, unknown>);
}

/**
 * Migrate a strict schema-v3 document by adding action bar defaults.
 * @param profile - untrusted profile object after root-key validation.
 * @returns a detached schema-v4 profile.
 */
function migrateProfileV3Document(
  profile: Record<string, unknown>,
): BlissHackProfile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    interface: {
      ...validateInterfaceSettingsV3(profile.interface),
      actionBarStyle: "original",
      actionBarLayout: createDefaultActionBarLayout(),
    },
    nethack: validateNetHackSettings(profile.nethack),
  };
}

/**
 * Validate a strict current-schema document and detach nested values.
 * @param profile - untrusted profile object after root-key validation.
 * @returns a detached schema-v4 profile.
 */
function validateProfileV4Document(
  profile: Record<string, unknown>,
): BlissHackProfile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    interface: validateInterfaceSettings(profile.interface),
    nethack: validateNetHackSettings(profile.nethack),
  };
}

/** Parse one persisted JSON string using the strict profile schema. */
export function parseStoredProfile(json: string): BlissHackProfile {
  return validateProfile(parseJson(json));
}

/** Create a detached, strictly validated export document. */
export function createProfileExport(
  profile: BlissHackProfile,
  productVersion: string,
  exportedAt: Date = new Date(),
): BlissHackProfileExport {
  const normalized = validateProfile(profile);
  assertProductVersion(productVersion);
  if (Number.isNaN(exportedAt.getTime())) {
    throw invalidProfile("exportedAt must be a valid date");
  }
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    productVersion,
    exportedAt: exportedAt.toISOString(),
    interface: normalized.interface,
    nethack: normalized.nethack,
  };
}

/** Serialize an export with deterministic indentation and LF termination. */
export function serializeProfileExport(
  profile: BlissHackProfile,
  productVersion: string,
  exportedAt: Date = new Date(),
): string {
  return `${JSON.stringify(
    createProfileExport(profile, productVersion, exportedAt),
    null,
    2,
  )}\n`;
}

/** Decode and validate an imported UTF-8 profile document. */
export function parseProfileImport(
  bytes: Uint8Array,
): BlissHackProfileExport {
  if (bytes.byteLength > PROFILE_IMPORT_MAX_BYTES) {
    throw new ProfileFormatError(
      "file-too-large",
      "Profile exceeds the 1 MiB import limit",
    );
  }
  if (
    bytes.byteLength >= 3
    && bytes[0] === 0xef
    && bytes[1] === 0xbb
    && bytes[2] === 0xbf
  ) {
    throw new ProfileFormatError(
      "invalid-encoding",
      "Profile contains a UTF-8 BOM",
    );
  }

  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ProfileFormatError(
      "invalid-encoding",
      "Profile is not valid UTF-8",
    );
  }
  if (json.startsWith("\uFEFF") || json.includes("\0")) {
    throw new ProfileFormatError(
      "invalid-encoding",
      "Profile contains a BOM or NUL byte",
    );
  }

  const document = requireRecord(parseJson(json), "profile export");
  assertExactKeys(
    document,
    [
      "schemaVersion",
      "productVersion",
      "exportedAt",
      "interface",
      "nethack",
    ],
    "profile export",
  );
  assertProductVersion(document.productVersion);
  assertIsoTimestamp(document.exportedAt);

  const profile = validateProfile({
    schemaVersion: document.schemaVersion,
    interface: document.interface,
    nethack: document.nethack,
  });
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    productVersion: document.productVersion,
    exportedAt: document.exportedAt,
    interface: profile.interface,
    nethack: profile.nethack,
  };
}

/** Validate and normalize the interface section independently. */
export function validateInterfaceSettings(
  value: unknown,
): InterfaceSettings {
  const settings = requireRecord(value, "interface");
  assertExactKeys(
    settings,
    [
      "mapRenderer",
      "terminalFontSize",
      "messageHistoryLines",
      "followPlayer",
      "permanentInventoryPosition",
      "permanentInventoryCollapsed",
      "informationLevel",
      "endgameStyle",
      "characterSetupStyle",
      "actionBarStyle",
      "actionBarLayout",
    ],
    "interface",
  );
  if (!isOneOf(settings.mapRenderer, MAP_RENDERERS)) {
    throw invalidProfile("interface.mapRenderer is invalid");
  }
  if (!isOneOf(settings.terminalFontSize, TERMINAL_FONT_SIZES)) {
    throw invalidProfile("interface.terminalFontSize is invalid");
  }
  if (!isOneOf(settings.messageHistoryLines, MESSAGE_HISTORY_LINES)) {
    throw invalidProfile("interface.messageHistoryLines is invalid");
  }
  assertBoolean(settings.followPlayer, "interface.followPlayer");
  if (!isOneOf(
    settings.permanentInventoryPosition,
    PERMANENT_INVENTORY_POSITIONS,
  )) {
    throw invalidProfile("interface.permanentInventoryPosition is invalid");
  }
  assertBoolean(
    settings.permanentInventoryCollapsed,
    "interface.permanentInventoryCollapsed",
  );
  if (!isOneOf(settings.informationLevel, INFORMATION_LEVELS)) {
    throw invalidProfile("interface.informationLevel is invalid");
  }
  if (!isOneOf(settings.endgameStyle, ENDGAME_STYLES)) {
    throw invalidProfile("interface.endgameStyle is invalid");
  }
  if (!isOneOf(settings.characterSetupStyle, CHARACTER_SETUP_STYLES)) {
    throw invalidProfile("interface.characterSetupStyle is invalid");
  }
  if (!isOneOf(settings.actionBarStyle, ACTION_BAR_STYLES)) {
    throw invalidProfile("interface.actionBarStyle is invalid");
  }

  return {
    mapRenderer: settings.mapRenderer,
    terminalFontSize: settings.terminalFontSize,
    messageHistoryLines: settings.messageHistoryLines,
    followPlayer: settings.followPlayer,
    permanentInventoryPosition: settings.permanentInventoryPosition,
    permanentInventoryCollapsed: settings.permanentInventoryCollapsed,
    informationLevel: settings.informationLevel,
    endgameStyle: settings.endgameStyle,
    characterSetupStyle: settings.characterSetupStyle,
    actionBarStyle: settings.actionBarStyle,
    actionBarLayout: validateActionBarLayoutForProfile(settings.actionBarLayout),
  };
}

/**
 * Validate the strict v1 interface and add its compatibility renderer.
 * @param value - persisted or imported v1 interface.
 * @returns migrated v2 interface settings.
 */
function migrateInterfaceSettingsV1(value: unknown): InterfaceSettingsV2 {
  const settings = requireRecord(value, "interface");
  assertExactKeys(
    settings,
    [
      "terminalFontSize",
      "messageHistoryLines",
      "followPlayer",
      "permanentInventoryPosition",
      "permanentInventoryCollapsed",
    ],
    "interface",
  );
  return validateInterfaceSettingsV2({
    ...settings,
    mapRenderer: "ascii",
  });
}

/**
 * Validate a strict v2 interface and add v3 presentation defaults.
 * @param value - persisted or imported v2 interface.
 * @returns migrated v3 interface settings.
 */
function migrateInterfaceSettingsV2(value: unknown): InterfaceSettingsV3 {
  return {
    ...validateInterfaceSettingsV2(value),
    informationLevel: "original",
    endgameStyle: "original",
    characterSetupStyle: "original",
  };
}

/**
 * Validate and detach the historical v3 interface shape.
 * @param value - persisted or imported v3 interface value.
 * @returns detached v3 interface settings.
 */
function validateInterfaceSettingsV3(value: unknown): InterfaceSettingsV3 {
  const settings = requireRecord(value, "interface");
  assertExactKeys(
    settings,
    [
      "mapRenderer",
      "terminalFontSize",
      "messageHistoryLines",
      "followPlayer",
      "permanentInventoryPosition",
      "permanentInventoryCollapsed",
      "informationLevel",
      "endgameStyle",
      "characterSetupStyle",
    ],
    "interface",
  );
  const v2 = validateInterfaceSettingsV2({
    mapRenderer: settings.mapRenderer,
    terminalFontSize: settings.terminalFontSize,
    messageHistoryLines: settings.messageHistoryLines,
    followPlayer: settings.followPlayer,
    permanentInventoryPosition: settings.permanentInventoryPosition,
    permanentInventoryCollapsed: settings.permanentInventoryCollapsed,
  });
  if (!isOneOf(settings.informationLevel, INFORMATION_LEVELS)) {
    throw invalidProfile("interface.informationLevel is invalid");
  }
  if (!isOneOf(settings.endgameStyle, ENDGAME_STYLES)) {
    throw invalidProfile("interface.endgameStyle is invalid");
  }
  if (!isOneOf(settings.characterSetupStyle, CHARACTER_SETUP_STYLES)) {
    throw invalidProfile("interface.characterSetupStyle is invalid");
  }
  return {
    ...v2,
    informationLevel: settings.informationLevel,
    endgameStyle: settings.endgameStyle,
    characterSetupStyle: settings.characterSetupStyle,
  };
}

/**
 * Convert layout validation failures into the profile error contract.
 * @param value - untrusted embedded action bar layout.
 * @returns a detached validated layout.
 */
function validateActionBarLayoutForProfile(value: unknown): ActionBarLayout {
  try {
    return validateActionBarLayout(value);
  } catch (error) {
    throw invalidProfile(
      error instanceof Error
        ? `interface.${error.message}`
        : "interface.actionBarLayout is invalid",
    );
  }
}

/**
 * Validate and detach the historical v2 interface shape.
 * @param value - unknown v2 interface value.
 * @returns detached v2 interface settings.
 */
function validateInterfaceSettingsV2(value: unknown): InterfaceSettingsV2 {
  const settings = requireRecord(value, "interface");
  assertExactKeys(
    settings,
    [
      "mapRenderer",
      "terminalFontSize",
      "messageHistoryLines",
      "followPlayer",
      "permanentInventoryPosition",
      "permanentInventoryCollapsed",
    ],
    "interface",
  );
  if (!isOneOf(settings.mapRenderer, MAP_RENDERERS)) {
    throw invalidProfile("interface.mapRenderer is invalid");
  }
  if (!isOneOf(settings.terminalFontSize, TERMINAL_FONT_SIZES)) {
    throw invalidProfile("interface.terminalFontSize is invalid");
  }
  if (!isOneOf(settings.messageHistoryLines, MESSAGE_HISTORY_LINES)) {
    throw invalidProfile("interface.messageHistoryLines is invalid");
  }
  assertBoolean(settings.followPlayer, "interface.followPlayer");
  if (!isOneOf(
    settings.permanentInventoryPosition,
    LEGACY_PERMANENT_INVENTORY_POSITIONS,
  )) {
    throw invalidProfile("interface.permanentInventoryPosition is invalid");
  }
  assertBoolean(
    settings.permanentInventoryCollapsed,
    "interface.permanentInventoryCollapsed",
  );

  return {
    mapRenderer: settings.mapRenderer,
    terminalFontSize: settings.terminalFontSize,
    messageHistoryLines: settings.messageHistoryLines,
    followPlayer: settings.followPlayer,
    permanentInventoryPosition: settings.permanentInventoryPosition,
    permanentInventoryCollapsed: settings.permanentInventoryCollapsed,
  };
}

/** Validate and normalize the NetHack section independently. */
export function validateNetHackSettings(
  value: unknown,
): NetHackSettingsV1 {
  const settings = requireRecord(value, "nethack");
  assertExactKeys(
    settings,
    [
      "tutorial",
      "autopickup",
      "pickupTypes",
      "numberPad",
      "safePet",
      "sortpack",
      "showExperience",
      "showTime",
      "permInvent",
      "perminvMode",
    ],
    "nethack",
  );
  assertBoolean(settings.tutorial, "nethack.tutorial");
  assertBoolean(settings.autopickup, "nethack.autopickup");
  if (!isOneOf(settings.numberPad, NUMBER_PAD_MODES)) {
    throw invalidProfile("nethack.numberPad is invalid");
  }
  assertBoolean(settings.safePet, "nethack.safePet");
  assertBoolean(settings.sortpack, "nethack.sortpack");
  assertBoolean(settings.showExperience, "nethack.showExperience");
  assertBoolean(settings.showTime, "nethack.showTime");
  assertBoolean(settings.permInvent, "nethack.permInvent");
  if (!isOneOf(settings.perminvMode, PERMINV_MODES)) {
    throw invalidProfile("nethack.perminvMode is invalid");
  }

  return {
    tutorial: settings.tutorial,
    autopickup: settings.autopickup,
    pickupTypes: validatePickupTypes(settings.pickupTypes),
    numberPad: settings.numberPad,
    safePet: settings.safePet,
    sortpack: settings.sortpack,
    showExperience: settings.showExperience,
    showTime: settings.showTime,
    permInvent: settings.permInvent,
    perminvMode: settings.perminvMode,
  };
}

function validatePickupTypes(value: unknown): PickupTypesV1 {
  const pickupTypes = requireRecord(value, "nethack.pickupTypes");
  if (pickupTypes.mode === "all") {
    assertExactKeys(pickupTypes, ["mode"], "nethack.pickupTypes");
    return { mode: "all" };
  }
  if (pickupTypes.mode !== "selected") {
    throw invalidProfile("nethack.pickupTypes.mode is invalid");
  }
  assertExactKeys(
    pickupTypes,
    ["mode", "classes"],
    "nethack.pickupTypes",
  );
  if (!Array.isArray(pickupTypes.classes) || pickupTypes.classes.length === 0) {
    throw invalidProfile(
      "nethack.pickupTypes.classes must contain at least one class",
    );
  }

  const selected = new Set<PickupClassSymbol>();
  for (const value of pickupTypes.classes) {
    if (!isOneOf(value, PICKUP_CLASS_SYMBOLS)) {
      throw invalidProfile("nethack.pickupTypes.classes contains an invalid class");
    }
    if (selected.has(value)) {
      throw invalidProfile("nethack.pickupTypes.classes contains a duplicate");
    }
    selected.add(value);
  }
  return {
    mode: "selected",
    classes: PICKUP_CLASS_SYMBOLS.filter((symbol) => selected.has(symbol)),
  };
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new ProfileFormatError("invalid-json", "Profile is not valid JSON");
  }
}

function profileSchemaVersion(value: unknown): SupportedProfileSchemaVersion {
  if (
    value !== LEGACY_PROFILE_SCHEMA_VERSION
    && value !== PROFILE_SCHEMA_VERSION_V2
    && value !== PREVIOUS_PROFILE_SCHEMA_VERSION
    && value !== PROFILE_SCHEMA_VERSION
  ) {
    throw new ProfileFormatError(
      "unsupported-schema",
      "Profile schema version is not supported",
    );
  }
  return value;
}

function assertProductVersion(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidProfile("productVersion must be a non-empty string");
  }
}

function assertIsoTimestamp(value: unknown): asserts value is string {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw invalidProfile("exportedAt must be a canonical UTC timestamp");
  }
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw invalidProfile(`${path} must be boolean`);
  }
}

function requireRecord(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidProfile(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length
    || actual.some((key, index) => key !== required[index])
  ) {
    throw invalidProfile(`${path} contains missing or unknown fields`);
  }
}

function isOneOf<const T extends readonly unknown[]>(
  value: unknown,
  choices: T,
): value is T[number] {
  return choices.includes(value);
}

function invalidProfile(message: string): ProfileFormatError {
  return new ProfileFormatError("invalid-profile", message);
}

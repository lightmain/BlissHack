import { MAX_SESSION_COMMAND_ID } from "./core-command-protocol";

export const ACTION_CATALOG_SCHEMA_VERSION = 1;
export const ACTION_CATALOG_COMMAND_COUNT = 104;
export const ACTION_CATALOG_KNOWN_FLAGS_MASK = 0x7fff;

const ACTION_CATALOG_MAX_NAME_LENGTH = 64;
const WIZMODECMD = 0x0004;
const CMD_NOT_AVAILABLE = 0x0010;
const INTERNALCMD = 0x0040;
const MOVEMENTCMD = 0x0400;
const HIDDEN_ACTION_FLAGS =
  WIZMODECMD | CMD_NOT_AVAILABLE | INTERNALCMD | MOVEMENTCMD;

export interface ActionCatalogOwner {
  moduleId: string;
  sessionId: string;
}

export interface ActionCatalogEntry {
  sessionCommandId: number;
  name: string;
  defaultKey: number;
  flags: number;
}

export interface SessionActionCatalog extends ActionCatalogOwner {
  schemaVersion: typeof ACTION_CATALOG_SCHEMA_VERSION;
  commands: ActionCatalogEntry[];
}

/**
 * Validate and session-scope the value-copied catalog supplied by WASM.
 * @param value - untrusted global metadata created by the active module.
 * @param owner - module and session which may use the copied command IDs.
 * @returns a defensive copy with explicit ownership.
 */
export function decodeActionCatalog(
  value: unknown,
  owner: ActionCatalogOwner,
): SessionActionCatalog {
  assertOwner(owner);
  if (!isRecord(value) || value.schemaVersion !== ACTION_CATALOG_SCHEMA_VERSION) {
    throw new Error("Unsupported action catalog schema");
  }
  if (
    !Array.isArray(value.commands)
    || value.commands.length !== ACTION_CATALOG_COMMAND_COUNT
  ) {
    throw new Error("Action catalog must contain exactly 104 commands");
  }

  const names = new Set<string>();
  const identifiers = new Set<number>();
  const commands = value.commands.map((command, index) => {
    const entry = decodeActionCatalogEntry(command, index);
    if (names.has(entry.name)) {
      throw new Error(`Duplicate action catalog name: ${entry.name}`);
    }
    if (identifiers.has(entry.sessionCommandId)) {
      throw new Error(
        `Duplicate action catalog ID: ${entry.sessionCommandId}`,
      );
    }
    names.add(entry.name);
    identifiers.add(entry.sessionCommandId);
    return entry;
  });

  return {
    schemaVersion: ACTION_CATALOG_SCHEMA_VERSION,
    moduleId: owner.moduleId,
    sessionId: owner.sessionId,
    commands,
  };
}

/**
 * Resolve one opaque command ID only within the catalog's owning session.
 * @param catalog - validated session-owned catalog.
 * @param sessionCommandId - opaque command identity copied from the core.
 * @param owner - caller's current module and session.
 * @returns the matching copied command entry.
 */
export function resolveActionCatalogCommand(
  catalog: SessionActionCatalog,
  sessionCommandId: number,
  owner: ActionCatalogOwner,
): ActionCatalogEntry {
  assertOwner(owner);
  if (
    catalog.moduleId !== owner.moduleId
    || catalog.sessionId !== owner.sessionId
  ) {
    throw new Error("Action catalog belongs to a different session");
  }
  const command = catalog.commands.find(
    (entry) => entry.sessionCommandId === sessionCommandId,
  );
  if (!command) {
    throw new Error(`Unknown action catalog ID: ${sessionCommandId}`);
  }
  return command;
}

/**
 * Resolve one command name without persisting its session-local numeric ID.
 * @param catalog - validated catalog for the active session.
 * @param name - authoritative extcmd name.
 * @param owner - caller's current module and session.
 * @returns the matching copied command entry.
 */
export function resolveActionCatalogName(
  catalog: SessionActionCatalog,
  name: string,
  owner: ActionCatalogOwner,
): ActionCatalogEntry {
  assertOwner(owner);
  if (
    catalog.moduleId !== owner.moduleId
    || catalog.sessionId !== owner.sessionId
  ) {
    throw new Error("Action catalog belongs to a different session");
  }
  const command = catalog.commands.find((entry) => entry.name === name);
  if (!command) throw new Error(`Unknown action catalog name: ${name}`);
  return command;
}

/**
 * Validate one command copied out of extcmdlist.
 * @param value - untrusted command metadata.
 * @param index - catalog position used in diagnostics.
 * @returns a detached action command record.
 */
function decodeActionCatalogEntry(
  value: unknown,
  index: number,
): ActionCatalogEntry {
  if (!isRecord(value)) {
    throw new Error(`Invalid action catalog entry at index ${index}`);
  }
  const { sessionCommandId, name, defaultKey, flags } = value;
  if (
    !Number.isInteger(sessionCommandId)
    || (sessionCommandId as number) < 0
    || (sessionCommandId as number) > MAX_SESSION_COMMAND_ID
  ) {
    throw new Error(`Invalid action catalog ID at index ${index}`);
  }
  if (
    typeof name !== "string"
    || name.length === 0
    || name.length > ACTION_CATALOG_MAX_NAME_LENGTH
  ) {
    throw new Error(`Invalid action catalog name at index ${index}`);
  }
  if (
    !Number.isInteger(defaultKey)
    || (defaultKey as number) < 0
    || (defaultKey as number) > 0xff
  ) {
    throw new Error(`Invalid action catalog key at index ${index}`);
  }
  if (
    !Number.isInteger(flags)
    || (flags as number) < 0
    || ((flags as number) & ~ACTION_CATALOG_KNOWN_FLAGS_MASK) !== 0
    || ((flags as number) & HIDDEN_ACTION_FLAGS) !== 0
  ) {
    throw new Error(`Invalid action catalog flags at index ${index}`);
  }
  return {
    sessionCommandId: sessionCommandId as number,
    name,
    defaultKey: defaultKey as number,
    flags: flags as number,
  };
}

/**
 * Require nonempty identifiers for the module/session ownership boundary.
 * @param owner - proposed catalog owner.
 */
function assertOwner(owner: ActionCatalogOwner): void {
  if (
    !owner
    || typeof owner.moduleId !== "string"
    || owner.moduleId.length === 0
    || typeof owner.sessionId !== "string"
    || owner.sessionId.length === 0
  ) {
    throw new Error("Action catalog owner is invalid");
  }
}

/**
 * Narrow one unknown value to a string-keyed object.
 * @param value - candidate object.
 * @returns whether the value can be inspected by field name.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

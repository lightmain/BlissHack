import type {
  ActionCatalogEntry,
  SessionActionCatalog,
} from "../game-actions/action-catalog";

export const ACTION_FALLBACK_ICON = "square-dashed-x-corner";
export const ACTION_CATALOG_CATEGORIES = [
  "common",
  "gear",
  "magic",
  "items",
  "explore",
  "info",
  "system",
] as const;
export type ActionCategory = (typeof ACTION_CATALOG_CATEGORIES)[number];
export type ActionAvailability = "available" | "blocked" | "unavailable";

export interface ActionPresentation {
  category?: ActionCategory;
  defaultKey: number;
  flags: number;
  icon: string;
  key: string;
  name: string;
  sessionCommandId: number | null;
  state: ActionAvailability;
}

interface ActionMetadata {
  category: ActionCategory;
  icon: string;
}

const CMD_PARAM = 0x4000;

const ACTION_METADATA_SOURCE = [
  ["#", "system", "hash"],
  ["?", "system", "list"],
  ["adjust", "gear", "arrow-left-right"],
  ["annotate", "explore", "map-pin"],
  ["apply", "items", "wrench"],
  ["attributes", "info", "user-round"],
  ["autopickup", "system", "package-plus"],
  ["call", "gear", "tag"],
  ["cast", "magic", "sparkles"],
  ["chat", "explore", "message-circle"],
  ["chronicle", "info", "book-open"],
  ["close", "explore", "door-closed"],
  ["conduct", "info", ACTION_FALLBACK_ICON],
  ["dip", "items", "glass-water"],
  ["down", "explore", "arrow-down"],
  ["drop", "items", "package-minus"],
  ["droptype", "items", "list-minus"],
  ["eat", "items", "utensils"],
  ["engrave", "items", "pen-line"],
  ["enhance", "magic", "trending-up"],
  ["exploremode", "system", "triangle-alert"],
  ["fight", "common", "swords"],
  ["fire", "common", "crosshair"],
  ["force", "explore", "key-round"],
  ["genocided", "info", "skull"],
  ["glance", "explore", "scan-search"],
  ["help", "system", "circle-help"],
  ["herecmdmenu", "common", ACTION_FALLBACK_ICON],
  ["history", "info", "history"],
  ["inventory", "gear", "backpack"],
  ["inventtype", "gear", "list-filter"],
  ["invoke", "magic", "sparkles"],
  ["jump", "explore", "move-up-right"],
  ["kick", "common", "footprints"],
  ["known", "info", "book-open-check"],
  ["knownclass", "info", ACTION_FALLBACK_ICON],
  ["look", "common", "eye"],
  ["lookaround", "explore", "scan-eye"],
  ["loot", "items", "archive"],
  ["monster", "magic", ACTION_FALLBACK_ICON],
  ["name", "gear", "tag"],
  ["offer", "magic", "hand-heart"],
  ["open", "explore", "door-open"],
  ["options", "system", "settings"],
  ["optionsfull", "system", "sliders-horizontal"],
  ["overview", "info", "map"],
  ["pay", "explore", "coins"],
  ["perminv", "info", "panel-right"],
  ["pickup", "items", "package-plus"],
  ["pray", "magic", "heart-handshake"],
  ["prevmsg", "info", "message-square-more"],
  ["puton", "gear", "gem"],
  ["quaff", "items", "cup-soda"],
  ["quit", "system", "log-out"],
  ["quiver", "gear", "target"],
  ["read", "magic", "book-open-text"],
  ["redraw", "system", "refresh-cw"],
  ["remove", "gear", "gem"],
  ["repeat", "system", "repeat-2"],
  ["reqmenu", "system", "command"],
  ["retravel", "explore", "route"],
  ["ride", "explore", "navigation"],
  ["rub", "magic", "lamp"],
  ["run", "explore", "gauge"],
  ["rush", "explore", "fast-forward"],
  ["save", "system", "save"],
  ["saveoptions", "system", "file-cog"],
  ["search", "common", "search"],
  ["seeall", "gear", "list-checks"],
  ["seeamulet", "gear", "gem"],
  ["seearmor", "gear", "shield"],
  ["seerings", "gear", "circle"],
  ["seetools", "gear", "wrench"],
  ["seeweapon", "gear", "sword"],
  ["shell", "system", "terminal"],
  ["showgold", "info", "coins"],
  ["showspells", "info", "book-copy"],
  ["showtrap", "explore", ACTION_FALLBACK_ICON],
  ["sit", "explore", "armchair"],
  ["suspend", "system", "pause"],
  ["swap", "gear", "arrow-left-right"],
  ["takeoff", "gear", "shirt"],
  ["takeoffall", "gear", "layers"],
  ["teleport", "explore", "locate-fixed"],
  ["terrain", "explore", "mountain"],
  ["therecmdmenu", "explore", ACTION_FALLBACK_ICON],
  ["throw", "items", "send"],
  ["tip", "items", "archive-restore"],
  ["toggle", "system", "toggle-right"],
  ["travel", "common", "navigation"],
  ["turn", "magic", "sun"],
  ["twoweapon", "common", ACTION_FALLBACK_ICON],
  ["untrap", "common", "shield-check"],
  ["up", "explore", "arrow-up"],
  ["vanquished", "info", "list-x"],
  ["version", "system", "info"],
  ["versionshort", "system", "badge-info"],
  ["wait", "common", "clock"],
  ["wear", "gear", "shirt"],
  ["whatdoes", "info", "circle-help"],
  ["whatis", "explore", "search"],
  ["wield", "gear", "sword"],
  ["wipe", "common", "droplets"],
  ["zap", "magic", "wand-sparkles"],
] as const satisfies ReadonlyArray<
  readonly [string, ActionCategory, string]
>;

const ACTION_METADATA = new Map<string, ActionMetadata>(
  ACTION_METADATA_SOURCE.map(([name, category, icon]) => [
    name,
    { category, icon },
  ]),
);

/**
 * Build display metadata for every command in the current session catalog.
 * @param catalog - validated session-owned command catalog.
 * @param options - whether otherwise executable actions are context-blocked.
 * @returns presentations in authoritative catalog order.
 */
export function buildActionPresentations(
  catalog: SessionActionCatalog,
  options: { blocked: boolean },
): ActionPresentation[] {
  if (
    catalog.commands.length !== ACTION_METADATA.size
    || catalog.commands.some((command) => !ACTION_METADATA.has(command.name))
  ) {
    throw new Error("Action presentation metadata does not match the catalog");
  }
  return catalog.commands.map((command) =>
    presentationFromCommand(command, options.blocked)
  );
}

/**
 * Resolve a persisted slot name against the current session catalog.
 * @param name - persisted command name.
 * @param catalog - validated session-owned command catalog.
 * @param options - whether otherwise executable actions are context-blocked.
 * @returns a known presentation or a stable unavailable placeholder.
 */
export function resolveActionSlotPresentation(
  name: string,
  catalog: SessionActionCatalog,
  options: { blocked: boolean },
): ActionPresentation {
  const command = catalog.commands.find((entry) => entry.name === name);
  const metadata = ACTION_METADATA.get(name);
  if (!command || !metadata) {
    return {
      defaultKey: 0,
      flags: 0,
      icon: ACTION_FALLBACK_ICON,
      key: `#${name}`,
      name,
      sessionCommandId: null,
      state: "unavailable",
    };
  }
  return presentationFromCommand(command, options.blocked);
}

/**
 * Return immutable presentation metadata for one known command name.
 * @param name - canonical action catalog name.
 * @returns category and icon metadata, or null for an unknown name.
 */
export function getActionMetadata(name: string): ActionMetadata | null {
  const metadata = ACTION_METADATA.get(name);
  return metadata ? { ...metadata } : null;
}

/**
 * Combine one authoritative command with its fixed display metadata.
 * @param command - command copied from the current session catalog.
 * @param blocked - whether current UI context prevents execution.
 * @returns a complete action presentation.
 */
function presentationFromCommand(
  command: ActionCatalogEntry,
  blocked: boolean,
): ActionPresentation {
  const metadata = ACTION_METADATA.get(command.name);
  if (!metadata) {
    throw new Error(`Missing action metadata: ${command.name}`);
  }
  const unavailable = (command.flags & CMD_PARAM) !== 0;
  return {
    category: metadata.category,
    defaultKey: command.defaultKey,
    flags: command.flags,
    icon: metadata.icon,
    key: formatActionKey(command),
    name: command.name,
    sessionCommandId: command.sessionCommandId,
    state: unavailable ? "unavailable" : blocked ? "blocked" : "available",
  };
}

/**
 * Format the catalog's current default binding without inventing shortcuts.
 * @param command - command copied from the active WASM catalog.
 * @returns a concise key label or the canonical extended-command spelling.
 */
function formatActionKey(command: ActionCatalogEntry): string {
  const key = command.defaultKey;
  if (key === 0) return `#${command.name}`;
  if (key === 0x7f) return "Del";
  if (key > 0 && key < 0x20) {
    const character = key === 0x1f
      ? "_"
      : String.fromCharCode(key + 0x40);
    return `Ctrl+${character}`;
  }
  if ((key & 0x80) !== 0) {
    const character = String.fromCharCode(key & 0x7f);
    return /^[A-Z]$/.test(character)
      ? `Alt+Shift+${character}`
      : `Alt+${character.toUpperCase()}`;
  }
  return String.fromCharCode(key);
}

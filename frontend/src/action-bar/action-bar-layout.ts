export const ACTION_BAR_LAYOUT_SCHEMA_VERSION = 1;
export const ACTION_BAR_LAYOUT_IMPORT_MAX_BYTES = 1024 * 1024;
export const ACTION_BAR_MIN_ROWS = 1;
export const ACTION_BAR_MAX_ROWS = 4;
export const ACTION_BAR_MAX_COLUMNS = 8;
export const ACTION_BAR_MAX_SECTION_SLOTS = 64;
export const ACTION_BAR_MAX_CATEGORY_SLOTS = 104;
export const ACTION_BAR_MAX_NAME_LENGTH = 64;

export const ACTION_BAR_CATEGORIES = [
  "all",
  "common",
  "gear",
  "magic",
  "items",
  "explore",
  "custom",
] as const;
export type ActionBarCategory = (typeof ACTION_BAR_CATEGORIES)[number];

export const ACTION_BAR_SECTION_CATEGORIES = [
  "common",
  "gear",
  "magic",
  "items",
] as const;
export type ActionBarSectionCategory =
  (typeof ACTION_BAR_SECTION_CATEGORIES)[number];

export const ACTION_BAR_SINGLE_CATEGORIES = [
  "common",
  "gear",
  "magic",
  "items",
  "explore",
  "custom",
] as const;
export type ActionBarSingleCategory =
  (typeof ACTION_BAR_SINGLE_CATEGORIES)[number];

export type ActionBarSlot = string | null;

export interface ActionBarSection {
  category: ActionBarSectionCategory;
  columns: number;
  slots: ActionBarSlot[];
}

export interface ActionBarLayout {
  rows: 1 | 2 | 3 | 4;
  locked: boolean;
  activeCategory: ActionBarCategory;
  all: ActionBarSection[];
  categories: Record<ActionBarSingleCategory, ActionBarSlot[]>;
}

export interface ActionBarLayoutExportV1 {
  schemaVersion: typeof ACTION_BAR_LAYOUT_SCHEMA_VERSION;
  actionBarLayout: ActionBarLayout;
}

export interface ActionBarLayoutDifference {
  path: string;
  label: string;
  current: string;
  incoming: string;
}

const DEFAULT_ACTION_BAR_LAYOUT: ActionBarLayout = {
  rows: 2,
  locked: true,
  activeCategory: "all",
  all: [
    {
      category: "common",
      columns: 2,
      slots: ["eat", "quaff", "kick", "search"],
    },
    {
      category: "gear",
      columns: 3,
      slots: ["wield", "wear", "puton", "takeoff", "remove", "swap"],
    },
    {
      category: "magic",
      columns: 3,
      slots: ["cast", "zap", "read", "fire", "throw", "quiver"],
    },
    {
      category: "items",
      columns: 3,
      slots: ["apply", "engrave", "dip", "loot", "tip", "rub"],
    },
  ],
  categories: {
    common: [
      "eat",
      "quaff",
      "kick",
      "search",
      "wield",
      "wear",
      "puton",
      "takeoff",
      "remove",
      "cast",
      "zap",
      "read",
      "fire",
      "throw",
      "apply",
      "engrave",
      "dip",
      "loot",
      "wait",
      "travel",
      "look",
    ],
    gear: [
      "adjust",
      "call",
      "inventory",
      "inventtype",
      "name",
      "puton",
      "quiver",
      "remove",
      "swap",
      "takeoff",
      "takeoffall",
      "wear",
      "wield",
      "seeall",
      "seeamulet",
      "seearmor",
      "seerings",
      "seetools",
      "seeweapon",
    ],
    magic: [
      "cast",
      "enhance",
      "invoke",
      "monster",
      "offer",
      "pray",
      "read",
      "rub",
      "turn",
      "zap",
    ],
    items: [
      "apply",
      "dip",
      "drop",
      "droptype",
      "eat",
      "engrave",
      "loot",
      "pickup",
      "quaff",
      "throw",
      "tip",
    ],
    explore: [
      "annotate",
      "chat",
      "close",
      "down",
      "force",
      "glance",
      "jump",
      "lookaround",
      "open",
      "pay",
      "retravel",
      "ride",
      "run",
      "rush",
      "showtrap",
      "sit",
      "teleport",
      "terrain",
      "therecmdmenu",
      "up",
      "whatis",
    ],
    custom: [],
  },
};

/**
 * Return the reviewed production defaults.
 * @returns a detached action bar layout.
 */
export function createDefaultActionBarLayout(): ActionBarLayout {
  return cloneActionBarLayout(DEFAULT_ACTION_BAR_LAYOUT);
}

/**
 * Strictly validate and detach an untrusted action bar layout.
 * @param value - persisted, imported, or edited layout candidate.
 * @returns a normalized layout which retains empty and unknown action slots.
 */
export function validateActionBarLayout(value: unknown): ActionBarLayout {
  const layout = requireRecord(value, "actionBarLayout");
  assertExactKeys(
    layout,
    ["rows", "locked", "activeCategory", "all", "categories"],
    "actionBarLayout",
  );
  if (
    !Number.isInteger(layout.rows)
    || (layout.rows as number) < ACTION_BAR_MIN_ROWS
    || (layout.rows as number) > ACTION_BAR_MAX_ROWS
  ) {
    throw new Error("actionBarLayout.rows is invalid");
  }
  if (typeof layout.locked !== "boolean") {
    throw new Error("actionBarLayout.locked must be boolean");
  }
  if (!isOneOf(layout.activeCategory, ACTION_BAR_CATEGORIES)) {
    throw new Error("actionBarLayout.activeCategory is invalid");
  }
  if (
    !Array.isArray(layout.all)
    || layout.all.length !== ACTION_BAR_SECTION_CATEGORIES.length
  ) {
    throw new Error("actionBarLayout.all is invalid");
  }

  const all = layout.all.map((value, index) =>
    validateSection(value, ACTION_BAR_SECTION_CATEGORIES[index], index)
  );
  const categories = requireRecord(
    layout.categories,
    "actionBarLayout.categories",
  );
  assertExactKeys(
    categories,
    ACTION_BAR_SINGLE_CATEGORIES,
    "actionBarLayout.categories",
  );

  return {
    rows: layout.rows as ActionBarLayout["rows"],
    locked: layout.locked,
    activeCategory: layout.activeCategory,
    all,
    categories: {
      common: validateSlots(
        categories.common,
        ACTION_BAR_MAX_CATEGORY_SLOTS,
        "actionBarLayout.categories.common",
      ),
      gear: validateSlots(
        categories.gear,
        ACTION_BAR_MAX_CATEGORY_SLOTS,
        "actionBarLayout.categories.gear",
      ),
      magic: validateSlots(
        categories.magic,
        ACTION_BAR_MAX_CATEGORY_SLOTS,
        "actionBarLayout.categories.magic",
      ),
      items: validateSlots(
        categories.items,
        ACTION_BAR_MAX_CATEGORY_SLOTS,
        "actionBarLayout.categories.items",
      ),
      explore: validateSlots(
        categories.explore,
        ACTION_BAR_MAX_CATEGORY_SLOTS,
        "actionBarLayout.categories.explore",
      ),
      custom: validateSlots(
        categories.custom,
        ACTION_BAR_MAX_CATEGORY_SLOTS,
        "actionBarLayout.categories.custom",
      ),
    },
  };
}

/**
 * Serialize one validated layout as a deterministic .bhactions document.
 * @param layout - complete action bar layout.
 * @returns indented JSON with an LF terminator.
 */
export function serializeActionBarLayoutExport(
  layout: ActionBarLayout,
): string {
  const document: ActionBarLayoutExportV1 = {
    schemaVersion: ACTION_BAR_LAYOUT_SCHEMA_VERSION,
    actionBarLayout: validateActionBarLayout(layout),
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * Decode and strictly validate one untrusted .bhactions document.
 * @param bytes - complete selected file bytes.
 * @returns a detached schema-v1 layout document.
 */
export function parseActionBarLayoutImport(
  bytes: Uint8Array,
): ActionBarLayoutExportV1 {
  if (bytes.byteLength > ACTION_BAR_LAYOUT_IMPORT_MAX_BYTES) {
    throw new Error("Action bar layout exceeds the 1 MiB import limit");
  }
  if (
    bytes.byteLength >= 3
    && bytes[0] === 0xef
    && bytes[1] === 0xbb
    && bytes[2] === 0xbf
  ) {
    throw new Error("Action bar layout contains a UTF-8 BOM");
  }

  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Action bar layout is not valid UTF-8");
  }
  if (json.startsWith("\uFEFF") || json.includes("\0")) {
    throw new Error("Action bar layout contains a BOM or NUL byte");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new Error("Action bar layout is not valid JSON");
  }
  const document = requireRecord(parsed, "action bar layout export");
  assertExactKeys(
    document,
    ["schemaVersion", "actionBarLayout"],
    "action bar layout export",
  );
  if (document.schemaVersion !== ACTION_BAR_LAYOUT_SCHEMA_VERSION) {
    throw new Error("Action bar layout schema version is not supported");
  }
  return {
    schemaVersion: ACTION_BAR_LAYOUT_SCHEMA_VERSION,
    actionBarLayout: validateActionBarLayout(document.actionBarLayout),
  };
}

/**
 * Compare two validated layouts in stable user-facing order.
 * @param current - currently committed action bar layout.
 * @param incoming - candidate imported action bar layout.
 * @returns only changed layout rows.
 */
export function diffActionBarLayouts(
  current: ActionBarLayout,
  incoming: ActionBarLayout,
): ActionBarLayoutDifference[] {
  const left = validateActionBarLayout(current);
  const right = validateActionBarLayout(incoming);
  const differences: ActionBarLayoutDifference[] = [];

  if (left.rows !== right.rows) {
    differences.push({
      path: "rows",
      label: "Rows",
      current: String(left.rows),
      incoming: String(right.rows),
    });
  }
  if (left.activeCategory !== right.activeCategory) {
    differences.push({
      path: "activeCategory",
      label: "Active category",
      current: formatCategory(left.activeCategory),
      incoming: formatCategory(right.activeCategory),
    });
  }
  if (left.locked !== right.locked) {
    differences.push({
      path: "locked",
      label: "Layout lock",
      current: left.locked ? "Locked" : "Unlocked",
      incoming: right.locked ? "Locked" : "Unlocked",
    });
  }
  if (
    left.all.some(
      (section, index) => section.columns !== right.all[index].columns,
    )
  ) {
    differences.push({
      path: "columns",
      label: "Section widths",
      current: formatSectionWidths(left),
      incoming: formatSectionWidths(right),
    });
  }
  if (JSON.stringify(layoutSlotData(left)) !== JSON.stringify(layoutSlotData(right))) {
    const currentSummary = summarizeActionBarSlots(left);
    const incomingSummary = summarizeActionBarSlots(right);
    const equalSummaries = currentSummary === incomingSummary;
    differences.push({
      path: "slots",
      label: "Slots",
      current: equalSummaries
        ? `${currentSummary}; ${describeFirstSlotDifference(left, right, false)}`
        : currentSummary,
      incoming: equalSummaries
        ? `${incomingSummary}; ${describeFirstSlotDifference(left, right, true)}`
        : incomingSummary,
    });
  }
  return differences;
}

/**
 * Summarize all persisted layout slots, including explicit empty positions.
 * @param layout - validated action bar layout.
 * @returns concise action and empty-slot counts.
 */
export function summarizeActionBarSlots(layout: ActionBarLayout): string {
  const slots = layoutSlotData(validateActionBarLayout(layout)).flat();
  const empty = slots.filter((slot) => slot === null).length;
  return `${slots.length - empty} actions, ${empty} empty`;
}

/**
 * Validate one fixed-order section and detach its slots.
 * @param value - untrusted section candidate.
 * @param expectedCategory - category required at this fixed section index.
 * @param index - section index used in validation errors.
 * @returns a normalized section.
 */
function validateSection(
  value: unknown,
  expectedCategory: ActionBarSectionCategory,
  index: number,
): ActionBarSection {
  const section = requireRecord(value, `actionBarLayout.all[${index}]`);
  assertExactKeys(
    section,
    ["category", "columns", "slots"],
    `actionBarLayout.all[${index}]`,
  );
  if (section.category !== expectedCategory) {
    throw new Error(`actionBarLayout.all[${index}].category is invalid`);
  }
  if (
    !Number.isInteger(section.columns)
    || (section.columns as number) < 1
    || (section.columns as number) > ACTION_BAR_MAX_COLUMNS
  ) {
    throw new Error(`actionBarLayout.all[${index}].columns is invalid`);
  }
  return {
    category: expectedCategory,
    columns: section.columns as number,
    slots: validateSlots(
      section.slots,
      ACTION_BAR_MAX_SECTION_SLOTS,
      `actionBarLayout.all[${index}].slots`,
    ),
  };
}

/**
 * Validate one bounded stable slot array without compacting null entries.
 * @param value - untrusted slot collection.
 * @param maximumLength - inclusive slot-count limit.
 * @param path - schema path used in validation errors.
 * @returns a detached slot list.
 */
function validateSlots(
  value: unknown,
  maximumLength: number,
  path: string,
): ActionBarSlot[] {
  if (!Array.isArray(value) || value.length > maximumLength) {
    throw new Error(`${path} is invalid`);
  }
  return value.map((slot, index) => {
    if (slot === null) return null;
    if (
      typeof slot !== "string"
      || slot.length === 0
      || slot.length > ACTION_BAR_MAX_NAME_LENGTH
      || !/^[\x21-\x7e]+$/.test(slot)
    ) {
      throw new Error(`${path}[${index}] is invalid`);
    }
    return slot;
  });
}

/**
 * Return slot-bearing layout collections in their persisted order.
 * @param layout - validated action bar layout.
 * @returns All-section and category slot arrays.
 */
function layoutSlotData(layout: ActionBarLayout): ActionBarSlot[][] {
  return [
    ...layout.all.map((section) => section.slots),
    ...ACTION_BAR_SINGLE_CATEGORIES.map(
      (category) => layout.categories[category],
    ),
  ];
}

/**
 * Convert a persisted category identifier into its Settings label.
 * @param category - canonical persisted category.
 * @returns title-cased display label.
 */
function formatCategory(category: ActionBarCategory): string {
  return category[0].toUpperCase() + category.slice(1);
}

/**
 * Format the four fixed All-section column widths.
 * @param layout - validated action bar layout.
 * @returns concise user-facing section width summary.
 */
function formatSectionWidths(layout: ActionBarLayout): string {
  return layout.all
    .map((section) => `${formatCategory(section.category)} ${section.columns}`)
    .join(", ");
}

/**
 * Describe the first changed persisted slot without dumping the full layout.
 * @param current - current validated action bar layout.
 * @param incoming - incoming validated action bar layout.
 * @param useIncoming - whether to report the incoming side of the difference.
 * @returns a stable slot path and value.
 */
function describeFirstSlotDifference(
  current: ActionBarLayout,
  incoming: ActionBarLayout,
  useIncoming: boolean,
): string {
  const currentSlots = layoutSlotData(current);
  const incomingSlots = layoutSlotData(incoming);
  const labels = [
    ...ACTION_BAR_SECTION_CATEGORIES.map((category) => `All/${formatCategory(category)}`),
    ...ACTION_BAR_SINGLE_CATEGORIES.map(formatCategory),
  ];
  for (
    let groupIndex = 0;
    groupIndex < Math.max(currentSlots.length, incomingSlots.length);
    groupIndex += 1
  ) {
    const left = currentSlots[groupIndex] ?? [];
    const right = incomingSlots[groupIndex] ?? [];
    for (
      let slotIndex = 0;
      slotIndex < Math.max(left.length, right.length);
      slotIndex += 1
    ) {
      if (left[slotIndex] === right[slotIndex]) continue;
      const value = (useIncoming ? right[slotIndex] : left[slotIndex]) ?? "empty";
      return `${labels[groupIndex]} slot ${slotIndex + 1}: ${value}`;
    }
  }
  return "positions changed";
}

/**
 * Clone an already validated layout without sharing nested arrays.
 * @param layout - trusted action bar layout.
 * @returns a deep-enough detached layout.
 */
function cloneActionBarLayout(layout: ActionBarLayout): ActionBarLayout {
  return {
    rows: layout.rows,
    locked: layout.locked,
    activeCategory: layout.activeCategory,
    all: layout.all.map((section) => ({
      category: section.category,
      columns: section.columns,
      slots: [...section.slots],
    })),
    categories: {
      common: [...layout.categories.common],
      gear: [...layout.categories.gear],
      magic: [...layout.categories.magic],
      items: [...layout.categories.items],
      explore: [...layout.categories.explore],
      custom: [...layout.categories.custom],
    },
  };
}

/**
 * Require an ordinary object before inspecting strict schema fields.
 * @param value - untrusted candidate.
 * @param path - schema path used in validation errors.
 * @returns a string-keyed view of the object.
 */
function requireRecord(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Require an object to contain exactly the supplied field names.
 * @param value - object whose own keys are checked.
 * @param expected - complete accepted key list.
 * @param path - schema path used in validation errors.
 */
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
    throw new Error(`${path} contains missing or unknown fields`);
  }
}

/**
 * Narrow one unknown value to a member of a readonly literal list.
 * @param value - untrusted candidate.
 * @param choices - accepted literal values.
 * @returns whether the candidate is one of the accepted values.
 */
function isOneOf<const T extends readonly unknown[]>(
  value: unknown,
  choices: T,
): value is T[number] {
  return choices.includes(value);
}

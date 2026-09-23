import { beforeAll, beforeEach, describe, expect, it } from "vitest";

type ActionBarCategory =
  | "all"
  | "common"
  | "gear"
  | "magic"
  | "items"
  | "explore"
  | "custom";

type ActionSectionCategory = "common" | "gear" | "magic" | "items";

interface ActionBarSection {
  category: ActionSectionCategory;
  columns: number;
  slots: Array<string | null>;
}

interface ActionBarLayout {
  rows: number;
  locked: boolean;
  activeCategory: ActionBarCategory;
  all: ActionBarSection[];
  categories: Record<
    Exclude<ActionBarCategory, "all">,
    Array<string | null>
  >;
}

interface ActionBarLayoutExportV1 {
  schemaVersion: 1;
  actionBarLayout: ActionBarLayout;
}

interface ActionBarLayoutDifference {
  path: string;
  label: string;
  current: string;
  incoming: string;
}

interface ActionBarLayoutApi {
  ACTION_BAR_LAYOUT_IMPORT_MAX_BYTES: number;
  createDefaultActionBarLayout(): ActionBarLayout;
  diffActionBarLayouts(
    current: ActionBarLayout,
    incoming: ActionBarLayout,
  ): ActionBarLayoutDifference[];
  parseActionBarLayoutImport(bytes: Uint8Array): ActionBarLayoutExportV1;
  serializeActionBarLayoutExport(layout: ActionBarLayout): string;
  validateActionBarLayout(value: unknown): ActionBarLayout;
}

const MODULE_PATH = "./action-bar-layout";
const encoder = new TextEncoder();
let api: ActionBarLayoutApi | null = null;

beforeAll(async () => {
  try {
    api = await import(
      /* @vite-ignore */ MODULE_PATH
    ) as ActionBarLayoutApi;
  } catch {
    api = null;
  }
});

beforeEach(() => {
  requireApi();
});

function requireApi(): ActionBarLayoutApi {
  expect(
    api,
    "stage two requires the public action bar layout domain module",
  ).not.toBeNull();
  return api as ActionBarLayoutApi;
}

function expectedDefaultLayout(): ActionBarLayout {
  return {
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
}

function cloneLayout(layout = expectedDefaultLayout()): ActionBarLayout {
  return structuredClone(layout);
}

describe("stage-two action bar layout", () => {
  it("returns the reviewed two-row locked default layout as detached values", () => {
    const first = requireApi().createDefaultActionBarLayout();
    const second = requireApi().createDefaultActionBarLayout();

    expect(first).toEqual(expectedDefaultLayout());
    first.all[0].slots[0] = null;
    first.categories.common.push("future-action");
    expect(second).toEqual(expectedDefaultLayout());
  });

  it.each([1, 2, 3, 4])("round-trips rows=%s", (rows) => {
    const layout = cloneLayout();
    layout.rows = rows;

    expect(requireApi().validateActionBarLayout(layout)).toEqual(layout);
  });

  it("preserves empty slots and unknown bounded ASCII action names", () => {
    const layout = cloneLayout();
    layout.locked = false;
    layout.activeCategory = "custom";
    layout.all[1].columns = 5;
    layout.all[1].slots.splice(1, 0, null, "future-action");
    layout.categories.custom = [null, "future-action", "?", "#"];

    const normalized = requireApi().validateActionBarLayout(layout);

    expect(normalized).toEqual(layout);
    expect(normalized).not.toBe(layout);
    expect(normalized.all[1].slots).not.toBe(layout.all[1].slots);
    expect(normalized.categories.custom).not.toBe(layout.categories.custom);
  });

  it("strictly rejects missing fields, unknown fields, and invalid enums", () => {
    const invalidCases: Array<[string, (layout: any) => void]> = [
      ["missing rows", (layout) => {
        delete layout.rows;
      }],
      ["unknown root field", (layout) => {
        layout.hoveredSlot = 1;
      }],
      ["invalid locked", (layout) => {
        layout.locked = "yes";
      }],
      ["invalid active category", (layout) => {
        layout.activeCategory = "info";
      }],
      ["missing category", (layout) => {
        delete layout.categories.custom;
      }],
      ["unknown category", (layout) => {
        layout.categories.system = [];
      }],
      ["wrong All section order", (layout) => {
        layout.all[0].category = "gear";
      }],
      ["unknown section field", (layout) => {
        layout.all[0].width = 96;
      }],
    ];

    for (const [label, mutate] of invalidCases) {
      const layout: any = cloneLayout();
      mutate(layout);
      expect(
        () => requireApi().validateActionBarLayout(layout),
        label,
      ).toThrow();
    }
  });

  it("rejects out-of-range rows, columns, arrays, and slot values", () => {
    const invalidCases: Array<[string, (layout: any) => void]> = [
      ["zero rows", (layout) => {
        layout.rows = 0;
      }],
      ["five rows", (layout) => {
        layout.rows = 5;
      }],
      ["fractional rows", (layout) => {
        layout.rows = 1.5;
      }],
      ["zero columns", (layout) => {
        layout.all[0].columns = 0;
      }],
      ["nine columns", (layout) => {
        layout.all[0].columns = 9;
      }],
      ["fractional columns", (layout) => {
        layout.all[0].columns = 1.5;
      }],
      ["too many All slots", (layout) => {
        layout.all[0].slots = Array(65).fill("search");
      }],
      ["too many category slots", (layout) => {
        layout.categories.custom = Array(105).fill("search");
      }],
      ["non-string slot", (layout) => {
        layout.categories.custom = [42];
      }],
    ];

    for (const [label, mutate] of invalidCases) {
      const layout: any = cloneLayout();
      mutate(layout);
      expect(
        () => requireApi().validateActionBarLayout(layout),
        label,
      ).toThrow();
    }
  });

  it.each([
    "",
    "x".repeat(65),
    "future action",
    "未来动作",
    "\u007f",
  ])("rejects invalid persisted action name %j", (name) => {
    const layout = cloneLayout();
    layout.categories.custom = [name];

    expect(() => requireApi().validateActionBarLayout(layout)).toThrow();
  });
});

describe("stage-two .bhactions format", () => {
  it("serializes schema v1 deterministically and round-trips the full layout", () => {
    const layout = cloneLayout();
    layout.activeCategory = "custom";
    layout.categories.custom = [null, "future-action"];
    const document = { schemaVersion: 1, actionBarLayout: layout };

    const json = requireApi().serializeActionBarLayoutExport(layout);

    expect(json).toBe(`${JSON.stringify(document, null, 2)}\n`);
    expect(
      requireApi().parseActionBarLayoutImport(encoder.encode(json)),
    ).toEqual(document);
  });

  it("strictly rejects outer fields, schemas, and malformed embedded layouts", () => {
    const valid = {
      schemaVersion: 1,
      actionBarLayout: cloneLayout(),
    };
    const invalidDocuments: Array<[string, Record<string, unknown>]> = [
      ["missing layout", { schemaVersion: 1 }],
      ["unsupported schema", { ...valid, schemaVersion: 2 }],
      ["unknown field", { ...valid, productVersion: "alpha-2.3" }],
      ["invalid layout", {
        ...valid,
        actionBarLayout: { ...valid.actionBarLayout, rows: 5 },
      }],
    ];

    for (const [label, document] of invalidDocuments) {
      expect(
        () => requireApi().parseActionBarLayoutImport(
          encoder.encode(JSON.stringify(document)),
        ),
        label,
      ).toThrow();
    }
  });

  it("rejects oversized, BOM-prefixed, NUL, and invalid UTF-8 input", () => {
    const layoutApi = requireApi();

    expect(layoutApi.ACTION_BAR_LAYOUT_IMPORT_MAX_BYTES).toBe(1024 * 1024);
    expect(() => layoutApi.parseActionBarLayoutImport(
      new Uint8Array(layoutApi.ACTION_BAR_LAYOUT_IMPORT_MAX_BYTES + 1),
    )).toThrow();
    expect(() => layoutApi.parseActionBarLayoutImport(
      encoder.encode("\uFEFF{}"),
    )).toThrow();
    expect(() => layoutApi.parseActionBarLayoutImport(
      encoder.encode("{\0}"),
    )).toThrow();
    expect(() => layoutApi.parseActionBarLayoutImport(
      Uint8Array.of(0xff),
    )).toThrow();
  });

  it("keeps current state untouched until a validated detached import is committed", () => {
    const current = cloneLayout();
    const incoming = cloneLayout();
    incoming.rows = 4;
    incoming.categories.custom = [null, "future-action"];
    const bytes = encoder.encode(JSON.stringify({
      schemaVersion: 1,
      actionBarLayout: incoming,
    }));

    const preview = requireApi().parseActionBarLayoutImport(bytes);

    expect(current).toEqual(expectedDefaultLayout());
    expect(preview.actionBarLayout).toEqual(incoming);
    expect(preview.actionBarLayout).not.toBe(incoming);
    preview.actionBarLayout.categories.custom[0] = "search";
    expect(incoming.categories.custom[0]).toBeNull();

    expect(() => requireApi().parseActionBarLayoutImport(
      encoder.encode(JSON.stringify({
        schemaVersion: 1,
        actionBarLayout: { ...incoming, rows: 0 },
      })),
    )).toThrow();
    expect(current).toEqual(expectedDefaultLayout());
  });

  it("produces a stable user-facing diff for rows, category, lock, and slots", () => {
    const current = cloneLayout();
    const incoming = cloneLayout();
    incoming.rows = 3;
    incoming.locked = false;
    incoming.activeCategory = "custom";
    incoming.categories.custom = [null, "future-action"];

    expect(requireApi().diffActionBarLayouts(current, incoming)).toEqual([
      {
        path: "rows",
        label: "Rows",
        current: "2",
        incoming: "3",
      },
      {
        path: "activeCategory",
        label: "Active category",
        current: "All",
        incoming: "Custom",
      },
      {
        path: "locked",
        label: "Layout lock",
        current: "Locked",
        incoming: "Unlocked",
      },
      {
        path: "slots",
        label: "Slots",
        current: "104 actions, 0 empty",
        incoming: "105 actions, 1 empty",
      },
    ]);
  });
});

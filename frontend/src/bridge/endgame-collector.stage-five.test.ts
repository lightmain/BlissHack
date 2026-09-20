import { describe, expect, it } from "vitest";
import {
  NHW_MAP,
  NHW_MENU,
  NHW_MESSAGE,
  NHW_STATUS,
  NHW_TEXT,
  PICK_NONE,
  PICK_ONE,
} from "../game-state";
import * as nethackBridge from "../nethack-bridge";
import {
  endgameMenuItemFixture,
  endgameWindowFixture,
  type EndgameCollector,
  type EndgameCollectorEvent,
  type EndgameCollectorOptions,
  type EndgameCollectorResetReason,
  type StageFiveCollectorApi,
} from "./endgame-collector.test-fixtures";

const stageFiveApi = nethackBridge as unknown as Partial<StageFiveCollectorApi>;
const OWNER = {
  moduleId: "module-current",
  sessionId: "session-current",
};
const DISCLOSURE_QUERY = "Do you want your possessions identified?";
const YES = "y".charCodeAt(0);

/**
 * Require the planned pure TypeScript collector without breaking test loading.
 * @param options - immutable session scope and game-over predicate.
 * @returns the collector once production implements the contract.
 */
function createCollector(options: EndgameCollectorOptions): EndgameCollector {
  const factory = stageFiveApi.createEndgameCollector;
  expect(factory).toBeTypeOf("function");
  return (factory as StageFiveCollectorApi["createEndgameCollector"])(options);
}

/**
 * Build one ordinary endgame disclosure event.
 * @param query - user-visible prompt used as the section title.
 * @param choices - exact core response contract.
 * @returns a standard ynq disclosure request.
 */
function disclosure(
  query = DISCLOSURE_QUERY,
  choices = "ynq",
): EndgameCollectorEvent {
  return {
    type: "yn",
    query,
    choices,
    defaultCode: "n".charCodeAt(0),
  };
}

/** Register the normal HUD windows which disappear before the summary. */
function registerHudWindows(collector: EndgameCollector): void {
  [
    [1, NHW_MESSAGE],
    [2, NHW_STATUS],
    [3, NHW_MAP],
  ].forEach(([windowId, windowType]) => {
    collector.handle({ type: "window-created", windowId, windowType });
  });
}

/** Destroy the normal HUD windows to establish the summary boundary. */
function destroyHudWindows(collector: EndgameCollector): void {
  [3, 2, 1].forEach((windowId) => {
    collector.handle({ type: "window-destroyed", windowId });
  });
}

const UNEXPECTED_INPUTS: Array<[string, EndgameCollectorEvent]> = [
  ["getlin", { type: "input-request", inputKind: "getlin" }],
  [
    "extended command",
    { type: "input-request", inputKind: "extended-command" },
  ],
  [
    "message menu",
    { type: "input-request", inputKind: "message-menu" },
  ],
  [
    "numeric yn",
    {
      type: "yn",
      query: "How many?",
      choices: "yn#",
      defaultCode: "n".charCodeAt(0),
    },
  ],
  [
    "interactive menu",
    {
      type: "select-menu",
      window: endgameWindowFixture({
        id: 12,
        type: NHW_MENU,
        menuPrompt: "Choose:",
        menuItems: [endgameMenuItemFixture("a - option")],
      }),
      how: PICK_ONE,
    },
  ],
];

describe("alpha-2.2 EndgameCollector contract", () => {
  it("answers disclosure only for BlissHack style with verified game-over", () => {
    const original = createCollector({
      owner: OWNER,
      style: "original",
      isGameOver: () => true,
    });
    const ordinaryPlay = createCollector({
      owner: OWNER,
      style: "blisshack",
      isGameOver: () => false,
    });
    const endgame = createCollector({
      owner: OWNER,
      style: "blisshack",
      isGameOver: () => true,
    });

    expect(original.handle(disclosure())).toEqual({ kind: "pass" });
    expect(ordinaryPlay.handle(disclosure())).toEqual({ kind: "pass" });
    expect(endgame.handle(disclosure())).toEqual({
      kind: "resolve",
      value: YES,
    });
    expect(endgame.getState().phase).toBe("collecting-disclosure");
  });

  it.each(["ynaq", "ynq\u001ba"])(
    "accepts the core's %j disclosure choice contract",
    (choices) => {
      const collector = createCollector({
        owner: OWNER,
        style: "blisshack",
        isGameOver: () => true,
      });

      expect(collector.handle(disclosure(
        "Do you want an account of creatures vanquished?",
        choices,
      ))).toEqual({
        kind: "resolve",
        value: YES,
      });
    },
  );

  it.each([
    {
      label: "single-item",
      itemTexts: ["a - a +0 bullwhip (weapon in hand)"],
    },
    {
      label: "multi-item",
      itemTexts: [
        "a - a +0 bullwhip (weapon in hand)",
        "b - 3 uncursed food rations",
      ],
    },
  ])(
    "collects and resolves a $label PICK_ONE inventory after its disclosure",
    ({ itemTexts }) => {
      const collector = createCollector({
        owner: OWNER,
        style: "blisshack",
        isGameOver: () => true,
      });
      registerHudWindows(collector);
      expect(collector.handle(disclosure())).toEqual({
        kind: "resolve",
        value: YES,
      });
      const inventory = endgameWindowFixture({
        id: 10,
        type: NHW_MENU,
        menuItems: itemTexts.map(endgameMenuItemFixture),
      });
      collector.handle({
        type: "window-created",
        windowId: inventory.id,
        windowType: inventory.type,
      });

      expect(collector.handle({
        type: "select-menu",
        window: inventory,
        how: PICK_ONE,
      })).toEqual({ kind: "resolve", value: 0 });

      destroyHudWindows(collector);
      collector.handle({
        type: "display-window",
        window: endgameWindowFixture({
          id: 20,
          type: NHW_TEXT,
          lines: [{ text: "You quit.", attribute: 0 }],
        }),
        blocking: true,
      });
      expect(collector.complete()?.sections[1]).toMatchObject({
        kind: "disclosure",
        title: DISCLOSURE_QUERY,
        blocks: [{
          kind: "menu",
          sourceWindowId: inventory.id,
          items: itemTexts.map((text) => ({ text })),
        }],
      });
    },
  );

  it("falls back for an arbitrary game-over PICK_ONE menu", () => {
    const collector = createCollector({
      owner: OWNER,
      style: "blisshack",
      isGameOver: () => true,
    });
    const menu = endgameWindowFixture({
      id: 12,
      type: NHW_MENU,
      menuPrompt: "Choose an action:",
      menuItems: [endgameMenuItemFixture("a - apply")],
    });

    expect(collector.handle({
      type: "select-menu",
      window: menu,
      how: PICK_ONE,
    })).toEqual({ kind: "pass" });
    expect(collector.getState()).toMatchObject({
      phase: "fallback",
      fallbackReason: "unexpected-menu",
      summary: null,
    });
  });

  it("applies endgame style changes while the current session is idle", () => {
    const collector = createCollector({
      owner: OWNER,
      style: "original",
      isGameOver: () => true,
    });
    registerHudWindows(collector);
    expect(collector.handle(disclosure())).toEqual({ kind: "pass" });

    collector.setStyle("blisshack");

    expect(collector.handle(disclosure())).toEqual({
      kind: "resolve",
      value: YES,
    });
    collector.handle({
      type: "display-window",
      window: endgameWindowFixture({
        id: 10,
        type: NHW_TEXT,
        lines: [{ text: "Possessions", attribute: 0 }],
      }),
      blocking: true,
    });
    destroyHudWindows(collector);
    collector.handle({
      type: "display-window",
      window: endgameWindowFixture({
        id: 20,
        type: NHW_TEXT,
        lines: [{ text: "You died.", attribute: 0 }],
      }),
      blocking: true,
    });
    expect(collector.complete()?.sections.map((section) => section.kind))
      .toEqual(["summary", "disclosure"]);
  });

  it("groups multiple windows under one disclosure and omits an empty one", () => {
    const collector = createCollector({
      owner: OWNER,
      style: "blisshack",
      isGameOver: () => true,
    });
    registerHudWindows(collector);

    collector.handle(disclosure());
    const inventory = endgameWindowFixture({
      id: 10,
      type: NHW_MENU,
      menuPrompt: "Inventory",
      menuItems: [endgameMenuItemFixture("a - a bag containing 1 item")],
    });
    const container = endgameWindowFixture({
      id: 11,
      type: NHW_TEXT,
      lines: [
        { text: "Contents of the bag:", attribute: 1 },
        { text: "  a potion", attribute: 0 },
      ],
    });
    collector.handle({
      type: "window-created",
      windowId: inventory.id,
      windowType: inventory.type,
    });
    collector.handle({ type: "select-menu", window: inventory, how: PICK_NONE });
    collector.handle({
      type: "window-created",
      windowId: container.id,
      windowType: container.type,
    });
    collector.handle({
      type: "display-window",
      window: container,
      blocking: true,
    });

    collector.handle(disclosure("Do you want to see extinct species?"));
    destroyHudWindows(collector);

    const summaryWindow = endgameWindowFixture({
      id: 20,
      type: NHW_TEXT,
      lines: [{ text: "Ada the Wizard...", attribute: 0 }],
    });
    collector.handle({
      type: "window-created",
      windowId: summaryWindow.id,
      windowType: summaryWindow.type,
    });
    collector.handle({
      type: "display-window",
      window: summaryWindow,
      blocking: true,
    });
    collector.handle({
      type: "window-destroyed",
      windowId: summaryWindow.id,
    });
    collector.handle({
      type: "raw-print",
      line: { text: " No  Points     Name", attribute: 1 },
    });

    const summary = collector.complete();

    expect(summary?.sections.map((section) => section.kind)).toEqual([
      "summary",
      "disclosure",
      "ranking",
    ]);
    expect(summary?.sections.map((section) => section.title)).not.toContain(
      "Do you want to see extinct species?",
    );
    expect(summary?.sections[1]).toMatchObject({
      kind: "disclosure",
      title: DISCLOSURE_QUERY,
      blocks: [
        {
          kind: "menu",
          sourceWindowId: 10,
          prompt: "Inventory",
          items: [{ text: "a - a bag containing 1 item" }],
        },
        {
          kind: "text",
          sourceWindowId: 11,
          lines: [
            { text: "Contents of the bag:", attribute: 1 },
            { text: "  a potion", attribute: 0 },
          ],
        },
      ],
    });
    expect(summary?.sections.at(0)?.blocks).toEqual([
      {
        kind: "text",
        sourceWindowId: 20,
        lines: [{ text: "Ada the Wizard...", attribute: 0 }],
      },
    ]);
    expect(summary?.sections.at(-1)?.blocks).toEqual([
      {
        kind: "text",
        sourceWindowId: null,
        lines: [{ text: " No  Points     Name", attribute: 1 }],
      },
    ]);
  });

  it("[defect-probing] maps disclosure questions to concise player-facing labels", () => {
    const cases = [
      [
        "Do you want your possessions identified?",
        "Identified Possessions",
      ],
      [
        "Do you want to see what you had when you died?",
        "Identified Possessions",
      ],
      ["Do you want to see your attributes?", "Final Attributes"],
      [
        "Do you want an account of creatures vanquished?",
        "Vanquished Creatures",
      ],
      ["Do you want a list of species genocided?", "Genocided Species"],
      ["Do you want a list of extinct species?", "Extinct Species"],
      [
        "Do you want a list of species genocided and extinct?",
        "Genocided and Extinct Species",
      ],
      ["Do you want to see your conduct?", "Conduct"],
      [
        "Do you want to see your conduct and achievements?",
        "Conduct and Achievements",
      ],
      ["Do you want to see the dungeon overview?", "Dungeon Overview"],
    ] as const;

    const titles = cases.map(([query]) => {
      const collector = createCollector({
        owner: OWNER,
        style: "blisshack",
        isGameOver: () => true,
      });
      registerHudWindows(collector);
      collector.handle(disclosure(query));
      collector.handle({
        type: "display-window",
        window: endgameWindowFixture({
          id: 10,
          type: NHW_TEXT,
          lines: [{ text: "Disclosure content", attribute: 0 }],
        }),
        blocking: true,
      });
      destroyHudWindows(collector);
      collector.handle({
        type: "display-window",
        window: endgameWindowFixture({
          id: 20,
          type: NHW_TEXT,
          lines: [{ text: "You died.", attribute: 0 }],
        }),
        blocking: true,
      });
      return collector.complete()?.sections[1]?.title;
    });

    expect(titles).toEqual(cases.map(([, label]) => label));
  });

  it("preserves putstr lines from NHW_MENU disclosure windows", () => {
    const collector = createCollector({
      owner: OWNER,
      style: "blisshack",
      isGameOver: () => true,
    });
    registerHudWindows(collector);
    collector.handle(disclosure(
      "Do you want an account of creatures vanquished?",
      "ynaq",
    ));
    collector.handle({
      type: "display-window",
      window: endgameWindowFixture({
        id: 42,
        type: NHW_MENU,
        lines: [{ text: "Vanquished creatures:", attribute: 1 }],
      }),
      blocking: true,
    });
    destroyHudWindows(collector);
    const summaryWindow = endgameWindowFixture({
      id: 43,
      type: NHW_TEXT,
      lines: [{ text: "You died.", attribute: 0 }],
    });
    collector.handle({
      type: "display-window",
      window: summaryWindow,
      blocking: true,
    });

    expect(collector.complete()?.sections[1]).toMatchObject({
      kind: "disclosure",
      blocks: [{
        kind: "menu",
        lines: [{ text: "Vanquished creatures:", attribute: 1 }],
      }],
    });
  });

  it("freezes the completed summary and all captured nested values", () => {
    const collector = createCollector({
      owner: OWNER,
      style: "blisshack",
      isGameOver: () => true,
    });
    registerHudWindows(collector);
    collector.handle(disclosure());
    const disclosureWindow = endgameWindowFixture({
      id: 10,
      type: NHW_TEXT,
      lines: [{ text: "Final Attributes:", attribute: 1 }],
    });
    collector.handle({
      type: "display-window",
      window: disclosureWindow,
      blocking: true,
    });
    destroyHudWindows(collector);
    const summaryWindow = endgameWindowFixture({
      id: 20,
      type: NHW_TEXT,
      lines: [{ text: "You died with 42 points.", attribute: 0 }],
    });
    collector.handle({
      type: "window-created",
      windowId: summaryWindow.id,
      windowType: summaryWindow.type,
    });
    collector.handle({
      type: "display-window",
      window: summaryWindow,
      blocking: true,
    });

    const summary = collector.complete();

    expect(summary).not.toBeNull();
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary?.owner)).toBe(true);
    expect(Object.isFrozen(summary?.sections)).toBe(true);
    for (const section of summary?.sections ?? []) {
      expect(Object.isFrozen(section)).toBe(true);
      expect(Object.isFrozen(section.blocks)).toBe(true);
      for (const block of section.blocks) {
        expect(Object.isFrozen(block)).toBe(true);
        if (block.kind === "text") expect(Object.isFrozen(block.lines)).toBe(true);
        else expect(Object.isFrozen(block.items)).toBe(true);
      }
    }
  });

  it("returns one exact acknowledgement for blocking text and PICK_NONE", () => {
    const collector = createCollector({
      owner: OWNER,
      style: "blisshack",
      isGameOver: () => true,
    });
    collector.handle(disclosure());
    const text = endgameWindowFixture({
      id: 10,
      type: NHW_TEXT,
      lines: [{ text: "Final Attributes:", attribute: 0 }],
    });
    const menu = endgameWindowFixture({
      id: 11,
      type: NHW_MENU,
      menuPrompt: "Inventory",
      menuItems: [endgameMenuItemFixture("a - a mace")],
    });

    expect(collector.handle({
      type: "display-window",
      window: text,
      blocking: true,
    })).toEqual({ kind: "resolve" });
    expect(collector.handle({
      type: "display-window",
      window: text,
      blocking: false,
    })).toEqual({ kind: "pass" });
    expect(collector.handle({
      type: "select-menu",
      window: menu,
      how: PICK_NONE,
    })).toEqual({ kind: "resolve", value: 0 });
    expect(collector.handle({
      type: "window-destroyed",
      windowId: text.id,
    })).toEqual({ kind: "pass" });
  });

  it.each(UNEXPECTED_INPUTS)(
    "falls back without consuming unexpected %s input",
    (_name, event) => {
      const collector = createCollector({
        owner: OWNER,
        style: "blisshack",
        isGameOver: () => true,
      });
      collector.handle(disclosure());

      expect(collector.handle(event)).toEqual({ kind: "pass" });
      expect(collector.getState()).toMatchObject({
        phase: "fallback",
        summary: null,
      });
      expect(collector.handle(disclosure("A later prompt"))).toEqual({
        kind: "pass",
      });
      expect(collector.complete()).toBeNull();
    },
  );

  it.each<EndgameCollectorResetReason>([
    "bridge-reset",
    "fatal",
    "session-replaced",
  ])("discards partial state on %s cleanup", (reason) => {
    const collector = createCollector({
      owner: OWNER,
      style: "blisshack",
      isGameOver: () => true,
    });
    collector.handle(disclosure());
    collector.handle({
      type: "display-window",
      window: endgameWindowFixture({
        id: 10,
        type: NHW_TEXT,
        lines: [{ text: "partial", attribute: 0 }],
      }),
      blocking: true,
    });

    collector.reset(reason);

    expect(collector.getState()).toEqual({
      phase: "idle",
      owner: null,
      currentDisclosureTitle: null,
      fallbackReason: null,
      summary: null,
    });
    expect(collector.handle(disclosure())).toEqual({ kind: "pass" });
    expect(collector.complete()).toBeNull();
  });
});

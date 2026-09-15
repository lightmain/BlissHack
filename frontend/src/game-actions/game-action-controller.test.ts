import { describe, expect, it, vi } from "vitest";
import { PICK_ONE, type MenuItem } from "../game-state";
import {
  createGameActionController,
  type ActionControllerObservation,
  type ActionIntent,
  type ActionIntentCancellationReason,
} from "./game-action-controller";

const ITEM_ACCELERATOR = "a".charCodeAt(0);
const INVENTORY_REVISION = 4;
const MAP_REVISION = 7;
const INVALID_MENU_METADATA = [
  { label: "missing how", metadata: { windowId: 23 } },
  { label: "non-PICK_ONE how", metadata: { how: 2, windowId: 23 } },
  { label: "missing windowId", metadata: { how: PICK_ONE } },
  { label: "negative windowId", metadata: { how: PICK_ONE, windowId: -1 } },
] as const;

function createInventoryIntent(): Extract<
  ActionIntent,
  { kind: "inventory-context" }
> {
  return {
    kind: "inventory-context",
    moduleId: "module-1",
    sessionId: "session-1",
    snapshotRevision: 12,
    inventoryRevision: INVENTORY_REVISION,
    identifier: 41,
    accelerator: ITEM_ACCELERATOR,
    origin: {
      kind: "inventory",
      clientX: 240,
      clientY: 160,
      inventoryRevision: INVENTORY_REVISION,
      accelerator: ITEM_ACCELERATOR,
    },
  };
}

/** Return one drop intent bound to the visible inventory snapshot. */
function createDropIntent(): Extract<ActionIntent, { kind: "drop-item" }> {
  return {
    kind: "drop-item",
    moduleId: "module-1",
    sessionId: "session-1",
    snapshotRevision: 12,
    inventoryRevision: INVENTORY_REVISION,
    identifier: 41,
    accelerator: ITEM_ACCELERATOR,
    glyph: null,
    origin: {
      kind: "inventory",
      clientX: 240,
      clientY: 160,
      inventoryRevision: INVENTORY_REVISION,
      accelerator: ITEM_ACCELERATOR,
    },
  };
}

function createMapContextIntent(): Extract<
  ActionIntent,
  { kind: "map-context" }
> {
  return {
    kind: "map-context",
    moduleId: "module-1",
    sessionId: "session-1",
    snapshotRevision: 12,
    origin: {
      kind: "map",
      clientX: 320,
      clientY: 200,
      mapX: 18,
      mapY: 7,
    },
  };
}

function createMapInspectIntent(): Extract<
  ActionIntent,
  { kind: "map-inspect" }
> {
  return {
    ...createMapContextIntent(),
    kind: "map-inspect",
    mapRevision: MAP_REVISION,
    glyph: null,
  };
}

type TestObservation = ActionControllerObservation & {
  mapRevision: number;
};

function createObservation(
  overrides: Partial<TestObservation> = {},
): TestObservation {
  return {
    moduleId: "module-1",
    sessionId: "session-1",
    snapshotRevision: 12,
    inventoryRevision: INVENTORY_REVISION,
    mapRevision: MAP_REVISION,
    input: { kind: "key" },
    ...overrides,
  };
}

function menuItem(
  identifier: number,
  accelerator: number,
  text: string,
): MenuItem {
  return {
    glyph: null,
    identifier,
    accelerator,
    groupAccelerator: 0,
    attribute: 0,
    color: 0,
    text,
    itemFlags: 0,
  };
}

function createHarness() {
  const startCommand = vi.fn();
  const submitMenuSelection = vi.fn();
  const releaseInputToUi = vi.fn();
  const onCancel = vi.fn();
  const onComplete = vi.fn();
  const setActionIntentActive = vi.fn();
  const options = {
    startCommand,
    submitMenuSelection,
    releaseInputToUi,
    onCancel,
    onComplete,
    setActionIntentActive,
  };
  const controller = createGameActionController(options);
  return {
    controller,
    onCancel,
    onComplete,
    releaseInputToUi,
    setActionIntentActive,
    startCommand,
    submitMenuSelection,
  };
}

describe("GameActionController", () => {
  it("allows only one active UI action intent", () => {
    const { controller } = createHarness();
    const first = createInventoryIntent();
    const second: ActionIntent = {
      kind: "map-context",
      moduleId: "module-1",
      sessionId: "session-1",
      snapshotRevision: 13,
      origin: {
        kind: "map",
        clientX: 320,
        clientY: 200,
        mapX: 18,
        mapY: 7,
      },
    };

    expect(controller.request(first)).toBe(true);
    expect(controller.request(second)).toBe(false);
    expect(controller.getState()).toMatchObject({
      status: "waiting-command-boundary",
      intent: first,
    });
  });

  it("starts an accepted intent only at the main command boundary", () => {
    const { controller, startCommand } = createHarness();
    const intent = createInventoryIntent();

    controller.request(intent);
    controller.observe(createObservation({
      input: null,
    }));
    expect(startCommand).not.toHaveBeenCalled();

    controller.observe(createObservation({
      input: { kind: "command" },
    }));
    controller.observe(createObservation({
      input: { kind: "command" },
    }));

    expect(startCommand).toHaveBeenCalledTimes(1);
    expect(startCommand).toHaveBeenCalledWith(intent);
  });

  it("starts one drop command and selects the whole current accelerator row", () => {
    const { controller, startCommand, submitMenuSelection } = createHarness();
    const intent = createDropIntent();

    controller.request(intent);
    controller.observe(createObservation({ input: { kind: "command" } }));

    expect(startCommand).toHaveBeenCalledOnce();
    expect(startCommand).toHaveBeenCalledWith(intent);

    controller.observe(createObservation({
      input: {
        kind: "menu",
        items: [
          menuItem(41, "b".charCodeAt(0), "old identifier, new accelerator"),
          menuItem(9001, ITEM_ACCELERATOR, "current accelerator, new identifier"),
        ],
        windowId: 30,
        how: PICK_ONE,
      },
    }));

    expect(submitMenuSelection).toHaveBeenCalledOnce();
    expect(submitMenuSelection).toHaveBeenCalledWith([
      { itemIndex: 1, count: -1 },
    ]);
  });

  it.each(INVALID_MENU_METADATA)(
    "rejects a drop selector with $label without selecting",
    ({ metadata }) => {
      const {
        controller,
        onCancel,
        releaseInputToUi,
        submitMenuSelection,
      } = createHarness();
      const invalidMenu = {
        kind: "menu" as const,
        items: [
          menuItem(9001, ITEM_ACCELERATOR, "current target row"),
        ],
        ...metadata,
      };

      controller.request(createDropIntent());
      controller.observe(createObservation({ input: { kind: "command" } }));
      controller.observe(createObservation({ input: invalidMenu }));

      expect(submitMenuSelection).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledWith("unexpected-input");
      expect(releaseInputToUi).toHaveBeenCalledWith(invalidMenu);
    },
  );

  it("rejects a matching drop accelerator when its current identifier is absent", () => {
    const {
      controller,
      onCancel,
      submitMenuSelection,
    } = createHarness();

    controller.request(createDropIntent());
    controller.observe(createObservation({ input: { kind: "command" } }));
    controller.observe(createObservation({
      input: {
        kind: "menu",
        items: [{
          ...menuItem(9001, ITEM_ACCELERATOR, "non-selectable target row"),
          identifier: null,
        }],
        windowId: 30,
        how: PICK_ONE,
      },
    }));

    expect(submitMenuSelection).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledWith("missing-accelerator");
  });

  it("hands a native follow-up prompt to the ordinary UI without another selection", () => {
    const {
      controller,
      onCancel,
      releaseInputToUi,
      submitMenuSelection,
    } = createHarness();
    const prompt = {
      kind: "yn" as const,
      query: "Drop the equipped item?",
      choices: "yn",
      defaultCode: "n".charCodeAt(0),
    };

    controller.request(createDropIntent());
    controller.observe(createObservation({ input: { kind: "command" } }));
    controller.observe(createObservation({
      input: {
        kind: "menu",
        items: [
          menuItem(9001, ITEM_ACCELERATOR, "current target row"),
        ],
        windowId: 30,
        how: PICK_ONE,
      },
    }));
    controller.observe(createObservation({ input: prompt }));

    expect(submitMenuSelection).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledWith("unexpected-input");
    expect(releaseInputToUi).toHaveBeenCalledWith(prompt);
    expect(controller.getState()).toMatchObject({
      status: "idle",
      intent: null,
      lastCancellationReason: "unexpected-input",
    });
  });

  it("[defect-probing] completes a successful drop after the core publishes a new inventory revision", () => {
    const {
      controller,
      onCancel,
      onComplete,
      releaseInputToUi,
      startCommand,
      submitMenuSelection,
    } = createHarness();
    const intent = createDropIntent();

    controller.request(intent);
    controller.observe(createObservation({ input: { kind: "command" } }));
    controller.observe(createObservation({
      input: {
        kind: "menu",
        items: [
          menuItem(9001, ITEM_ACCELERATOR, "current target row"),
        ],
        windowId: 30,
        how: PICK_ONE,
      },
    }));
    controller.observe(createObservation({
      inventoryRevision: INVENTORY_REVISION + 1,
      snapshotRevision: 13,
      input: { kind: "command" },
    }));

    expect(startCommand).toHaveBeenCalledOnce();
    expect(submitMenuSelection).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
    expect(releaseInputToUi).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(intent);
    expect(controller.getState()).toMatchObject({
      status: "idle",
      intent: null,
      lastCancellationReason: null,
    });
  });

  it.each([
    {
      label: "inventory revision",
      observation: { inventoryRevision: INVENTORY_REVISION + 1 },
      reason: "inventory-revision-changed",
    },
    {
      label: "session",
      observation: { sessionId: "session-2" },
      reason: "session-reset",
    },
  ] as const)(
    "cancels a pending drop before command start when the $label changes",
    ({ observation, reason }) => {
      const { controller, onCancel, startCommand } = createHarness();
      controller.request(createDropIntent());

      controller.observe(createObservation({
        ...observation,
        input: { kind: "command" },
      }));

      expect(startCommand).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledWith(reason);
    },
  );

  it("[defect-probing] completes map inspection only at the next command boundary", () => {
    const {
      controller,
      onCancel,
      releaseInputToUi,
      startCommand,
    } = createHarness();
    const intent = createMapInspectIntent();

    controller.request(intent);
    controller.observe(createObservation({ input: null }));
    expect(startCommand).not.toHaveBeenCalled();

    controller.observe(createObservation({ input: { kind: "command" } }));
    expect(startCommand).toHaveBeenCalledOnce();
    expect(startCommand).toHaveBeenCalledWith(intent);
    expect(controller.getState().status).toBe("waiting-expected-input");

    controller.observe(createObservation({ input: null }));
    expect(controller.getState().status).toBe("waiting-expected-input");

    controller.observe(createObservation({ input: { kind: "command" } }));

    expect(controller.getState()).toMatchObject({
      status: "idle",
      intent: null,
      lastCancellationReason: null,
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(releaseInputToUi).not.toHaveBeenCalled();
  });

  it("[defect-probing] cancels and releases a menu received during map inspection", () => {
    const {
      controller,
      onCancel,
      releaseInputToUi,
      submitMenuSelection,
    } = createHarness();
    const unexpectedMenu = {
      kind: "menu" as const,
      items: [menuItem(17, "l".charCodeAt(0), "l - unrelated action")],
      windowId: 23,
      how: PICK_ONE,
    };

    controller.request(createMapInspectIntent());
    controller.observe(createObservation({ input: { kind: "command" } }));
    controller.observe(createObservation({ input: unexpectedMenu }));

    expect(submitMenuSelection).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledWith("unexpected-input");
    expect(releaseInputToUi).toHaveBeenCalledOnce();
    expect(releaseInputToUi).toHaveBeenCalledWith(unexpectedMenu);
    expect(onCancel.mock.invocationCallOrder[0])
      .toBeLessThan(releaseInputToUi.mock.invocationCallOrder[0]);
    expect(controller.getState()).toMatchObject({
      status: "idle",
      intent: null,
      contextMenu: null,
      lastCancellationReason: "unexpected-input",
    });
  });

  it("freezes bridge typeahead for the complete active-intent lifetime", () => {
    const { controller, setActionIntentActive } = createHarness();

    controller.request(createInventoryIntent());
    expect(setActionIntentActive).toHaveBeenLastCalledWith(true);

    controller.cancel("user-cancelled");
    expect(setActionIntentActive.mock.calls).toEqual([[true], [false]]);
  });

  it("completes a map context intent after its observed menu closes", () => {
    const { controller, setActionIntentActive } = createHarness();
    const intent = createMapContextIntent();

    controller.request(intent);
    controller.observe(createObservation({ input: { kind: "command" } }));
    controller.observe(createObservation({
      input: {
        kind: "menu",
        items: [menuItem(17, "o".charCodeAt(0), "o - open")],
        windowId: 23,
        how: PICK_ONE,
      },
    }));

    expect(controller.getState()).toMatchObject({
      status: "presenting-context-menu",
      intent,
      contextMenu: {
        windowId: 23,
        how: PICK_ONE,
        origin: intent.origin,
      },
    });

    controller.observe(createObservation({ input: null }));
    expect(controller.getState().status).toBe("presenting-context-menu");
    expect(setActionIntentActive).toHaveBeenLastCalledWith(true);

    controller.observe(createObservation({ input: { kind: "command" } }));

    expect(controller.getState()).toMatchObject({
      status: "idle",
      intent: null,
      contextMenu: null,
    });
    expect(setActionIntentActive.mock.calls).toEqual([[true], [false]]);
  });

  it.each(INVALID_MENU_METADATA)(
    "[defect-probing] rejects a map context menu with $label",
    ({ metadata }) => {
      const {
        controller,
        onCancel,
        releaseInputToUi,
        submitMenuSelection,
      } = createHarness();
      const invalidMenu = {
        kind: "menu" as const,
        items: [menuItem(17, "o".charCodeAt(0), "o - open")],
        ...metadata,
      };

      controller.request(createMapContextIntent());
      controller.observe(createObservation({ input: { kind: "command" } }));
      controller.observe(createObservation({ input: invalidMenu }));

      expect(submitMenuSelection).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledWith("unexpected-input");
      expect(releaseInputToUi).toHaveBeenCalledWith(invalidMenu);
      expect(onCancel.mock.invocationCallOrder[0])
        .toBeLessThan(releaseInputToUi.mock.invocationCallOrder[0]);
      expect(controller.getState()).toMatchObject({
        status: "idle",
        intent: null,
        contextMenu: null,
        lastCancellationReason: "unexpected-input",
      });
    },
  );

  it("matches the accelerator in the newly generated menu", () => {
    const { controller, submitMenuSelection } = createHarness();
    controller.request(createInventoryIntent());
    controller.observe(createObservation({ input: { kind: "command" } }));

    controller.observe(createObservation({
      input: {
        kind: "menu",
        items: [
          menuItem(41, "b".charCodeAt(0), "b - a changed first item"),
          menuItem(99, ITEM_ACCELERATOR, "a - the current target"),
        ],
        windowId: 30,
        how: PICK_ONE,
      },
    }));

    expect(submitMenuSelection).toHaveBeenCalledOnce();
    expect(submitMenuSelection).toHaveBeenCalledWith([
      { itemIndex: 1, count: 1 },
    ]);
  });

  it.each(INVALID_MENU_METADATA)(
    "[defect-probing] rejects an inventory selector with $label without selecting",
    ({ metadata }) => {
      const {
        controller,
        onCancel,
        releaseInputToUi,
        submitMenuSelection,
      } = createHarness();
      const invalidMenu = {
        kind: "menu" as const,
        items: [
          menuItem(7002, ITEM_ACCELERATOR, "opaque target row"),
        ],
        ...metadata,
      };

      controller.request(createInventoryIntent());
      controller.observe(createObservation({ input: { kind: "command" } }));
      controller.observe(createObservation({ input: invalidMenu }));

      expect(submitMenuSelection).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledWith("unexpected-input");
      expect(releaseInputToUi).toHaveBeenCalledWith(invalidMenu);
      expect(onCancel.mock.invocationCallOrder[0])
        .toBeLessThan(releaseInputToUi.mock.invocationCallOrder[0]);
      expect(controller.getState()).toMatchObject({
        status: "idle",
        intent: null,
        targetSelected: false,
        contextMenu: null,
        lastCancellationReason: "unexpected-input",
      });
    },
  );

  it("hides the inventory selector and presents only the resulting itemactions menu", () => {
    const { controller, submitMenuSelection } = createHarness();
    const intent = createInventoryIntent();
    controller.request(intent);
    controller.observe(createObservation({ input: { kind: "command" } }));

    controller.observe(createObservation({
      input: {
        kind: "menu",
        items: [
          menuItem(7001, "q".charCodeAt(0), "opaque row one"),
          menuItem(7002, ITEM_ACCELERATOR, "opaque row two"),
        ],
        windowId: 31,
        how: PICK_ONE,
      },
    }));

    expect(submitMenuSelection).toHaveBeenCalledWith([
      { itemIndex: 1, count: 1 },
    ]);
    expect(controller.getState()).toMatchObject({
      status: "waiting-expected-input",
      targetSelected: true,
      contextMenu: null,
    });

    controller.observe(createObservation({
      input: {
        kind: "menu",
        items: [
          menuItem(8101, 0, "opaque core action"),
        ],
        windowId: 32,
        how: PICK_ONE,
      },
    }));

    expect(submitMenuSelection).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({
      status: "presenting-context-menu",
      contextMenu: {
        windowId: 32,
        how: PICK_ONE,
        origin: intent.origin,
      },
    });
  });

  it.each(INVALID_MENU_METADATA)(
    "[defect-probing] rejects an itemactions menu with $label after selecting the target",
    ({ metadata }) => {
      const {
        controller,
        onCancel,
        releaseInputToUi,
        submitMenuSelection,
      } = createHarness();
      const invalidMenu = {
        kind: "menu" as const,
        items: [menuItem(8101, 0, "opaque core action")],
        ...metadata,
      };

      controller.request(createInventoryIntent());
      controller.observe(createObservation({ input: { kind: "command" } }));
      controller.observe(createObservation({
        input: {
          kind: "menu",
          items: [
            menuItem(7002, ITEM_ACCELERATOR, "opaque target row"),
          ],
          windowId: 31,
          how: PICK_ONE,
        },
      }));
      controller.observe(createObservation({ input: invalidMenu }));

      expect(submitMenuSelection).toHaveBeenCalledTimes(1);
      expect(submitMenuSelection).toHaveBeenCalledWith([
        { itemIndex: 0, count: 1 },
      ]);
      expect(onCancel).toHaveBeenCalledWith("unexpected-input");
      expect(releaseInputToUi).toHaveBeenCalledWith(invalidMenu);
      expect(onCancel.mock.invocationCallOrder[0])
        .toBeLessThan(releaseInputToUi.mock.invocationCallOrder[0]);
      expect(controller.getState()).toMatchObject({
        status: "idle",
        intent: null,
        targetSelected: false,
        contextMenu: null,
        lastCancellationReason: "unexpected-input",
      });
    },
  );

  it("cancels safely when the newly generated inventory menu lacks the accelerator", () => {
    const {
      controller,
      onCancel,
      submitMenuSelection,
    } = createHarness();
    controller.request(createInventoryIntent());
    controller.observe(createObservation({ input: { kind: "command" } }));

    controller.observe(createObservation({
      input: {
        kind: "menu",
        items: [
          menuItem(7001, "b".charCodeAt(0), "opaque non-target row"),
        ],
        windowId: 31,
        how: PICK_ONE,
      },
    }));

    expect(submitMenuSelection).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledWith("missing-accelerator");
    expect(controller.getState()).toMatchObject({
      status: "idle",
      intent: null,
      lastCancellationReason: "missing-accelerator",
    });
  });

  it("cancels before itemactions when the inventory revision changes after selection", () => {
    const {
      controller,
      onCancel,
      submitMenuSelection,
    } = createHarness();
    controller.request(createInventoryIntent());
    controller.observe(createObservation({ input: { kind: "command" } }));
    controller.observe(createObservation({
      input: {
        kind: "menu",
        items: [
          menuItem(7002, ITEM_ACCELERATOR, "opaque target row"),
        ],
        windowId: 31,
        how: PICK_ONE,
      },
    }));

    controller.observe(createObservation({
      inventoryRevision: INVENTORY_REVISION + 1,
      input: {
        kind: "menu",
        items: [
          menuItem(8101, 0, "opaque core action"),
        ],
      },
    }));

    expect(submitMenuSelection).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith("inventory-revision-changed");
    expect(controller.getState()).toMatchObject({
      status: "idle",
      intent: null,
      lastCancellationReason: "inventory-revision-changed",
    });
  });

  it("cancels before command start when the inventory revision changes", () => {
    const { controller, onCancel, startCommand } = createHarness();
    controller.request(createInventoryIntent());

    controller.observe(createObservation({
      inventoryRevision: INVENTORY_REVISION + 1,
      input: { kind: "command" },
    }));

    expect(startCommand).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledWith("inventory-revision-changed");
    expect(controller.getState()).toMatchObject({
      status: "idle",
      intent: null,
      lastCancellationReason: "inventory-revision-changed",
    });
  });

  it("hands off an early menu and cannot later select its matching accelerator", () => {
    const {
      controller,
      onCancel,
      releaseInputToUi,
      startCommand,
      submitMenuSelection,
    } = createHarness();
    const unexpectedMenu = {
      kind: "menu" as const,
      items: [menuItem(99, ITEM_ACCELERATOR, "a - an unrelated item")],
      windowId: 8,
      how: 1,
    };

    controller.request(createInventoryIntent());
    controller.observe(createObservation({ input: unexpectedMenu }));
    controller.observe(createObservation({ input: { kind: "command" } }));
    controller.observe(createObservation({ input: unexpectedMenu }));

    expect(onCancel).toHaveBeenCalledWith("unexpected-input");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(releaseInputToUi).toHaveBeenCalledWith(unexpectedMenu);
    expect(releaseInputToUi).toHaveBeenCalledOnce();
    expect(startCommand).not.toHaveBeenCalled();
    expect(submitMenuSelection).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "key" },
    { kind: "yn", query: "Really?", choices: "yn", defaultCode: 110 },
    { kind: "line", purpose: "getlin", query: "What?" },
    { kind: "position" },
    { kind: "display" },
  ] as const)(
    "cancels on an unexpected $kind request and returns it to the normal UI",
    (input) => {
      const { controller, onCancel, releaseInputToUi } = createHarness();
      controller.request(createInventoryIntent());
      controller.observe(createObservation({ input: { kind: "command" } }));

      controller.observe(createObservation({ input }));

      expect(onCancel).toHaveBeenCalledWith("unexpected-input");
      expect(releaseInputToUi).toHaveBeenCalledWith(input);
      expect(controller.getState()).toMatchObject({
        status: "idle",
        intent: null,
        lastCancellationReason: "unexpected-input",
      });
    },
  );

  it("rejects a map context target after its snapshot revision becomes stale", () => {
    const { controller, onCancel, startCommand } = createHarness();
    controller.request(createMapContextIntent());

    controller.observe(createObservation({
      snapshotRevision: 13,
      input: { kind: "command" },
    }));

    expect(startCommand).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledWith("target-stale");
  });

  it("rejects a map inspection after the committed map revision changes", () => {
    const { controller, onCancel, startCommand } = createHarness();
    controller.request(createMapInspectIntent());

    controller.observe(createObservation({
      mapRevision: MAP_REVISION + 1,
      input: { kind: "command" },
    }));

    expect(startCommand).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledWith("target-stale");
  });

  it.each([
    "session-reset",
    "fatal",
    "unmount",
  ] as const)("clears an active intent on %s", (reason) => {
    const {
      controller,
      onCancel,
      startCommand,
      submitMenuSelection,
    } = createHarness();
    controller.request(createInventoryIntent());

    if (reason === "unmount") {
      controller.dispose();
    } else {
      controller.cancel(reason satisfies ActionIntentCancellationReason);
    }
    controller.observe(createObservation({
      input: {
        kind: "menu",
        items: [menuItem(99, ITEM_ACCELERATOR, "a - a late item")],
      },
    }));

    expect(onCancel).toHaveBeenCalledWith(reason);
    expect(startCommand).not.toHaveBeenCalled();
    expect(submitMenuSelection).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({
      status: "idle",
      intent: null,
      lastCancellationReason: reason,
    });
  });
});

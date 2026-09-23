import { describe, expect, it, vi } from "vitest";
import {
  PICK_ANY,
  PICK_ONE,
  type MenuItem,
} from "../game-state";
import {
  createGameActionController,
  type ActionIntentCancellationReason,
  type GameActionController,
} from "./game-action-controller";

const INPUT_STATE_OTHER = 0;
const INPUT_STATE_COMMAND = 1;
const INPUT_STATE_GETPOS = 2;
const INPUT_STATE_GETDIR = 3;
const REQUEST_NONCE = 51;
const ACCEPTED_BOUNDARY = 20;

interface CatalogActionIntent {
  kind: "catalog-action";
  moduleId: string;
  sessionId: string;
  snapshotRevision: number;
  actionName: string;
  sessionCommandId: number;
  requestItemMenu: boolean;
  prefix: boolean;
  origin: {
    kind: "action-dock";
    actionName: string;
  };
}

interface CommandReceipt {
  requestNonce: number;
  acceptedBoundaryGeneration: number;
}

type StageFourInput =
  | { kind: "command"; inputState: typeof INPUT_STATE_COMMAND }
  | { kind: "key"; inputState: number }
  | { kind: "position"; inputState: number }
  | {
    kind: "yn";
    query: string;
    choices: string | null;
    defaultCode: number;
    inputState: number;
  }
  | { kind: "line"; purpose: "getlin"; query: string; inputState: number }
  | { kind: "display"; inputState: number }
  | { kind: "extcmd"; inputState: number }
  | {
    kind: "menu";
    items: readonly MenuItem[];
    windowId: number;
    how: number;
    provenance: "none" | "action-getobj";
    requestNonce: number;
    menuGeneration: number;
  };

interface StageFourObservation {
  moduleId: string;
  sessionId: string;
  snapshotRevision: number;
  inventoryRevision: number | null;
  boundaryGeneration: number;
  menuGeneration: number;
  input: StageFourInput | null;
  fatal?: boolean;
}

interface StageFourController extends Omit<
  GameActionController,
  "observe" | "request"
> {
  request(intent: CatalogActionIntent): boolean;
  observe(observation: StageFourObservation): void;
  chooseItem(menuGeneration: number, itemIndex: number): boolean;
  chooseDirection(key: number): boolean;
  choosePosition(x: number, y: number, modifier: 1 | 2): boolean;
}

interface StageFourControllerOptions {
  scope: { moduleId: string; sessionId: string };
  startCommand(intent: CatalogActionIntent): CommandReceipt;
  submitMenuSelection(
    selection: Array<{ itemIndex: number; count: number }> | null,
  ): void;
  submitDirection(key: number): void;
  submitPosition(x: number, y: number, modifier: 1 | 2): void;
  cancelCoreInput(input: StageFourInput): void;
  releaseInputToUi(input: StageFourInput): void;
  onCancel(reason: ActionIntentCancellationReason): void;
  onComplete(intent: CatalogActionIntent): void;
  setActionIntentActive(active: boolean): void;
}

function catalogIntent(
  overrides: Partial<CatalogActionIntent> = {},
): CatalogActionIntent {
  return {
    kind: "catalog-action",
    moduleId: "module-1",
    sessionId: "session-1",
    snapshotRevision: 12,
    actionName: "search",
    sessionCommandId: 29,
    requestItemMenu: false,
    prefix: false,
    origin: {
      kind: "action-dock",
      actionName: "search",
    },
    ...overrides,
  };
}

function observation(
  overrides: Partial<StageFourObservation> = {},
): StageFourObservation {
  return {
    moduleId: "module-1",
    sessionId: "session-1",
    snapshotRevision: 12,
    inventoryRevision: null,
    boundaryGeneration: ACCEPTED_BOUNDARY,
    menuGeneration: 30,
    input: null,
    ...overrides,
  };
}

function commandInput(): StageFourInput {
  return { kind: "command", inputState: INPUT_STATE_COMMAND };
}

function item(
  identifier: number,
  accelerator: string,
): MenuItem {
  return {
    glyph: null,
    identifier,
    accelerator: accelerator.charCodeAt(0),
    groupAccelerator: 0,
    attribute: 0,
    color: 0,
    text: "opaque core candidate",
    itemFlags: 0,
  };
}

function actionMenu(
  overrides: Partial<Extract<StageFourInput, { kind: "menu" }>> = {},
): Extract<StageFourInput, { kind: "menu" }> {
  return {
    kind: "menu",
    items: [item(701, "a"), item(702, "b")],
    windowId: 30,
    how: PICK_ONE,
    provenance: "action-getobj",
    requestNonce: REQUEST_NONCE,
    menuGeneration: 31,
    ...overrides,
  };
}

function createHarness() {
  const startCommand = vi.fn(
    (): CommandReceipt => ({
      requestNonce: REQUEST_NONCE,
      acceptedBoundaryGeneration: ACCEPTED_BOUNDARY,
    }),
  );
  const submitMenuSelection = vi.fn();
  const submitDirection = vi.fn();
  const submitPosition = vi.fn();
  const cancelCoreInput = vi.fn();
  const releaseInputToUi = vi.fn();
  const onCancel = vi.fn();
  const onComplete = vi.fn();
  const setActionIntentActive = vi.fn();
  const options: StageFourControllerOptions = {
    scope: { moduleId: "module-1", sessionId: "session-1" },
    startCommand,
    submitMenuSelection,
    submitDirection,
    submitPosition,
    cancelCoreInput,
    releaseInputToUi,
    onCancel,
    onComplete,
    setActionIntentActive,
  };
  const factory = createGameActionController as unknown as (
    value: StageFourControllerOptions,
  ) => StageFourController;
  const controller = factory(options);
  return {
    cancelCoreInput,
    controller,
    onCancel,
    onComplete,
    releaseInputToUi,
    setActionIntentActive,
    startCommand,
    submitDirection,
    submitMenuSelection,
    submitPosition,
  };
}

function start(
  controller: StageFourController,
  intent: CatalogActionIntent,
): void {
  expect(controller.request(intent)).toBe(true);
  controller.observe(observation({ input: commandInput() }));
}

describe("stage-four generic catalog actions", () => {
  it("completes a direct action only at a boundary after its accepted generation", () => {
    const { controller, onComplete, startCommand } = createHarness();
    const intent = catalogIntent();

    start(controller, intent);
    controller.observe(observation({
      boundaryGeneration: ACCEPTED_BOUNDARY,
      input: commandInput(),
    }));
    expect(onComplete).not.toHaveBeenCalled();

    controller.observe(observation({
      boundaryGeneration: ACCEPTED_BOUNDARY + 1,
      input: commandInput(),
    }));

    expect(startCommand).toHaveBeenCalledOnce();
    expect(startCommand).toHaveBeenCalledWith(intent);
    expect(onComplete).toHaveBeenCalledWith(intent);
    expect(controller.getState()).toMatchObject({
      status: "idle",
      intent: null,
    });
  });

  it("keeps PREFIXCMD commandInp as continuation until a later generation", () => {
    const { controller, onComplete, releaseInputToUi } = createHarness();
    const intent = catalogIntent({
      actionName: "fight",
      sessionCommandId: 46,
      prefix: true,
      origin: { kind: "action-dock", actionName: "fight" },
    });

    start(controller, intent);
    controller.observe(observation({
      boundaryGeneration: ACCEPTED_BOUNDARY,
      input: commandInput(),
    }));

    expect(controller.getState()).toMatchObject({
      status: "waiting-prefix-continuation",
      intent,
    });
    expect(onComplete).not.toHaveBeenCalled();
    expect(releaseInputToUi).toHaveBeenCalledWith(commandInput());

    controller.observe(observation({
      boundaryGeneration: ACCEPTED_BOUNDARY + 1,
      input: commandInput(),
    }));
    expect(onComplete).toHaveBeenCalledWith(intent);
  });

  it("advances item to direction using getdirInp rather than prompt text", () => {
    const {
      controller,
      submitDirection,
      submitMenuSelection,
    } = createHarness();
    const intent = catalogIntent({
      actionName: "apply",
      sessionCommandId: 7,
      requestItemMenu: true,
      origin: { kind: "action-dock", actionName: "apply" },
    });

    start(controller, intent);
    controller.observe(observation({ input: actionMenu() }));
    expect(controller.getState().status).toBe("presenting-item-menu");
    expect(controller.chooseItem(31, 1)).toBe(true);
    expect(submitMenuSelection).toHaveBeenCalledWith([
      { itemIndex: 1, count: 1 },
    ]);

    controller.observe(observation({
      input: {
        kind: "yn",
        query: "Choose a response",
        choices: null,
        defaultCode: 0,
        inputState: INPUT_STATE_GETDIR,
      },
    }));
    expect(controller.getState().status).toBe("targeting-direction");
    expect(controller.chooseDirection("h".charCodeAt(0))).toBe(true);
    expect(submitDirection).toHaveBeenCalledWith("h".charCodeAt(0));
  });

  it("does not infer direction targeting from an ordinary yn prompt", () => {
    const { controller, releaseInputToUi, submitDirection } = createHarness();
    const ordinaryYn: StageFourInput = {
      kind: "yn",
      query: "In what direction?",
      choices: null,
      defaultCode: 0,
      inputState: INPUT_STATE_OTHER,
    };

    start(controller, catalogIntent({
      actionName: "kick",
      sessionCommandId: 55,
      origin: { kind: "action-dock", actionName: "kick" },
    }));
    controller.observe(observation({ input: ordinaryYn }));

    expect(submitDirection).not.toHaveBeenCalled();
    expect(releaseInputToUi).toHaveBeenCalledWith(ordinaryYn);
    expect(controller.getState().status).toBe("handed-off-to-native-ui");
  });

  it("advances item to position only for authoritative getposInp", () => {
    const {
      controller,
      submitMenuSelection,
      submitPosition,
    } = createHarness();

    start(controller, catalogIntent({
      actionName: "jump",
      sessionCommandId: 62,
      requestItemMenu: true,
      origin: { kind: "action-dock", actionName: "jump" },
    }));
    controller.observe(observation({ input: actionMenu() }));
    expect(controller.chooseItem(31, 0)).toBe(true);
    expect(submitMenuSelection).toHaveBeenCalledOnce();

    controller.observe(observation({
      input: { kind: "position", inputState: INPUT_STATE_GETPOS },
    }));
    expect(controller.getState().status).toBe("targeting-position");
    expect(controller.choosePosition(18, 7, 1)).toBe(true);
    expect(submitPosition).toHaveBeenCalledWith(18, 7, 1);
  });

  it("hands a non-getpos position request to the native UI", () => {
    const { controller, releaseInputToUi, submitPosition } = createHarness();
    const ordinaryPosition: StageFourInput = {
      kind: "position",
      inputState: INPUT_STATE_OTHER,
    };

    start(controller, catalogIntent({
      actionName: "travel",
      sessionCommandId: 93,
      origin: { kind: "action-dock", actionName: "travel" },
    }));
    controller.observe(observation({ input: ordinaryPosition }));

    expect(submitPosition).not.toHaveBeenCalled();
    expect(releaseInputToUi).toHaveBeenCalledWith(ordinaryPosition);
    expect(controller.getState().status).toBe("handed-off-to-native-ui");
  });

  it("supports multiple action-getobj menus in one command", () => {
    const { controller, submitMenuSelection } = createHarness();
    start(controller, catalogIntent({
      actionName: "dip",
      sessionCommandId: 26,
      requestItemMenu: true,
      origin: { kind: "action-dock", actionName: "dip" },
    }));

    controller.observe(observation({ input: actionMenu() }));
    expect(controller.chooseItem(31, 0)).toBe(true);
    controller.observe(observation({
      input: actionMenu({
        items: [item(801, "c")],
        menuGeneration: 32,
      }),
    }));
    expect(controller.getState().status).toBe("presenting-item-menu");
    expect(controller.chooseItem(32, 0)).toBe(true);

    expect(submitMenuSelection.mock.calls).toEqual([
      [[{ itemIndex: 0, count: 1 }]],
      [[{ itemIndex: 0, count: 1 }]],
    ]);
  });
});

describe("stage-four menu provenance and native handoff", () => {
  it.each([
    {
      label: "PICK_ANY",
      menu: actionMenu({ how: PICK_ANY }),
    },
    {
      label: "ordinary provenance",
      menu: actionMenu({ provenance: "none", requestNonce: 0 }),
    },
    {
      label: "stale request nonce",
      menu: actionMenu({ requestNonce: REQUEST_NONCE - 1 }),
    },
    {
      label: "stale menu generation",
      menu: actionMenu({ menuGeneration: 20 }),
    },
  ])("does not take over a $label menu", ({ menu }) => {
    const {
      controller,
      releaseInputToUi,
      submitMenuSelection,
    } = createHarness();
    start(controller, catalogIntent({
      actionName: "eat",
      sessionCommandId: 35,
      requestItemMenu: true,
      origin: { kind: "action-dock", actionName: "eat" },
    }));

    controller.observe(observation({ input: menu }));

    expect(submitMenuSelection).not.toHaveBeenCalled();
    expect(releaseInputToUi).toHaveBeenCalledWith(menu);
    expect(controller.getState()).toMatchObject({
      status: "handed-off-to-native-ui",
      intent: expect.objectContaining({ actionName: "eat" }),
    });
  });

  it("does not take over a later action menu after an ordinary menu reused its window", () => {
    const {
      controller,
      releaseInputToUi,
      submitMenuSelection,
    } = createHarness();
    start(controller, catalogIntent({
      actionName: "read",
      sessionCommandId: 74,
      requestItemMenu: true,
      origin: { kind: "action-dock", actionName: "read" },
    }));
    const ordinary = actionMenu({
      provenance: "none",
      requestNonce: 0,
      windowId: 44,
    });
    controller.observe(observation({ input: ordinary }));
    controller.observe(observation({
      input: actionMenu({
        windowId: 44,
        menuGeneration: 32,
      }),
    }));

    expect(releaseInputToUi).toHaveBeenCalledOnce();
    expect(releaseInputToUi).toHaveBeenCalledWith(ordinary);
    expect(submitMenuSelection).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("handed-off-to-native-ui");
  });

  it.each([
    {
      label: "ordinary yn",
      input: {
        kind: "yn",
        query: "Really?",
        choices: "yn",
        defaultCode: "n".charCodeAt(0),
        inputState: INPUT_STATE_OTHER,
      },
    },
    {
      label: "line input",
      input: {
        kind: "line",
        purpose: "getlin",
        query: "Name this object:",
        inputState: INPUT_STATE_OTHER,
      },
    },
    {
      label: "display",
      input: { kind: "display", inputState: INPUT_STATE_OTHER },
    },
    {
      label: "extended command picker",
      input: { kind: "extcmd", inputState: INPUT_STATE_OTHER },
    },
    {
      label: "PICK_ANY menu",
      input: actionMenu({ how: PICK_ANY }),
    },
  ] as const)("hands $label to native UI and completes at a later boundary", ({
    input,
  }) => {
    const {
      controller,
      onComplete,
      releaseInputToUi,
      setActionIntentActive,
    } = createHarness();
    const intent = catalogIntent({
      actionName: "options",
      sessionCommandId: 68,
      origin: { kind: "action-dock", actionName: "options" },
    });
    start(controller, intent);

    controller.observe(observation({ input }));
    expect(releaseInputToUi).toHaveBeenCalledWith(input);
    expect(controller.getState().status).toBe("handed-off-to-native-ui");
    expect(setActionIntentActive).toHaveBeenLastCalledWith(true);

    controller.observe(observation({
      boundaryGeneration: ACCEPTED_BOUNDARY + 1,
      input: commandInput(),
    }));
    expect(onComplete).toHaveBeenCalledWith(intent);
    expect(setActionIntentActive).toHaveBeenLastCalledWith(false);
  });
});

describe("stage-four cancellation and cleanup", () => {
  it("keeps the input barrier through resolver consumption and a later boundary", () => {
    const {
      cancelCoreInput,
      controller,
      onCancel,
      setActionIntentActive,
    } = createHarness();
    const direction: StageFourInput = {
      kind: "yn",
      query: "Choose a direction",
      choices: null,
      defaultCode: 0,
      inputState: INPUT_STATE_GETDIR,
    };
    const first = catalogIntent({
      actionName: "open",
      sessionCommandId: 67,
      origin: { kind: "action-dock", actionName: "open" },
    });
    start(controller, first);
    controller.observe(observation({ input: direction }));

    controller.cancel("user-cancelled");
    expect(cancelCoreInput).toHaveBeenCalledWith(direction);
    expect(controller.getState()).toMatchObject({
      status: "cancelling-core-input",
      intent: first,
    });
    expect(setActionIntentActive).toHaveBeenLastCalledWith(true);
    expect(controller.request(catalogIntent({ actionName: "wait" })))
      .toBe(false);

    controller.observe(observation({ input: null }));
    expect(controller.getState().status).toBe("waiting-cancel-boundary");
    controller.observe(observation({
      boundaryGeneration: ACCEPTED_BOUNDARY,
      input: commandInput(),
    }));
    expect(controller.getState().status).toBe("waiting-cancel-boundary");

    controller.observe(observation({
      boundaryGeneration: ACCEPTED_BOUNDARY + 1,
      input: commandInput(),
    }));
    expect(controller.getState()).toMatchObject({
      status: "idle",
      intent: null,
      lastCancellationReason: "user-cancelled",
    });
    expect(onCancel).toHaveBeenCalledWith("user-cancelled");
    expect(setActionIntentActive).toHaveBeenLastCalledWith(false);
  });

  it.each([
    {
      label: "session reset",
      terminate(controller: StageFourController) {
        controller.observe(observation({ sessionId: "session-2" }));
      },
      reason: "session-reset",
    },
    {
      label: "fatal error",
      terminate(controller: StageFourController) {
        controller.observe(observation({ fatal: true }));
      },
      reason: "fatal",
    },
    {
      label: "unmount",
      terminate(controller: StageFourController) {
        controller.dispose();
      },
      reason: "unmount",
    },
  ] as const)("immediately cleans up on $label", ({ reason, terminate }) => {
    const {
      cancelCoreInput,
      controller,
      onCancel,
      setActionIntentActive,
    } = createHarness();
    start(controller, catalogIntent());

    terminate(controller);

    expect(cancelCoreInput).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledWith(reason);
    expect(setActionIntentActive).toHaveBeenLastCalledWith(false);
    expect(controller.getState()).toMatchObject({
      status: "idle",
      intent: null,
      lastCancellationReason: reason,
    });
  });
});

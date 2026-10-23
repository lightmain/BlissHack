import { describe, expect, it, vi } from "vitest";
import {
  PICK_ANY,
  PICK_ONE,
  type GlyphInfo,
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
    visibleEntityToken: null,
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
      { itemIndex: 1, count: -1 },
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
      [[{ itemIndex: 0, count: -1 }]],
      [[{ itemIndex: 0, count: -1 }]],
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

  it("finishes cancellation when resolver consumption and a later boundary are coalesced", () => {
    const {
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
    const intent = catalogIntent({
      actionName: "open",
      sessionCommandId: 67,
      origin: { kind: "action-dock", actionName: "open" },
    });
    start(controller, intent);
    controller.observe(observation({ input: direction }));
    controller.cancel("user-cancelled");

    controller.observe(observation({
      boundaryGeneration: ACCEPTED_BOUNDARY + 1,
      input: null,
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

type InformationLevel = "original" | "detailed";

interface MapExamineTarget {
  surface: "map";
  entityId: string;
  moduleId: string;
  sessionId: string;
  mapRevision: number;
  mapX: number;
  mapY: number;
  source: "map-foreground" | "map-background";
  glyph: GlyphInfo;
}

interface InventoryExamineTarget {
  surface: "inventory";
  entityId: string;
  moduleId: string;
  sessionId: string;
  inventoryRevision: number;
  identifier: number;
  accelerator: number;
  source: "inventory";
  glyph: GlyphInfo;
  visibleEntityToken: string | null;
}

type ExamineTarget = MapExamineTarget | InventoryExamineTarget;

type ContextMenuRow =
  | { kind: "core"; itemIndex: number; item: MenuItem }
  | { kind: "examine"; accelerator: number; target: ExamineTarget };

type ExamineContextIntent =
  | {
    kind: "map-context";
    moduleId: string;
    sessionId: string;
    snapshotRevision: number;
    origin: {
      kind: "map";
      clientX: number;
      clientY: number;
      mapX: number;
      mapY: number;
    };
  }
  | {
    kind: "inventory-context";
    moduleId: string;
    sessionId: string;
    snapshotRevision: number;
    inventoryRevision: number;
    identifier: number;
    accelerator: number;
    origin: {
      kind: "inventory";
      clientX: number;
      clientY: number;
      inventoryRevision: number;
      accelerator: number;
    };
  };

interface ExamineContextObservation extends StageFourObservation {
  informationLevel: InformationLevel;
  examineTarget: ExamineTarget | null;
}

interface ExamineContextPresentation {
  how: number;
  menuGeneration: number;
  origin: ExamineContextIntent["origin"];
  rows: readonly ContextMenuRow[];
  windowId: number;
}

interface ExamineControllerState {
  status: string;
  intent: ExamineContextIntent | null;
  contextMenu: ExamineContextPresentation | null;
  lastCancellationReason: ActionIntentCancellationReason | null;
}

interface ExamineController extends Omit<
  GameActionController,
  | "cancelContextMenu"
  | "chooseContextMenuRow"
  | "getState"
  | "observe"
  | "request"
> {
  request(intent: ExamineContextIntent): boolean;
  observe(observation: ExamineContextObservation): void;
  chooseContextMenuRow?(
    menuGeneration: number,
    row: ContextMenuRow,
    count: number,
  ): boolean;
  cancelContextMenu?(menuGeneration: number): boolean;
  getState(): ExamineControllerState;
}

interface ActionCompletion {
  kind: "open-examine";
  target: ExamineTarget;
}

interface ExamineControllerOptions {
  scope: { moduleId: string; sessionId: string };
  startCommand(intent: ExamineContextIntent): void;
  submitMenuSelection(
    selection: Array<{ itemIndex: number; count: number }> | null,
  ): void;
  releaseInputToUi(input: StageFourInput): void;
  onCancel(reason: ActionIntentCancellationReason): void;
  onComplete(intent: ExamineContextIntent): void;
  onActionCompletion(completion: ActionCompletion): void;
  setActionIntentActive(active: boolean): void;
}

const CONTEXT_MENU_GENERATION = 41;
const CONTEXT_WINDOW_ID = 71;
const MAP_REVISION = 17;
const INVENTORY_REVISION = 23;

/**
 * Create one complete final-display glyph for handoff identity checks.
 * @param glyph Final core-provided glyph index.
 * @param overrides Presentation fields to replace.
 * @returns Independent glyph metadata.
 */
function glyphInfo(
  glyph: number,
  overrides: Partial<GlyphInfo> = {},
): GlyphInfo {
  return {
    glyph,
    ttyChar: 64,
    frameColor: -1,
    glyphFlags: 0,
    color: 7,
    symbolIndex: 1,
    customColor: 0,
    color256: 0,
    tileIndex: 300,
    ...overrides,
  };
}

/** Return one supported map target captured entirely by value. */
function mapExamineTarget(
  overrides: Partial<MapExamineTarget> = {},
): MapExamineTarget {
  return {
    surface: "map",
    entityId: "monster:PM_NEWT",
    moduleId: "module-1",
    sessionId: "session-1",
    mapRevision: MAP_REVISION,
    mapX: 18,
    mapY: 7,
    source: "map-foreground",
    glyph: glyphInfo(301),
    ...overrides,
  };
}

/** Return one supported permanent-inventory target captured by value. */
function inventoryExamineTarget(
  overrides: Partial<InventoryExamineTarget> = {},
): InventoryExamineTarget {
  return {
    surface: "inventory",
    entityId: "object:LONG_SWORD",
    moduleId: "module-1",
    sessionId: "session-1",
    inventoryRevision: INVENTORY_REVISION,
    identifier: 81,
    accelerator: "a".charCodeAt(0),
    source: "inventory",
    glyph: glyphInfo(401),
    visibleEntityToken: null,
    ...overrides,
  };
}

/** Return one map context request at the accepted command boundary. */
function mapContextIntent(): Extract<
  ExamineContextIntent,
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

/** Return one inventory context request for the captured permanent row. */
function inventoryContextIntent(): Extract<
  ExamineContextIntent,
  { kind: "inventory-context" }
> {
  return {
    kind: "inventory-context",
    moduleId: "module-1",
    sessionId: "session-1",
    snapshotRevision: 12,
    inventoryRevision: INVENTORY_REVISION,
    identifier: 81,
    accelerator: "a".charCodeAt(0),
    origin: {
      kind: "inventory",
      clientX: 240,
      clientY: 160,
      inventoryRevision: INVENTORY_REVISION,
      accelerator: "a".charCodeAt(0),
    },
  };
}

/** Return one authoritative context-menu observation. */
function examineObservation(
  overrides: Partial<ExamineContextObservation> = {},
): ExamineContextObservation {
  return {
    moduleId: "module-1",
    sessionId: "session-1",
    snapshotRevision: 12,
    inventoryRevision: INVENTORY_REVISION,
    boundaryGeneration: ACCEPTED_BOUNDARY,
    menuGeneration: CONTEXT_MENU_GENERATION,
    informationLevel: "detailed",
    examineTarget: mapExamineTarget(),
    input: null,
    ...overrides,
  };
}

/** Return the final core-generated action menu for a context request. */
function contextActionMenu(
  items: readonly MenuItem[] = [item(901, "a"), item(902, "b")],
  overrides: Partial<Extract<StageFourInput, { kind: "menu" }>> = {},
): Extract<StageFourInput, { kind: "menu" }> {
  return {
    kind: "menu",
    items,
    windowId: CONTEXT_WINDOW_ID,
    how: PICK_ONE,
    provenance: "none",
    requestNonce: 0,
    menuGeneration: CONTEXT_MENU_GENERATION,
    ...overrides,
  };
}

/**
 * Create a controller harness through the future stage-four contract.
 * @returns Controller and every externally observable side effect.
 */
function createExamineHarness() {
  const startCommand = vi.fn();
  const submitMenuSelection = vi.fn();
  const releaseInputToUi = vi.fn();
  const onCancel = vi.fn();
  const onComplete = vi.fn();
  const completionStatuses: string[] = [];
  let controller: ExamineController;
  const onActionCompletion = vi.fn((_completion: ActionCompletion) => {
    completionStatuses.push(controller.getState().status);
  });
  const setActionIntentActive = vi.fn();
  const options: ExamineControllerOptions = {
    scope: { moduleId: "module-1", sessionId: "session-1" },
    startCommand,
    submitMenuSelection,
    releaseInputToUi,
    onCancel,
    onComplete,
    onActionCompletion,
    setActionIntentActive,
  };
  const factory = createGameActionController as unknown as (
    value: ExamineControllerOptions,
  ) => ExamineController;
  controller = factory(options);
  return {
    completionStatuses,
    controller,
    onActionCompletion,
    onCancel,
    onComplete,
    releaseInputToUi,
    setActionIntentActive,
    startCommand,
    submitMenuSelection,
  };
}

/**
 * Advance a map or inventory request to its final visible action menu.
 * @param controller Active future controller.
 * @param intent Context request to start.
 * @param target Supported target, or null when the small index cannot resolve it.
 * @param informationLevel Current profile mode.
 * @param menu Core-generated action menu.
 */
function presentContextMenu(
  controller: ExamineController,
  intent: ExamineContextIntent,
  target: ExamineTarget | null,
  informationLevel: InformationLevel = "detailed",
  menu = contextActionMenu(),
): void {
  expect(controller.request(intent)).toBe(true);
  controller.observe(examineObservation({
    examineTarget: target,
    informationLevel,
    inventoryRevision: intent.kind === "inventory-context"
      ? intent.inventoryRevision
      : INVENTORY_REVISION,
    input: commandInput(),
  }));
  if (intent.kind === "inventory-context") {
    controller.observe(examineObservation({
      examineTarget: target,
      informationLevel,
      input: contextActionMenu([
        {
          ...item(intent.identifier, "a"),
          accelerator: intent.accelerator,
        },
      ], {
        windowId: CONTEXT_WINDOW_ID - 1,
        menuGeneration: CONTEXT_MENU_GENERATION - 1,
      }),
    }));
  }
  controller.observe(examineObservation({
    examineTarget: target,
    informationLevel,
    input: menu,
  }));
  expect(controller.getState().status).toBe("presenting-context-menu");
}

/** Return semantic rows from the active context presentation. */
function contextRows(controller: ExamineController): readonly ContextMenuRow[] {
  return controller.getState().contextMenu?.rows ?? [];
}

/** Return the sole synthetic row after asserting its presence. */
function examineRow(controller: ExamineController): ContextMenuRow {
  const row = contextRows(controller).find(
    (candidate) => candidate.kind === "examine",
  );
  expect(row).toBeDefined();
  return row ?? {
    kind: "examine",
    accelerator: "e".charCodeAt(0),
    target: mapExamineTarget(),
  };
}

/** Select one semantic row without requiring production types to exist yet. */
function chooseContextRow(
  controller: ExamineController,
  row: ContextMenuRow,
  menuGeneration = CONTEXT_MENU_GENERATION,
): boolean {
  return controller.chooseContextMenuRow?.(menuGeneration, row, -1) ?? false;
}

/** Cancel one semantic context menu through its generation-bound handler. */
function cancelContextMenu(
  controller: ExamineController,
  menuGeneration = CONTEXT_MENU_GENERATION,
): boolean {
  return controller.cancelContextMenu?.(menuGeneration) ?? false;
}

describe("stage-four Examine context-menu rows", () => {
  it("keeps Original core-only and adds Examine only for a supported Detailed target", () => {
    const coreItems = [item(901, "a"), item(902, "b")];
    const cases = [
      {
        label: "Original supported",
        informationLevel: "original" as const,
        target: mapExamineTarget(),
        expectedKinds: ["core", "core"],
      },
      {
        label: "Detailed unsupported",
        informationLevel: "detailed" as const,
        target: null,
        expectedKinds: ["core", "core"],
      },
      {
        label: "Detailed supported",
        informationLevel: "detailed" as const,
        target: mapExamineTarget(),
        expectedKinds: ["core", "core", "examine"],
      },
    ];

    for (const scenario of cases) {
      const { controller } = createExamineHarness();
      presentContextMenu(
        controller,
        mapContextIntent(),
        scenario.target,
        scenario.informationLevel,
        contextActionMenu(coreItems),
      );
      const rows = contextRows(controller);

      expect(rows.map((row) => row.kind), scenario.label)
        .toEqual(scenario.expectedKinds);
      expect(rows.slice(0, 2), scenario.label).toEqual([
        { kind: "core", itemIndex: 0, item: coreItems[0] },
        { kind: "core", itemIndex: 1, item: coreItems[1] },
      ]);
    }
  });

  it("preserves core identity and accelerators while keeping Examine semantic", () => {
    const occupiedExamine = item(902, "e");
    const coreItems = [item(901, "a"), occupiedExamine];
    const target = mapExamineTarget();
    const { controller } = createExamineHarness();

    presentContextMenu(
      controller,
      mapContextIntent(),
      target,
      "detailed",
      contextActionMenu(coreItems),
    );
    const rows = contextRows(controller);
    const synthetic = rows.find((row) => row.kind === "examine");
    const coreRows = rows.filter(
      (row): row is Extract<ContextMenuRow, { kind: "core" }> =>
        row.kind === "core",
    );

    expect(coreRows.map(({ item: core, itemIndex }) => ({
      itemIndex,
      identifier: core.identifier,
      accelerator: core.accelerator,
      text: core.text,
    }))).toEqual([
      {
        itemIndex: 0,
        identifier: 901,
        accelerator: "a".charCodeAt(0),
        text: "opaque core candidate",
      },
      {
        itemIndex: 1,
        identifier: 902,
        accelerator: "e".charCodeAt(0),
        text: "opaque core candidate",
      },
    ]);
    expect(synthetic).toMatchObject({
      kind: "examine",
      target,
    });
    expect(synthetic).not.toHaveProperty("item");
    expect(synthetic).not.toHaveProperty("itemIndex");
    expect(synthetic).not.toHaveProperty("identifier");
    expect(
      synthetic?.kind === "examine"
        && (
          synthetic.accelerator === 0
          || !coreItems.some(
            (core) => core.accelerator === synthetic.accelerator,
          )
        ),
    ).toBe(true);
  });

  it("uses the preferred e accelerator when no core row owns it", () => {
    const { controller } = createExamineHarness();
    presentContextMenu(
      controller,
      mapContextIntent(),
      mapExamineTarget(),
    );

    expect(examineRow(controller)).toMatchObject({
      kind: "examine",
      accelerator: "e".charCodeAt(0),
    });
  });

  it("submits an unchanged core row without producing an Examine completion", () => {
    const {
      controller,
      onActionCompletion,
      submitMenuSelection,
    } = createExamineHarness();
    presentContextMenu(
      controller,
      mapContextIntent(),
      mapExamineTarget(),
    );
    const core = contextRows(controller)[1];

    expect(core).toMatchObject({ kind: "core", itemIndex: 1 });
    expect(chooseContextRow(controller, core)).toBe(true);
    expect(submitMenuSelection).toHaveBeenCalledOnce();
    expect(submitMenuSelection).toHaveBeenCalledWith([
      { itemIndex: 1, count: -1 },
    ]);
    expect(onActionCompletion).not.toHaveBeenCalled();
  });
});

describe("stage-four Examine safe handoff", () => {
  it("submits one null and waits for resolver, window, and boundary gates", () => {
    const liveTarget = mapExamineTarget();
    const {
      completionStatuses,
      controller,
      onActionCompletion,
      submitMenuSelection,
    } = createExamineHarness();
    presentContextMenu(controller, mapContextIntent(), liveTarget);
    const row = examineRow(controller);

    expect(chooseContextRow(controller, row)).toBe(true);
    expect(chooseContextRow(controller, row)).toBe(false);
    expect(submitMenuSelection.mock.calls).toEqual([[null]]);
    expect(onActionCompletion).not.toHaveBeenCalled();

    controller.observe(examineObservation({
      examineTarget: liveTarget,
      input: contextActionMenu(),
    }));
    expect(onActionCompletion).not.toHaveBeenCalled();

    controller.observe(examineObservation({
      examineTarget: liveTarget,
      input: null,
    }));
    expect(onActionCompletion).not.toHaveBeenCalled();

    controller.observe(examineObservation({
      boundaryGeneration: ACCEPTED_BOUNDARY,
      examineTarget: liveTarget,
      input: commandInput(),
    }));
    expect(onActionCompletion).not.toHaveBeenCalled();

    controller.observe(examineObservation({
      boundaryGeneration: ACCEPTED_BOUNDARY + 1,
      examineTarget: liveTarget,
      input: commandInput(),
    }));

    expect(completionStatuses).toEqual(["idle"]);
    expect(onActionCompletion).toHaveBeenCalledOnce();
    expect(onActionCompletion).toHaveBeenCalledWith({
      kind: "open-examine",
      target: liveTarget,
    });
    controller.observe(examineObservation({
      boundaryGeneration: ACCEPTED_BOUNDARY + 2,
      examineTarget: liveTarget,
      input: commandInput(),
    }));
    expect(onActionCompletion).toHaveBeenCalledOnce();
  });

  it("keeps volatile inventory Examine through itemactions rerolls", () => {
    const target = {
      ...inventoryExamineTarget(),
      volatileDisplayIdentity: true,
    };
    const intent = {
      ...inventoryContextIntent(),
      examineCapture: target,
    };
    const {
      controller,
      onActionCompletion,
      onCancel,
    } = createExamineHarness();
    expect(controller.request(intent)).toBe(true);
    controller.observe(examineObservation({
      examineTarget: target,
      input: commandInput(),
    }));
    controller.observe(examineObservation({
      examineTarget: target,
      input: contextActionMenu([
        {
          ...item(intent.identifier, "a"),
          accelerator: intent.accelerator,
        },
      ], {
        windowId: CONTEXT_WINDOW_ID - 1,
        menuGeneration: CONTEXT_MENU_GENERATION - 1,
      }),
    }));
    controller.observe(examineObservation({
      examineTarget: target,
      inventoryRevision: INVENTORY_REVISION + 1,
      input: contextActionMenu(),
    }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("presenting-context-menu");
    expect(chooseContextRow(controller, examineRow(controller))).toBe(true);
    controller.observe(examineObservation({
      examineTarget: target,
      inventoryRevision: INVENTORY_REVISION + 2,
      input: null,
    }));
    controller.observe(examineObservation({
      boundaryGeneration: ACCEPTED_BOUNDARY + 1,
      examineTarget: target,
      inventoryRevision: INVENTORY_REVISION + 3,
      input: commandInput(),
    }));

    expect(onActionCompletion).toHaveBeenCalledOnce();
    expect(onActionCompletion).toHaveBeenCalledWith({
      kind: "open-examine",
      target,
    });
  });

  it("publishes a value copy rather than retaining the selected row target", () => {
    const captured = mapExamineTarget();
    const liveTarget = mapExamineTarget();
    const {
      controller,
      onActionCompletion,
    } = createExamineHarness();
    presentContextMenu(controller, mapContextIntent(), captured);
    const row = examineRow(controller);

    expect(chooseContextRow(controller, row)).toBe(true);
    captured.entityId = "monster:PM_ORC";
    captured.glyph.glyph = 999;
    controller.observe(examineObservation({
      examineTarget: liveTarget,
      input: null,
    }));
    controller.observe(examineObservation({
      boundaryGeneration: ACCEPTED_BOUNDARY + 1,
      examineTarget: liveTarget,
      input: commandInput(),
    }));

    expect(onActionCompletion).toHaveBeenCalledWith({
      kind: "open-examine",
      target: liveTarget,
    });
  });

  it("treats backdrop and Escape as ordinary cancellation without a payload", () => {
    for (const source of ["backdrop", "Escape"]) {
      const target = mapExamineTarget();
      const {
        controller,
        onActionCompletion,
        submitMenuSelection,
      } = createExamineHarness();
      presentContextMenu(controller, mapContextIntent(), target);

      expect(cancelContextMenu(controller), source).toBe(true);
      expect(submitMenuSelection.mock.calls, source).toEqual([[null]]);
      controller.observe(examineObservation({
        examineTarget: target,
        input: null,
      }));
      controller.observe(examineObservation({
        boundaryGeneration: ACCEPTED_BOUNDARY + 1,
        examineTarget: target,
        input: commandInput(),
      }));

      expect(controller.getState().status, source).toBe("idle");
      expect(onActionCompletion, source).not.toHaveBeenCalled();
    }
  });

  it.each([
    {
      label: "map revision",
      intent: mapContextIntent(),
      initial: mapExamineTarget(),
      changed: mapExamineTarget({ mapRevision: MAP_REVISION + 1 }),
    },
    {
      label: "map glyph",
      intent: mapContextIntent(),
      initial: mapExamineTarget(),
      changed: mapExamineTarget({ glyph: glyphInfo(302) }),
    },
    {
      label: "inventory revision",
      intent: inventoryContextIntent(),
      initial: inventoryExamineTarget(),
      changed: inventoryExamineTarget({
        inventoryRevision: INVENTORY_REVISION + 1,
      }),
    },
    {
      label: "inventory glyph",
      intent: inventoryContextIntent(),
      initial: inventoryExamineTarget(),
      changed: inventoryExamineTarget({ glyph: glyphInfo(402) }),
    },
  ])("clears a selected request after the $label changes", ({
    changed,
    initial,
    intent,
  }) => {
    const {
      controller,
      onActionCompletion,
      submitMenuSelection,
    } = createExamineHarness();
    presentContextMenu(controller, intent, initial);
    expect(chooseContextRow(controller, examineRow(controller))).toBe(true);

    controller.observe(examineObservation({
      examineTarget: changed,
      inventoryRevision: changed.surface === "inventory"
        ? changed.inventoryRevision
        : INVENTORY_REVISION,
      input: null,
    }));
    controller.observe(examineObservation({
      boundaryGeneration: ACCEPTED_BOUNDARY + 1,
      examineTarget: changed,
      inventoryRevision: changed.surface === "inventory"
        ? changed.inventoryRevision
        : INVENTORY_REVISION,
      input: commandInput(),
    }));

    expect(submitMenuSelection.mock.calls).toEqual(
      intent.kind === "inventory-context"
        ? [
          [[{ itemIndex: 0, count: 1 }]],
          [null],
        ]
        : [[null]],
    );
    expect(onActionCompletion).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "session reset",
      terminate(controller: ExamineController, target: ExamineTarget) {
        controller.observe(examineObservation({
          sessionId: "session-2",
          examineTarget: target,
          input: null,
        }));
      },
    },
    {
      label: "fatal error",
      terminate(controller: ExamineController, target: ExamineTarget) {
        controller.observe(examineObservation({
          fatal: true,
          examineTarget: target,
          input: null,
        }));
      },
    },
    {
      label: "unmount",
      terminate(controller: ExamineController) {
        controller.dispose();
      },
    },
    {
      label: "Original mode",
      terminate(controller: ExamineController, target: ExamineTarget) {
        controller.observe(examineObservation({
          examineTarget: target,
          informationLevel: "original",
          input: null,
        }));
      },
    },
  ])("clears a selected request on $label", ({ terminate }) => {
    const target = mapExamineTarget();
    const {
      controller,
      onActionCompletion,
      submitMenuSelection,
    } = createExamineHarness();
    presentContextMenu(controller, mapContextIntent(), target);
    expect(chooseContextRow(controller, examineRow(controller))).toBe(true);

    terminate(controller, target);
    controller.observe(examineObservation({
      boundaryGeneration: ACCEPTED_BOUNDARY + 1,
      examineTarget: target,
      input: commandInput(),
    }));

    expect(submitMenuSelection.mock.calls).toEqual([[null]]);
    expect(onActionCompletion).not.toHaveBeenCalled();
  });

  it("deduplicates repeated right-clicks, double activation, and stale handlers", () => {
    const target = mapExamineTarget();
    const {
      controller,
      onActionCompletion,
      submitMenuSelection,
    } = createExamineHarness();
    presentContextMenu(controller, mapContextIntent(), target);
    const staleRow = examineRow(controller);

    expect(controller.request(mapContextIntent())).toBe(false);
    expect(chooseContextRow(controller, staleRow)).toBe(true);
    expect(chooseContextRow(controller, staleRow)).toBe(false);
    expect(submitMenuSelection.mock.calls).toEqual([[null]]);

    controller.observe(examineObservation({
      examineTarget: target,
      input: null,
    }));
    controller.observe(examineObservation({
      boundaryGeneration: ACCEPTED_BOUNDARY + 1,
      examineTarget: target,
      input: commandInput(),
    }));
    expect(onActionCompletion).toHaveBeenCalledOnce();

    expect(chooseContextRow(controller, staleRow)).toBe(false);
    controller.observe(examineObservation({
      boundaryGeneration: ACCEPTED_BOUNDARY + 2,
      examineTarget: target,
      input: commandInput(),
    }));
    expect(submitMenuSelection.mock.calls).toEqual([[null]]);
    expect(onActionCompletion).toHaveBeenCalledOnce();
  });
});

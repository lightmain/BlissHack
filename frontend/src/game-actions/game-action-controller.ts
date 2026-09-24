import {
  INPUT_STATE_GETDIR,
  INPUT_STATE_GETPOS,
  PICK_ONE,
  type MenuItem,
} from "../game-state";
import type {
  ActionIntent,
  ActionIntentCancellationReason,
} from "./action-intents";
import {
  INITIAL_GAME_ACTION_STATE,
  reduceGameAction,
  type ActionControllerInput,
  type GameActionState,
} from "./game-action-reducer";

export type {
  ActionIntent,
  ActionIntentCancellationReason,
} from "./action-intents";
export type {
  ActionItemMenuPresentation,
  ActionControllerInput,
  ContextMenuPresentation,
  GameActionState,
} from "./game-action-reducer";

export interface CoreCommandReceipt {
  requestNonce: number;
  acceptedBoundaryGeneration: number | null;
}

export interface ActionControllerObservation {
  moduleId: string;
  sessionId: string;
  snapshotRevision: number;
  inventoryRevision: number | null;
  mapRevision?: number;
  boundaryGeneration?: number;
  menuGeneration?: number;
  input: ActionControllerInput | null;
  fatal?: boolean;
}

interface GameActionControllerOptions {
  scope?: { moduleId: string; sessionId: string };
  startCommand(intent: ActionIntent): CoreCommandReceipt | void;
  submitMenuSelection(
    selection: Array<{ itemIndex: number; count: number }> | null,
  ): void;
  submitDirection?(key: number): void;
  submitPosition?(x: number, y: number, modifier: 1 | 2): void;
  cancelCoreInput?(input: ActionControllerInput): void;
  releaseInputToUi(input: ActionControllerInput): void;
  onCancel?(reason: ActionIntentCancellationReason): void;
  onComplete?(intent: ActionIntent): void;
  setActionIntentActive?(active: boolean): void;
}

export interface GameActionController {
  request(intent: ActionIntent): boolean;
  observe(observation: ActionControllerObservation): void;
  cancel(reason: ActionIntentCancellationReason): void;
  chooseItem(menuGeneration: number, itemIndex: number): boolean;
  chooseDirection(key: number): boolean;
  choosePosition(x: number, y: number, modifier: 1 | 2): boolean;
  complete(): void;
  dispose(): void;
  getState(): GameActionState;
  subscribe(listener: () => void): () => void;
}

/**
 * Coordinate one UI-owned action without retaining WASM pointers or menu IDs.
 * @param options - side effects at the existing bridge boundary.
 * @returns a session-scoped action controller.
 */
export function createGameActionController(
  options: GameActionControllerOptions,
): GameActionController {
  let state = INITIAL_GAME_ACTION_STATE;
  let disposed = false;
  let commandReceipt: CoreCommandReceipt | null = null;
  const listeners = new Set<() => void>();

  /** Publish a reducer event and notify state subscribers. */
  function transition(
    event: Parameters<typeof reduceGameAction>[1],
  ): void {
    state = reduceGameAction(state, event);
    for (const listener of listeners) listener();
  }

  /** Clear the active intent immediately and report its reason once. */
  function finishCancellation(reason: ActionIntentCancellationReason): void {
    if (state.intent === null) return;
    transition({ type: "cancelled", reason });
    commandReceipt = null;
    options.setActionIntentActive?.(false);
    options.onCancel?.(reason);
  }

  /** Cancel through the active core resolver when a catalog action owns it. */
  function cancel(reason: ActionIntentCancellationReason): void {
    if (state.intent === null) return;
    if (
      reason === "user-cancelled"
      && state.intent.kind === "catalog-action"
      && state.activeInput !== null
      && options.cancelCoreInput
    ) {
      options.cancelCoreInput(state.activeInput);
      transition({
        type: "progress",
        status: "cancelling-core-input",
        pendingCancellationReason: reason,
      });
      return;
    }
    finishCancellation(reason);
  }

  /** Complete the active intent and release its input barrier. */
  function complete(): void {
    const intent = state.intent;
    if (intent === null) return;
    transition({ type: "completed" });
    commandReceipt = null;
    options.setActionIntentActive?.(false);
    options.onComplete?.(intent);
  }

  /** Validate session and inventory ownership before any automated step. */
  function validateOwnership(
    observation: ActionControllerObservation,
  ): boolean {
    const intent = state.intent;
    if (!intent) return false;
    if (
      observation.moduleId !== intent.moduleId
      || observation.sessionId !== intent.sessionId
    ) {
      finishCancellation("session-reset");
      return false;
    }
    if (
      "inventoryRevision" in intent
      && observation.inventoryRevision !== intent.inventoryRevision
      && !(intent.kind === "drop-item" && state.targetSelected)
    ) {
      finishCancellation("inventory-revision-changed");
      return false;
    }
    if (
      state.status === "waiting-command-boundary"
      && intent.kind === "map-context"
      && observation.snapshotRevision !== intent.snapshotRevision
    ) {
      finishCancellation("target-stale");
      return false;
    }
    if (
      intent.kind === "map-inspect"
      && state.status === "waiting-command-boundary"
      && observation.mapRevision !== intent.mapRevision
    ) {
      finishCancellation("target-stale");
      return false;
    }
    if (observation.fatal) {
      finishCancellation("fatal");
      return false;
    }
    return true;
  }

  /** Cancel automation before exposing an unexpected core prompt normally. */
  function releaseUnexpectedInput(input: ActionControllerInput): void {
    finishCancellation("unexpected-input");
    options.releaseInputToUi(input);
  }

  /** Hand an unclaimed catalog input to the existing native UI once. */
  function handOffCatalogInput(input: ActionControllerInput): void {
    if (state.status === "handed-off-to-native-ui") return;
    options.releaseInputToUi(input);
    transition({
      type: "progress",
      status: "handed-off-to-native-ui",
      activeInput: input,
      itemMenu: null,
    });
  }

  /** Present or automate the expected menu for the active intent. */
  function handleMenu(
    input: Extract<ActionControllerInput, { kind: "menu" }>,
  ): void {
    const intent = state.intent;
    if (!intent) return;
    if (intent.kind === "catalog-action") {
      handOffCatalogInput(input);
      return;
    }
    if (!isPickOneMenu(input) || intent.kind === "map-inspect") {
      releaseUnexpectedInput(input);
      return;
    }
    if (intent.kind === "drop-item" && state.targetSelected) {
      releaseUnexpectedInput(input);
      return;
    }
    if (
      (intent.kind === "inventory-context" || intent.kind === "drop-item")
      && !state.targetSelected
    ) {
      const itemIndex = findAccelerator(input.items, intent.accelerator);
      if (itemIndex < 0) {
        cancel("missing-accelerator");
        return;
      }
      transition({ type: "waiting", targetSelected: true });
      options.submitMenuSelection([{
        itemIndex,
        count: intent.kind === "drop-item" ? -1 : 1,
      }]);
      return;
    }
    transition({
      type: "presenting",
      presentation: {
        how: input.how,
        origin: intent.origin,
        windowId: input.windowId,
      },
    });
  }

  /** Read the accepted generation from the live mutable command receipt. */
  function acceptedBoundaryGeneration(): number | null {
    return commandReceipt?.acceptedBoundaryGeneration ?? null;
  }

  /** Handle one authoritative input emitted by a catalog action. */
  function handleCatalogInput(
    observation: ActionControllerObservation,
    input: ActionControllerInput,
  ): void {
    const intent = state.intent;
    if (intent?.kind !== "catalog-action") return;
    const acceptedGeneration = acceptedBoundaryGeneration();
    if (
      acceptedGeneration !== null
      && (observation.boundaryGeneration ?? 0) > acceptedGeneration
    ) {
      complete();
      return;
    }
    if (state.status === "handed-off-to-native-ui") return;
    if (input.kind === "command") {
      if (
        intent.prefix
        && state.status !== "waiting-prefix-continuation"
      ) {
        options.releaseInputToUi(input);
        transition({
          type: "progress",
          status: "waiting-prefix-continuation",
          activeInput: input,
        });
      }
      return;
    }
    if (
      input.kind === "menu"
      && intent.requestItemMenu
      && input.how === PICK_ONE
      && input.provenance === "action-getobj"
      && input.requestNonce === commandReceipt?.requestNonce
      && Number.isInteger(input.menuGeneration)
      && (input.menuGeneration ?? 0) > state.startMenuGeneration
      && Number.isSafeInteger(input.windowId)
      && (input.windowId ?? -1) > 0
    ) {
      transition({
        type: "progress",
        status: "presenting-item-menu",
        activeInput: input,
        itemMenu: {
          items: input.items,
          menuGeneration: input.menuGeneration as number,
          windowId: input.windowId as number,
        },
      });
      return;
    }
    if (
      "inputState" in input
      && input.inputState === INPUT_STATE_GETDIR
    ) {
      transition({
        type: "progress",
        status: "targeting-direction",
        activeInput: input,
        itemMenu: null,
      });
      return;
    }
    if (
      input.kind === "position"
      && input.inputState === INPUT_STATE_GETPOS
    ) {
      transition({
        type: "progress",
        status: "targeting-position",
        activeInput: input,
        itemMenu: null,
      });
      return;
    }
    handOffCatalogInput(input);
  }

  /** Advance a generic catalog action from command acceptance to completion. */
  function observeCatalogAction(
    observation: ActionControllerObservation,
  ): void {
    if (state.status === "cancelling-core-input") {
      const acceptedGeneration = acceptedBoundaryGeneration();
      if (
        acceptedGeneration !== null
        && (observation.boundaryGeneration ?? 0) > acceptedGeneration
      ) {
        finishCancellation(
          state.pendingCancellationReason ?? "user-cancelled",
        );
        return;
      }
      if (observation.input === null) {
        transition({
          type: "progress",
          status: "waiting-cancel-boundary",
          activeInput: null,
        });
      }
      return;
    }
    if (state.status === "waiting-cancel-boundary") {
      const acceptedGeneration = acceptedBoundaryGeneration();
      if (
        acceptedGeneration !== null
        && (observation.boundaryGeneration ?? 0) > acceptedGeneration
      ) {
        finishCancellation(
          state.pendingCancellationReason ?? "user-cancelled",
        );
      }
      return;
    }
    const acceptedGeneration = acceptedBoundaryGeneration();
    if (
      acceptedGeneration !== null
      && state.acceptedBoundaryGeneration !== acceptedGeneration
    ) {
      transition({
        type: "progress",
        status: state.status === "starting-command" || state.status === "idle"
          ? "waiting-expected-input"
          : state.status,
        acceptedBoundaryGeneration: acceptedGeneration,
      });
    }
    if (
      acceptedGeneration !== null
      && (observation.boundaryGeneration ?? 0) > acceptedGeneration
    ) {
      complete();
      return;
    }
    if (observation.input !== null) {
      handleCatalogInput(observation, observation.input);
    }
  }

  /** Observe the latest authoritative core/session state. */
  function observe(observation: ActionControllerObservation): void {
    if (disposed || state.intent === null) return;
    if (!validateOwnership(observation)) return;
    if (state.status === "waiting-command-boundary") {
      if (observation.input === null) return;
      if (observation.input.kind !== "command") {
        const input = observation.input;
        releaseUnexpectedInput(input);
        return;
      }
      const intent = state.intent;
      transition({ type: "starting" });
      try {
        const receipt = options.startCommand(intent);
        if (intent.kind === "catalog-action") {
          if (
            !receipt
            || !Number.isInteger(receipt.requestNonce)
            || receipt.requestNonce <= 0
          ) {
            throw new Error("Catalog command did not return a request receipt");
          }
          commandReceipt = receipt;
          transition({
            type: "progress",
            status: "waiting-expected-input",
            acceptedBoundaryGeneration:
              receipt.acceptedBoundaryGeneration,
            startMenuGeneration: observation.menuGeneration ?? 0,
          });
          return;
        }
      } catch {
        finishCancellation("busy");
        return;
      }
      transition({ type: "waiting" });
      return;
    }
    if (state.intent.kind === "catalog-action") {
      observeCatalogAction(observation);
      return;
    }
    if (state.status === "presenting-context-menu") {
      const input = observation.input;
      if (
        input === null
        || (
          input.kind === "menu"
          && input.windowId === state.contextMenu?.windowId
        )
      ) {
        return;
      }
      complete();
      return;
    }
    if (state.status !== "waiting-expected-input") return;
    const input = observation.input;
    if (input === null) return;
    if (state.intent?.kind === "map-inspect" && input.kind === "command") {
      complete();
      return;
    }
    if (
      state.intent?.kind === "drop-item"
      && state.targetSelected
      && input.kind === "command"
    ) {
      complete();
      return;
    }
    if (input.kind === "menu") {
      handleMenu(input);
      return;
    }
    releaseUnexpectedInput(input);
  }

  return {
    /**
     * Accept an intent only while the controller is idle.
     * @param intent - immutable intent bound to the current module/session.
     * @returns whether the intent became active.
     */
    request(intent): boolean {
      if (disposed || state.intent !== null) return false;
      if (
        options.scope
        && (
          intent.moduleId !== options.scope.moduleId
          || intent.sessionId !== options.scope.sessionId
        )
      ) {
        return false;
      }
      transition({ type: "requested", intent });
      options.setActionIntentActive?.(true);
      return true;
    },
    observe,
    cancel,
    /**
     * Submit one row from the currently matched action-owned item menu.
     * @param menuGeneration - identity of the rendered chooser contents.
     * @param itemIndex - source row index in the core-generated menu.
     * @returns whether the current chooser accepted the selection.
     */
    chooseItem(menuGeneration: number, itemIndex: number): boolean {
      const menu = state.itemMenu;
      if (
        state.status !== "presenting-item-menu"
        || !menu
        || menu.menuGeneration !== menuGeneration
        || !Number.isInteger(itemIndex)
        || itemIndex < 0
        || itemIndex >= menu.items.length
        || menu.items[itemIndex]?.identifier === null
      ) {
        return false;
      }
      options.submitMenuSelection([{ itemIndex, count: -1 }]);
      transition({
        type: "progress",
        status: "waiting-expected-input",
        activeInput: null,
        itemMenu: null,
      });
      return true;
    },
    /**
     * Submit one core-compatible direction byte for active getdir input.
     * @param key - current number-pad mode direction byte.
     * @returns whether direction targeting owned the input.
     */
    chooseDirection(key: number): boolean {
      if (
        state.status !== "targeting-direction"
        || !Number.isInteger(key)
        || key <= 0
        || key > 0xff
        || !options.submitDirection
      ) {
        return false;
      }
      options.submitDirection(key);
      transition({
        type: "progress",
        status: "waiting-expected-input",
        activeInput: null,
      });
      return true;
    },
    /**
     * Submit one map coordinate for active getpos input.
     * @param x - map column.
     * @param y - map row.
     * @param modifier - primary or secondary click.
     * @returns whether position targeting owned the input.
     */
    choosePosition(x: number, y: number, modifier: 1 | 2): boolean {
      if (
        state.status !== "targeting-position"
        || !Number.isInteger(x)
        || !Number.isInteger(y)
        || !options.submitPosition
      ) {
        return false;
      }
      options.submitPosition(x, y, modifier);
      transition({
        type: "progress",
        status: "waiting-expected-input",
        activeInput: null,
      });
      return true;
    },
    complete,
    /** Cancel outstanding work and prevent future observations. */
    dispose(): void {
      if (disposed) return;
      finishCancellation("unmount");
      disposed = true;
      listeners.clear();
    },
    /** Return the current immutable controller state. */
    getState(): GameActionState {
      return state;
    },
    /**
     * Subscribe to action-state changes.
     * @param listener - callback invoked after a transition.
     * @returns cleanup function.
     */
    subscribe(listener: () => void): () => void {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Locate a selectable menu row by its current accelerator.
 * @param items - newly generated menu rows.
 * @param accelerator - inventory accelerator from the validated snapshot.
 * @returns source row index, or -1 when the target is absent.
 */
function findAccelerator(
  items: readonly MenuItem[],
  accelerator: number,
): number {
  return items.findIndex(
    (item) =>
      item.identifier !== null
      && item.accelerator === accelerator,
  );
}

/**
 * Validate the metadata shared by every automated stage-five menu step.
 * @param input - menu observation copied from the current core snapshot.
 * @returns whether the menu is a selectable, core-owned PICK_ONE window.
 */
function isPickOneMenu(
  input: Extract<ActionControllerInput, { kind: "menu" }>,
): input is typeof input & { how: typeof PICK_ONE; windowId: number } {
  return input.how === PICK_ONE
    && Number.isSafeInteger(input.windowId)
    && (input.windowId ?? -1) > 0;
}

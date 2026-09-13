import type { MenuItem } from "../game-state";
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
  ActionControllerInput,
  ContextMenuPresentation,
  GameActionState,
} from "./game-action-reducer";

export interface ActionControllerObservation {
  moduleId: string;
  sessionId: string;
  snapshotRevision: number;
  inventoryRevision: number | null;
  mapRevision?: number;
  input: ActionControllerInput | null;
  fatal?: boolean;
}

interface GameActionControllerOptions {
  scope?: { moduleId: string; sessionId: string };
  startCommand(intent: ActionIntent): void;
  submitMenuSelection(
    selection: Array<{ itemIndex: number; count: number }> | null,
  ): void;
  releaseInputToUi(input: ActionControllerInput): void;
  onCancel?(reason: ActionIntentCancellationReason): void;
  setActionIntentActive?(active: boolean): void;
}

export interface GameActionController {
  request(intent: ActionIntent): boolean;
  observe(observation: ActionControllerObservation): void;
  cancel(reason: ActionIntentCancellationReason): void;
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
  const listeners = new Set<() => void>();

  /** Publish a reducer event and notify state subscribers. */
  function transition(
    event: Parameters<typeof reduceGameAction>[1],
  ): void {
    state = reduceGameAction(state, event);
    for (const listener of listeners) listener();
  }

  /** Cancel the current intent and report its reason once. */
  function cancel(reason: ActionIntentCancellationReason): void {
    if (state.intent === null) return;
    transition({ type: "cancelled", reason });
    options.setActionIntentActive?.(false);
    options.onCancel?.(reason);
  }

  /** Complete the active intent and release its input barrier. */
  function complete(): void {
    if (state.intent === null) return;
    transition({ type: "completed" });
    options.setActionIntentActive?.(false);
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
      cancel("session-reset");
      return false;
    }
    if (
      "inventoryRevision" in intent
      && observation.inventoryRevision !== intent.inventoryRevision
    ) {
      cancel("inventory-revision-changed");
      return false;
    }
    if (
      state.status === "waiting-command-boundary"
      && intent.kind === "map-context"
      && observation.snapshotRevision !== intent.snapshotRevision
    ) {
      cancel("target-stale");
      return false;
    }
    if (
      intent.kind === "map-inspect"
      && observation.mapRevision !== intent.mapRevision
    ) {
      cancel("target-stale");
      return false;
    }
    if (observation.fatal) {
      cancel("fatal");
      return false;
    }
    return true;
  }

  /** Present or automate the expected menu for the active intent. */
  function handleMenu(
    input: Extract<ActionControllerInput, { kind: "menu" }>,
  ): void {
    const intent = state.intent;
    if (!intent) return;
    if (
      intent.kind === "inventory-context"
      || intent.kind === "drop-item"
    ) {
      if (!state.targetSelected) {
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
    }
    transition({
      type: "presenting",
      presentation: {
        how: input.how ?? 1,
        origin: intent.origin,
        windowId: input.windowId ?? -1,
      },
    });
  }

  /** Observe the latest authoritative core/session state. */
  function observe(observation: ActionControllerObservation): void {
    if (disposed || state.intent === null) return;
    if (!validateOwnership(observation)) return;
    if (state.status === "waiting-command-boundary") {
      if (observation.input === null) return;
      if (observation.input.kind !== "command") {
        const input = observation.input;
        cancel("unexpected-input");
        options.releaseInputToUi(input);
        return;
      }
      const intent = state.intent;
      transition({ type: "starting" });
      try {
        options.startCommand(intent);
      } catch {
        cancel("busy");
        return;
      }
      transition({ type: "waiting" });
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
    if (input.kind === "menu") {
      handleMenu(input);
      return;
    }
    cancel("unexpected-input");
    options.releaseInputToUi(input);
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
    complete,
    /** Cancel outstanding work and prevent future observations. */
    dispose(): void {
      if (disposed) return;
      cancel("unmount");
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

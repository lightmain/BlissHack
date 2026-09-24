import type { MenuItem } from "../game-state";
import type {
  ActionIntent,
  ActionIntentCancellationReason,
} from "./action-intents";
import type { InteractionOrigin } from "./interaction-origin";

/** Core input currently visible to the UI action coordinator. */
export type ActionControllerInput =
  | { kind: "command"; inputState?: number }
  | { kind: "key"; inputState?: number }
  | { kind: "position"; inputState?: number }
  | {
    kind: "yn";
    query: string;
    choices: string | null;
    defaultCode: number;
    inputState?: number;
  }
  | {
    kind: "line";
    purpose: "name" | "getlin";
    query: string;
    inputState?: number;
  }
  | { kind: "display"; inputState?: number }
  | { kind: "extcmd"; inputState?: number }
  | {
    kind: "menu";
    items: readonly MenuItem[];
    windowId?: number;
    how?: number;
    provenance?: "none" | "action-getobj";
    requestNonce?: number;
    menuGeneration?: number;
  };

export interface ContextMenuPresentation {
  how: number;
  origin: Exclude<InteractionOrigin, { kind: "action-dock" }>;
  windowId: number;
}

export interface ActionItemMenuPresentation {
  items: readonly MenuItem[];
  menuGeneration: number;
  windowId: number;
}

export type GameActionStatus =
  | "idle"
  | "waiting-command-boundary"
  | "starting-command"
  | "waiting-expected-input"
  | "waiting-prefix-continuation"
  | "presenting-context-menu"
  | "presenting-item-menu"
  | "targeting-direction"
  | "targeting-position"
  | "handed-off-to-native-ui"
  | "cancelling-core-input"
  | "waiting-cancel-boundary"
  | "completing";

/** Observable state of the single active UI action. */
export interface GameActionState {
  status: GameActionStatus;
  intent: ActionIntent | null;
  targetSelected: boolean;
  contextMenu: ContextMenuPresentation | null;
  itemMenu: ActionItemMenuPresentation | null;
  activeInput: ActionControllerInput | null;
  acceptedBoundaryGeneration: number | null;
  startMenuGeneration: number;
  pendingCancellationReason: ActionIntentCancellationReason | null;
  lastCancellationReason: ActionIntentCancellationReason | null;
}

export type GameActionEvent =
  | { type: "requested"; intent: ActionIntent }
  | { type: "starting" }
  | { type: "waiting"; targetSelected?: boolean }
  | { type: "presenting"; presentation: ContextMenuPresentation }
  | {
    type: "progress";
    status: Exclude<GameActionStatus, "idle">;
    acceptedBoundaryGeneration?: number | null;
    activeInput?: ActionControllerInput | null;
    itemMenu?: ActionItemMenuPresentation | null;
    startMenuGeneration?: number;
    pendingCancellationReason?: ActionIntentCancellationReason | null;
    targetSelected?: boolean;
  }
  | { type: "completing" }
  | { type: "completed" }
  | { type: "cancelled"; reason: ActionIntentCancellationReason };

/** Initial state with no pending UI-owned action. */
export const INITIAL_GAME_ACTION_STATE: GameActionState = {
  status: "idle",
  intent: null,
  targetSelected: false,
  contextMenu: null,
  itemMenu: null,
  activeInput: null,
  acceptedBoundaryGeneration: null,
  startMenuGeneration: 0,
  pendingCancellationReason: null,
  lastCancellationReason: null,
};

/**
 * Apply one explicit action lifecycle transition.
 * @param state - current immutable action state.
 * @param event - accepted controller event.
 * @returns the next immutable action state.
 */
export function reduceGameAction(
  state: GameActionState,
  event: GameActionEvent,
): GameActionState {
  switch (event.type) {
    case "requested":
      return {
        status: "waiting-command-boundary",
        intent: event.intent,
        targetSelected: false,
        contextMenu: null,
        itemMenu: null,
        activeInput: null,
        acceptedBoundaryGeneration: null,
        startMenuGeneration: 0,
        pendingCancellationReason: null,
        lastCancellationReason: null,
      };
    case "starting":
      return { ...state, status: "starting-command" };
    case "waiting":
      return {
        ...state,
        status: "waiting-expected-input",
        targetSelected: event.targetSelected ?? state.targetSelected,
      };
    case "presenting":
      return {
        ...state,
        status: "presenting-context-menu",
        contextMenu: event.presentation,
      };
    case "progress":
      return {
        ...state,
        status: event.status,
        acceptedBoundaryGeneration:
          event.acceptedBoundaryGeneration
          ?? state.acceptedBoundaryGeneration,
        activeInput: event.activeInput === undefined
          ? state.activeInput
          : event.activeInput,
        itemMenu: event.itemMenu === undefined
          ? state.itemMenu
          : event.itemMenu,
        startMenuGeneration:
          event.startMenuGeneration ?? state.startMenuGeneration,
        pendingCancellationReason:
          event.pendingCancellationReason === undefined
            ? state.pendingCancellationReason
            : event.pendingCancellationReason,
        targetSelected: event.targetSelected ?? state.targetSelected,
      };
    case "completing":
      return { ...state, status: "completing" };
    case "completed":
      return {
        ...INITIAL_GAME_ACTION_STATE,
        lastCancellationReason: state.lastCancellationReason,
      };
    case "cancelled":
      return {
        ...INITIAL_GAME_ACTION_STATE,
        lastCancellationReason: event.reason,
      };
  }
}

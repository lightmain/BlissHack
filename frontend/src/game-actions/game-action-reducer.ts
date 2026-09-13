import type { MenuItem } from "../game-state";
import type {
  ActionIntent,
  ActionIntentCancellationReason,
} from "./action-intents";
import type { InteractionOrigin } from "./interaction-origin";

/** Core input currently visible to the UI action coordinator. */
export type ActionControllerInput =
  | { kind: "command" }
  | { kind: "key" }
  | { kind: "position" }
  | {
    kind: "yn";
    query: string;
    choices: string | null;
    defaultCode: number;
  }
  | { kind: "line"; purpose: "name" | "getlin"; query: string }
  | { kind: "display" }
  | { kind: "extcmd" }
  | {
    kind: "menu";
    items: readonly MenuItem[];
    windowId?: number;
    how?: number;
  };

export interface ContextMenuPresentation {
  how: number;
  origin: InteractionOrigin;
  windowId: number;
}

/** Observable state of the single active UI action. */
export interface GameActionState {
  status:
    | "idle"
    | "waiting-command-boundary"
    | "starting-command"
    | "waiting-expected-input"
    | "presenting-context-menu"
    | "completing";
  intent: ActionIntent | null;
  targetSelected: boolean;
  contextMenu: ContextMenuPresentation | null;
  lastCancellationReason: ActionIntentCancellationReason | null;
}

export type GameActionEvent =
  | { type: "requested"; intent: ActionIntent }
  | { type: "starting" }
  | { type: "waiting"; targetSelected?: boolean }
  | { type: "presenting"; presentation: ContextMenuPresentation }
  | { type: "completing" }
  | { type: "completed" }
  | { type: "cancelled"; reason: ActionIntentCancellationReason };

/** Initial state with no pending UI-owned action. */
export const INITIAL_GAME_ACTION_STATE: GameActionState = {
  status: "idle",
  intent: null,
  targetSelected: false,
  contextMenu: null,
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

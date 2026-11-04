import type { Dispatch } from "react";
import { flushSync } from "react-dom";
import type { AppAction } from "./app-state";

/** Navigation direction used only by the screen presentation layer. */
export type ScreenMotionDirection = "forward" | "reverse";

/** Non-fatal failure raised while preparing a screen transition. */
export interface ScreenMotionFailure {
  phase: "ready";
  error: unknown;
}

/** Optional integration hooks for screen transition diagnostics. */
export interface ScreenMotionOptions {
  onFailure?: (failure: ScreenMotionFailure) => void;
}

interface PendingScreenUpdate {
  actions: AppAction[];
  dispatch: Dispatch<AppAction>;
}

let activeScreenMotion = 0;
let pendingScreenUpdate: PendingScreenUpdate | null = null;

/**
 * Map lifecycle actions to a visual navigation direction without owning state.
 * @param action - authoritative application action.
 * @returns the matching presentation direction, if the action changes screens.
 */
export function screenMotionDirection(
  action: AppAction,
): ScreenMotionDirection | null {
  switch (action.type) {
    case "SETTINGS_OPENED":
    case "SESSION_CREATED":
      return "forward";
    case "SETTINGS_CLOSED":
    case "SESSION_CLEANUP_COMPLETED":
    case "END_SUMMARY_CONFIRMED":
    case "RETURN_HOME":
      return "reverse";
    default:
      return null;
  }
}

/**
 * Commit one reducer action inside a native same-document transition.
 * Unsupported browsers and reduced-motion users receive the original update.
 * @param dispatch - authoritative reducer dispatch.
 * @param action - application action to commit.
 */
export function dispatchWithScreenMotion(
  dispatch: Dispatch<AppAction>,
  action: AppAction,
  options: ScreenMotionOptions = {},
): void {
  const direction = screenMotionDirection(action);
  if (pendingScreenUpdate?.dispatch === dispatch) {
    pendingScreenUpdate.actions.push(action);
    return;
  }
  if (
    direction === null
    || typeof document === "undefined"
    || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    dispatch(action);
    return;
  }

  if (typeof document.startViewTransition !== "function") {
    dispatch(action);
    return;
  }

  const root = document.documentElement;
  const motionToken = ++activeScreenMotion;
  const screenUpdate: PendingScreenUpdate = {
    actions: [],
    dispatch,
  };
  let committed = false;
  pendingScreenUpdate = screenUpdate;
  root.dataset.uiMotionCapable = "true";
  root.dataset.uiMotion = direction;

  try {
    const transition = document.startViewTransition(() => {
      const queuedActions = screenUpdate.actions.splice(0);
      if (pendingScreenUpdate === screenUpdate) {
        pendingScreenUpdate = null;
      }
      flushSync(() => {
        dispatch(action);
        committed = true;
        for (const queuedAction of queuedActions) {
          dispatch(queuedAction);
        }
      });
    });
    void transition.ready.catch((error: unknown) => {
      if (isAbortError(error)) return;
      try {
        options.onFailure?.({ phase: "ready", error });
      } catch {
        // Presentation diagnostics must never interrupt the application.
      }
    });
    void transition.finished.finally(() => {
      if (activeScreenMotion === motionToken) {
        delete root.dataset.uiMotion;
      }
    }).catch(() => undefined);
  } catch {
    if (activeScreenMotion === motionToken) {
      delete root.dataset.uiMotion;
    }
    const queuedActions = screenUpdate.actions.splice(0);
    if (pendingScreenUpdate === screenUpdate) {
      pendingScreenUpdate = null;
    }
    if (!committed) {
      dispatch(action);
      for (const queuedAction of queuedActions) {
        dispatch(queuedAction);
      }
    }
  }
}

/**
 * Return whether a transition failure is the browser's expected abort signal.
 * @param error - rejected View Transition reason.
 * @returns true for AbortError values, including cross-realm DOM exceptions.
 */
function isAbortError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
}

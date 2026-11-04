import type { Dispatch } from "react";
import { flushSync } from "react-dom";
import type { AppAction } from "./app-state";

/** Navigation direction used only by the screen presentation layer. */
export type ScreenMotionDirection = "forward" | "reverse";

let activeScreenMotion = 0;

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
    case "SESSION_RUNNING":
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
): void {
  const direction = screenMotionDirection(action);
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
  let committed = false;
  root.dataset.uiMotionCapable = "true";
  root.dataset.uiMotion = direction;

  try {
    const transition = document.startViewTransition(() => {
      flushSync(() => dispatch(action));
      committed = true;
    });
    void transition.ready.catch(() => undefined);
    void transition.finished.finally(() => {
      if (activeScreenMotion === motionToken) {
        delete root.dataset.uiMotion;
      }
    }).catch(() => undefined);
  } catch {
    if (activeScreenMotion === motionToken) {
      delete root.dataset.uiMotion;
    }
    if (!committed) dispatch(action);
  }
}

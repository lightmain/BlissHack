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
  now?: () => number;
  onFailure?: (failure: ScreenMotionFailure) => void;
}

interface PendingScreenUpdate {
  actions: AppAction[];
}

interface HomeLoadingMotion {
  allowSharedTransition: boolean;
  moduleId: string;
  startedAt: number;
}

const HOME_SHARED_TRANSITION_DELAY_MS = 500;
let activeScreenMotion = 0;
const directHomeLoads = new WeakSet<Dispatch<AppAction>>();
const homeLoadingMotion = new WeakMap<
  Dispatch<AppAction>,
  HomeLoadingMotion
>();
const pendingScreenUpdates = new WeakMap<
  Dispatch<AppAction>,
  PendingScreenUpdate
>();

/**
 * Map lifecycle actions to a visual navigation direction without owning state.
 * @param action - authoritative application action.
 * @returns the matching presentation direction, if the action changes screens.
 */
export function screenMotionDirection(
  action: AppAction,
): ScreenMotionDirection | null {
  switch (action.type) {
    case "HOME_READY":
    case "SETTINGS_OPENED":
    case "SESSION_CREATED":
      return "forward";
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
  trackHomeLoadingMotion(dispatch, action, options.now ?? defaultNow);
  const direction = action.type === "HOME_READY"
    ? homeReadyMotionDirection(dispatch, action, options.now ?? defaultNow)
    : screenMotionDirection(action);
  const pendingScreenUpdate = pendingScreenUpdates.get(dispatch);
  if (pendingScreenUpdate) {
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
  };
  let committed = false;
  pendingScreenUpdates.set(dispatch, screenUpdate);
  root.dataset.uiMotionCapable = "true";
  root.dataset.uiMotion = direction;
  if (action.type === "HOME_READY") {
    root.dataset.uiMotionShared = "home-dungeon";
  } else {
    delete root.dataset.uiMotionShared;
  }

  try {
    const transition = document.startViewTransition(() => {
      const queuedActions = screenUpdate.actions.splice(0);
      if (pendingScreenUpdates.get(dispatch) === screenUpdate) {
        pendingScreenUpdates.delete(dispatch);
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
        delete root.dataset.uiMotionShared;
      }
    }).catch(() => undefined);
  } catch {
    if (activeScreenMotion === motionToken) {
      delete root.dataset.uiMotion;
      delete root.dataset.uiMotionShared;
    }
    const queuedActions = screenUpdate.actions.splice(0);
    if (pendingScreenUpdates.get(dispatch) === screenUpdate) {
      pendingScreenUpdates.delete(dispatch);
    }
    if (!committed) {
      dispatch(action);
      for (const queuedAction of queuedActions) {
        dispatch(queuedAction);
      }
    }
  }
}

/** Record whether one module load began from startup or another screen. */
function trackHomeLoadingMotion(
  dispatch: Dispatch<AppAction>,
  action: AppAction,
  now: () => number,
): void {
  switch (action.type) {
    case "LOCAL_DATA_CLEARED":
    case "RETURN_HOME":
    case "SESSION_CLEANUP_COMPLETED":
      directHomeLoads.add(dispatch);
      homeLoadingMotion.delete(dispatch);
      return;
    case "SETTINGS_CLOSED":
    case "END_SUMMARY_CONFIRMED":
      homeLoadingMotion.delete(dispatch);
      return;
    case "MODULE_LOADING":
      homeLoadingMotion.set(dispatch, {
        allowSharedTransition: !directHomeLoads.delete(dispatch),
        moduleId: action.moduleId,
        startedAt: now(),
      });
      return;
    default:
      return;
  }
}

/** Return startup motion only after the matching loading screen stayed visible. */
function homeReadyMotionDirection(
  dispatch: Dispatch<AppAction>,
  action: Extract<AppAction, { type: "HOME_READY" }>,
  now: () => number,
): ScreenMotionDirection | null {
  const loading = homeLoadingMotion.get(dispatch);
  homeLoadingMotion.delete(dispatch);
  return loading?.allowSharedTransition
      && loading.moduleId === action.moduleId
      && now() - loading.startedAt >= HOME_SHARED_TRANSITION_DELAY_MS
    ? "forward"
    : null;
}

/** Read a monotonic presentation timestamp when the browser provides one. */
function defaultNow(): number {
  return globalThis.performance?.now() ?? Date.now();
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

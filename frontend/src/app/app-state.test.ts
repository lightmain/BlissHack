import { describe, expect, it } from "vitest";
import {
  appReducer,
  initialAppState,
  type AppAction,
  type AppState,
} from "./app-state";

/**
 * Reduce a sequence of application actions from a supplied state.
 * @param state - state before the first action.
 * @param actions - ordered actions to apply.
 * @returns the state after the final action.
 */
function reduce(
  state: AppState,
  ...actions: AppAction[]
): AppState {
  return actions.reduce(appReducer, state);
}

/**
 * Create a running session using only legal lifecycle actions.
 * @param sessionId - identity assigned to the session.
 * @returns the running session state.
 */
function runningSession(sessionId = "session-1"): AppState {
  return reduce(
    { phase: "home", storageAvailable: true },
    { type: "NEW_GAME", sessionId },
    { type: "MODULE_LOADING", sessionId },
    { type: "MODULE_READY", sessionId },
    { type: "SESSION_RUNNING", sessionId },
  );
}

describe("appReducer legal transitions", () => {
  it("moves from booting through every new-game lifecycle status", () => {
    const home = appReducer(initialAppState, {
      type: "BOOT_COMPLETED",
      storageAvailable: true,
    });
    expect(home).toEqual({ phase: "home", storageAvailable: true });

    const creating = appReducer(home, {
      type: "NEW_GAME",
      sessionId: "session-1",
    });
    expect(creating).toEqual({
      phase: "session",
      sessionId: "session-1",
      status: "creating",
    });
    expect(appReducer(creating, {
      type: "SESSION_CREATED",
      sessionId: "session-1",
    })).toBe(creating);

    const loading = appReducer(creating, {
      type: "MODULE_LOADING",
      sessionId: "session-1",
    });
    expect(loading).toMatchObject({ phase: "session", status: "loading" });

    const ready = appReducer(loading, {
      type: "MODULE_READY",
      sessionId: "session-1",
    });
    expect(ready).toMatchObject({ phase: "session", status: "ready" });

    const running = appReducer(ready, {
      type: "SESSION_RUNNING",
      sessionId: "session-1",
    });
    expect(running).toMatchObject({ phase: "session", status: "running" });
  });

  it("supports the normal-exit path and returns home only after cleanup", () => {
    const running = runningSession();
    const exiting = appReducer(running, {
      type: "SESSION_EXITING",
      sessionId: "session-1",
    });

    expect(exiting).toMatchObject({ phase: "session", status: "exiting" });
    expect(appReducer(exiting, {
      type: "SESSION_CLEANUP_COMPLETED",
      sessionId: "session-1",
      storageAvailable: true,
    })).toEqual({ phase: "home", storageAvailable: true });
  });

  it("supports the save-exit path and returns home only after cleanup", () => {
    const saving = appReducer(runningSession(), {
      type: "SESSION_SAVING",
      sessionId: "session-1",
    });
    expect(saving).toMatchObject({ phase: "session", status: "saving" });

    const exiting = appReducer(saving, {
      type: "SESSION_EXITING",
      sessionId: "session-1",
    });
    expect(exiting).toMatchObject({ phase: "session", status: "exiting" });
    expect(appReducer(exiting, {
      type: "SESSION_CLEANUP_COMPLETED",
      sessionId: "session-1",
      storageAvailable: false,
    })).toEqual({ phase: "home", storageAvailable: false });
  });

  it.each([
    "creating",
    "loading",
    "ready",
    "running",
    "saving",
    "exiting",
  ] as const)("moves session/%s to fatal for the current session", (status) => {
    const state: AppState = {
      phase: "session",
      sessionId: "session-1",
      status,
    };

    expect(appReducer(state, {
      type: "SESSION_FATAL_ERROR",
      sessionId: "session-1",
      errorId: "error-1",
    })).toEqual({
      phase: "fatal",
      sessionId: "session-1",
      errorId: "error-1",
    });
  });
});

describe("appReducer lifecycle guards", () => {
  it.each([
    { type: "SESSION_RUNNING", sessionId: "stale-session" },
    {
      type: "SESSION_CLEANUP_COMPLETED",
      sessionId: "stale-session",
      storageAvailable: true,
    },
    {
      type: "SESSION_FATAL_ERROR",
      sessionId: "stale-session",
      errorId: "stale-error",
    },
  ] satisfies AppAction[])("ignores stale $type events", (action) => {
    const state = runningSession("current-session");
    expect(appReducer(state, action)).toBe(state);
  });

  it("does not let RETURN_HOME bypass a running core", () => {
    const state = runningSession();
    expect(appReducer(state, { type: "RETURN_HOME" })).toBe(state);
  });

  it("rejects an unknown runtime action instead of silently accepting it", () => {
    expect(() => appReducer(
      { phase: "home", storageAvailable: true },
      { type: "UNKNOWN_ACTION" } as never,
    )).toThrow(/unknown|unsupported|unreachable/i);
  });

  it("keeps unknown variants outside the AppAction discriminated union", () => {
    type ContainsUnknown = Extract<
      AppAction,
      { type: "UNKNOWN_ACTION" }
    > extends never ? false : true;
    const containsUnknown: ContainsUnknown = false;
    expect(containsUnknown).toBe(false);
  });
});

/** Lifecycle statuses for the single active NetHack session. */
export type SessionStatus =
  | "creating"
  | "loading"
  | "ready"
  | "running"
  | "saving"
  | "exiting";

/** Authoritative top-level application state. */
export type AppState =
  | { phase: "booting" }
  | { phase: "home"; storageAvailable: boolean }
  | {
    phase: "session";
    sessionId: string;
    status: SessionStatus;
  }
  | { phase: "fatal"; sessionId: string | null; errorId: string };

/** Events which can move the application through its lifecycle. */
export type AppAction =
  | { type: "BOOT_COMPLETED"; storageAvailable: boolean }
  | { type: "NEW_GAME"; sessionId: string }
  | { type: "SESSION_CREATED"; sessionId: string }
  | { type: "MODULE_LOADING"; sessionId: string }
  | { type: "MODULE_READY"; sessionId: string }
  | { type: "SESSION_RUNNING"; sessionId: string }
  | { type: "SESSION_SAVING"; sessionId: string }
  | { type: "SESSION_EXITING"; sessionId: string }
  | {
    type: "SESSION_CLEANUP_COMPLETED";
    sessionId: string;
    storageAvailable: boolean;
  }
  | { type: "SESSION_FATAL_ERROR"; sessionId: string; errorId: string }
  | { type: "RETURN_HOME" };

/** Initial state before browser capabilities have been inspected. */
export const initialAppState: AppState = { phase: "booting" };

/**
 * Apply one lifecycle event to the authoritative application state.
 * @param state - current application state.
 * @param action - lifecycle event to process.
 * @returns the next application state.
 */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "BOOT_COMPLETED":
      return state.phase === "booting"
        ? { phase: "home", storageAvailable: action.storageAvailable }
        : state;
    case "NEW_GAME":
    case "SESSION_CREATED":
      return state.phase === "home"
        ? {
          phase: "session",
          sessionId: action.sessionId,
          status: "creating",
        }
        : state;
    case "MODULE_LOADING":
      return updateCurrentSession(state, action.sessionId, "loading");
    case "MODULE_READY":
      return updateCurrentSession(state, action.sessionId, "ready");
    case "SESSION_RUNNING":
      return updateCurrentSession(state, action.sessionId, "running");
    case "SESSION_SAVING":
      return updateCurrentSession(state, action.sessionId, "saving");
    case "SESSION_EXITING":
      return updateCurrentSession(state, action.sessionId, "exiting");
    case "SESSION_CLEANUP_COMPLETED":
      if (!isCurrentSession(state, action.sessionId)) return state;
      return {
        phase: "home",
        storageAvailable: action.storageAvailable,
      };
    case "SESSION_FATAL_ERROR":
      if (!isCurrentSession(state, action.sessionId)) return state;
      return {
        phase: "fatal",
        sessionId: action.sessionId,
        errorId: action.errorId,
      };
    case "RETURN_HOME":
      return state.phase === "fatal" && state.sessionId === null
        ? { phase: "home", storageAvailable: false }
        : state;
    default:
      return assertNever(action);
  }
}

/**
 * Test whether an event belongs to the active session.
 * @param state - current application state.
 * @param sessionId - event session identity.
 * @returns whether the event belongs to the current session.
 */
function isCurrentSession(
  state: AppState,
  sessionId: string,
): state is Extract<AppState, { phase: "session" }> {
  return state.phase === "session" && state.sessionId === sessionId;
}

/**
 * Replace the status of the current session while rejecting stale events.
 * @param state - current application state.
 * @param sessionId - event session identity.
 * @param status - requested session status.
 * @returns updated state, or the original state for stale events.
 */
function updateCurrentSession(
  state: AppState,
  sessionId: string,
  status: SessionStatus,
): AppState {
  if (!isCurrentSession(state, sessionId)) return state;
  return { ...state, status };
}

/**
 * Enforce exhaustive action handling at compile time and fail unknown input.
 * @param value - unreachable action value.
 * @returns never.
 */
function assertNever(value: never): never {
  const unknownValue: unknown = value;
  const description = typeof unknownValue === "object"
    && unknownValue !== null
    && "type" in unknownValue
    ? String(unknownValue.type)
    : String(value);
  throw new Error(`Unsupported application action: ${description}`);
}

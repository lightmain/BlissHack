import type { AppAction } from "../app/app-state";
import { getSnapshot } from "../game-state";
import {
  createGameModule,
  dismissDisplay,
  isWaitingForInput,
  resetBridgeState,
  sendKey,
  sendPosition,
  shimCallbackForModule,
  submitExtendedCommand,
  submitLine,
  submitMenuSelection,
  type EmscriptenModule,
} from "../nethack-bridge";

/** A started session and the callback registered for its WASM module. */
export interface SessionHandle {
  sessionId: string;
  callbackName: string;
  module: EmscriptenModule;
}

/** Public controls for the single-session lifecycle. */
export interface SessionManager {
  startSession: () => Promise<SessionHandle>;
  cleanupSession: (sessionId: string) => Promise<void>;
  dispose: () => Promise<void>;
  getActiveSession: () => SessionHandle | null;
  isWaitingForInput: () => boolean;
  sendKey: (value: number) => void;
  sendPosition: (x: number, y: number, modifier: 1 | 2) => void;
  submitLine: (value: string | null) => void;
  submitMenuSelection: (
    selected: Array<{ itemIndex: number; count: number }> | null,
  ) => void;
  submitExtendedCommand: (sourceIndex: number | null) => void;
  dismissDisplay: () => void;
}

/** Dependencies used to create a session manager. */
export interface SessionManagerOptions {
  callbackHost?: Record<string, unknown>;
  createSessionId?: () => string;
  dispatch: (action: AppAction) => void;
  moduleFactory?: () => Promise<EmscriptenModule>;
  storageAvailable?: () => boolean;
}

interface SessionRecord {
  sessionId: string;
  callbackName: string;
  module: EmscriptenModule | null;
  mainPromise: Promise<unknown> | null;
  cleanupPromise: Promise<void> | null;
  closed: boolean;
}

let generatedSessionId = 0;

/**
 * Create the manager which owns the sole active WASM session.
 * @param options - lifecycle dependencies and application dispatcher.
 * @returns a single-session manager.
 */
export function createSessionManager(
  options: SessionManagerOptions,
): SessionManager {
  const callbackHost = options.callbackHost
    ?? globalThis as unknown as Record<string, unknown>;
  const createSessionId = options.createSessionId ?? defaultSessionId;
  const storageAvailable = options.storageAvailable ?? (() => true);
  let activeRecord: SessionRecord | null = null;
  let activeHandle: SessionHandle | null = null;
  let startPromise: Promise<SessionHandle> | null = null;

  /**
   * Start a fresh module, register its callback, and invoke main once.
   * @returns the active session handle.
   */
  function startSession(): Promise<SessionHandle> {
    if (startPromise) return startPromise;

    resetBridgeState();
    const sessionId = createSessionId();
    const callbackName = callbackNameFor(sessionId);
    const record: SessionRecord = {
      sessionId,
      callbackName,
      module: null,
      mainPromise: null,
      cleanupPromise: null,
      closed: false,
    };
    activeRecord = record;
    options.dispatch({ type: "SESSION_CREATED", sessionId });
    options.dispatch({ type: "MODULE_LOADING", sessionId });

    const modulePromise = options.moduleFactory
      ? options.moduleFactory()
      : createGameModule(undefined, {
        isCurrent: () => activeRecord === record && !record.closed,
      });
    startPromise = modulePromise
      .then((module) => initializeSession(record, module))
      .catch((error: unknown) => {
        failSession(record, error);
        throw error;
      });
    return startPromise;
  }

  /**
   * Register one loaded module and start its Asyncify main call.
   * @param record - session record being initialized.
   * @param module - freshly created Emscripten module.
   * @returns active session handle.
   */
  function initializeSession(
    record: SessionRecord,
    module: EmscriptenModule,
  ): SessionHandle {
    if (activeRecord !== record || record.closed) {
      throw new Error(`Session ${record.sessionId} was cancelled while loading`);
    }
    record.module = module;
    const handle: SessionHandle = {
      sessionId: record.sessionId,
      callbackName: record.callbackName,
      module,
    };
    activeHandle = handle;

    callbackHost[record.callbackName] = async (
      name: string,
      ...args: unknown[]
    ): Promise<unknown> => {
      if (activeRecord !== record || record.closed) return undefined;
      const result = await shimCallbackForModule(module, name, ...args);
      if (activeRecord !== record || record.closed) return result;
      if (getSnapshot().phase === "error") {
        failSession(record, new Error(`Bridge callback failed: ${name}`));
        return result;
      }
      if (name === "shim_init_nhwindows") {
        options.dispatch({
          type: "SESSION_RUNNING",
          sessionId: record.sessionId,
        });
      } else if (name === "shim_exit_nhwindows") {
        options.dispatch({
          type: "SESSION_EXITING",
          sessionId: record.sessionId,
        });
        await cleanupSession(record.sessionId);
      }
      return result;
    };

    module.ccall(
      "shim_graphics_set_callback",
      null,
      ["string"],
      [record.callbackName],
    );
    options.dispatch({
      type: "MODULE_READY",
      sessionId: record.sessionId,
    });
    const mainResult = module.ccall(
      "main",
      "number",
      [],
      [],
      { async: true },
    );
    record.mainPromise = Promise.resolve(mainResult);
    void record.mainPromise.then(
      () => finishSession(record),
      (error: unknown) => {
        if (isSuccessfulExit(error)) finishSession(record);
        else failSession(record, error);
      },
    );
    return handle;
  }

  /**
   * Release the active session exactly once.
   * @param sessionId - identity of the session to release.
   * @returns completion after all local resources have been cleared.
   */
  function cleanupSession(sessionId: string): Promise<void> {
    const record = activeRecord;
    if (!record || record.sessionId !== sessionId) return Promise.resolve();
    if (record.cleanupPromise) return record.cleanupPromise;

    record.cleanupPromise = Promise.resolve().then(() => {
      if (record.closed) return;
      record.closed = true;
      delete callbackHost[record.callbackName];
      resetBridgeState();
      if (activeRecord === record) {
        activeRecord = null;
        activeHandle = null;
        startPromise = null;
      }
      options.dispatch({
        type: "SESSION_CLEANUP_COMPLETED",
        sessionId: record.sessionId,
        storageAvailable: storageAvailable(),
      });
    });
    return record.cleanupPromise;
  }

  /** Dispose the current manager and its active session, if any. */
  function dispose(): Promise<void> {
    return activeRecord
      ? cleanupSession(activeRecord.sessionId)
      : Promise.resolve();
  }

  /**
   * Finish a session whose main function returned without an exit callback.
   * @param record - session whose WASM main call has completed.
   */
  function finishSession(record: SessionRecord): void {
    if (activeRecord !== record || record.closed) return;
    options.dispatch({
      type: "SESSION_EXITING",
      sessionId: record.sessionId,
    });
    void cleanupSession(record.sessionId);
  }

  /**
   * Invalidate a failed session without reporting successful cleanup.
   * @param record - failed session record.
   * @param error - failure used to derive the visible error ID.
   */
  function failSession(record: SessionRecord, error: unknown): void {
    if (activeRecord !== record || record.closed) return;
    record.closed = true;
    delete callbackHost[record.callbackName];
    resetBridgeState();
    activeRecord = null;
    activeHandle = null;
    startPromise = null;
    options.dispatch({
      type: "SESSION_FATAL_ERROR",
      sessionId: record.sessionId,
      errorId: errorIdentifier(record.sessionId, error),
    });
  }

  /** Run an input operation only while a live session owns the bridge. */
  function withActiveSession(operation: () => void): void {
    if (!activeRecord || activeRecord.closed || !activeHandle) return;
    operation();
  }

  return {
    startSession,
    cleanupSession,
    dispose,
    getActiveSession: () => activeHandle,
    isWaitingForInput: () =>
      activeRecord !== null && !activeRecord.closed && isWaitingForInput(),
    sendKey: (value) => withActiveSession(() => sendKey(value)),
    sendPosition: (x, y, modifier) =>
      withActiveSession(() => sendPosition(x, y, modifier)),
    submitLine: (value) => withActiveSession(() => submitLine(value)),
    submitMenuSelection: (selected) =>
      withActiveSession(() => submitMenuSelection(selected)),
    submitExtendedCommand: (sourceIndex) =>
      withActiveSession(() => submitExtendedCommand(sourceIndex)),
    dismissDisplay: () => withActiveSession(dismissDisplay),
  };
}

/**
 * Generate a session identity which cannot contain player information.
 * @returns unique identity for the current tab lifetime.
 */
function defaultSessionId(): string {
  generatedSessionId += 1;
  const random = globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `${generatedSessionId}-${random}`;
}

/**
 * Convert a session ID into a legal, unique JavaScript callback identifier.
 * @param sessionId - owning session identity.
 * @returns global callback property name.
 */
function callbackNameFor(sessionId: string): string {
  const safeId = sessionId.replace(/[^A-Za-z0-9_$]/g, "_");
  return `blissCallback_${safeId}`;
}

/**
 * Create a non-sensitive identifier for one session failure.
 * @param sessionId - failed session identity.
 * @param error - failure value.
 * @returns identifier suitable for the fatal screen.
 */
function errorIdentifier(sessionId: string, error: unknown): string {
  const category = error instanceof Error && error.name
    ? error.name
    : "SessionError";
  return `${sessionId}:${category}`;
}

/**
 * Detect Emscripten's successful ExitStatus rejection.
 * @param error - rejected main result.
 * @returns whether the program terminated with exit status zero.
 */
function isSuccessfulExit(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { message?: unknown; name?: unknown; status?: unknown };
  if (candidate.status === 0) return true;
  return candidate.name === "ExitStatus"
    && typeof candidate.message === "string"
    && /\bexit(?:ed)?\(0\)|status 0\b/i.test(candidate.message);
}

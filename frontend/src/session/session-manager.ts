import type { AppAction } from "../app/app-state";
import { getSnapshot } from "../game-state";
import {
  createGameModule,
  dismissDisplay,
  isWaitingForInput,
  resetBridgeState,
  sendKey,
  sendPosition,
  setRestoreRequired,
  setStartupIdentity,
  shimCallbackForModule,
  submitExtendedCommand,
  submitLine,
  submitMenuSelection,
  validateSaveMetadata,
  type EmscriptenModule,
} from "../nethack-bridge";
import {
  createStorageService,
  type SaveIdentity,
  type SaveListEntry,
  type StorageModule,
  type StorageService,
} from "../storage/storage-service";

/** A started session and the callback registered for its WASM module. */
export interface SessionHandle {
  moduleId: string;
  sessionId: string;
  callbackName: string;
  module: EmscriptenModule;
}

/** Result of preparing the game module displayed by Home. */
export interface HomePreparation {
  moduleId: string;
  saves: SaveListEntry[];
  storageAvailable: boolean;
}

/** Request which claims the prepared home module for one game. */
export type SessionStartRequest =
  | { kind: "new" }
  | { kind: "continue"; save: SaveListEntry };

/** Public controls for the single-module and single-session lifecycle. */
export interface SessionManager {
  initialize: () => Promise<HomePreparation>;
  startSession: (request?: SessionStartRequest) => Promise<SessionHandle>;
  deleteSave: (
    moduleId: string,
    path: string,
  ) => Promise<HomePreparation>;
  cleanupSession: (sessionId: string) => Promise<void>;
  dispose: () => Promise<void>;
  getActiveSession: () => SessionHandle | null;
  getHomePreparation: () => HomePreparation | null;
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
  createModuleId?: () => string;
  createSessionId?: () => string;
  createStorageService?: (module: EmscriptenModule) => StorageService;
  dispatch: (action: AppAction) => void;
  moduleFactory?: () => Promise<EmscriptenModule>;
  setRestoreRequired?: (
    module: EmscriptenModule,
    required: boolean,
  ) => void;
  setStartupIdentity?: (
    module: EmscriptenModule,
    identity: SaveIdentity,
  ) => void;
  /** Retained for stage-one callers; storage availability now comes from initialize. */
  storageAvailable?: () => boolean;
}

interface ModuleRecord {
  moduleId: string;
  module: EmscriptenModule | null;
  storage: StorageService | null;
  preparation: HomePreparation | null;
  session: SessionRecord | null;
  closed: boolean;
}

interface SessionRecord {
  sessionId: string;
  callbackName: string;
  handle: SessionHandle;
  mainPromise: Promise<unknown>;
  cleanupPromise: Promise<void> | null;
  continuation: {
    path: string;
    originalBytes: Uint8Array;
    restoreFailed: boolean;
  } | null;
  exitFlushed: boolean;
  closed: boolean;
}

let generatedModuleId = 0;
let generatedSessionId = 0;

/**
 * Create the manager which owns the next game module and sole active session.
 * @param options - lifecycle dependencies and application dispatcher.
 * @returns a manager spanning Home preparation through session retirement.
 */
export function createSessionManager(
  options: SessionManagerOptions,
): SessionManager {
  const callbackHost = options.callbackHost
    ?? globalThis as unknown as Record<string, unknown>;
  const createModuleId = options.createModuleId ?? defaultModuleId;
  const createSessionId = options.createSessionId ?? defaultSessionId;
  const applyStartupIdentity = options.setStartupIdentity ?? setStartupIdentity;
  const applyRestoreRequired = options.setRestoreRequired ?? setRestoreRequired;
  let currentModule: ModuleRecord | null = null;
  let initializePromise: Promise<HomePreparation> | null = null;
  let startPromise: Promise<SessionHandle> | null = null;
  let deletePromise: Promise<HomePreparation> | null = null;
  let disposed = false;

  /** Prepare one module and its storage before Home becomes ready. */
  function initialize(): Promise<HomePreparation> {
    disposed = false;
    if (currentModule?.preparation) {
      return Promise.resolve(currentModule.preparation);
    }
    if (initializePromise) return initializePromise;
    return prepareModule(createModuleId());
  }

  /** Create and populate one named module generation. */
  function prepareModule(moduleId: string): Promise<HomePreparation> {
    const record: ModuleRecord = {
      moduleId,
      module: null,
      storage: null,
      preparation: null,
      session: null,
      closed: false,
    };
    currentModule = record;
    options.dispatch({ type: "MODULE_LOADING", moduleId });

    const modulePromise = options.moduleFactory
      ? options.moduleFactory()
      : createGameModule(undefined, {
        isCurrent: () =>
          currentModule === record && !record.closed && !disposed,
      });

    initializePromise = modulePromise
      .then(async (module) => {
        assertCurrentModule(record);
        record.module = module;
        const storage = options.createStorageService
          ? options.createStorageService(module)
          : createStorageService(module as unknown as StorageModule, {
            validateSaveMetadata,
          });
        record.storage = storage;
        options.dispatch({ type: "STORAGE_LOADING", moduleId });

        let storageAvailable = false;
        let saves: SaveListEntry[] = [];
        try {
          storageAvailable = await storage.initialize();
          if (storageAvailable) saves = await storage.listSaves();
        } catch {
          storageAvailable = false;
        }
        assertCurrentModule(record);

        const preparation = { moduleId, saves, storageAvailable };
        record.preparation = preparation;
        options.dispatch({
          type: "HOME_READY",
          moduleId,
          storageAvailable,
        });
        return preparation;
      })
      .catch((error: unknown) => {
        if (currentModule === record && !record.closed && !disposed) {
          record.closed = true;
          options.dispatch({
            type: "MODULE_FATAL_ERROR",
            moduleId,
            errorId: errorIdentifier(moduleId, error),
          });
        }
        throw error;
      });
    return initializePromise;
  }

  /**
   * Claim the prepared module, register its callback, and invoke main once.
   * @param request - whether to start fresh or restore a validated save.
   * @returns the active session handle.
   */
  function startSession(
    request: SessionStartRequest = { kind: "new" },
  ): Promise<SessionHandle> {
    if (startPromise) return startPromise;
    startPromise = startPreparedSession(request).catch((error: unknown) => {
      const session = currentModule?.session;
      if (session && !session.closed) void failSession(session, error);
      else startPromise = null;
      throw error;
    });
    return startPromise;
  }

  /** Complete the asynchronous work needed before calling main. */
  async function startPreparedSession(
    request: SessionStartRequest,
  ): Promise<SessionHandle> {
    await initialize();
    await deletePromise?.catch(() => undefined);
    const owner = currentModule;
    if (
      !owner
      || owner.closed
      || !owner.module
      || !owner.storage
      || !owner.preparation
      || owner.session
    ) {
      throw new Error("No ready game module is available");
    }

    const sessionId = createSessionId();
    const callbackName = callbackNameFor(sessionId);
    const handle: SessionHandle = {
      moduleId: owner.moduleId,
      sessionId,
      callbackName,
      module: owner.module,
    };
    const session: SessionRecord = {
      sessionId,
      callbackName,
      handle,
      mainPromise: Promise.resolve(),
      cleanupPromise: null,
      continuation: null,
      exitFlushed: false,
      closed: false,
    };
    owner.session = session;

    if (request.kind === "continue") {
      if (request.save.status !== "ready") {
        throw new Error("Cannot continue an invalid save");
      }
      const listedSave = owner.preparation.saves.find(
        (save) => save.path === request.save.path && save.status === "ready",
      );
      if (!listedSave || listedSave.status !== "ready") {
        throw new Error("Selected save is not part of the current module");
      }
      session.continuation = {
        path: listedSave.path,
        originalBytes: await owner.storage.readSave(listedSave.path),
        restoreFailed: false,
      };
      applyStartupIdentity(owner.module, listedSave.identity);
      applyRestoreRequired(owner.module, true);
    }

    resetBridgeState();
    options.dispatch({
      type: "SESSION_CREATED",
      moduleId: owner.moduleId,
      sessionId,
    });
    registerCallback(owner, session);
    owner.module.ccall(
      "shim_graphics_set_callback",
      null,
      ["string"],
      [callbackName],
    );

    const mainResult = owner.module.ccall(
      "main",
      "number",
      [],
      [],
      { async: true },
    );
    session.mainPromise = Promise.resolve(mainResult);
    void session.mainPromise.then(
      () => finishSession(owner, session),
      (error: unknown) => {
        if (session.continuation) {
          void failRestore(owner, session, error);
        } else if (isSuccessfulExit(error)) {
          void finishSession(owner, session);
        } else {
          void failSession(session, error);
        }
      },
    );
    return handle;
  }

  /**
   * Delete one save owned by the current Home module and refresh its list.
   * @param moduleId - module generation which displayed the save.
   * @param path - exact path previously enumerated for that module.
   * @returns the refreshed Home preparation.
   */
  function deleteSave(
    moduleId: string,
    path: string,
  ): Promise<HomePreparation> {
    if (deletePromise) {
      return Promise.reject(new Error("A save deletion is already active"));
    }
    const operation = deletePreparedSave(moduleId, path);
    deletePromise = operation;
    void operation.finally(() => {
      if (deletePromise === operation) deletePromise = null;
    }).catch(() => undefined);
    return operation;
  }

  /** Execute a validated Home deletion against its module-bound storage. */
  async function deletePreparedSave(
    moduleId: string,
    path: string,
  ): Promise<HomePreparation> {
    const owner = currentModule;
    if (
      !owner
      || owner.closed
      || owner.moduleId !== moduleId
      || !owner.storage
      || !owner.preparation
    ) {
      throw new Error("Save deletion does not belong to the current Home module");
    }
    if (owner.session) {
      throw new Error("Cannot delete a save while an active session owns Home");
    }
    if (!owner.preparation.saves.some((save) => save.path === path)) {
      throw new Error("Save path is not listed by the current Home module");
    }

    await owner.storage.deleteSave(path);
    assertCurrentHomeModule(owner);
    const saves = await owner.storage.listSaves();
    assertCurrentHomeModule(owner);

    const preparation = { ...owner.preparation, saves };
    owner.preparation = preparation;
    options.dispatch({
      type: "HOME_SAVES_UPDATED",
      moduleId,
      saves,
    });
    return preparation;
  }

  /** Register the callback owned by one session and module. */
  function registerCallback(owner: ModuleRecord, session: SessionRecord): void {
    const module = owner.module as EmscriptenModule;
    callbackHost[session.callbackName] = async (
      name: string,
      ...args: unknown[]
    ): Promise<unknown> => {
      if (!isCurrentSession(owner, session)) return undefined;
      if (name === "shim_player_selection_or_tty" && session.continuation) {
        session.continuation.restoreFailed = true;
      }

      const result = await shimCallbackForModule(module, name, ...args);
      if (!isCurrentSession(owner, session)) return result;
      if (getSnapshot().phase === "error") {
        const error = new Error(`Bridge callback failed: ${name}`);
        if (session.continuation) await failRestore(owner, session, error);
        else await failSession(session, error);
        return result;
      }
      if (name === "shim_init_nhwindows") {
        options.dispatch({ type: "SESSION_RUNNING", sessionId: session.sessionId });
      } else if (name === "shim_exit_nhwindows") {
        options.dispatch({ type: "SESSION_EXITING", sessionId: session.sessionId });
        try {
          await (owner.storage as StorageService).flush();
          session.exitFlushed = true;
        } catch (error) {
          await failSession(session, error);
        }
      } else if (name === "shim_nhgetch" && session.continuation) {
        session.continuation = null;
      }
      return result;
    };
  }

  /** Complete a normal main return, retire its module, and prepare the next. */
  async function finishSession(
    owner: ModuleRecord,
    session: SessionRecord,
  ): Promise<void> {
    if (!isCurrentSession(owner, session)) return;
    if (!session.exitFlushed) {
      options.dispatch({ type: "SESSION_EXITING", sessionId: session.sessionId });
      await (owner.storage as StorageService).flush();
      session.exitFlushed = true;
    }
    await retireSession(owner, session, true);
  }

  /** Restore preserved bytes after the core rejected a Continue attempt. */
  async function failRestore(
    owner: ModuleRecord,
    session: SessionRecord,
    error: unknown,
  ): Promise<void> {
    if (!isCurrentSession(owner, session) || !session.continuation) return;
    const backup = session.continuation;
    try {
      await (owner.storage as StorageService).restoreOriginalSave(
        backup.path,
        backup.originalBytes,
      );
      await (owner.storage as StorageService).flush();
    } catch (restoreError) {
      error = restoreError;
    }
    await failSession(session, error);
  }

  /** Release one session and optionally prepare the next home module. */
  async function retireSession(
    owner: ModuleRecord,
    session: SessionRecord,
    prepareNext: boolean,
  ): Promise<void> {
    if (session.cleanupPromise) return session.cleanupPromise;
    session.cleanupPromise = Promise.resolve().then(async () => {
      if (session.closed) return;
      session.closed = true;
      owner.closed = true;
      delete callbackHost[session.callbackName];
      resetBridgeState();
      if (currentModule === owner) {
        currentModule = null;
        initializePromise = null;
        startPromise = null;
      }
      if (prepareNext && !disposed) {
        const nextModuleId = createModuleId();
        options.dispatch({
          type: "SESSION_CLEANUP_COMPLETED",
          sessionId: session.sessionId,
          nextModuleId,
        });
        await prepareModule(nextModuleId);
      }
    });
    return session.cleanupPromise;
  }

  /** Release the active session exactly once. */
  function cleanupSession(sessionId: string): Promise<void> {
    const owner = currentModule;
    const session = owner?.session;
    if (!owner || !session || session.sessionId !== sessionId) {
      return Promise.resolve();
    }
    return retireSession(owner, session, true);
  }

  /** Invalidate a failed session without reporting successful cleanup. */
  async function failSession(
    session: SessionRecord,
    error: unknown,
  ): Promise<void> {
    const owner = currentModule;
    if (!owner || !isCurrentSession(owner, session)) return;
    await retireSession(owner, session, false);
    options.dispatch({
      type: "SESSION_FATAL_ERROR",
      sessionId: session.sessionId,
      errorId: errorIdentifier(session.sessionId, error),
    });
  }

  /** Dispose the current manager without creating another module. */
  async function dispose(): Promise<void> {
    disposed = true;
    const owner = currentModule;
    if (!owner) return;
    if (owner.storage) {
      try {
        await owner.storage.flush();
      } catch {
        // Page teardown cannot present a recoverable storage workflow.
      }
    }
    if (owner.session) {
      await retireSession(owner, owner.session, false);
    } else {
      owner.closed = true;
      currentModule = null;
      initializePromise = null;
    }
  }

  /** Run an input operation only while a live session owns the bridge. */
  function withActiveSession(operation: () => void): void {
    const session = currentModule?.session;
    if (!session || session.closed) return;
    operation();
  }

  return {
    initialize,
    startSession,
    deleteSave,
    cleanupSession,
    dispose,
    getActiveSession: () => currentModule?.session?.handle ?? null,
    getHomePreparation: () => currentModule?.preparation ?? null,
    isWaitingForInput: () => {
      const session = currentModule?.session;
      return session !== null
        && session !== undefined
        && !session.closed
        && isWaitingForInput();
    },
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

/** Throw when a storage operation no longer belongs to the current Home. */
function assertCurrentHomeModule(record: ModuleRecord): void {
  if (record.closed || record.session) {
    throw new Error(`Module ${record.moduleId} no longer owns Home`);
  }
}

/** Throw when an asynchronous result belongs to an obsolete module. */
function assertCurrentModule(record: ModuleRecord): void {
  if (record.closed) throw new Error(`Module ${record.moduleId} is obsolete`);
}

/** Return whether a session still owns the current module. */
function isCurrentSession(
  owner: ModuleRecord,
  session: SessionRecord,
): boolean {
  return !owner.closed && !session.closed && owner.session === session;
}

/** Generate a non-sensitive module identity for the current tab. */
function defaultModuleId(): string {
  generatedModuleId += 1;
  return `module-${generatedModuleId}-${randomId()}`;
}

/** Generate a non-sensitive session identity for the current tab. */
function defaultSessionId(): string {
  generatedSessionId += 1;
  return `session-${generatedSessionId}-${randomId()}`;
}

/** Return a random suffix without incorporating player information. */
function randomId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
}

/** Convert a session ID into a legal, unique JavaScript callback identifier. */
function callbackNameFor(sessionId: string): string {
  const safeId = sessionId.replace(/[^A-Za-z0-9_$]/g, "_");
  return `blissCallback_${safeId}`;
}

/** Create a non-sensitive identifier for one lifecycle failure. */
function errorIdentifier(identity: string, error: unknown): string {
  const category = error instanceof Error && error.name
    ? error.name
    : "SessionError";
  return `${identity}:${category}`;
}

/** Detect Emscripten's successful ExitStatus rejection. */
function isSuccessfulExit(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    message?: unknown;
    name?: unknown;
    status?: unknown;
  };
  if (candidate.status === 0) return true;
  return candidate.name === "ExitStatus"
    && typeof candidate.message === "string"
    && /\bexit(?:ed)?\(0\)|status 0\b/i.test(candidate.message);
}

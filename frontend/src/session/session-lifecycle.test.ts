import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AppAction,
} from "../app/app-state";
import { createDiagnosticLog } from "../diagnostics/diagnostic-log";
import {
  NHW_MENU,
  PICK_ONE,
  getSnapshot,
  resetGameState,
} from "../game-state";
import type {
  EmscriptenModule,
  EndgameSummary,
} from "../nethack-bridge";
import {
  createSessionManager,
  type SessionHandle,
  type SessionManager,
  type SessionManagerOptions,
} from "./session-manager";
import { createDefaultProfile } from "../settings/profile";
import {
  GameLockConflictError,
  type GameLock,
} from "../concurrency/game-lock";
import type {
  SaveListEntry,
  StorageService,
} from "../storage/storage-service";
import { createIsolatedGameLock } from "./session-manager.test-fixtures";
import { isLocalWizardAcceptanceEnabled } from "./wizard-acceptance";

interface ModuleHarness {
  module: EmscriptenModule;
  memory: Uint8Array;
  readFile: ReturnType<typeof vi.fn<
    (
      path: string,
      options?: { encoding: "utf8" },
    ) => string | Uint8Array
  >>;
  writeFile: ReturnType<typeof vi.fn<
    (path: string, value: string | Uint8Array) => void
  >>;
  resolveMain: (value?: unknown) => void;
  rejectMain: (error: unknown) => void;
  writeString: (pointer: number, value: string) => void;
}

type ShimCallback = (name: string, ...args: unknown[]) => Promise<unknown>;

/**
 * Create the smallest Emscripten module needed by session lifecycle tests.
 * @param label - text returned for the shared pointer fixture.
 * @param sysconf - packaged configuration exposed by the fake filesystem.
 * @returns module, memory, and a UTF-8 fixture writer.
 */
function createModuleHarness(
  label: string,
  sysconf = "WIZARDS=\n",
): ModuleHarness {
  const memory = new Uint8Array(4096);
  const view = new DataView(memory.buffer);
  let nextAllocation = 1024;
  let resolveMain!: (value?: unknown) => void;
  let rejectMain!: (error: unknown) => void;
  const mainResult = new Promise<unknown>((resolve, reject) => {
    resolveMain = resolve;
    rejectMain = reject;
  });

  /**
   * Write a NUL-terminated string into this module's private memory.
   * @param pointer - destination address.
   * @param value - UTF-8 fixture text.
   */
  function writeString(pointer: number, value: string): void {
    const encoded = new TextEncoder().encode(value);
    memory.set(encoded, pointer);
    memory[pointer + encoded.length] = 0;
  }

  writeString(256, label);
  const readFile = vi.fn((
    _path: string,
    options?: { encoding: "utf8" },
  ) => options ? sysconf : new TextEncoder().encode(sysconf));
  const writeFile = vi.fn(
    (_path: string, _value: string | Uint8Array) => undefined,
  );
  const fileSystem = {
    analyzePath: vi.fn(() => ({ exists: true })),
    mkdir: vi.fn(),
    mount: vi.fn(),
    readFile,
    writeFile,
    syncfs: vi.fn((
      _populate: boolean,
      callback: (error: unknown | null) => void,
    ) => callback(null)),
  };
  const module: EmscriptenModule = {
    ccall: vi.fn((name: string) => name === "main" ? mainResult : undefined),
    getValue: vi.fn((pointer: number, type: string) => {
      if (type === "i8") return view.getInt8(pointer);
      if (type === "i16") return view.getInt16(pointer, true);
      return view.getInt32(pointer, true);
    }),
    setValue: vi.fn((pointer: number, value: number, type: string) => {
      if (type === "i8") view.setInt8(pointer, value);
      else if (type === "i16") view.setInt16(pointer, value, true);
      else view.setInt32(pointer, value, true);
    }),
    UTF8ToString: vi.fn((pointer: number) => {
      let end = pointer;
      while (memory[end] !== 0) end += 1;
      return new TextDecoder().decode(memory.subarray(pointer, end));
    }),
    stringToUTF8: vi.fn((value: string, pointer: number) => {
      writeString(pointer, value);
    }),
    _malloc: vi.fn((size: number) => {
      const pointer = nextAllocation;
      nextAllocation += Math.max(8, Math.ceil(size / 8) * 8);
      return pointer;
    }),
    _free: vi.fn(),
    ENV: {},
    FS: fileSystem,
  };
  return {
    module,
    memory,
    readFile,
    writeFile,
    resolveMain,
    rejectMain,
    writeString,
  };
}

/**
 * Read the callback registered by one session from its callback host.
 * @param callbackHost - host supplied to the manager.
 * @param handle - active session handle.
 * @returns the registered shim callback.
 */
function callbackFor(
  callbackHost: Record<string, unknown>,
  handle: SessionHandle,
): ShimCallback {
  const callback = callbackHost[handle.callbackName];
  expect(callback).toBeTypeOf("function");
  return callback as ShimCallback;
}

/**
 * Determine whether a Promise settles during the current microtask turn.
 * @param promise - Promise under observation.
 * @returns true when the Promise has settled.
 */
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.finally(() => {
    settled = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return settled;
}

/**
 * Install one deterministic Vite mode and browser URL for an acceptance test.
 * @param viteDev - value exposed as Vite's DEV flag.
 * @param href - complete browser URL exposed through global location.
 */
function useAcceptanceUrl(viteDev: boolean, href: string): void {
  vi.stubEnv("DEV", viteDev);
  vi.stubEnv("PROD", !viteDev);
  vi.stubGlobal("location", new URL(href));
}

/**
 * Decode one filesystem write into text without constraining its representation.
 * @param value - string or byte payload passed to Emscripten FS.
 * @returns decoded text.
 */
function decodeWrittenText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  throw new TypeError("Expected a string or Uint8Array filesystem payload");
}

/**
 * Create a manager with deterministic IDs and observable dependencies.
 * @param modules - modules returned by consecutive factory calls.
 * @returns manager and its test-visible dependency state.
 */
function createHarness(
  modules: EmscriptenModule[],
  diagnostics = createDiagnosticLog({
    productVersion: "prealpha-test",
    buildId: "test",
    console: { warn: vi.fn(), error: vi.fn() },
    createErrorId: () => "BH-TEST0001",
    storage: null,
  }),
  overrides: Partial<SessionManagerOptions> = {},
): {
  manager: SessionManager;
  callbackHost: Record<string, unknown>;
  dispatch: ReturnType<typeof vi.fn<(action: AppAction) => void>>;
  factory: ReturnType<typeof vi.fn<() => Promise<EmscriptenModule>>>;
} {
  let moduleId = 0;
  let sessionId = 0;
  const callbackHost: Record<string, unknown> = {};
  const dispatch = vi.fn<(action: AppAction) => void>();
  const factory = vi.fn(async () => {
    return modules.shift() ?? createModuleHarness("next-home").module;
  });
  const manager = createSessionManager({
    callbackHost,
    createModuleId: () => `module-${++moduleId}`,
    createSessionId: () => `session-${++sessionId}`,
    createStorageService: () => ({
      initialize: vi.fn(async () => true),
      refreshFromPersistent: vi.fn(async () => []),
      listSaves: vi.fn(async () => []),
      readSave: vi.fn(async () => new Uint8Array()),
      restoreOriginalSave: vi.fn(async () => undefined),
      deleteSave: vi.fn(async () => undefined),
      exportSave: vi.fn(async () => new Uint8Array()),
      exportAllSaves: vi.fn(async () => []),
      exportRanking: vi.fn(async () => new Uint8Array()),
      importRanking: vi.fn(async () => undefined),
      getRankingStatus: vi.fn(() => ({
        source: "packaged" as const,
        recovery: null,
      })),
      validateSave: vi.fn(async () => ({
        status: "damaged" as const,
        reason: "validation-failed" as const,
      })),
      importSave: vi.fn(async () => ({
        status: "imported" as const,
        path: "/save/0Ada",
      })),
      clearManagedFiles: vi.fn(async () => []),
      restoreManagedFiles: vi.fn(async () => undefined),
      flush: vi.fn(async () => undefined),
    }),
    diagnostics,
    dispatch,
    gameLock: createIsolatedGameLock(),
    moduleFactory: factory,
    wizardAcceptance: isLocalWizardAcceptanceEnabled(
      import.meta.env.DEV,
      globalThis.location,
    ),
    ...overrides,
  });
  return { manager, callbackHost, dispatch, factory };
}

beforeEach(() => {
  resetGameState();
  (globalThis as Record<string, unknown>).nethackGlobal = {
    globals: {
      flags: {},
      iflags: { wc2_hitpointbar: false, window_inited: false },
      svp: { plname: "" },
    },
    pointers: {},
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("cross-page game lock lifecycle", () => {
  it("locks and refreshes before reading one exported save", async () => {
    const module = createModuleHarness("module");
    const save: SaveListEntry = {
      path: "/save/0Ada",
      modifiedAt: 1,
      status: "ready",
      identity: {
        playerName: "Ada",
        role: "Wiz",
        race: "Hum",
        gender: "Fem",
        alignment: "Neu",
      },
    };
    let held = false;
    const requestedOperations: string[] = [];
    async function runExclusive<T>(
      _operation: Parameters<GameLock["runExclusive"]>[0],
      callback: () => Promise<T>,
    ): Promise<T> {
      requestedOperations.push(_operation);
      held = true;
      try {
        return await callback();
      } finally {
        held = false;
      }
    }
    const gameLock: GameLock = {
      supported: true,
      acquireLease: vi.fn(),
      runExclusive,
    };
    const refreshFromPersistent = vi.fn(async () => {
      expect(held).toBe(true);
      return [save];
    });
    const exportSave = vi.fn(async () => {
      expect(held).toBe(true);
      return Uint8Array.of(1);
    });
    const storage = {
      initialize: vi.fn(async () => true),
      refreshFromPersistent,
      listSaves: vi.fn(async () => [save]),
      readSave: vi.fn(async () => new Uint8Array()),
      restoreOriginalSave: vi.fn(async () => undefined),
      deleteSave: vi.fn(async () => undefined),
      exportSave,
      exportAllSaves: vi.fn(async () => []),
      exportRanking: vi.fn(async () => new Uint8Array()),
      importRanking: vi.fn(async () => undefined),
      getRankingStatus: vi.fn(() => ({
        source: "packaged" as const,
        recovery: null,
      })),
      validateSave: vi.fn(async () => ({
        status: "ready" as const,
        identity: save.identity,
      })),
      importSave: vi.fn(async () => ({
        status: "imported" as const,
        path: save.path,
      })),
      clearManagedFiles: vi.fn(async () => []),
      restoreManagedFiles: vi.fn(async () => undefined),
      flush: vi.fn(async () => undefined),
    } satisfies StorageService;
    const { manager } = createHarness(
      [module.module],
      undefined,
      { createStorageService: () => storage, gameLock },
    );
    await manager.initialize();

    await manager.exportSave("module-1", save.path);

    expect(requestedOperations).toEqual(["raw-save-export"]);
    expect(refreshFromPersistent).toHaveBeenCalledOnce();
    expect(exportSave).toHaveBeenCalledOnce();
    expect(held).toBe(false);
  });

  it("does not create a session or call main when another page owns the lock", async () => {
    const module = createModuleHarness("module");
    const gameLock: GameLock = {
      supported: true,
      acquireLease: vi.fn(async () => {
        throw new GameLockConflictError("new-game");
      }),
      runExclusive: vi.fn(),
    };
    const { manager, dispatch } = createHarness(
      [module.module],
      undefined,
      { gameLock },
    );
    await manager.initialize();
    dispatch.mockClear();

    await expect(manager.startSession()).rejects.toBeInstanceOf(
      GameLockConflictError,
    );
    expect(module.module.ccall).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SESSION_CREATED" }),
    );
  });

  it("refreshes after acquisition and releases only after session cleanup", async () => {
    const module = createModuleHarness("module");
    const release = vi.fn(async () => undefined);
    const gameLock: GameLock = {
      supported: true,
      acquireLease: vi.fn(async () => ({ release })),
      runExclusive: vi.fn(),
    };
    const refreshFromPersistent = vi.fn(async () => []);
    const storage = {
      initialize: vi.fn(async () => true),
      refreshFromPersistent,
      listSaves: vi.fn(async () => []),
      readSave: vi.fn(async () => new Uint8Array()),
      restoreOriginalSave: vi.fn(async () => undefined),
      deleteSave: vi.fn(async () => undefined),
      exportSave: vi.fn(async () => new Uint8Array()),
      exportAllSaves: vi.fn(async () => []),
      exportRanking: vi.fn(async () => new Uint8Array()),
      importRanking: vi.fn(async () => undefined),
      getRankingStatus: vi.fn(() => ({
        source: "packaged" as const,
        recovery: null,
      })),
      validateSave: vi.fn(async () => ({
        status: "damaged" as const,
        reason: "validation-failed" as const,
      })),
      importSave: vi.fn(async () => ({
        status: "imported" as const,
        path: "/save/0Ada",
      })),
      clearManagedFiles: vi.fn(async () => []),
      restoreManagedFiles: vi.fn(async () => undefined),
      flush: vi.fn(async () => undefined),
    } satisfies StorageService;
    const { manager } = createHarness(
      [module.module],
      undefined,
      {
        createStorageService: () => storage,
        gameLock,
      },
    );
    await manager.initialize();

    const session = await manager.startSession();
    expect(refreshFromPersistent).toHaveBeenCalledOnce();
    expect(refreshFromPersistent.mock.invocationCallOrder[0]).toBeLessThan(
      (module.module.ccall as ReturnType<typeof vi.fn>)
        .mock.invocationCallOrder.at(-1) as number,
    );
    expect(release).not.toHaveBeenCalled();

    await manager.cleanupSession(session.sessionId);
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not flush an idle prepared module during disposal", async () => {
    const module = createModuleHarness("module");
    const flush = vi.fn(async () => undefined);
    const { manager } = createHarness(
      [module.module],
      undefined,
      {
        createStorageService: () => ({
          initialize: vi.fn(async () => true),
          refreshFromPersistent: vi.fn(async () => []),
          listSaves: vi.fn(async () => []),
          readSave: vi.fn(async () => new Uint8Array()),
          restoreOriginalSave: vi.fn(async () => undefined),
          deleteSave: vi.fn(async () => undefined),
          exportSave: vi.fn(async () => new Uint8Array()),
          exportAllSaves: vi.fn(async () => []),
          exportRanking: vi.fn(async () => new Uint8Array()),
          importRanking: vi.fn(async () => undefined),
          getRankingStatus: vi.fn(() => ({
            source: "packaged" as const,
            recovery: null,
          })),
          validateSave: vi.fn(async () => ({
            status: "damaged" as const,
            reason: "validation-failed" as const,
          })),
          importSave: vi.fn(async () => ({
            status: "imported" as const,
            path: "/save/0Ada",
          })),
          clearManagedFiles: vi.fn(async () => []),
          restoreManagedFiles: vi.fn(async () => undefined),
          flush,
        }),
      },
    );
    await manager.initialize();

    await manager.dispose();
    expect(flush).not.toHaveBeenCalled();
  });
});

describe("session creation and startup", () => {
  it("installs the latest NetHack settings before creating a session or calling main", async () => {
    const module = createModuleHarness("module");
    const settings = createDefaultProfile().nethack;
    settings.numberPad = 4;
    const installRuntimeConfig = vi.fn();
    const { manager, dispatch } = createHarness(
      [module.module],
      undefined,
      { installRuntimeConfig },
    );

    await manager.initialize();
    dispatch.mockClear();
    await manager.startSession({ kind: "new", settings });

    expect(installRuntimeConfig).toHaveBeenCalledWith(module.module, settings);
    expect(installRuntimeConfig.mock.invocationCallOrder[0]).toBeLessThan(
      (module.module.ccall as ReturnType<typeof vi.fn>)
        .mock.invocationCallOrder[0],
    );
    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      "SESSION_CREATED",
    ]);
  });

  it("terminates the prepared module without calling main when rc installation fails", async () => {
    const module = createModuleHarness("module");
    const failure = new Error("rc write failed");
    const installRuntimeConfig = vi.fn(() => {
      throw failure;
    });
    const { manager, dispatch } = createHarness(
      [module.module],
      undefined,
      { installRuntimeConfig },
    );

    await manager.initialize();
    dispatch.mockClear();
    await expect(manager.startSession({
      kind: "new",
      settings: createDefaultProfile().nethack,
    })).rejects.toBe(failure);

    expect(module.module.ccall).not.toHaveBeenCalled();
    expect(manager.getActiveSession()).toBeNull();
    expect(dispatch).toHaveBeenCalledWith({
      type: "MODULE_FATAL_ERROR",
      moduleId: "module-1",
      errorId: "BH-TEST0001",
    });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "SESSION_CREATED",
    }));
  });

  it("discards a failed module factory result before returning Home", async () => {
    const replacement = createModuleHarness("replacement");
    const { manager, dispatch, factory } = createHarness([replacement.module]);
    factory.mockRejectedValueOnce(new TypeError("module loader failed"));

    await expect(manager.initialize()).rejects.toThrow("module loader failed");
    expect(dispatch).toHaveBeenCalledWith({
      type: "MODULE_FATAL_ERROR",
      moduleId: "module-1",
      errorId: "BH-TEST0001",
    });

    await expect(manager.recoverHome()).resolves.toMatchObject({
      moduleId: "module-2",
      storageAvailable: true,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "RETURN_HOME",
      moduleId: "module-2",
    });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent starts and calls one module main exactly once", async () => {
    const firstModule = createModuleHarness("first");
    const { manager, dispatch, factory } = createHarness([firstModule.module]);

    const firstStart = manager.startSession();
    const duplicateStart = manager.startSession();

    expect(duplicateStart).toBe(firstStart);
    const [first, duplicate] = await Promise.all([firstStart, duplicateStart]);
    expect(duplicate).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(firstModule.module.ccall).toHaveBeenCalledWith(
      "main",
      "number",
      [],
      [],
      { async: true },
    );
    expect(firstModule.module.ccall).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      "MODULE_LOADING",
      "STORAGE_LOADING",
      "HOME_READY",
      "SESSION_CREATED",
    ]);
  });

  it("creates a fresh module, ID, and callback for each completed game", async () => {
    const firstModule = createModuleHarness("first");
    const secondModule = createModuleHarness("second");
    const { manager, callbackHost, factory } = createHarness([
      firstModule.module,
      secondModule.module,
    ]);

    const first = await manager.startSession();
    const firstCallback = callbackFor(callbackHost, first);
    await manager.cleanupSession(first.sessionId);
    expect(callbackHost[first.callbackName]).toBeUndefined();

    const second = await manager.startSession();

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.callbackName).not.toBe(first.callbackName);
    expect(callbackFor(callbackHost, second)).not.toBe(firstCallback);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(firstModule.module.ccall).toHaveBeenCalledTimes(2);
    expect(secondModule.module.ccall).toHaveBeenCalledWith(
      "main",
      "number",
      [],
      [],
      { async: true },
    );
  });

  it("registers globally unique callback names and removes each on cleanup", async () => {
    const firstModule = createModuleHarness("first");
    const secondModule = createModuleHarness("second");
    const { manager, callbackHost } = createHarness([
      firstModule.module,
      secondModule.module,
    ]);

    const first = await manager.startSession();
    expect(first.callbackName).not.toBe("blissCallback");
    expect(callbackHost[first.callbackName]).toBeTypeOf("function");
    await manager.cleanupSession(first.sessionId);
    expect(first.callbackName in callbackHost).toBe(false);

    const second = await manager.startSession();
    expect(second.callbackName).not.toBe("blissCallback");
    expect(second.callbackName).not.toBe(first.callbackName);
    await manager.cleanupSession(second.sessionId);
    expect(second.callbackName in callbackHost).toBe(false);
  });
});

describe("local wizard acceptance startup", () => {
  it("enables exact loopback wizard queries only in fixture production builds", () => {
    const fixtureAwareGate = isLocalWizardAcceptanceEnabled as unknown as (
      development: boolean,
      location: Pick<Location, "hostname" | "search"> | undefined,
      e2eFixtures: boolean,
    ) => boolean;
    const loopback = new URL("http://127.0.0.1/?acceptance=wizard");

    expect(fixtureAwareGate(false, loopback, true)).toBe(true);
    expect(fixtureAwareGate(false, loopback, false)).toBe(false);
    expect(fixtureAwareGate(
      false,
      new URL("https://example.test/?acceptance=wizard"),
      true,
    )).toBe(false);
    expect(fixtureAwareGate(
      false,
      new URL(
        "http://127.0.0.1/?acceptance=wizard&acceptance=wizard",
      ),
      true,
    )).toBe(false);
  });

  it.each([
    {
      hostname: "localhost",
      href: "http://localhost/?acceptance=wizard",
    },
    {
      hostname: "127.0.0.1",
      href: "http://127.0.0.1/?acceptance=wizard",
    },
    {
      hostname: "[::1]",
      href: "http://[::1]/?acceptance=wizard",
    },
  ])(
    "enables on Vite DEV at $hostname and patches only WIZARDS",
    async ({ href }) => {
      const packagedSysconf = [
        "# packaged settings",
        "WIZARDS=alice bob",
        "EXPLORERS=*",
        "",
      ].join("\n");
      const expectedSysconf = [
        "# packaged settings",
        "WIZARDS=*",
        "EXPLORERS=*",
        "",
      ].join("\n");
      const module = createModuleHarness("module", packagedSysconf);
      useAcceptanceUrl(true, href);
      const { manager } = createHarness([module.module]);

      await manager.startSession();

      expect(module.readFile.mock.calls.some(
        ([path]) => path === "/sysconf",
      )).toBe(true);
      expect(module.writeFile).toHaveBeenCalledOnce();
      const [path, value] = module.writeFile.mock.calls[0]!;
      expect(path).toBe("/sysconf");
      expect(decodeWrittenText(value)).toBe(expectedSysconf);
      const ccall = module.module.ccall as ReturnType<typeof vi.fn>;
      const mainCallIndex = ccall.mock.calls.findIndex(
        ([name]) => name === "main",
      );
      expect(mainCallIndex).toBeGreaterThanOrEqual(0);
      expect(module.writeFile.mock.invocationCallOrder[0]).toBeLessThan(
        ccall.mock.invocationCallOrder[mainCallIndex]!,
      );
    },
  );

  it.each([
    {
      condition: "Vite production",
      viteDev: false,
      href: "http://localhost/?acceptance=wizard",
    },
    {
      condition: "a non-loopback hostname",
      viteDev: true,
      href: "https://example.test/?acceptance=wizard",
    },
    {
      condition: "a loopback lookalike hostname",
      viteDev: true,
      href: "https://localhost.example.test/?acceptance=wizard",
    },
    {
      condition: "a non-matching query value",
      viteDev: true,
      href: "http://localhost/?acceptance=Wizard",
    },
    {
      condition: "duplicate matching query values",
      viteDev: true,
      href: "http://localhost/?acceptance=wizard&acceptance=wizard",
    },
  ])(
    "fails closed for $condition and preserves ordinary main",
    async ({ viteDev, href }) => {
      const module = createModuleHarness("module", "WIZARDS=alice\n");
      useAcceptanceUrl(viteDev, href);
      const { manager } = createHarness([module.module]);

      await manager.startSession();

      expect(module.readFile).not.toHaveBeenCalled();
      expect(module.writeFile).not.toHaveBeenCalled();
      expect(module.module.ccall).toHaveBeenCalledWith(
        "main",
        "number",
        [],
        [],
        { async: true },
      );
    },
  );

  it.each([
    {
      session: "wizard acceptance",
      wizardAcceptance: true,
      expectedStyle: "original",
    },
    {
      session: "ordinary",
      wizardAcceptance: false,
      expectedStyle: "blisshack",
    },
  ] as const)(
    "uses $expectedStyle character setup for a $session session with a BlissHack profile",
    async ({ wizardAcceptance, expectedStyle }) => {
      const module = createModuleHarness("module", "WIZARDS=alice\n");
      const profile = createDefaultProfile();
      profile.interface.characterSetupStyle = "blisshack";
      const setCharacterSetupContext = vi.fn();
      const { manager } = createHarness(
        [module.module],
        undefined,
        {
          installRuntimeConfig: vi.fn(),
          loadProfile: () => profile,
          setCharacterSetupContext,
          wizardAcceptance,
        },
      );

      await manager.startSession();

      expect(setCharacterSetupContext).toHaveBeenCalledOnce();
      expect(setCharacterSetupContext).toHaveBeenCalledWith(
        expect.objectContaining({ style: expectedStyle }),
      );
    },
  );

  it.each([
    {
      assignmentCount: "zero",
      sysconf: "# packaged settings\nEXPLORERS=*\n",
    },
    {
      assignmentCount: "multiple",
      sysconf: "WIZARDS=alice\nWIZARDS=bob\n",
    },
  ])(
    "rejects $assignmentCount WIZARDS assignments without calling main",
    async ({ sysconf }) => {
      const module = createModuleHarness("module", sysconf);
      useAcceptanceUrl(true, "http://localhost/?acceptance=wizard");
      const { manager } = createHarness([module.module]);

      await expect(manager.startSession()).rejects.toThrow(
        "Wizard acceptance requires exactly one WIZARDS assignment",
      );

      const ccall = module.module.ccall as ReturnType<typeof vi.fn>;
      expect(ccall.mock.calls.filter(([name]) => name === "main")).toHaveLength(
        0,
      );
      expect(module.writeFile).not.toHaveBeenCalled();
    },
  );

  it("passes nethack -D through a complete argv vector", async () => {
    const module = createModuleHarness("module", "WIZARDS=alice\n");
    useAcceptanceUrl(true, "http://localhost/?acceptance=wizard");
    const { manager } = createHarness([module.module]);

    await manager.startSession();

    const ccall = module.module.ccall as ReturnType<typeof vi.fn>;
    const mainCall = ccall.mock.calls.find(([name]) => name === "main");
    if (!mainCall) throw new Error("Expected main to be called");
    expect(mainCall[1]).toBe("number");
    expect(mainCall[2]).toEqual(["number", "number"]);
    expect(mainCall[4]).toEqual({ async: true });
    const [argc, argv] = mainCall[3] as [number, number];
    expect(argc).toBe(2);
    const programPointer = Number(module.module.getValue(argv, "*"));
    const flagPointer = Number(module.module.getValue(argv + 4, "*"));
    expect(module.module.getValue(argv + 8, "*")).toBe(0);
    expect(module.module.UTF8ToString(programPointer)).toBe("nethack");
    expect(module.module.UTF8ToString(flagPointer)).toBe("-D");
    expect(module.module._malloc).toHaveBeenNthCalledWith(1, 8);
    expect(module.module._malloc).toHaveBeenNthCalledWith(2, 3);
    expect(module.module._malloc).toHaveBeenNthCalledWith(3, 12);
  });

  it.each([
    {
      settlement: "resolves",
      settle(module: ModuleHarness) {
        module.resolveMain();
      },
    },
    {
      settlement: "rejects",
      settle(module: ModuleHarness) {
        module.rejectMain(new Error("main rejected"));
      },
    },
  ])(
    "keeps argv alive until main $settlement, then frees every allocation",
    async ({ settle }) => {
      const module = createModuleHarness("module", "WIZARDS=alice\n");
      useAcceptanceUrl(true, "http://localhost/?acceptance=wizard");
      const { manager } = createHarness([module.module]);

      await manager.startSession();

      const malloc = module.module._malloc as ReturnType<typeof vi.fn>;
      const free = module.module._free as ReturnType<typeof vi.fn>;
      expect(malloc).toHaveBeenCalledTimes(3);
      expect(free).not.toHaveBeenCalled();
      const allocated = malloc.mock.results.map(({ value }) => Number(value));

      settle(module);

      await vi.waitFor(() => {
        expect(free).toHaveBeenCalledTimes(allocated.length);
      });
      const freed = free.mock.calls.map(([pointer]) => Number(pointer));
      expect(freed.toSorted((left, right) => left - right)).toEqual(
        allocated.toSorted((left, right) => left - right),
      );
    },
  );

  it("frees every argv allocation when main ccall throws synchronously", async () => {
    const module = createModuleHarness("module", "WIZARDS=alice\n");
    const failure = new Error("main ccall failed");
    const ccall = module.module.ccall as ReturnType<typeof vi.fn>;
    ccall.mockImplementation((name: string) => {
      if (name === "main") throw failure;
      return undefined;
    });
    useAcceptanceUrl(true, "http://localhost/?acceptance=wizard");
    const { manager } = createHarness([module.module]);

    await expect(manager.startSession()).rejects.toBe(failure);

    const malloc = module.module._malloc as ReturnType<typeof vi.fn>;
    const free = module.module._free as ReturnType<typeof vi.fn>;
    const allocated = malloc.mock.results.map(({ value }) => Number(value));
    expect(allocated).toHaveLength(3);
    expect(free.mock.calls.map(([pointer]) => Number(pointer))).toEqual(
      allocated,
    );
  });
});

describe("session callback isolation", () => {
  it("ignores an old callback after a second session becomes active", async () => {
    const firstModule = createModuleHarness("first");
    const secondModule = createModuleHarness("second");
    const { manager, callbackHost, dispatch } = createHarness([
      firstModule.module,
      secondModule.module,
    ]);
    const first = await manager.startSession();
    const staleCallback = callbackFor(callbackHost, first);
    await manager.cleanupSession(first.sessionId);
    const second = await manager.startSession();
    dispatch.mockClear();

    await staleCallback("shim_init_nhwindows", 0, 0);
    await staleCallback("shim_raw_print", "stale message");

    expect(dispatch).not.toHaveBeenCalled();
    expect(getSnapshot().messages).toEqual([]);
    await callbackFor(callbackHost, second)("shim_init_nhwindows", 0, 0);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SESSION_RUNNING",
      sessionId: second.sessionId,
    });
  });

  it("decodes callback pointers only with the module captured by that session", async () => {
    const firstModule = createModuleHarness("first-module");
    const secondModule = createModuleHarness("second-module");
    const { manager, callbackHost } = createHarness([
      firstModule.module,
      secondModule.module,
    ]);

    const first = await manager.startSession();
    await callbackFor(callbackHost, first)("shim_preference_update", 256);
    expect(firstModule.module.UTF8ToString).toHaveBeenCalledWith(256);
    expect(secondModule.module.UTF8ToString).not.toHaveBeenCalled();
    await manager.cleanupSession(first.sessionId);

    const second = await manager.startSession();
    await callbackFor(callbackHost, second)("shim_preference_update", 256);
    expect(secondModule.module.UTF8ToString).toHaveBeenCalledWith(256);
    expect(getSnapshot().lastPreference).toBe("second-module");
  });

  it("records the first endgame collector fallback exactly once", async () => {
    const module = createModuleHarness("module");
    const profile = createDefaultProfile();
    profile.interface.endgameStyle = "blisshack";
    const diagnostics = createDiagnosticLog({
      productVersion: "prealpha-test",
      buildId: "test",
      console: { warn: vi.fn(), error: vi.fn() },
      storage: null,
    });
    const { manager, callbackHost } = createHarness(
      [module.module],
      diagnostics,
      {
        installRuntimeConfig: vi.fn(),
        loadProfile: () => profile,
      },
    );
    const session = await manager.startSession();
    const callback = callbackFor(callbackHost, session);
    const globals = globalThis.nethackGlobal?.globals;
    expect(globals).toBeDefined();
    if (globals) {
      globals.program_state = { gameover: true };
    }
    await expect(callback(
      "shim_yn_function",
      "Do you want your possessions identified?",
      "ynq",
      "n".charCodeAt(0),
    )).resolves.toBe("y".charCodeAt(0));

    for (const message of ["a - an item", "a - another item"]) {
      const messageMenu = callback(
        "shim_message_menu",
        "a".charCodeAt(0),
        PICK_ONE,
        message,
      );
      expect(await isSettled(messageMenu)).toBe(false);
      manager.sendKey("a".charCodeAt(0));
      await expect(messageMenu).resolves.toBe("a".charCodeAt(0));
    }

    const fallbackEvents = diagnostics.events().filter(
      ({ event }) => event === "endgame.collection_fallback",
    );
    expect(fallbackEvents).toHaveLength(1);
    expect(fallbackEvents[0]).toMatchObject({
      level: "warning",
      area: "bridge",
      event: "endgame.collection_fallback",
      moduleId: session.moduleId,
      sessionId: session.sessionId,
      detail: {
        fallbackReason: "unexpected-message-menu",
      },
    });
  });
});

describe("session cleanup", () => {
  it("flushes once more after main returns before retiring the session", async () => {
    const module = createModuleHarness("module");
    const nextModule = createModuleHarness("next");
    const diagnostics = createDiagnosticLog({
      productVersion: "alpha-2.2",
      buildId: "test",
      console: { warn: vi.fn(), error: vi.fn() },
      storage: null,
    });
    let mainReturned = false;
    const flushPhases: string[] = [];
    const flush = vi.fn(async () => {
      flushPhases.push(mainReturned ? "post-main" : "exit-callback");
    });
    const storage = {
      initialize: vi.fn(async () => true),
      refreshFromPersistent: vi.fn(async () => []),
      listSaves: vi.fn(async () => []),
      readSave: vi.fn(async () => new Uint8Array()),
      restoreOriginalSave: vi.fn(async () => undefined),
      deleteSave: vi.fn(async () => undefined),
      exportSave: vi.fn(async () => new Uint8Array()),
      exportAllSaves: vi.fn(async () => []),
      exportRanking: vi.fn(async () => new Uint8Array()),
      importRanking: vi.fn(async () => undefined),
      getRankingStatus: vi.fn(() => ({
        source: "packaged" as const,
        recovery: null,
      })),
      validateSave: vi.fn(async () => ({
        status: "damaged" as const,
        reason: "validation-failed" as const,
      })),
      importSave: vi.fn(async () => ({
        status: "imported" as const,
        path: "/save/0Ada",
      })),
      clearManagedFiles: vi.fn(async () => []),
      restoreManagedFiles: vi.fn(async () => undefined),
      flush,
    } satisfies StorageService;
    const { manager, callbackHost, dispatch } = createHarness(
      [module.module, nextModule.module],
      diagnostics,
      { createStorageService: () => storage },
    );
    const session = await manager.startSession();
    const callback = callbackFor(callbackHost, session);

    await callback("shim_exit_nhwindows", "goodbye");
    expect(flushPhases).toEqual(["exit-callback"]);

    mainReturned = true;
    module.resolveMain();
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: "SESSION_CLEANUP_COMPLETED",
        sessionId: session.sessionId,
      }));
    });

    expect(flushPhases).toEqual(["exit-callback", "post-main"]);
    const events = diagnostics.events();
    const flushIndexes = events.flatMap((event, index) =>
      event.event === "storage.flush_completed"
        && event.sessionId === session.sessionId
        ? [index]
        : []
    );
    const cleanupIndex = events.findIndex((event) =>
      event.event === "session.cleaned"
        && event.sessionId === session.sessionId
    );
    const nextModuleIndex = events.findIndex((event, index) =>
      index > cleanupIndex
        && event.event === "module.loading"
        && event.sessionId === null
    );
    expect(flushIndexes).toHaveLength(2);
    expect(flushIndexes[1]).toBeLessThan(cleanupIndex);
    expect(cleanupIndex).toBeLessThan(nextModuleIndex);
    expect(callbackHost[session.callbackName]).toBeUndefined();
  });

  it("retires the session and prepares Home before publishing its result", async () => {
    const module = createModuleHarness("module");
    const nextModule = createModuleHarness("next");
    const profile = createDefaultProfile();
    profile.interface.endgameStyle = "blisshack";
    const { manager, callbackHost, dispatch } = createHarness(
      [module.module, nextModule.module],
      undefined,
      {
        installRuntimeConfig: vi.fn(),
        loadProfile: () => profile,
      },
    );
    const session = await manager.startSession();
    const callback = callbackFor(callbackHost, session);
    const globals = globalThis.nethackGlobal?.globals;
    expect(globals).toBeDefined();
    if (globals) {
      globals.program_state = { gameover: true };
    }

    const message = await callback("shim_create_nhwindow", 1) as number;
    const status = await callback("shim_create_nhwindow", 2) as number;
    const map = await callback("shim_create_nhwindow", 3) as number;
    await callback("shim_yn_function", "Possessions?", "ynq", 110);
    const disclosure = await callback("shim_create_nhwindow", 5) as number;
    await callback("shim_putstr", disclosure, 0, "Inventory");
    await callback("shim_display_nhwindow", disclosure, true);
    await callback("shim_destroy_nhwindow", map);
    await callback("shim_destroy_nhwindow", status);
    await callback("shim_destroy_nhwindow", message);
    const summaryWindow = await callback("shim_create_nhwindow", 5) as number;
    await callback("shim_putstr", summaryWindow, 0, "You died.");
    await callback("shim_display_nhwindow", summaryWindow, true);

    dispatch.mockClear();
    module.resolveMain();

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: "SESSION_COMPLETED",
        sessionId: session.sessionId,
        nextModuleId: "module-2",
        summary: expect.any(Object) as EndgameSummary,
      }));
    });
    const actionTypes = dispatch.mock.calls.map(([action]) => action.type);
    expect(actionTypes.indexOf("HOME_READY")).toBeLessThan(
      actionTypes.indexOf("SESSION_COMPLETED"),
    );
    expect(callbackHost[session.callbackName]).toBeUndefined();
    expect(manager.getActiveSession()).toBeNull();
  });

  it("invalidates callback and input ownership after a fatal failure", async () => {
    const module = createModuleHarness("module");
    const { manager, callbackHost, dispatch } = createHarness([module.module]);
    const session = await manager.startSession();
    const staleCallback = callbackFor(callbackHost, session);
    const pendingInput = staleCallback("shim_nhgetch");
    expect(manager.isWaitingForInput()).toBe(true);

    await manager.reportFatal(
      "browser",
      "browser.unhandled_rejection",
      new Error("fatal"),
    );

    expect(callbackHost[session.callbackName]).toBeUndefined();
    expect(manager.getActiveSession()).toBeNull();
    expect(manager.isWaitingForInput()).toBe(false);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SESSION_FATAL_ERROR",
      sessionId: session.sessionId,
      errorId: "BH-TEST0001",
    });

    dispatch.mockClear();
    manager.sendKey("h".charCodeAt(0));
    await staleCallback("shim_init_nhwindows");
    expect(await isSettled(pendingInput)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("treats Emscripten exit status zero as successful termination", async () => {
    const module = createModuleHarness("module");
    const { manager, callbackHost, dispatch } = createHarness([module.module]);
    const session = await manager.startSession();
    dispatch.mockClear();

    module.rejectMain({ name: "ExitStatus", status: 0 });

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: "SESSION_CLEANUP_COMPLETED",
        sessionId: session.sessionId,
        nextModuleId: expect.any(String),
      }));
    });
    expect(callbackHost[session.callbackName]).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "SESSION_FATAL_ERROR",
    }));
  });

  it.each([
    {
      name: "menu",
      begin: async (callback: ShimCallback) => {
        const menu = await callback("shim_create_nhwindow", NHW_MENU) as number;
        await callback("shim_start_menu", menu, 0);
        return { pending: callback("shim_select_menu", menu, 1, 512) };
      },
      send: (manager: SessionManager) => {
        manager.submitMenuSelection([{ itemIndex: 0, count: 1 }]);
      },
    },
    {
      name: "yn",
      begin: (callback: ShimCallback) => Promise.resolve({
        pending: callback("shim_yn_function", "Really?", "yn", 110),
      }),
      send: (manager: SessionManager) => {
        manager.sendKey("y".charCodeAt(0));
      },
    },
    {
      name: "line",
      begin: (callback: ShimCallback) => Promise.resolve({
        pending: callback("shim_getlin", "Name:", 512),
      }),
      send: (manager: SessionManager) => {
        manager.submitLine("late");
      },
    },
    {
      name: "key",
      begin: (callback: ShimCallback) => Promise.resolve({
        pending: callback("shim_nhgetch"),
      }),
      send: (manager: SessionManager) => {
        manager.sendKey("h".charCodeAt(0));
      },
    },
  ])("clears pending $name input and ignores input after exit", async ({
    begin,
    send,
  }) => {
    const module = createModuleHarness("module");
    const { manager, callbackHost } = createHarness([module.module]);
    const session = await manager.startSession();
    const { pending } = await begin(callbackFor(callbackHost, session));
    expect(manager.isWaitingForInput()).toBe(true);

    await manager.cleanupSession(session.sessionId);
    send(manager);

    expect(manager.isWaitingForInput()).toBe(false);
    expect(getSnapshot().inputRequest).toBeNull();
    expect(getSnapshot().modal).toBeNull();
    expect(await isSettled(pending)).toBe(false);
  });

  it("clears queued typeahead before the next game", async () => {
    const firstModule = createModuleHarness("first");
    const secondModule = createModuleHarness("second");
    const { manager, callbackHost } = createHarness([
      firstModule.module,
      secondModule.module,
    ]);
    const first = await manager.startSession();
    const firstCallback = callbackFor(callbackHost, first);
    const accepted = firstCallback("shim_nhgetch");
    manager.sendKey("l".charCodeAt(0));
    await expect(accepted).resolves.toBe("l".charCodeAt(0));
    manager.sendKey("h".charCodeAt(0));
    await manager.cleanupSession(first.sessionId);

    const second = await manager.startSession();
    const nextInput = callbackFor(callbackHost, second)("shim_nhgetch");
    expect(await isSettled(nextInput)).toBe(false);
    manager.sendKey("j".charCodeAt(0));
    await expect(nextInput).resolves.toBe("j".charCodeAt(0));
  });

  it("is idempotent and reports cleanup completion once", async () => {
    const module = createModuleHarness("module");
    const { manager, callbackHost, dispatch } = createHarness([module.module]);
    const session = await manager.startSession();

    await Promise.all([
      manager.cleanupSession(session.sessionId),
      manager.cleanupSession(session.sessionId),
    ]);
    await manager.cleanupSession(session.sessionId);

    expect(callbackHost[session.callbackName]).toBeUndefined();
    expect(dispatch.mock.calls.filter(
      ([action]) => action.type === "SESSION_CLEANUP_COMPLETED",
    )).toHaveLength(1);
  });

});

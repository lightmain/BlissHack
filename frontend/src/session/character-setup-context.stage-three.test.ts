import { describe, expect, it, vi } from "vitest";
import type { AppAction } from "../app/app-state";
import type { EmscriptenModule } from "../nethack-bridge";
import { createDefaultProfile } from "../settings/profile";
import type {
  SaveIdentity,
  SaveListEntry,
  StorageService,
} from "../storage/storage-service";
import {
  createSessionManager,
  type SessionManagerOptions,
} from "./session-manager";
import { createIsolatedGameLock } from "./session-manager.test-fixtures";

interface CharacterSetupStartupContext {
  moduleId: string;
  sessionId: string;
  style: "original" | "blisshack";
  saveIdentities: readonly SaveIdentity[];
}

/**
 * Create the minimum module required to start a session without running C.
 * @returns an observable Emscripten module with a permanently pending main.
 */
function createModule(): EmscriptenModule {
  return {
    ccall: vi.fn((name: string) =>
      name === "main" ? new Promise<unknown>(() => undefined) : undefined),
    getValue: vi.fn(() => 0),
    setValue: vi.fn(),
    UTF8ToString: vi.fn(() => ""),
    stringToUTF8: vi.fn(),
    _malloc: vi.fn(() => 1024),
    _free: vi.fn(),
    ENV: {},
    FS: {
      analyzePath: vi.fn(() => ({ exists: true })),
      mkdir: vi.fn(),
      mount: vi.fn(),
      readFile: vi.fn(() => new Uint8Array()),
      syncfs: vi.fn((_populate, callback) => callback(null)),
    },
  };
}

/**
 * Create a ready storage service which returns the supplied save catalog.
 * @param saves - save records enumerated before the new session starts.
 * @returns an isolated storage service test double.
 */
function createStorage(saves: SaveListEntry[]): StorageService {
  return {
    initialize: vi.fn(async () => true),
    refreshFromPersistent: vi.fn(async () => saves),
    listSaves: vi.fn(async () => saves),
    readSave: vi.fn(async () => new Uint8Array()),
    restoreOriginalSave: vi.fn(async () => undefined),
    deleteSave: vi.fn(async () => undefined),
    exportSave: vi.fn(async () => new Uint8Array()),
    exportAllSaves: vi.fn(async () => []),
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
  };
}

describe("stage-three character setup startup context", () => {
  /**
   * Verify that every ready save contributes its complete identity before main.
   */
  it("passes complete SaveIdentity records into the session startup context", async () => {
    const ada: SaveIdentity = {
      playerName: "Ada",
      role: "Wiz",
      race: "Hum",
      gender: "Fem",
      alignment: "Neu",
    };
    const bob: SaveIdentity = {
      playerName: "Bob",
      role: "Bar",
      race: "Orc",
      gender: "Mal",
      alignment: "Cha",
    };
    const saves: SaveListEntry[] = [
      {
        path: "/save/0Ada",
        modifiedAt: 10,
        status: "ready",
        identity: ada,
      },
      {
        path: "/save/0Broken",
        modifiedAt: 20,
        status: "damaged",
        reason: "truncated",
      },
      {
        path: "/save/0Bob",
        modifiedAt: 30,
        status: "ready",
        identity: bob,
      },
    ];
    const profile = createDefaultProfile();
    profile.interface.characterSetupStyle = "blisshack";
    const module = createModule();
    const setCharacterSetupContext = vi.fn<
      (context: CharacterSetupStartupContext) => void
    >();
    const options = {
      callbackHost: {},
      createModuleId: () => "module-1",
      createSessionId: () => "session-1",
      createStorageService: () => createStorage(saves),
      dispatch: vi.fn<(action: AppAction) => void>(),
      gameLock: createIsolatedGameLock(),
      installRuntimeConfig: vi.fn(),
      loadProfile: () => profile,
      moduleFactory: vi.fn(async () => module),
      setCharacterSetupContext,
    } satisfies SessionManagerOptions & {
      setCharacterSetupContext(
        context: CharacterSetupStartupContext,
      ): void;
    };
    const manager = createSessionManager(options);

    await manager.initialize();
    await manager.startSession({ kind: "new" });

    expect(setCharacterSetupContext).toHaveBeenCalledOnce();
    expect(setCharacterSetupContext).toHaveBeenCalledWith({
      moduleId: "module-1",
      sessionId: "session-1",
      style: "blisshack",
      saveIdentities: [ada, bob],
    });
    expect(setCharacterSetupContext.mock.invocationCallOrder[0]).toBeLessThan(
      Number(
        (module.ccall as ReturnType<typeof vi.fn>)
          .mock.invocationCallOrder.at(-1),
      ),
    );
  });
});

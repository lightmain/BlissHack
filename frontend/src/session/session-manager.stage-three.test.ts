import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppAction } from "../app/app-state";
import { resetGameState } from "../game-state";
import type { EmscriptenModule } from "../nethack-bridge";
import {
  createSessionManager,
  type SessionManagerOptions,
} from "./session-manager";

interface SaveIdentity {
  playerName: string;
  role: string;
  race: string;
  gender: string;
  alignment: string;
}

interface ReadySave {
  path: string;
  modifiedAt: number | null;
  status: "ready";
  identity: SaveIdentity;
}

interface ImportRequest {
  bytes: Uint8Array;
  modifiedAt: number | null;
  overwrite: boolean;
}

interface Conflict {
  status: "conflict";
  path: string;
  existing: { identity: SaveIdentity; modifiedAt: number | null };
  incoming: { identity: SaveIdentity; modifiedAt: number | null };
}

interface StageThreeManager {
  initialize(): Promise<{
    moduleId: string;
    saves: ReadySave[];
    storageAvailable: boolean;
  }>;
  importSave(
    moduleId: string,
    request: ImportRequest,
  ): Promise<Conflict | {
    status: "imported";
    preparation: {
      moduleId: string;
      saves: ReadySave[];
      storageAvailable: boolean;
    };
  }>;
  exportSave(
    moduleId: string,
    path: string,
  ): Promise<{
    bytes: Uint8Array;
    fileName: string;
    mimeType: "application/octet-stream";
  }>;
}

const adaIdentity: SaveIdentity = {
  playerName: "Ada",
  role: "Wiz",
  race: "Hum",
  gender: "Fem",
  alignment: "Neu",
};
const adaSave: ReadySave = {
  path: "/save/0Ada",
  modifiedAt: 1_700_000_000_000,
  status: "ready",
  identity: adaIdentity,
};

/** Create the minimum idle module needed by Home storage tests. */
function createModule(): EmscriptenModule {
  return {
    ccall: vi.fn(),
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
    IDBFS: {},
  };
}

/** Create a manager through its future stage-three public contract. */
function createManager(
  storage: Record<string, unknown>,
  dispatch = vi.fn<(action: AppAction) => void>(),
): { manager: StageThreeManager; dispatch: typeof dispatch } {
  const options: SessionManagerOptions & Record<string, unknown> = {
    createModuleId: () => "module-1",
    createSessionId: () => "session-1",
    createStorageService: () => storage as never,
    dispatch,
    moduleFactory: vi.fn(async () => createModule()),
  };
  return {
    manager: createSessionManager(options) as unknown as StageThreeManager,
    dispatch,
  };
}

beforeEach(() => {
  resetGameState();
});

describe("Home raw save operations", () => {
  it("re-enumerates and dispatches after a successful import", async () => {
    const storage = {
      initialize: vi.fn(async () => true),
      listSaves: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([adaSave]),
      importSave: vi.fn(async () => ({
        status: "imported" as const,
        path: adaSave.path,
      })),
      exportSave: vi.fn(),
      readSave: vi.fn(),
      restoreOriginalSave: vi.fn(),
      deleteSave: vi.fn(),
      flush: vi.fn(async () => undefined),
    };
    const { manager, dispatch } = createManager(storage);
    await manager.initialize();
    dispatch.mockClear();
    const request: ImportRequest = {
      bytes: Uint8Array.of(0x68),
      modifiedAt: 1_725_000_000_000,
      overwrite: false,
    };

    await expect(manager.importSave("module-1", request)).resolves.toEqual({
      status: "imported",
      preparation: {
        moduleId: "module-1",
        saves: [adaSave],
        storageAvailable: true,
      },
    });

    expect(storage.importSave).toHaveBeenCalledWith(request);
    expect(storage.listSaves).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledWith({
      type: "HOME_SAVES_UPDATED",
      moduleId: "module-1",
      saves: [adaSave],
    });
  });

  it("returns a conflict without re-enumerating or dispatching", async () => {
    const conflict: Conflict = {
      status: "conflict",
      path: adaSave.path,
      existing: { identity: adaIdentity, modifiedAt: 1_700_000_000_000 },
      incoming: { identity: adaIdentity, modifiedAt: 1_725_000_000_000 },
    };
    const storage = {
      initialize: vi.fn(async () => true),
      listSaves: vi.fn(async () => [adaSave]),
      importSave: vi.fn(async () => conflict),
      exportSave: vi.fn(),
      readSave: vi.fn(),
      restoreOriginalSave: vi.fn(),
      deleteSave: vi.fn(),
      flush: vi.fn(async () => undefined),
    };
    const { manager, dispatch } = createManager(storage);
    await manager.initialize();
    dispatch.mockClear();

    await expect(manager.importSave("module-1", {
      bytes: Uint8Array.of(0x68),
      modifiedAt: 1_725_000_000_000,
      overwrite: false,
    })).resolves.toEqual(conflict);

    expect(storage.listSaves).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("exports only a ready save listed by the current Home module", async () => {
    const bytes = Uint8Array.of(0x68, 0xff);
    const storage = {
      initialize: vi.fn(async () => true),
      listSaves: vi.fn(async () => [adaSave]),
      importSave: vi.fn(),
      exportSave: vi.fn(async () => bytes),
      readSave: vi.fn(),
      restoreOriginalSave: vi.fn(),
      deleteSave: vi.fn(),
      flush: vi.fn(async () => undefined),
    };
    const { manager } = createManager(storage);
    await manager.initialize();

    await expect(manager.exportSave(
      "module-1",
      adaSave.path,
    )).resolves.toEqual({
      bytes,
      fileName: "Ada.nhsave",
      mimeType: "application/octet-stream",
    });
    await expect(manager.exportSave(
      "module-stale",
      adaSave.path,
    )).rejects.toThrow(/current Home module/i);
    await expect(manager.exportSave(
      "module-1",
      "/save/0Unknown",
    )).rejects.toThrow(/listed|ready/i);
    expect(storage.exportSave).toHaveBeenCalledOnce();
  });
});

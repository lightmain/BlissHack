import { vi } from "vitest";

/** One pending callback-style syncfs request captured by the fake FS. */
export interface SyncRequest {
  populate: boolean;
  complete: (error?: unknown) => void;
}

/** In-memory Emscripten filesystem fixture used by storage contract tests. */
export interface StorageModuleHarness {
  files: Map<string, Uint8Array>;
  module: {
    FS: {
      analyzePath: ReturnType<typeof vi.fn>;
      isFile: ReturnType<typeof vi.fn>;
      mkdir: ReturnType<typeof vi.fn>;
      mount: ReturnType<typeof vi.fn>;
      readFile: ReturnType<typeof vi.fn>;
      readdir: ReturnType<typeof vi.fn>;
      stat: ReturnType<typeof vi.fn>;
      syncfs: ReturnType<typeof vi.fn>;
      writeFile: ReturnType<typeof vi.fn>;
    };
    IDBFS?: object;
  };
  syncRequests: SyncRequest[];
}

/** Options controlling failure behavior in the in-memory storage fixture. */
interface StorageModuleHarnessOptions {
  idbfsAvailable?: boolean;
  mountError?: Error;
}

/**
 * Create an in-memory Emscripten module with manually completed syncfs calls.
 * @param options - optional capability and mount failure controls.
 * @returns module, files, and captured synchronization requests.
 */
export function createStorageModuleHarness(
  options: StorageModuleHarnessOptions = {},
): StorageModuleHarness {
  const files = new Map<string, Uint8Array>();
  const directories = new Set(["/"]);
  const syncRequests: SyncRequest[] = [];

  const FS = {
    analyzePath: vi.fn((path: string) => ({
      exists: directories.has(path) || files.has(path),
    })),
    isFile: vi.fn((mode: number) => (mode & 0xf000) === 0x8000),
    mkdir: vi.fn((path: string) => {
      directories.add(path);
    }),
    mount: vi.fn(() => {
      if (options.mountError) throw options.mountError;
    }),
    readFile: vi.fn((path: string) => {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`ENOENT: ${path}`);
      return bytes.slice();
    }),
    readdir: vi.fn((path: string) => {
      const prefix = `${path.replace(/\/$/, "")}/`;
      const names = Array.from(files.keys())
        .filter((filePath) => filePath.startsWith(prefix))
        .map((filePath) => filePath.slice(prefix.length))
        .filter((name) => name.length > 0 && !name.includes("/"));
      return [".", "..", ...names];
    }),
    stat: vi.fn((path: string) => {
      if (files.has(path)) return { mode: 0x8000 };
      if (directories.has(path)) return { mode: 0x4000 };
      throw new Error(`ENOENT: ${path}`);
    }),
    syncfs: vi.fn((
      populate: boolean,
      callback: (error: unknown | null) => void,
    ) => {
      syncRequests.push({
        populate,
        complete: (error?: unknown) => callback(error ?? null),
      });
    }),
    writeFile: vi.fn((path: string, bytes: Uint8Array) => {
      files.set(path, bytes.slice());
    }),
  };

  return {
    files,
    module: {
      FS,
      ...(options.idbfsAvailable === false ? {} : { IDBFS: {} }),
    },
    syncRequests,
  };
}

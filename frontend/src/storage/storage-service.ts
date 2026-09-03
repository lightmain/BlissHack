import { importRawSaveTransaction } from "./storage-transaction";

/** Largest raw save accepted before allocating or writing imported content. */
export const MAX_RAW_SAVE_BYTES = 64 * 1024 * 1024;

/** File-system operations required from an Emscripten module. */
export interface StorageFileSystem {
  analyzePath(path: string): { exists: boolean };
  isFile(mode: number): boolean;
  mkdir(path: string): unknown;
  mount(type: unknown, options: Record<string, unknown>, path: string): unknown;
  readFile(path: string): string | Uint8Array;
  readdir(path: string): string[];
  rename(oldPath: string, newPath: string): unknown;
  stat(path: string): { mode: number; mtime?: Date | number };
  syncfs(
    populate: boolean,
    callback: (error: unknown | null) => void,
  ): void;
  unlink(path: string): unknown;
  writeFile(path: string, bytes: Uint8Array): unknown;
}

/** Module capabilities used by browser save storage. */
export interface StorageModule {
  FS: StorageFileSystem;
  IDBFS?: unknown;
}

/** Identity read from a NetHack save by the shim validator. */
export interface SaveIdentity {
  playerName: string;
  role: string;
  race: string;
  gender: string;
  alignment: string;
}

/** Result of validating one save candidate. */
export type SaveValidation =
  | { status: "ready"; identity: SaveIdentity }
  | { status: "invalid"; error: string };

/** One file displayed by the save picker. */
export type SaveListEntry = {
  path: string;
  modifiedAt: number | null;
} & SaveValidation;

/** Narrow validator implemented by the NetHack shim in production. */
export type SaveMetadataValidator = (
  module: StorageModule,
  path: string,
) => Promise<SaveValidation>;

/** Validate uploaded bytes without first writing them into /save. */
export type SaveBytesValidator = (
  module: StorageModule,
  bytes: Uint8Array,
) => Promise<SaveValidation>;

/** User-approved request to import one raw save. */
export interface RawSaveImportRequest {
  bytes: Uint8Array;
  modifiedAt: number | null;
  overwrite: boolean;
}

/** Metadata shown for one side of a same-name conflict. */
export interface RawSaveSummary {
  identity: SaveIdentity;
  modifiedAt: number | null;
}

/** Import either completes or pauses before an unapproved replacement. */
export type RawSaveImportResult =
  | { status: "imported"; path: string }
  | {
    status: "conflict";
    path: string;
    existing: RawSaveSummary;
    incoming: RawSaveSummary;
  };

/** Public storage operations owned by one prepared game module. */
export interface StorageService {
  initialize(): Promise<boolean>;
  listSaves(): Promise<SaveListEntry[]>;
  readSave(path: string): Promise<Uint8Array>;
  restoreOriginalSave(path: string, bytes: Uint8Array): Promise<void>;
  deleteSave(path: string): Promise<void>;
  exportSave(path: string): Promise<Uint8Array>;
  importSave(request: RawSaveImportRequest): Promise<RawSaveImportResult>;
  flush(): Promise<void>;
}

/** Dependencies for a module-bound storage service. */
export interface StorageServiceOptions {
  validateSaveMetadata: SaveMetadataValidator;
  validateSaveBytes?: SaveBytesValidator;
}

const SAVE_DIRECTORY = "/save";
const TEMPORARY_SUFFIX = /(?:\.tmp|\.bak|\.e|~)$/i;

/**
 * Create storage operations bound to one Emscripten module.
 * @param module - module which owns the in-memory FS and IDBFS mount.
 * @param options - save validation dependency.
 * @returns an isolated, serialized storage service.
 */
export function createStorageService(
  module: StorageModule,
  options: StorageServiceOptions,
): StorageService {
  let initializePromise: Promise<boolean> | null = null;
  let persistent = false;
  let syncTail: Promise<void> | null = null;

  /** Queue one syncfs call without poisoning later operations on failure. */
  function enqueueSync(populate: boolean): Promise<void> {
    const operation = syncTail === null
      ? syncFilesystem(module.FS, populate)
      : syncTail.then(() => syncFilesystem(module.FS, populate));
    syncTail = operation.catch(() => undefined);
    return operation;
  }

  function initialize(): Promise<boolean> {
    if (initializePromise) return initializePromise;

    if (!module.FS.analyzePath(SAVE_DIRECTORY).exists) {
      module.FS.mkdir(SAVE_DIRECTORY);
    }
    if (
      module.IDBFS === undefined
      || typeof globalThis.indexedDB === "undefined"
    ) {
      initializePromise = Promise.resolve(false);
      return initializePromise;
    }

    try {
      module.FS.mount(
        module.IDBFS,
        { autoPersist: false },
        SAVE_DIRECTORY,
      );
    } catch {
      initializePromise = Promise.resolve(false);
      return initializePromise;
    }

    initializePromise = enqueueSync(true).then(
      () => {
        persistent = true;
        return true;
      },
      () => false,
    );
    return initializePromise;
  }

  async function listSaves(): Promise<SaveListEntry[]> {
    const available = await initialize();
    if (!available) return [];

    const entries: SaveListEntry[] = [];
    for (const fileName of module.FS.readdir(SAVE_DIRECTORY)) {
      if (!isSaveCandidate(fileName)) continue;
      const path = `${SAVE_DIRECTORY}/${fileName}`;
      let stat: { mode: number; mtime?: Date | number };
      try {
        stat = module.FS.stat(path);
      } catch {
        continue;
      }
      if (!module.FS.isFile(stat.mode)) continue;

      try {
        const validation = await options.validateSaveMetadata(module, path);
        entries.push({
          path,
          modifiedAt: fileModificationTime(stat),
          ...validation,
        });
      } catch (error) {
        entries.push({
          path,
          modifiedAt: fileModificationTime(stat),
          status: "invalid",
          error: errorMessage(error),
        });
      }
    }
    return entries.sort(compareSaveEntries);
  }

  async function readSave(path: string): Promise<Uint8Array> {
    assertSavePath(path);
    const bytes = module.FS.readFile(path);
    if (typeof bytes === "string") {
      throw new Error(`Expected binary save data at ${path}`);
    }
    return bytes.slice();
  }

  async function restoreOriginalSave(
    path: string,
    bytes: Uint8Array,
  ): Promise<void> {
    assertSavePath(path);
    module.FS.writeFile(path, bytes);
  }

  /** Delete one save and restore its bytes if persistence fails. */
  async function deleteSave(path: string): Promise<void> {
    assertSavePath(path);
    const originalBytes = await readSave(path);
    module.FS.unlink(path);
    try {
      await flush();
    } catch (deleteError) {
      try {
        module.FS.writeFile(path, originalBytes);
        await flush();
      } catch (restoreError) {
        throw new AggregateError(
          [deleteError, restoreError],
          `Could not delete or restore save at ${path}`,
        );
      }
      throw deleteError;
    }
  }

  /** Return an exact copy of one raw save without changing its FS state. */
  function exportSave(path: string): Promise<Uint8Array> {
    return readSave(path);
  }

  /** Validate and transactionally persist one uploaded raw save. */
  async function importSave(
    request: RawSaveImportRequest,
  ): Promise<RawSaveImportResult> {
    if (
      request.bytes.length === 0
      || request.bytes.length > MAX_RAW_SAVE_BYTES
    ) {
      throw new Error(
        request.bytes.length === 0
          ? "Save file is empty"
          : "Save file exceeds the 64 MiB limit",
      );
    }
    if (!options.validateSaveBytes) {
      throw new Error("Raw save import validation is unavailable");
    }
    const validation = await options.validateSaveBytes(module, request.bytes);
    if (validation.status === "invalid") {
      throw new Error(validation.error);
    }

    const path = `${SAVE_DIRECTORY}/0${validation.identity.playerName}`;
    assertSavePath(path);
    if (module.FS.analyzePath(path).exists && !request.overwrite) {
      const existingValidation = await options.validateSaveMetadata(
        module,
        path,
      );
      if (existingValidation.status === "invalid") {
        throw new Error(
          "An invalid same-name save already exists; delete it before importing",
        );
      }
      return {
        status: "conflict",
        path,
        existing: {
          identity: existingValidation.identity,
          modifiedAt: statModificationTime(module.FS, path),
        },
        incoming: {
          identity: validation.identity,
          modifiedAt: validTimestamp(request.modifiedAt),
        },
      };
    }

    await importRawSaveTransaction({
      fileSystem: module.FS,
      destinationPath: path,
      bytes: request.bytes,
      overwrite: request.overwrite,
      flush,
    });
    return { status: "imported", path };
  }

  function flush(): Promise<void> {
    return persistent ? enqueueSync(false) : Promise.resolve();
  }

  return {
    initialize,
    listSaves,
    readSave,
    restoreOriginalSave,
    deleteSave,
    exportSave,
    importSave,
    flush,
  };
}

/** Read a file's modification timestamp without inventing missing metadata. */
function statModificationTime(
  fileSystem: StorageFileSystem,
  path: string,
): number | null {
  return fileModificationTime(fileSystem.stat(path));
}

/** Normalize Emscripten's Date-shaped mtime. */
function fileModificationTime(
  stat: { mtime?: Date | number },
): number | null {
  const value = stat.mtime instanceof Date ? stat.mtime.getTime() : stat.mtime;
  return validTimestamp(value);
}

/** Keep only finite, non-negative millisecond timestamps. */
function validTimestamp(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** Return whether a direct /save entry can be a normal WASM save file. */
function isSaveCandidate(fileName: string): boolean {
  return /^0[^/]{1,31}$/.test(fileName)
    && !fileName.startsWith("0.")
    && !TEMPORARY_SUFFIX.test(fileName);
}

/** Reject paths outside the direct save directory. */
function assertSavePath(path: string): void {
  const fileName = path.slice(`${SAVE_DIRECTORY}/`.length);
  if (path !== `${SAVE_DIRECTORY}/${fileName}` || !isSaveCandidate(fileName)) {
    throw new Error(`Invalid save path: ${path}`);
  }
}

/** Sort ready entries by player name and invalid entries by path. */
function compareSaveEntries(left: SaveListEntry, right: SaveListEntry): number {
  const leftName = left.status === "ready" ? left.identity.playerName : left.path;
  const rightName = right.status === "ready" ? right.identity.playerName : right.path;
  return leftName.localeCompare(rightName);
}

/** Normalize an unknown failure without exposing file contents. */
function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Save is incompatible or damaged";
}

/** Convert callback-style syncfs into an awaitable operation. */
function syncFilesystem(
  fileSystem: StorageFileSystem,
  populate: boolean,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    fileSystem.syncfs(populate, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

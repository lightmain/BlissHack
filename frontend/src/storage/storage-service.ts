import { importRawSaveTransaction } from "./storage-transaction";
import {
  assertFormalSaveFileName,
  type BackupSaveBytes,
} from "../backup/backup-file";
import {
  MAX_RANKING_RECORD_BYTES,
  validateRankingRecord,
} from "./ranking-record";

/** Largest raw save accepted before allocating or writing imported content. */
export const MAX_RAW_SAVE_BYTES = 64 * 1024 * 1024;
export { MAX_RANKING_RECORD_BYTES };
/** Largest number of direct files copied for a clear rollback. */
export const MAX_MANAGED_STORAGE_FILES = 1_000;
/** Largest aggregate byte snapshot copied for a clear rollback. */
export const MAX_MANAGED_STORAGE_BYTES = 64 * 1024 * 1024;

/** File-system operations required from an Emscripten module. */
export interface StorageFileSystem {
  analyzePath(path: string): { exists: boolean };
  isFile(mode: number): boolean;
  mkdir(path: string): unknown;
  mount(type: unknown, options: Record<string, unknown>, path: string): unknown;
  readFile(path: string): string | Uint8Array;
  readdir(path: string): string[];
  rename(oldPath: string, newPath: string): unknown;
  stat(path: string): { mode: number; mtime?: Date | number; size?: number };
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
  | { status: "incompatible"; reason: "fingerprint-mismatch" }
  | {
    status: "damaged";
    reason:
      | "not-binary"
      | "truncated"
      | "invalid-identity-size"
      | "invalid-player-name"
      | "invalid-character-identity"
      | "identity-file-name-mismatch"
      | "validation-failed";
  };

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
  expectedExisting?: RawSaveSummary;
  modifiedAt: number | null;
  overwrite: boolean;
}

/** Metadata shown for one side of a same-name conflict. */
export interface RawSaveSummary {
  identity: SaveIdentity;
  modifiedAt: number | null;
}

/** Exact snapshot of one regular file managed by the /save mount. */
export interface ManagedStorageFile {
  path: string;
  bytes: Uint8Array;
}

/** Current source and recovery state of the module's local ranking file. */
export interface RankingStatus {
  source: "packaged" | "sidecar";
  recovery: "damaged-sidecar" | null;
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
  refreshFromPersistent(): Promise<SaveListEntry[]>;
  listSaves(): Promise<SaveListEntry[]>;
  readSave(path: string): Promise<Uint8Array>;
  restoreOriginalSave(path: string, bytes: Uint8Array): Promise<void>;
  deleteSave(path: string): Promise<void>;
  exportSave(path: string): Promise<Uint8Array>;
  exportAllSaves(): Promise<BackupSaveBytes[]>;
  exportRanking(): Promise<Uint8Array>;
  importRanking(bytes: Uint8Array): Promise<void>;
  getRankingStatus(): RankingStatus;
  validateSave(bytes: Uint8Array): Promise<SaveValidation>;
  importSave(request: RawSaveImportRequest): Promise<RawSaveImportResult>;
  clearManagedFiles(): Promise<ManagedStorageFile[]>;
  restoreManagedFiles(files: ManagedStorageFile[]): Promise<void>;
  flush(): Promise<void>;
}

/** Dependencies for a module-bound storage service. */
export interface StorageServiceOptions {
  validateSaveMetadata: SaveMetadataValidator;
  validateSaveBytes?: SaveBytesValidator;
  onRankingRecovery?: (
    reason: Exclude<RankingStatus["recovery"], null>,
  ) => void;
}

const SAVE_DIRECTORY = "/save";
const RANKING_PATH = "/record";
const RANKING_SIDECAR_PATH = `${SAVE_DIRECTORY}/.ranking-record`;
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
  let packagedRanking: Uint8Array | null = null;
  let rankingStatus: RankingStatus = {
    source: "packaged",
    recovery: null,
  };

  /** Queue one complete filesystem operation without poisoning later work. */
  function enqueueOperation(operation: () => Promise<void>): Promise<void> {
    let queued: Promise<void>;
    try {
      queued = syncTail === null ? operation() : syncTail.then(operation);
    } catch (error) {
      queued = Promise.reject(error);
    }
    syncTail = queued.catch(() => undefined);
    return queued;
  }

  /** Queue one syncfs call without poisoning later operations on failure. */
  function enqueueSync(populate: boolean): Promise<void> {
    return enqueueOperation(() => syncFilesystem(module.FS, populate));
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

    initializePromise = enqueueSync(true)
      .then(() => {
        hydrateRanking(false);
        persistent = true;
        return true;
      })
      .catch(() => false);
    return initializePromise;
  }

  /**
   * Replace this module's mounted save view with the latest durable IDBFS state.
   * @returns the freshly enumerated formal saves, or an empty list without IDBFS.
   */
  async function refreshFromPersistent(): Promise<SaveListEntry[]> {
    const available = await initialize();
    if (!available) return [];
    await enqueueSync(true);
    hydrateRanking(true);
    return listSaves();
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

      const validation = await options.validateSaveMetadata(module, path);
      entries.push({
        path,
        modifiedAt: fileModificationTime(stat),
        ...validation,
      });
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

  /** Read every formal save, including incompatible and damaged entries. */
  async function exportAllSaves(): Promise<BackupSaveBytes[]> {
    const result: BackupSaveBytes[] = [];
    const fileNames = module.FS.readdir(SAVE_DIRECTORY)
      .filter(isSaveCandidate)
      .sort(compareCodePoints);
    for (const fileName of fileNames) {
      const path = `${SAVE_DIRECTORY}/${fileName}`;
      const stat = module.FS.stat(path);
      if (!module.FS.isFile(stat.mode)) continue;
      result.push({
        fileName,
        bytes: await readSave(path),
      });
    }
    return result;
  }

  /** Return an exact detached copy of the current core ranking record. */
  async function exportRanking(): Promise<Uint8Array> {
    const available = await initialize();
    if (!available) throw new Error("Persistent ranking storage is unavailable");
    return readRankingFile(RANKING_PATH);
  }

  /** Transactionally replace both ranking copies and persist the sidecar. */
  async function importRanking(bytes: Uint8Array): Promise<void> {
    validateRankingRecord(bytes);
    const available = await initialize();
    if (!available) throw new Error("Persistent ranking storage is unavailable");
    const replacement = bytes.slice();

    return enqueueOperation(async () => {
      const originalRoot = readRankingFile(RANKING_PATH);
      const originalSidecar = readOptionalBinaryFile(RANKING_SIDECAR_PATH);
      try {
        writeRankingCopies(replacement);
        await syncFilesystem(module.FS, false);
        rankingStatus = { source: "sidecar", recovery: null };
      } catch (importError) {
        try {
          module.FS.writeFile(RANKING_PATH, originalRoot);
          restoreOptionalFile(RANKING_SIDECAR_PATH, originalSidecar);
          await syncFilesystem(module.FS, false);
        } catch (restoreError) {
          throw new AggregateError(
            [importError, restoreError],
            "Could not import or restore local ranking data",
          );
        }
        throw importError;
      }
    });
  }

  /** Return the latest ranking hydration state without exposing record content. */
  function getRankingStatus(): RankingStatus {
    return { ...rankingStatus };
  }

  /** Classify detached raw bytes using the current game module. */
  function validateSave(bytes: Uint8Array): Promise<SaveValidation> {
    if (!options.validateSaveBytes) {
      throw new Error("Raw save validation is unavailable");
    }
    return options.validateSaveBytes(module, bytes);
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
    if (validation.status !== "ready") {
      throw new Error(saveValidationMessage(validation));
    }

    const path = `${SAVE_DIRECTORY}/0${validation.identity.playerName}`;
    assertSavePath(path);
    if (module.FS.analyzePath(path).exists) {
      const existingValidation = await options.validateSaveMetadata(
        module,
        path,
      );
      if (existingValidation.status !== "ready") {
        throw new Error(
          "An unavailable same-name save already exists; delete it before importing",
        );
      }
      const existing = {
        identity: existingValidation.identity,
        modifiedAt: statModificationTime(module.FS, path),
      };
      if (
        !request.overwrite
        || (
          request.expectedExisting !== undefined
          && !sameSaveSummary(existing, request.expectedExisting)
        )
      ) {
        return {
          status: "conflict",
          path,
          existing,
          incoming: {
            identity: validation.identity,
            modifiedAt: validTimestamp(request.modifiedAt),
          },
        };
      }
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
    if (!persistent) return Promise.resolve();
    return enqueueOperation(async () => {
      const ranking = readRankingFile(RANKING_PATH);
      module.FS.writeFile(RANKING_SIDECAR_PATH, ranking);
      await syncFilesystem(module.FS, false);
      rankingStatus = { source: "sidecar", recovery: null };
    });
  }

  /** Remove all managed files and return an exact rollback copy. */
  async function clearManagedFiles(): Promise<ManagedStorageFile[]> {
    const snapshot = snapshotManagedFiles();
    try {
      for (const file of snapshot) {
        if (file.path !== RANKING_PATH) module.FS.unlink(file.path);
      }
      module.FS.writeFile(RANKING_PATH, packagedRankingRecord());
      await enqueueSync(false);
      rankingStatus = { source: "packaged", recovery: null };
    } catch (clearError) {
      try {
        await restoreManagedFiles(snapshot);
      } catch (restoreError) {
        throw new AggregateError(
          [clearError, restoreError],
          "Could not clear or restore local save data",
        );
      }
      throw clearError;
    }
    return snapshot;
  }

  /** Replace current managed files with an earlier exact snapshot. */
  async function restoreManagedFiles(
    files: ManagedStorageFile[],
  ): Promise<void> {
    const paths = new Set<string>();
    let rootRanking: Uint8Array | null = null;
    for (const file of files) {
      if (
        file.path !== RANKING_PATH
        && !file.path.startsWith(`${SAVE_DIRECTORY}/`)
      ) {
        throw new Error("Managed storage snapshot contains an invalid path");
      }
      if (paths.has(file.path)) {
        throw new Error("Managed storage snapshot contains a duplicate path");
      }
      paths.add(file.path);
      if (file.path === RANKING_PATH) {
        validateRankingRecord(file.bytes);
        rootRanking = file.bytes;
      }
    }
    for (const fileName of module.FS.readdir(SAVE_DIRECTORY)) {
      if (fileName === "." || fileName === "..") continue;
      const path = `${SAVE_DIRECTORY}/${fileName}`;
      const stat = module.FS.stat(path);
      if (module.FS.isFile(stat.mode)) module.FS.unlink(path);
    }
    for (const file of files) {
      if (file.path !== RANKING_PATH) {
        module.FS.writeFile(file.path, file.bytes);
      }
    }
    module.FS.writeFile(
      RANKING_PATH,
      rootRanking?.slice() ?? packagedRankingRecord(),
    );
    await enqueueSync(false);
    rankingStatus = module.FS.analyzePath(RANKING_SIDECAR_PATH).exists
      ? { source: "sidecar", recovery: null }
      : { source: "packaged", recovery: null };
  }

  /** Copy the root ranking and every regular direct child of /save. */
  function snapshotManagedFiles(): ManagedStorageFile[] {
    const rootRanking = readRankingFile(RANKING_PATH);
    const files: ManagedStorageFile[] = [{
      path: RANKING_PATH,
      bytes: rootRanking,
    }];
    let totalBytes = rootRanking.byteLength;
    for (const fileName of module.FS.readdir(SAVE_DIRECTORY)) {
      if (fileName === "." || fileName === "..") continue;
      const path = `${SAVE_DIRECTORY}/${fileName}`;
      const stat = module.FS.stat(path);
      if (!module.FS.isFile(stat.mode)) continue;
      if (files.length >= MAX_MANAGED_STORAGE_FILES) {
        throw new Error("Local save storage contains too many files to clear safely");
      }
      if (
        typeof stat.size === "number"
        && (
          stat.size < 0
          || stat.size > MAX_MANAGED_STORAGE_BYTES - totalBytes
        )
      ) {
        throw new Error("Local save storage exceeds the safe clear limit");
      }
      const bytes = module.FS.readFile(path);
      if (typeof bytes === "string") {
        throw new Error(`Expected binary storage data at ${path}`);
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_MANAGED_STORAGE_BYTES) {
        throw new Error("Local save storage exceeds the safe clear limit");
      }
      files.push({ path, bytes: bytes.slice() });
    }
    return files;
  }

  /**
   * Restore the mounted sidecar into the root path or reset damaged data.
   * @param resetMissing - reset a stale live record after a durable deletion.
   */
  function hydrateRanking(resetMissing: boolean): void {
    const packaged = packagedRankingRecord();
    if (!module.FS.analyzePath(RANKING_SIDECAR_PATH).exists) {
      if (resetMissing) module.FS.writeFile(RANKING_PATH, packaged);
      rankingStatus = { source: "packaged", recovery: null };
      return;
    }

    try {
      const sidecar = readRankingFile(RANKING_SIDECAR_PATH);
      module.FS.writeFile(RANKING_PATH, sidecar);
      rankingStatus = { source: "sidecar", recovery: null };
    } catch {
      writeRankingCopies(packaged);
      rankingStatus = {
        source: "packaged",
        recovery: "damaged-sidecar",
      };
      options.onRankingRecovery?.("damaged-sidecar");
    }
  }

  /** Capture the immutable ranking record embedded in a fresh module. */
  function packagedRankingRecord(): Uint8Array {
    if (packagedRanking !== null) return packagedRanking.slice();
    if (!module.FS.analyzePath(RANKING_PATH).exists) {
      packagedRanking = new Uint8Array();
      return packagedRanking.slice();
    }
    packagedRanking = readRankingFile(RANKING_PATH);
    return packagedRanking.slice();
  }

  /** Read and validate one binary ranking path. */
  function readRankingFile(path: string): Uint8Array {
    if (
      path === RANKING_PATH
      && !module.FS.analyzePath(RANKING_PATH).exists
    ) {
      return packagedRankingRecord();
    }
    const bytes = module.FS.readFile(path);
    if (typeof bytes === "string") {
      throw new Error(`Expected binary ranking data at ${path}`);
    }
    validateRankingRecord(bytes);
    return bytes.slice();
  }

  /** Read one optional binary file without validating its payload. */
  function readOptionalBinaryFile(path: string): Uint8Array | null {
    if (!module.FS.analyzePath(path).exists) return null;
    const bytes = module.FS.readFile(path);
    if (typeof bytes === "string") {
      throw new Error(`Expected binary storage data at ${path}`);
    }
    return bytes.slice();
  }

  /** Write one validated ranking payload to both live and persistent paths. */
  function writeRankingCopies(bytes: Uint8Array): void {
    validateRankingRecord(bytes);
    module.FS.writeFile(RANKING_PATH, bytes);
    module.FS.writeFile(RANKING_SIDECAR_PATH, bytes);
  }

  /** Restore an optional file to its exact previous existence and bytes. */
  function restoreOptionalFile(path: string, bytes: Uint8Array | null): void {
    if (bytes === null) {
      if (module.FS.analyzePath(path).exists) module.FS.unlink(path);
      return;
    }
    module.FS.writeFile(path, bytes);
  }

  return {
    initialize,
    refreshFromPersistent,
    listSaves,
    readSave,
    restoreOriginalSave,
    deleteSave,
    exportSave,
    exportAllSaves,
    exportRanking,
    importRanking,
    getRankingStatus,
    validateSave,
    importSave,
    clearManagedFiles,
    restoreManagedFiles,
    flush,
  };
}

/** Compare the metadata bound to one explicit raw-save overwrite approval. */
function sameSaveSummary(
  current: RawSaveSummary,
  expected: RawSaveSummary,
): boolean {
  return current.modifiedAt === expected.modifiedAt
    && current.identity.playerName === expected.identity.playerName
    && current.identity.role === expected.identity.role
    && current.identity.race === expected.identity.race
    && current.identity.gender === expected.identity.gender
    && current.identity.alignment === expected.identity.alignment;
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
  try {
    assertFormalSaveFileName(fileName);
    return !TEMPORARY_SUFFIX.test(fileName);
  } catch {
    return false;
  }
}

/** Reject paths outside the direct save directory. */
function assertSavePath(path: string): void {
  const fileName = path.slice(`${SAVE_DIRECTORY}/`.length);
  if (path !== `${SAVE_DIRECTORY}/${fileName}` || !isSaveCandidate(fileName)) {
    throw new Error(`Invalid save path: ${path}`);
  }
}

/** Sort ready entries by player name and unavailable entries by path. */
function compareSaveEntries(left: SaveListEntry, right: SaveListEntry): number {
  const leftName = left.status === "ready" ? left.identity.playerName : left.path;
  const rightName = right.status === "ready" ? right.identity.playerName : right.path;
  return compareCodePoints(leftName, rightName);
}

/** Compare strings by Unicode code point rather than UTF-16 code unit. */
function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) as number);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) as number);
  const count = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < count; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

/** Return stable user-facing text for a save which cannot be continued. */
export function saveValidationMessage(
  validation: Exclude<SaveValidation, { status: "ready" }>,
): string {
  return validation.status === "incompatible"
    ? "Save is incompatible with this BlissHack build"
    : "Save is damaged or unrecognized";
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

/** Filesystem operations needed by one raw save import transaction. */
export interface ImportTransactionFileSystem {
  analyzePath(path: string): { exists: boolean };
  readFile(path: string): string | Uint8Array;
  rename(oldPath: string, newPath: string): unknown;
  unlink(path: string): unknown;
  writeFile(path: string, bytes: Uint8Array): unknown;
}

/** Parameters for atomically replacing one formal save path. */
export interface RawSaveTransactionOptions {
  fileSystem: ImportTransactionFileSystem;
  destinationPath: string;
  bytes: Uint8Array;
  overwrite: boolean;
  flush: () => Promise<void>;
}

/**
 * Persist raw save bytes and restore the prior file if any step fails.
 * @param options - destination, bytes, overwrite decision, and storage adapter.
 */
export async function importRawSaveTransaction(
  options: RawSaveTransactionOptions,
): Promise<void> {
  const {
    fileSystem,
    destinationPath,
    bytes,
    overwrite,
    flush,
  } = options;
  const existed = fileSystem.analyzePath(destinationPath).exists;
  if (existed && !overwrite) {
    throw new Error(`Save already exists at ${destinationPath}`);
  }

  const originalBytes = existed
    ? readBinaryFile(fileSystem, destinationPath)
    : null;
  const temporaryPath = `/save/.blisshack-import-${randomSuffix()}.tmp`;
  let destinationChanged = false;

  try {
    fileSystem.writeFile(temporaryPath, bytes);
    const verifiedBytes = readBinaryFile(fileSystem, temporaryPath);
    if (!equalBytes(bytes, verifiedBytes)) {
      throw new Error("Temporary save verification failed");
    }
    fileSystem.rename(temporaryPath, destinationPath);
    destinationChanged = true;
    await flush();
  } catch (importError) {
    try {
      if (fileSystem.analyzePath(temporaryPath).exists) {
        fileSystem.unlink(temporaryPath);
      }
      if (originalBytes) {
        fileSystem.writeFile(destinationPath, originalBytes);
      } else if (
        destinationChanged
        && fileSystem.analyzePath(destinationPath).exists
      ) {
        fileSystem.unlink(destinationPath);
      }
      await flush();
    } catch (rollbackError) {
      throw new AggregateError(
        [importError, rollbackError],
        `Could not import or restore save at ${destinationPath}`,
      );
    }
    throw importError;
  }
}

/** Read one FS path without accepting accidental text decoding. */
function readBinaryFile(
  fileSystem: ImportTransactionFileSystem,
  path: string,
): Uint8Array {
  const bytes = fileSystem.readFile(path);
  if (typeof bytes === "string") {
    throw new Error(`Expected binary save data at ${path}`);
  }
  return bytes.slice();
}

/** Compare bytes without converting binary data to strings. */
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

/** Generate a path component which does not contain player information. */
function randomSuffix(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
}

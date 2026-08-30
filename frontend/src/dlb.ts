interface DlbEntry {
  start: number;
  end: number;
}

interface DlbArchive {
  bytes: Uint8Array;
  entries: Map<string, DlbEntry>;
}

const DLB_REVISION = 1;
const decoder = new TextDecoder();
const archiveCache = new WeakMap<Uint8Array, DlbArchive>();

/**
 * Read one logical file from a revision-1 NetHack DLB archive.
 * @param bytes - complete nhdat archive bytes.
 * @param name - logical filename supplied to display_file.
 * @returns the exact entry bytes, or null when the name is absent.
 */
export function readDlbEntry(bytes: Uint8Array, name: string): Uint8Array | null {
  const archive = archiveCache.get(bytes) ?? parseDlbArchive(bytes);
  archiveCache.set(bytes, archive);
  const entry = archive.entries.get(name);
  return entry ? archive.bytes.subarray(entry.start, entry.end) : null;
}

/**
 * Parse the textual DLB header and directory documented in src/dlb.c.
 * @param bytes - complete nhdat archive bytes.
 * @returns validated entry offsets into the original byte array.
 */
function parseDlbArchive(bytes: Uint8Array): DlbArchive {
  let cursor = 0;
  const header = readLine(bytes, cursor);
  cursor = header.next;
  const values = header.text.trim().split(/\s+/).map(Number);
  if (values.length !== 5 || values.some((value) => !Number.isSafeInteger(value))) {
    throw new Error("Invalid nhdat header");
  }

  const [revision, entryCount, , dataOffset, totalSize] = values;
  if (
    revision !== DLB_REVISION
    || entryCount < 1
    || dataOffset < cursor
    || totalSize !== bytes.length
  ) {
    throw new Error("Unsupported or corrupt nhdat archive");
  }

  const directory: Array<{ name: string; offset: number }> = [];
  for (let index = 0; index < entryCount; index += 1) {
    const line = readLine(bytes, cursor);
    cursor = line.next;
    const match = /^n(\S+)\s+(\d+)$/.exec(line.text);
    if (!match) throw new Error("Invalid nhdat directory");
    directory.push({ name: match[1], offset: Number(match[2]) });
  }
  if (cursor !== dataOffset || directory[0]?.name !== "Directory") {
    throw new Error("Invalid nhdat data offset");
  }

  const entries = new Map<string, DlbEntry>();
  for (let index = 1; index < directory.length; index += 1) {
    const current = directory[index];
    const end = directory[index + 1]?.offset ?? totalSize;
    if (current.offset < dataOffset || end < current.offset || end > totalSize) {
      throw new Error("Invalid nhdat entry offset");
    }
    entries.set(current.name, { start: current.offset, end });
  }
  return { bytes, entries };
}

/**
 * Decode one LF-terminated ASCII metadata line.
 * @param bytes - archive bytes.
 * @param start - first byte of the line.
 * @returns decoded text and the next unread byte.
 */
function readLine(
  bytes: Uint8Array,
  start: number,
): { text: string; next: number } {
  const end = bytes.indexOf(10, start);
  if (end < 0) throw new Error("Truncated nhdat metadata");
  return {
    text: decoder.decode(bytes.subarray(start, end)),
    next: end + 1,
  };
}

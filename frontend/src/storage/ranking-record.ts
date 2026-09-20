/** Largest accepted local NetHack ranking payload. */
export const MAX_RANKING_RECORD_BYTES = 64 * 1024;
/** Current core maximum number of persisted ranking entries. */
const MAX_RANKING_RECORD_ENTRIES = 100;
/** Conservative upper bound for one current-core record line, including LF. */
const MAX_RANKING_RECORD_LINE_BYTES = 284;
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

export type RankingRecordValidationErrorCode =
  | "too-large"
  | "invalid-format";

/** Stable validation failure for untrusted or damaged ranking bytes. */
export class RankingRecordValidationError extends Error {
  readonly code: RankingRecordValidationErrorCode;

  constructor(code: RankingRecordValidationErrorCode, message: string) {
    super(message);
    this.name = "RankingRecordValidationError";
    this.code = code;
  }
}

/**
 * Validate bytes against the bounded NetHack 5.0 record format.
 * @param bytes - opaque record bytes produced locally or decoded from a backup.
 * @returns the original byte view after successful validation.
 */
export function validateRankingRecord(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength > MAX_RANKING_RECORD_BYTES) {
    throw new RankingRecordValidationError(
      "too-large",
      "Ranking record exceeds the 64 KiB limit",
    );
  }
  if (bytes.byteLength === 0) return bytes;
  if (bytes.at(-1) !== 0x0a) {
    throw invalidRanking("Ranking record is not newline terminated");
  }

  let lineStart = 0;
  let entryCount = 0;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index];
    if (byte === 0x00 || byte === 0x0d || byte === 0x7f) {
      throw invalidRanking("Ranking record contains an unsafe control byte");
    }
    if (byte < 0x20 && byte !== 0x0a) {
      throw invalidRanking("Ranking record contains an unsafe control byte");
    }
    if (byte !== 0x0a) continue;

    entryCount += 1;
    if (entryCount > MAX_RANKING_RECORD_ENTRIES) {
      throw invalidRanking("Ranking record contains too many entries");
    }
    const line = bytes.subarray(lineStart, index);
    if (line.byteLength + 1 > MAX_RANKING_RECORD_LINE_BYTES) {
      throw invalidRanking("Ranking record contains an oversized entry");
    }
    validateRankingLine(line);
    lineStart = index + 1;
  }
  return bytes;
}

/** Validate one newline-free NetHack 5.0 ranking line. */
function validateRankingLine(bytes: Uint8Array): void {
  const line = String.fromCharCode(...bytes);
  const match = /^(\d+)\.(\d+)\.(\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) ([A-Za-z?]{1,3}) ([A-Za-z?]{1,3}) ([A-Za-z?]{1,3}) ([A-Za-z?]{1,3}) ([^,]{1,10}),(.+)$/
    .exec(line);
  if (!match) {
    throw invalidRanking("Ranking record contains a malformed entry");
  }
  if (match[1] !== "5" || match[2] !== "0" || match[3] !== "0") {
    throw invalidRanking("Ranking record version is not supported");
  }

  const numbers = match.slice(4, 14).map(parseCanonicalInt32);
  const [
    points,
    deathDungeon,
    deathLevel,
    maximumLevel,
  ] = numbers;
  if (
    numbers.some((value) => value === null)
    || points === null
    || points < 1
    || deathDungeon === null
    || deathDungeon < 0
    || deathDungeon >= 16
    || deathLevel === null
    || deathLevel < -5
    || deathLevel > 127
    || maximumLevel === null
    || maximumLevel < -5
    || maximumLevel > 127
  ) {
    throw invalidRanking("Ranking record contains an invalid numeric field");
  }
  if ((match[19]?.length ?? 0) > 100) {
    throw invalidRanking("Ranking record contains an oversized death field");
  }
}

/** Parse the canonical decimal representation emitted by WASM32 stdio. */
function parseCanonicalInt32(value: string): number | null {
  if (!/^(?:0|-?[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= INT32_MIN && parsed <= INT32_MAX
    ? parsed
    : null;
}

/** Construct a stable damaged-record validation error. */
function invalidRanking(message: string): RankingRecordValidationError {
  return new RankingRecordValidationError("invalid-format", message);
}

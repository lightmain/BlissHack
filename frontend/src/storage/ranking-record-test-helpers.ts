const encoder = new TextEncoder();

/**
 * Concatenate byte arrays without decoding opaque ranking fields.
 * @param chunks - byte arrays to append in order.
 * @returns one detached byte array containing every chunk.
 */
export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Build one core-readable NetHack 5 record line with opaque name/death bytes.
 * @param name - bytes for the fixed-width player name field.
 * @param death - bytes for the fixed-width death description field.
 * @returns one newline-terminated ranking record.
 */
export function createRankingRecord(
  name: Uint8Array = encoder.encode("Ada"),
  death: Uint8Array = encoder.encode("killed by a test"),
): Uint8Array {
  return concatBytes(
    encoder.encode(
      "5.0.0 1234 0 1 3 0 10 0 20260920 20260920 0 Wiz Hum Fem Neu ",
    ),
    name,
    encoder.encode(","),
    death,
    encoder.encode("\n"),
  );
}

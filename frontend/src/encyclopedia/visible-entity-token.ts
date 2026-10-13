const ARTIFACT_TOKEN_PATTERN = /^artifact:ART_[A-Z0-9_]{1,128}$/;

export interface VisibleIdentityTokenChannel {
  publishRow(input: {
    sessionId: string;
    rowId: number;
    baseObjectId: string;
    token: unknown;
  }): void;
  consumeRow(input: {
    sessionId: string;
    rowId: number;
    baseObjectId: string;
  }): string | null;
  clearRow(sessionId: string, rowId: number): void;
  clearSession(sessionId: string): void;
}

/**
 * Parse the bounded canonical shape allowed across the WASM callback boundary.
 * @param token Candidate callback value.
 * @returns Canonical token string, or null when its shape is unsafe.
 */
export function parseVisibleArtifactToken(token: unknown): string | null {
  return typeof token === "string" && ARTIFACT_TOKEN_PATTERN.test(token)
    ? token
    : null;
}

/**
 * Validate an opaque artifact identity against the generated artifact catalog.
 * @param token Candidate value copied from the WASM callback.
 * @param baseObjectId Object identity represented by the displayed glyph.
 * @param artifactBaseObjects Catalog mapping artifacts to their base objects.
 * @returns The canonical artifact token, or null when any check fails.
 */
export function validateVisibleArtifactToken(
  token: unknown,
  baseObjectId: string,
  artifactBaseObjects: ReadonlyMap<string, string>,
): string | null {
  const parsed = parseVisibleArtifactToken(token);
  if (parsed === null || artifactBaseObjects.get(parsed) !== baseObjectId) {
    return null;
  }
  return parsed;
}

/**
 * Create a one-shot channel for row-local visible identity metadata.
 * @param options Generated artifact catalog used to validate publications.
 * @returns A session-scoped publish, consume, and cleanup API.
 */
export function createVisibleIdentityTokenChannel(options: {
  artifactBaseObjects: ReadonlyMap<string, string>;
}): VisibleIdentityTokenChannel {
  const sessions = new Map<
    string,
    Map<number, { baseObjectId: string; token: string }>
  >();

  return {
    publishRow(input): void {
      const token = validateVisibleArtifactToken(
        input.token,
        input.baseObjectId,
        options.artifactBaseObjects,
      );
      const existingRows = sessions.get(input.sessionId);
      if (token === null) {
        existingRows?.delete(input.rowId);
        if (existingRows?.size === 0) sessions.delete(input.sessionId);
        return;
      }
      const rows = existingRows ?? new Map();
      rows.set(input.rowId, {
        baseObjectId: input.baseObjectId,
        token,
      });
      sessions.set(input.sessionId, rows);
    },

    consumeRow(input): string | null {
      const rows = sessions.get(input.sessionId);
      const row = rows?.get(input.rowId);
      if (!rows || !row) return null;
      rows.delete(input.rowId);
      if (rows.size === 0) sessions.delete(input.sessionId);
      return row.baseObjectId === input.baseObjectId ? row.token : null;
    },

    clearRow(sessionId, rowId): void {
      const rows = sessions.get(sessionId);
      rows?.delete(rowId);
      if (rows?.size === 0) sessions.delete(sessionId);
    },

    clearSession(sessionId): void {
      sessions.delete(sessionId);
    },
  };
}

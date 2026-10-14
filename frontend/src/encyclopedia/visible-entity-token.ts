const VISIBLE_ENTITY_TOKEN_PATTERN =
  /^(?:object:[A-Z0-9_]{1,128}|artifact:ART_[A-Z0-9_]{1,128})$/;

export interface VisibleEntityTokenCatalog {
  displayedObjectId: string;
  knownObjectIds: ReadonlySet<string>;
  artifactBaseObjects: ReadonlyMap<string, string>;
}

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
 * Parse a bounded ordinary object or artifact identity from the WASM boundary.
 * @param token Candidate callback value.
 * @returns Canonical token string, or null when its shape is unsafe.
 */
export function parseVisibleEntityToken(token: unknown): string | null {
  return typeof token === "string"
      && VISIBLE_ENTITY_TOKEN_PATTERN.test(token)
    ? token
    : null;
}

/**
 * Validate a visible identity against the exact object represented by a glyph.
 * @param token Candidate value copied from the WASM callback.
 * @param catalog Runtime-bound object and artifact identity metadata.
 * @returns The canonical visible entity token, or null when any check fails.
 */
export function validateVisibleEntityToken(
  token: unknown,
  catalog: VisibleEntityTokenCatalog,
): string | null {
  const parsed = parseVisibleEntityToken(token);
  if (parsed === null) return null;
  if (parsed.startsWith("object:")) {
    return catalog.knownObjectIds.has(parsed)
        && parsed === catalog.displayedObjectId
      ? parsed
      : null;
  }
  return catalog.artifactBaseObjects.get(parsed) === catalog.displayedObjectId
    ? parsed
    : null;
}

/**
 * Parse the legacy artifact-only token shape.
 * @param token Candidate callback value.
 * @returns Canonical artifact token, or null for objects and malformed input.
 */
export function parseVisibleArtifactToken(token: unknown): string | null {
  const parsed = parseVisibleEntityToken(token);
  return parsed?.startsWith("artifact:") ? parsed : null;
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
  return parsed === null
    ? null
    : validateVisibleEntityToken(parsed, {
      displayedObjectId: baseObjectId,
      knownObjectIds: new Set(),
      artifactBaseObjects,
    });
}

/**
 * Create a one-shot channel for row-local visible identity metadata.
 * @param options Generated artifact catalog used to validate publications.
 * @returns A session-scoped publish, consume, and cleanup API.
 */
export function createVisibleIdentityTokenChannel(options: {
  artifactBaseObjects: ReadonlyMap<string, string>;
  knownObjectIds?: ReadonlySet<string>;
}): VisibleIdentityTokenChannel {
  const sessions = new Map<
    string,
    Map<number, { baseObjectId: string; token: string }>
  >();

  return {
    publishRow(input): void {
      const token = validateVisibleEntityToken(
        input.token,
        {
          displayedObjectId: input.baseObjectId,
          knownObjectIds: options.knownObjectIds ?? new Set(),
          artifactBaseObjects: options.artifactBaseObjects,
        },
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

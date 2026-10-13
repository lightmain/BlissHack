import {
  validateCoreEntityChunk,
  validateCoreManifest,
  validateGlyphBindingChunk,
  type CoreAssetMetadata,
  type CoreEncyclopediaManifest,
  type CoreEntityRecord,
  type GlyphAssetMetadata,
  type GlyphBindingResult,
} from "./core-schema";
import {
  validateWikiChunk,
  validateWikiManifest,
  type WikiChunkMetadata,
  type WikiManifest,
  type WikiRecord,
} from "./wiki-schema";
import {
  assertRuntimeIdentityMatches,
  decodeRuntimeManifest,
  verifyRuntimeAssetBytes,
  type RuntimeAssetIdentity,
  type RuntimeManifest,
} from "../bridge/runtime-manifest";

interface LoadOptions {
  signal?: AbortSignal;
}

interface FetchOptions {
  signal?: AbortSignal;
}

type FetchBytes = (
  url: string,
  options?: FetchOptions,
) => Promise<Uint8Array>;

export interface LoadedEncyclopediaEntity {
  core: CoreEntityRecord;
  nethackVersion?: string;
  wiki: WikiRecord | null;
}

export interface EncyclopediaLoader {
  loadGlyphBinding(
    glyph: number,
    options?: LoadOptions,
  ): Promise<GlyphBindingResult | null>;
  loadEntity(
    entityId: string,
    options?: LoadOptions,
  ): Promise<LoadedEncyclopediaEntity | null>;
  loadArtifactBaseObjects(
    options?: LoadOptions,
  ): Promise<ReadonlyMap<string, string>>;
}

interface PendingBytes {
  controller: AbortController;
  promise: Promise<Uint8Array>;
  subscribers: number;
  settled: boolean;
}

interface CoreContext {
  manifest: CoreEncyclopediaManifest;
  runtime: RuntimeManifest;
}

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

/**
 * Create an integrity-checking lazy loader for local encyclopedia assets.
 * @param options Asset fetcher and manifest base URLs.
 * @returns Loader methods for glyph bindings, entities, and artifact metadata.
 */
export function createEncyclopediaLoader(options: {
  fetchBytes?: FetchBytes;
  runtimeIdentity: RuntimeAssetIdentity;
  runtimeManifestUrl: string;
  coreBaseUrl: string;
  wikiBaseUrl: string;
}): EncyclopediaLoader {
  const fetchBytes = options.fetchBytes ?? defaultFetchBytes;
  const resolvedBytes = new Map<string, Uint8Array>();
  const pendingBytes = new Map<string, PendingBytes>();
  let coreContextPromise: Promise<CoreContext> | null = null;
  let wikiManifestPromise: Promise<WikiManifest> | null = null;

  /**
   * Fetch one asset, sharing the request while preserving caller cancellation.
   * @param url Asset URL.
   * @param signal Optional caller-owned abort signal.
   * @returns Independent bytes for validation and parsing.
   */
  async function loadBytes(
    url: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    throwIfAborted(signal);
    const cached = resolvedBytes.get(url);
    if (cached) {
      throwIfAborted(signal);
      return cached.slice();
    }

    let pending = pendingBytes.get(url);
    if (!pending || pending.controller.signal.aborted) {
      const controller = new AbortController();
      pending = {
        controller,
        promise: Promise.resolve(new Uint8Array()),
        subscribers: 0,
        settled: false,
      };
      const entry = pending;
      entry.promise = fetchBytes(url, { signal: controller.signal })
        .then((bytes) => {
          const stored = bytes.slice();
          resolvedBytes.set(url, stored);
          return stored;
        })
        .finally(() => {
          entry.settled = true;
          if (pendingBytes.get(url) === entry) {
            pendingBytes.delete(url);
          }
        });
      pendingBytes.set(url, entry);
    }

    pending.subscribers += 1;
    try {
      const bytes = await waitForCaller(pending.promise, signal);
      throwIfAborted(signal);
      return bytes.slice();
    } finally {
      pending.subscribers -= 1;
      if (pending.subscribers === 0 && !pending.settled) {
        pending.controller.abort();
      }
    }
  }

  /**
   * Load and bind the core manifest to the current WASM runtime metadata.
   * @param signal Optional caller-owned abort signal.
   * @returns Validated core context.
   */
  async function loadCoreContext(signal?: AbortSignal): Promise<CoreContext> {
    if (!signal && coreContextPromise) return coreContextPromise;
    const operation = (async () => {
      const runtimeBytes = await loadBytes(options.runtimeManifestUrl, signal);
      const runtime = decodeRuntimeManifest(runtimeBytes);
      assertRuntimeIdentityMatches(options.runtimeIdentity, runtime);
      const coreUrl = assetUrl(options.coreBaseUrl, "manifest.json");
      const coreBytes = await loadBytes(coreUrl, signal);
      await verifyRuntimeAssetBytes(
        coreBytes,
        runtime.encyclopedia.core.manifest,
        coreUrl,
      );
      const manifest = validateCoreManifest(parseJson(coreBytes, "core manifest"));
      if (
        manifest.sourceFingerprint
          !== runtime.encyclopedia.core.sourceFingerprint
      ) {
        throw new Error("Runtime and core encyclopedia fingerprints differ");
      }
      throwIfAborted(signal);
      return { manifest, runtime };
    })();
    if (!signal) {
      coreContextPromise = operation.catch((error: unknown) => {
        coreContextPromise = null;
        throw error;
      });
      return coreContextPromise;
    }
    return operation;
  }

  /**
   * Load the optional Wiki manifest without weakening core failures.
   * @param signal Optional caller-owned abort signal.
   * @returns Validated Wiki manifest.
   */
  async function loadWikiManifest(signal?: AbortSignal): Promise<WikiManifest> {
    if (!signal && wikiManifestPromise) return wikiManifestPromise;
    const operation = (async () => {
      const { runtime } = await loadCoreContext(signal);
      const url = assetUrl(options.wikiBaseUrl, "manifest.json");
      const bytes = await loadBytes(url, signal);
      await verifyRuntimeAssetBytes(
        bytes,
        runtime.encyclopedia.wiki.manifest,
        url,
      );
      return validateWikiManifest(parseJson(bytes, "Wiki manifest"));
    })();
    if (!signal) {
      wikiManifestPromise = operation.catch((error: unknown) => {
        wikiManifestPromise = null;
        throw error;
      });
      return wikiManifestPromise;
    }
    return operation;
  }

  /**
   * Load and validate one core entity chunk.
   * @param metadata Trusted core chunk metadata.
   * @param signal Optional caller-owned abort signal.
   * @returns Validated entity records.
   */
  async function loadCoreChunk(
    metadata: CoreAssetMetadata,
    signal?: AbortSignal,
  ): Promise<CoreEntityRecord[]> {
    const url = assetUrl(options.coreBaseUrl, metadata.file);
    const bytes = await loadBytes(url, signal);
    await verifyRuntimeAssetBytes(bytes, metadata, url);
    return validateCoreEntityChunk(
      parseJson(bytes, metadata.file),
      metadata,
    ).records;
  }

  /**
   * Load and validate one glyph binding chunk.
   * @param metadata Trusted glyph chunk metadata.
   * @param signal Optional caller-owned abort signal.
   * @returns Validated glyph results.
   */
  async function loadGlyphChunk(
    metadata: GlyphAssetMetadata,
    signal?: AbortSignal,
  ): Promise<GlyphBindingResult[]> {
    const url = assetUrl(options.coreBaseUrl, metadata.file);
    const bytes = await loadBytes(url, signal);
    await verifyRuntimeAssetBytes(bytes, metadata, url);
    return validateGlyphBindingChunk(
      parseJson(bytes, metadata.file),
      metadata,
    ).bindings;
  }

  /**
   * Load the Wiki record matching one core entity, if a reviewed chunk exists.
   * @param entityId Canonical core entity ID.
   * @param signal Optional caller-owned abort signal.
   * @returns Matching record or null.
   */
  async function loadWikiRecord(
    entityId: string,
    signal?: AbortSignal,
  ): Promise<WikiRecord | null> {
    const manifest = await loadWikiManifest(signal);
    const metadata = findWikiChunk(manifest, entityId);
    if (!metadata) return null;
    const url = assetUrl(options.wikiBaseUrl, metadata.file);
    const bytes = await loadBytes(url, signal);
    await verifyRuntimeAssetBytes(bytes, metadata, url);
    const chunk = validateWikiChunk(
      parseJson(bytes, metadata.file),
      metadata,
      manifest,
    );
    await verifyWikiParagraphHashes(chunk.records, signal);
    return chunk.records.find((record) => record.entityId === entityId) ?? null;
  }

  return {
    async loadGlyphBinding(glyph, loadOptions = {}) {
      throwIfAborted(loadOptions.signal);
      if (!Number.isSafeInteger(glyph) || glyph < 0) return null;
      const { manifest } = await loadCoreContext(loadOptions.signal);
      throwIfAborted(loadOptions.signal);
      if (glyph >= manifest.glyphBindings.maxGlyph) return null;
      const metadata = manifest.glyphBindings.chunks.find((chunk) =>
        glyph >= chunk.firstGlyph
        && glyph < chunk.firstGlyph + chunk.count
      );
      if (!metadata) {
        throw new Error(`Core manifest does not cover glyph ${glyph}`);
      }
      const bindings = await loadGlyphChunk(metadata, loadOptions.signal);
      throwIfAborted(loadOptions.signal);
      return bindings[glyph - metadata.firstGlyph] ?? null;
    },

    async loadEntity(entityId, loadOptions = {}) {
      throwIfAborted(loadOptions.signal);
      const { manifest } = await loadCoreContext(loadOptions.signal);
      const metadata = findCoreChunk(manifest, entityId);
      if (!metadata) return null;
      const records = await loadCoreChunk(metadata, loadOptions.signal);
      const core = records.find((record) => record.id === entityId);
      if (!core) {
        throw new Error(`${metadata.file} does not contain ${entityId}`);
      }
      let wiki: WikiRecord | null = null;
      try {
        wiki = await loadWikiRecord(entityId, loadOptions.signal);
      } catch (error) {
        if (loadOptions.signal?.aborted) {
          throw abortReason(loadOptions.signal);
        }
        if (isAbortError(error)) throw error;
      }
      throwIfAborted(loadOptions.signal);
      return {
        core,
        nethackVersion: manifest.nethackVersion,
        wiki,
      };
    },

    async loadArtifactBaseObjects(loadOptions = {}) {
      throwIfAborted(loadOptions.signal);
      const { manifest } = await loadCoreContext(loadOptions.signal);
      const chunks = manifest.chunks.filter((chunk) =>
        chunk.kind === "artifact"
      );
      const records = (
        await Promise.all(
          chunks.map((chunk) => loadCoreChunk(chunk, loadOptions.signal)),
        )
      ).flat();
      const entries = records.map((record) => {
        const baseObjectId = record.facts.baseObjectId;
        if (typeof baseObjectId !== "string") {
          throw new Error(`${record.id} has no artifact base object`);
        }
        return [record.id, baseObjectId] as const;
      });
      throwIfAborted(loadOptions.signal);
      return new Map(entries);
    },
  };
}

/**
 * Fetch one same-origin asset with browser credentials.
 * @param url Asset URL.
 * @param options Optional abort signal.
 * @returns Response bytes.
 */
async function defaultFetchBytes(
  url: string,
  options?: FetchOptions,
): Promise<Uint8Array> {
  const response = await fetch(url, {
    credentials: "same-origin",
    signal: options?.signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Parse UTF-8 JSON without accepting malformed byte sequences.
 * @param bytes Encoded JSON.
 * @param label Diagnostic label.
 * @returns Parsed untrusted value.
 */
function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON`);
  }
}

/**
 * Wait for shared bytes while allowing one caller to cancel independently.
 * @param promise Shared fetch operation.
 * @param signal Optional caller-owned abort signal.
 * @returns Shared bytes after this caller remains active.
 */
async function waitForCaller(
  promise: Promise<Uint8Array>,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<Uint8Array>((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

/**
 * Throw the caller signal's abort reason when cancellation has occurred.
 * @param signal Optional caller-owned abort signal.
 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

/**
 * Normalize one caller-owned abort signal to a standard rejection.
 * @param signal Aborted caller signal.
 * @returns Existing Error reason or a standard AbortError.
 */
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

/**
 * Recompute every published paragraph digest before returning Wiki text.
 * @param records Strictly validated Wiki records.
 * @param signal Optional caller-owned abort signal.
 */
async function verifyWikiParagraphHashes(
  records: WikiRecord[],
  signal?: AbortSignal,
): Promise<void> {
  for (const record of records) {
    for (const section of record.sections) {
      for (let index = 0; index < section.paragraphs.length; index += 1) {
        throwIfAborted(signal);
        const digest = await globalThis.crypto.subtle.digest(
          "SHA-256",
          encoder.encode(section.paragraphs[index]),
        );
        const actual = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0")
        ).join("");
        if (actual !== section.paragraphHashes[index]) {
          throw new Error(
            `${record.entityId} Wiki paragraph ${index} digest mismatch`,
          );
        }
      }
    }
  }
  throwIfAborted(signal);
}

/**
 * Find the manifest chunk whose sorted ID range contains an entity.
 * @param manifest Validated core manifest.
 * @param entityId Entity ID to locate.
 * @returns Matching chunk metadata or null.
 */
function findCoreChunk(
  manifest: CoreEncyclopediaManifest,
  entityId: string,
): CoreAssetMetadata | null {
  const kind = entityId.slice(0, entityId.indexOf(":"));
  return manifest.chunks.find((chunk) =>
    chunk.kind === kind
    && entityId >= chunk.firstId
    && entityId <= chunk.lastId
  ) ?? null;
}

/**
 * Find the reviewed Wiki chunk whose sorted ID range contains an entity.
 * @param manifest Validated Wiki manifest.
 * @param entityId Entity ID to locate.
 * @returns Matching chunk metadata or null.
 */
function findWikiChunk(
  manifest: WikiManifest,
  entityId: string,
): WikiChunkMetadata | null {
  return manifest.chunks.find((chunk) =>
    entityId >= chunk.firstEntityId
    && entityId <= chunk.lastEntityId
  ) ?? null;
}

/**
 * Build a child asset URL from a controlled flat filename.
 * @param baseUrl Configured directory URL.
 * @param filename Validated or constant flat filename.
 * @returns Joined URL.
 */
function assetUrl(baseUrl: string, filename: string): string {
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}${filename}`;
}

/**
 * Identify a standard abort rejection without masking it as optional Wiki data.
 * @param error Rejection value.
 * @returns True for an AbortError.
 */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

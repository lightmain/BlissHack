import { describe, expect, it, vi } from "vitest";
import { createEncyclopediaLoader } from "./encyclopedia-loader";
import {
  bindChunkMetadata,
  bindRuntimeToCore,
  createEncyclopediaAssetFixture,
  type EncyclopediaAssetFixture,
  readJsonAsset,
  runtimeIdentityForFixture,
  writeJsonAsset,
} from "./encyclopedia-loader.test-fixtures";
import type { RuntimeAssetIdentity } from "../bridge/runtime-manifest";

interface FetchAssetOptions {
  signal?: AbortSignal;
}

type FetchAsset = (
  url: string,
  options?: FetchAssetOptions,
) => Promise<Uint8Array>;

interface PreloadCapableLoader {
  preload(options?: FetchAssetOptions): Promise<void>;
}

/**
 * Create a fetch spy backed by one mutable in-memory asset graph.
 * @param fixture Asset graph.
 * @returns Byte fetch spy.
 */
function fixtureFetcher(fixture: EncyclopediaAssetFixture) {
  return vi.fn<FetchAsset>(async (url, options) => {
    if (options?.signal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    const bytes = fixture.assets.get(url);
    if (!bytes) {
      throw new Error(`Asset not found: ${url}`);
    }
    return bytes.slice();
  });
}

/**
 * Create a loader configured for fixture URLs.
 * @param fixture Asset graph.
 * @param fetchBytes Optional fetch implementation.
 * @returns Runtime encyclopedia loader.
 */
function fixtureLoader(
  fixture: EncyclopediaAssetFixture,
  fetchBytes: FetchAsset = fixtureFetcher(fixture),
  runtimeIdentity: RuntimeAssetIdentity = runtimeIdentityForFixture(fixture),
) {
  return createEncyclopediaLoader({
    fetchBytes,
    runtimeIdentity,
    runtimeManifestUrl: fixture.urls.runtimeManifest,
    coreBaseUrl: "/encyclopedia/core/",
    wikiBaseUrl: "/encyclopedia/wiki/",
  });
}

/**
 * Count calls to one URL.
 * @param fetchBytes Fetch spy.
 * @param url URL to count.
 * @returns Number of calls.
 */
function callsForUrl(
  fetchBytes: ReturnType<typeof fixtureFetcher>,
  url: string,
): number {
  return fetchBytes.mock.calls.filter(([calledUrl]) => calledUrl === url)
    .length;
}

/**
 * Require the stage-six manifest preload API without weakening its contract.
 * @param loader Runtime loader under test.
 * @returns Bound preload method.
 */
function requirePreload(
  loader: ReturnType<typeof fixtureLoader>,
): PreloadCapableLoader["preload"] {
  const preload = (loader as unknown as Partial<PreloadCapableLoader>).preload;
  expect(
    preload,
    "stage six requires EncyclopediaLoader.preload({ signal? })",
  ).toBeTypeOf("function");
  return preload!.bind(loader);
}

describe("encyclopedia manifest preload", () => {
  it("validates only runtime, core, and optional Wiki manifests", async () => {
    const fixture = createEncyclopediaAssetFixture();
    const fetchBytes = fixtureFetcher(fixture);
    const preload = requirePreload(fixtureLoader(fixture, fetchBytes));

    await expect(preload()).resolves.toBeUndefined();

    for (const url of [
      fixture.urls.runtimeManifest,
      fixture.urls.coreManifest,
      fixture.urls.wikiManifest,
    ]) {
      expect(callsForUrl(fetchBytes, url), url).toBe(1);
    }
    for (const url of [
      fixture.urls.glyphChunk,
      fixture.urls.visibleObjectBindings,
      fixture.urls.entityChunk,
      fixture.urls.artifactChunk,
      fixture.urls.objectChunk,
      fixture.urls.wikiChunk,
    ]) {
      expect(callsForUrl(fetchBytes, url), url).toBe(0);
    }
    expect(fetchBytes).toHaveBeenCalledTimes(3);
  });

  it.each([
    {
      label: "runtime manifest",
      failedUrl(fixture: EncyclopediaAssetFixture) {
        return fixture.urls.runtimeManifest;
      },
    },
    {
      label: "core manifest",
      failedUrl(fixture: EncyclopediaAssetFixture) {
        return fixture.urls.coreManifest;
      },
    },
  ])("rejects a $label failure", async ({ failedUrl }) => {
    const fixture = createEncyclopediaAssetFixture();
    const rejectedUrl = failedUrl(fixture);
    const fetchBytes: FetchAsset = async (url, options) => {
      if (options?.signal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      if (url === rejectedUrl) throw new Error(`Failed to fetch ${url}`);
      const bytes = fixture.assets.get(url);
      if (!bytes) throw new Error(`Asset not found: ${url}`);
      return bytes.slice();
    };
    const preload = requirePreload(fixtureLoader(fixture, fetchBytes));

    await expect(preload()).rejects.toThrow(`Failed to fetch ${rejectedUrl}`);
  });

  it("degrades a Wiki manifest failure without loading any chunks", async () => {
    const fixture = createEncyclopediaAssetFixture();
    const fetchBytes = fixtureFetcher(fixture);
    fetchBytes.mockImplementation(async (url, options) => {
      if (options?.signal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      if (url === fixture.urls.wikiManifest) {
        throw new Error("Wiki manifest is unavailable");
      }
      const bytes = fixture.assets.get(url);
      if (!bytes) throw new Error(`Asset not found: ${url}`);
      return bytes.slice();
    });
    const preload = requirePreload(fixtureLoader(fixture, fetchBytes));

    await expect(preload()).resolves.toBeUndefined();
    for (const url of [
      fixture.urls.glyphChunk,
      fixture.urls.visibleObjectBindings,
      fixture.urls.entityChunk,
      fixture.urls.artifactChunk,
      fixture.urls.objectChunk,
      fixture.urls.wikiChunk,
    ]) {
      expect(callsForUrl(fetchBytes, url), url).toBe(0);
    }
  });

  it("propagates abort while the optional Wiki manifest is pending", async () => {
    const fixture = createEncyclopediaAssetFixture();
    let markWikiRequested: (() => void) | undefined;
    const wikiRequested = new Promise<void>((resolve) => {
      markWikiRequested = resolve;
    });
    const fetchBytes: FetchAsset = async (url, options) => {
      if (url !== fixture.urls.wikiManifest) {
        const bytes = fixture.assets.get(url);
        if (!bytes) throw new Error(`Asset not found: ${url}`);
        return bytes.slice();
      }
      markWikiRequested?.();
      return await new Promise<Uint8Array>((_resolve, reject) => {
        const abort = () =>
          reject(new DOMException("The operation was aborted", "AbortError"));
        options?.signal?.addEventListener("abort", abort, { once: true });
        if (options?.signal?.aborted) abort();
      });
    };
    const controller = new AbortController();
    const preload = requirePreload(fixtureLoader(fixture, fetchBytes));
    const pending = preload({ signal: controller.signal });

    await wikiRequested;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("encyclopedia runtime loader", () => {
  it("strictly loads runtime-bound core data and optional Wiki text", async () => {
    const fixture = createEncyclopediaAssetFixture();
    const fetchBytes = fixtureFetcher(fixture);
    const loader = fixtureLoader(fixture, fetchBytes);

    await expect(loader.loadGlyphBinding(0)).resolves.toMatchObject({
      glyph: 0,
      status: "supported",
      binding: {
        kind: "terrain",
        terrainId: "terrain:S_FOUNTAIN",
      },
    });
    await expect(loader.loadEntity("terrain:S_FOUNTAIN")).resolves
      .toMatchObject({
        core: {
          id: "terrain:S_FOUNTAIN",
          family: "terrain",
        },
        wiki: {
          entityId: "terrain:S_FOUNTAIN",
          page: {
            title: "Fountain",
            revisionId: 12345,
          },
        },
      });
    expect(callsForUrl(fetchBytes, fixture.urls.runtimeManifest)).toBe(1);
    expect(callsForUrl(fetchBytes, fixture.urls.coreManifest)).toBe(1);
  });

  it("loads an exact object identity only from its manifest-bound index", async () => {
    const fixture = createEncyclopediaAssetFixture();
    const fetchBytes = fixtureFetcher(fixture);
    const loader = fixtureLoader(fixture, fetchBytes);

    await expect(loader.loadObjectIdForGlyph(0))
      .resolves.toBe("object:TEST_OBJECT");
    await expect(loader.loadObjectIdForGlyph(-1)).resolves.toBeNull();
    await expect(loader.loadObjectIdForGlyph(1)).resolves.toBeNull();
    expect(callsForUrl(
      fetchBytes,
      fixture.urls.visibleObjectBindings,
    )).toBe(1);
  });

  it("loads an artifact as its base object plus an additive overlay", async () => {
    const fixture = createEncyclopediaAssetFixture();
    const fetchBytes = fixtureFetcher(fixture);
    const loader = fixtureLoader(fixture, fetchBytes);

    await expect(loader.loadEntity("artifact:ART_TEST")).resolves
      .toMatchObject({
        core: {
          id: "artifact:ART_TEST",
          family: "artifact",
          facts: { baseObjectId: "object:TEST_WEAPON" },
        },
        artifactBaseObject: {
          id: "object:TEST_WEAPON",
          family: "object",
          facts: {
            objectClass: "WEAPON_CLASS",
            subtype: {
              damageSmall: 6,
              damageLarge: 8,
              skill: "P_SPEAR",
            },
          },
        },
      });
    expect(callsForUrl(fetchBytes, fixture.urls.artifactChunk)).toBe(1);
    expect(callsForUrl(fetchBytes, fixture.urls.objectChunk)).toBe(1);
  });

  it("never requests Wiki data for a generic appearance record", async () => {
    const fixture = createEncyclopediaAssetFixture();
    const appearanceId = "appearance:POTION_CLASS:GENERIC";
    const coreChunk = readJsonAsset(fixture, fixture.urls.entityChunk);
    coreChunk.family = "appearance";
    coreChunk.records[0] = {
      schemaVersion: 2,
      id: appearanceId,
      family: "appearance",
      names: { primary: "potion of healing from untrusted text" },
      symbol: 33,
      color: 5,
      facts: { objectClass: "POTION_CLASS" },
      sourceRefs: [{
        path: "include/objects.h",
        symbol: "POTION_CLASS",
      }],
    };
    writeJsonAsset(fixture, fixture.urls.entityChunk, coreChunk);

    const coreManifest = readJsonAsset(
      fixture,
      fixture.urls.coreManifest,
    );
    coreManifest.entityCounts.appearance = 1;
    coreManifest.entityCounts.terrain = 0;
    const coreMetadata = coreManifest.chunks.find(
      (chunk: { file: string }) => chunk.file === "terrain-001.json",
    );
    coreMetadata.family = "appearance";
    coreMetadata.firstId = appearanceId;
    coreMetadata.lastId = appearanceId;
    writeJsonAsset(fixture, fixture.urls.coreManifest, coreManifest);
    bindChunkMetadata(
      fixture,
      fixture.urls.coreManifest,
      fixture.urls.entityChunk,
    );

    const wikiChunk = readJsonAsset(fixture, fixture.urls.wikiChunk);
    wikiChunk.records[0].entityId = appearanceId;
    wikiChunk.records[0].page.title = "Potion of healing";
    writeJsonAsset(fixture, fixture.urls.wikiChunk, wikiChunk);
    const wikiManifest = readJsonAsset(
      fixture,
      fixture.urls.wikiManifest,
    );
    wikiManifest.chunks[0].firstEntityId = appearanceId;
    wikiManifest.chunks[0].lastEntityId = appearanceId;
    wikiManifest.revisions[0].entityId = appearanceId;
    wikiManifest.revisions[0].title = "Potion of healing";
    writeJsonAsset(fixture, fixture.urls.wikiManifest, wikiManifest);
    bindChunkMetadata(
      fixture,
      fixture.urls.wikiManifest,
      fixture.urls.wikiChunk,
    );
    bindRuntimeToCore(fixture);

    const fetchBytes = fixtureFetcher(fixture);
    const loader = fixtureLoader(fixture, fetchBytes);
    await expect(loader.loadEntity(appearanceId)).resolves.toMatchObject({
      core: { id: appearanceId, family: "appearance" },
      wiki: null,
    });
    expect(callsForUrl(fetchBytes, fixture.urls.wikiManifest)).toBe(0);
    expect(callsForUrl(fetchBytes, fixture.urls.wikiChunk)).toBe(0);
  });

  it.each([
    {
      label: "core manifest byte length",
      mutate(runtime: Record<string, any>) {
        runtime.encyclopedia.core.manifest.bytes += 1;
      },
    },
    {
      label: "core manifest digest",
      mutate(runtime: Record<string, any>) {
        runtime.encyclopedia.core.manifest.sha256 = "0".repeat(64);
      },
    },
    {
      label: "source fingerprint",
      mutate(runtime: Record<string, any>) {
        runtime.encyclopedia.core.sourceFingerprint = "1".repeat(64);
      },
    },
  ])("fails closed on a mismatched runtime $label", async ({ mutate }) => {
    const fixture = createEncyclopediaAssetFixture();
    const runtime = readJsonAsset(fixture, fixture.urls.runtimeManifest);
    mutate(runtime);
    writeJsonAsset(fixture, fixture.urls.runtimeManifest, runtime);

    await expect(fixtureLoader(fixture).loadGlyphBinding(0)).rejects
      .toThrow();
  });

  it("fails closed when the active module WASM identity differs", async () => {
    const fixture = createEncyclopediaAssetFixture();
    const identity = runtimeIdentityForFixture(fixture);
    identity.wasm.sha256 = "0".repeat(64);

    await expect(
      fixtureLoader(fixture, fixtureFetcher(fixture), identity)
        .loadGlyphBinding(0),
    ).rejects.toThrow(/runtime identity/);
  });

  it.each([
    {
      label: "core encyclopedia root",
      mutate(fixture: EncyclopediaAssetFixture) {
        const manifest = readJsonAsset(fixture, fixture.urls.coreManifest);
        manifest.generatorVersion = "1.0.1";
        writeJsonAsset(fixture, fixture.urls.coreManifest, manifest);
      },
    },
    {
      label: "Wiki encyclopedia root",
      mutate(fixture: EncyclopediaAssetFixture) {
        const manifest = readJsonAsset(fixture, fixture.urls.wikiManifest);
        manifest.generatorVersion = "1.0.1";
        writeJsonAsset(fixture, fixture.urls.wikiManifest, manifest);
      },
    },
  ])(
    "rejects a replacement $label for the same active WASM",
    async ({ mutate }) => {
      const fixture = createEncyclopediaAssetFixture();
      const identity = runtimeIdentityForFixture(fixture);
      mutate(fixture);
      bindRuntimeToCore(fixture);

      await expect(
        fixtureLoader(fixture, fixtureFetcher(fixture), identity)
          .loadEntity("terrain:S_FOUNTAIN"),
      ).rejects.toThrow(/runtime identity/);
    },
  );

  it("rejects a core manifest schema error even when runtime metadata matches", async () => {
    const fixture = createEncyclopediaAssetFixture();
    const manifest = readJsonAsset(fixture, fixture.urls.coreManifest);
    manifest.schemaVersion = 1;
    writeJsonAsset(fixture, fixture.urls.coreManifest, manifest);
    bindRuntimeToCore(fixture);

    await expect(fixtureLoader(fixture).loadGlyphBinding(0)).rejects
      .toThrow();
  });

  it.each([
    {
      label: "glyph chunk digest",
      asset: "glyphChunk" as const,
      load: "glyph" as const,
      mutate(fixture: EncyclopediaAssetFixture) {
        const bytes = fixture.assets.get(fixture.urls.glyphChunk)!;
        fixture.assets.set(
          fixture.urls.glyphChunk,
          Uint8Array.from([...bytes, 0x20]),
        );
      },
    },
    {
      label: "glyph chunk byte length",
      asset: "glyphChunk" as const,
      load: "glyph" as const,
      mutate(fixture: EncyclopediaAssetFixture) {
        const manifest = readJsonAsset(fixture, fixture.urls.coreManifest);
        manifest.glyphBindings.chunks[0].bytes += 1;
        writeJsonAsset(fixture, fixture.urls.coreManifest, manifest);
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "glyph chunk schema",
      asset: "glyphChunk" as const,
      load: "glyph" as const,
      mutate(fixture: EncyclopediaAssetFixture) {
        const chunk = readJsonAsset(fixture, fixture.urls.glyphChunk);
        chunk.schemaVersion = 1;
        writeJsonAsset(fixture, fixture.urls.glyphChunk, chunk);
        bindChunkMetadata(
          fixture,
          fixture.urls.coreManifest,
          fixture.urls.glyphChunk,
        );
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "entity chunk digest",
      asset: "entityChunk" as const,
      load: "entity" as const,
      mutate(fixture: EncyclopediaAssetFixture) {
        const bytes = fixture.assets.get(fixture.urls.entityChunk)!;
        fixture.assets.set(
          fixture.urls.entityChunk,
          Uint8Array.from([...bytes, 0x20]),
        );
      },
    },
    {
      label: "entity chunk byte length",
      asset: "entityChunk" as const,
      load: "entity" as const,
      mutate(fixture: EncyclopediaAssetFixture) {
        const manifest = readJsonAsset(fixture, fixture.urls.coreManifest);
        const metadata = manifest.chunks.find(
          (chunk: { file: string }) => chunk.file === "terrain-001.json",
        );
        metadata.bytes += 1;
        writeJsonAsset(fixture, fixture.urls.coreManifest, manifest);
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "entity chunk schema",
      asset: "entityChunk" as const,
      load: "entity" as const,
      mutate(fixture: EncyclopediaAssetFixture) {
        const chunk = readJsonAsset(fixture, fixture.urls.entityChunk);
        chunk.schemaVersion = 1;
        writeJsonAsset(fixture, fixture.urls.entityChunk, chunk);
        bindChunkMetadata(
          fixture,
          fixture.urls.coreManifest,
          fixture.urls.entityChunk,
        );
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "visible object index digest",
      asset: "visibleObjectBindings" as const,
      load: "object" as const,
      mutate(fixture: EncyclopediaAssetFixture) {
        const bytes = fixture.assets.get(
          fixture.urls.visibleObjectBindings,
        )!;
        fixture.assets.set(
          fixture.urls.visibleObjectBindings,
          Uint8Array.from([...bytes, 0x20]),
        );
      },
    },
    {
      label: "visible object index byte length",
      asset: "visibleObjectBindings" as const,
      load: "object" as const,
      mutate(fixture: EncyclopediaAssetFixture) {
        const manifest = readJsonAsset(fixture, fixture.urls.coreManifest);
        manifest.visibleObjectBindings.bytes += 1;
        writeJsonAsset(fixture, fixture.urls.coreManifest, manifest);
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "visible object index schema",
      asset: "visibleObjectBindings" as const,
      load: "object" as const,
      mutate(fixture: EncyclopediaAssetFixture) {
        const index = readJsonAsset(
          fixture,
          fixture.urls.visibleObjectBindings,
        );
        index.schemaVersion = 1;
        writeJsonAsset(fixture, fixture.urls.visibleObjectBindings, index);
        bindChunkMetadata(
          fixture,
          fixture.urls.coreManifest,
          fixture.urls.visibleObjectBindings,
        );
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "visible object index duplicate glyph",
      asset: "visibleObjectBindings" as const,
      load: "object" as const,
      mutate(fixture: EncyclopediaAssetFixture) {
        const index = readJsonAsset(
          fixture,
          fixture.urls.visibleObjectBindings,
        );
        index.bindings.push(structuredClone(index.bindings[0]));
        writeJsonAsset(fixture, fixture.urls.visibleObjectBindings, index);
        bindChunkMetadata(
          fixture,
          fixture.urls.coreManifest,
          fixture.urls.visibleObjectBindings,
        );
        const manifest = readJsonAsset(fixture, fixture.urls.coreManifest);
        manifest.visibleObjectBindings.count = index.bindings.length;
        writeJsonAsset(fixture, fixture.urls.coreManifest, manifest);
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "visible object index out-of-range glyph",
      asset: "visibleObjectBindings" as const,
      load: "object" as const,
      mutate(fixture: EncyclopediaAssetFixture) {
        const index = readJsonAsset(
          fixture,
          fixture.urls.visibleObjectBindings,
        );
        index.bindings[0].glyph = 1;
        writeJsonAsset(fixture, fixture.urls.visibleObjectBindings, index);
        bindChunkMetadata(
          fixture,
          fixture.urls.coreManifest,
          fixture.urls.visibleObjectBindings,
        );
        bindRuntimeToCore(fixture);
      },
    },
  ])("fails closed on a $label error", async ({ load, mutate }) => {
    const fixture = createEncyclopediaAssetFixture();
    mutate(fixture);
    const loader = fixtureLoader(fixture);

    const pending = load === "glyph"
      ? loader.loadGlyphBinding(0)
      : load === "object"
      ? loader.loadObjectIdForGlyph(0)
      : loader.loadEntity("terrain:S_FOUNTAIN");
    await expect(pending).rejects.toThrow();
  });

  it("aborts the exact object index fetch after its only caller is cancelled", async () => {
    const fixture = createEncyclopediaAssetFixture();
    let requestedSignal: AbortSignal | undefined;
    let markIndexRequested: (() => void) | undefined;
    const indexRequested = new Promise<void>((resolve) => {
      markIndexRequested = resolve;
    });
    const fetchBytes: FetchAsset = async (url, options) => {
      if (url !== fixture.urls.visibleObjectBindings) {
        const bytes = fixture.assets.get(url);
        if (!bytes) throw new Error(`Asset not found: ${url}`);
        return bytes.slice();
      }
      requestedSignal = options?.signal;
      markIndexRequested?.();
      return await new Promise<Uint8Array>((_resolve, reject) => {
        const abort = () =>
          reject(new DOMException("The operation was aborted", "AbortError"));
        options?.signal?.addEventListener("abort", abort, { once: true });
        if (options?.signal?.aborted) abort();
      });
    };
    const controller = new AbortController();
    const pending = fixtureLoader(fixture, fetchBytes).loadObjectIdForGlyph(
      0,
      { signal: controller.signal },
    );

    await indexRequested;
    expect(requestedSignal).toBeDefined();
    expect(requestedSignal).not.toBe(controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(requestedSignal?.aborted).toBe(true);
  });

  it("deduplicates concurrent manifest and chunk requests and reuses cache", async () => {
    const fixture = createEncyclopediaAssetFixture();
    const fetchBytes = fixtureFetcher(fixture);
    const loader = fixtureLoader(fixture, fetchBytes);

    const [first, second] = await Promise.all([
      loader.loadEntity("terrain:S_FOUNTAIN"),
      loader.loadEntity("terrain:S_FOUNTAIN"),
    ]);
    const third = await loader.loadEntity("terrain:S_FOUNTAIN");

    expect(first).toEqual(second);
    expect(second).toEqual(third);
    for (const url of [
      fixture.urls.runtimeManifest,
      fixture.urls.coreManifest,
      fixture.urls.entityChunk,
      fixture.urls.wikiManifest,
      fixture.urls.wikiChunk,
    ]) {
      expect(callsForUrl(fetchBytes, url), url).toBe(1);
    }
  });

  it("deduplicates signaled requests while aborting callers independently", async () => {
    const fixture = createEncyclopediaAssetFixture();
    let requestedSignal: AbortSignal | undefined;
    let markEntityRequested: (() => void) | undefined;
    let releaseEntity: (() => void) | undefined;
    const entityRequested = new Promise<void>((resolve) => {
      markEntityRequested = resolve;
    });
    const entityReleased = new Promise<void>((resolve) => {
      releaseEntity = resolve;
    });
    const fetchSpy = vi.fn<FetchAsset>(async (url, options) => {
      const bytes = fixture.assets.get(url);
      if (!bytes) throw new Error(`Asset not found: ${url}`);
      if (url !== fixture.urls.entityChunk) return bytes.slice();
      requestedSignal = options?.signal;
      markEntityRequested?.();
      await entityReleased;
      if (options?.signal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      return bytes.slice();
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const loader = fixtureLoader(fixture, fetchSpy);
    const first = loader.loadEntity("terrain:S_FOUNTAIN", {
      signal: firstController.signal,
    });
    const firstOutcome = first.then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    const second = loader.loadEntity("terrain:S_FOUNTAIN", {
      signal: secondController.signal,
    });

    await entityRequested;
    expect(requestedSignal).toBeDefined();
    expect(requestedSignal).not.toBe(firstController.signal);
    expect(requestedSignal).not.toBe(secondController.signal);
    expect(callsForUrl(fetchSpy, fixture.urls.entityChunk)).toBe(1);
    firstController.abort();
    await expect(firstOutcome).resolves.toMatchObject({
      status: "rejected",
      error: { name: "AbortError" },
    });
    releaseEntity?.();

    await expect(second).resolves.toMatchObject({
      core: { id: "terrain:S_FOUNTAIN" },
    });
  });

  it("rejects an aborted caller even when every required asset is cached", async () => {
    const fixture = createEncyclopediaAssetFixture();
    const fetchBytes = fixtureFetcher(fixture);
    const loader = fixtureLoader(fixture, fetchBytes);
    await loader.loadEntity("terrain:S_FOUNTAIN");
    const callsBeforeAbort = fetchBytes.mock.calls.length;
    const controller = new AbortController();
    controller.abort();

    await expect(
      loader.loadEntity("terrain:S_FOUNTAIN", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchBytes.mock.calls).toHaveLength(callsBeforeAbort);
  });

  it("aborts the shared fetch after its only caller is cancelled", async () => {
    const fixture = createEncyclopediaAssetFixture();
    let requestedSignal: AbortSignal | undefined;
    let markEntityRequested: (() => void) | undefined;
    const entityRequested = new Promise<void>((resolve) => {
      markEntityRequested = resolve;
    });
    const fetchBytes: FetchAsset = async (url, options) => {
      if (url !== fixture.urls.entityChunk) {
        const bytes = fixture.assets.get(url);
        if (!bytes) throw new Error(`Asset not found: ${url}`);
        return bytes.slice();
      }
      requestedSignal = options?.signal;
      markEntityRequested?.();
      return await new Promise<Uint8Array>((resolve, reject) => {
        const abort = () =>
          reject(new DOMException("The operation was aborted", "AbortError"));
        options?.signal?.addEventListener("abort", abort, { once: true });
        if (options?.signal?.aborted) abort();
        void resolve;
      });
    };
    const controller = new AbortController();
    const pending = fixtureLoader(fixture, fetchBytes).loadEntity(
      "terrain:S_FOUNTAIN",
      { signal: controller.signal },
    );

    await entityRequested;
    expect(requestedSignal).toBeDefined();
    expect(requestedSignal).not.toBe(controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(requestedSignal?.aborted).toBe(true);
  });

  it.each([
    {
      label: "Wiki manifest runtime digest",
      mutate(fixture: EncyclopediaAssetFixture) {
        const manifest = readJsonAsset(fixture, fixture.urls.wikiManifest);
        manifest.generatorVersion = "1.0.1";
        writeJsonAsset(fixture, fixture.urls.wikiManifest, manifest);
      },
    },
    {
      label: "Wiki manifest schema",
      mutate(fixture: EncyclopediaAssetFixture) {
        const manifest = readJsonAsset(fixture, fixture.urls.wikiManifest);
        manifest.schemaVersion = 2;
        writeJsonAsset(fixture, fixture.urls.wikiManifest, manifest);
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "Wiki manifest unknown field",
      mutate(fixture: EncyclopediaAssetFixture) {
        const manifest = readJsonAsset(fixture, fixture.urls.wikiManifest);
        manifest.unexpected = true;
        writeJsonAsset(fixture, fixture.urls.wikiManifest, manifest);
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "Wiki manifest unsafe chunk path",
      mutate(fixture: EncyclopediaAssetFixture) {
        const manifest = readJsonAsset(fixture, fixture.urls.wikiManifest);
        manifest.chunks[0].file = "../wiki-001.json";
        writeJsonAsset(fixture, fixture.urls.wikiManifest, manifest);
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "Wiki chunk digest",
      mutate(fixture: EncyclopediaAssetFixture) {
        const bytes = fixture.assets.get(fixture.urls.wikiChunk)!;
        fixture.assets.set(
          fixture.urls.wikiChunk,
          Uint8Array.from([...bytes, 0x20]),
        );
      },
    },
    {
      label: "Wiki chunk byte length",
      mutate(fixture: EncyclopediaAssetFixture) {
        const manifest = readJsonAsset(fixture, fixture.urls.wikiManifest);
        manifest.chunks[0].bytes += 1;
        writeJsonAsset(fixture, fixture.urls.wikiManifest, manifest);
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "Wiki chunk schema",
      mutate(fixture: EncyclopediaAssetFixture) {
        const chunk = readJsonAsset(fixture, fixture.urls.wikiChunk);
        chunk.schemaVersion = 2;
        writeJsonAsset(fixture, fixture.urls.wikiChunk, chunk);
        bindChunkMetadata(
          fixture,
          fixture.urls.wikiManifest,
          fixture.urls.wikiChunk,
        );
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "Wiki attribution",
      mutate(fixture: EncyclopediaAssetFixture) {
        const chunk = readJsonAsset(fixture, fixture.urls.wikiChunk);
        chunk.records[0].page.authorLabel = "Someone else";
        writeJsonAsset(fixture, fixture.urls.wikiChunk, chunk);
        bindChunkMetadata(
          fixture,
          fixture.urls.wikiManifest,
          fixture.urls.wikiChunk,
        );
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "Wiki source URL",
      mutate(fixture: EncyclopediaAssetFixture) {
        const chunk = readJsonAsset(fixture, fixture.urls.wikiChunk);
        chunk.records[0].page.sourceUrl =
          "https://nethackwiki.com/wiki/Fountain";
        writeJsonAsset(fixture, fixture.urls.wikiChunk, chunk);
        bindChunkMetadata(
          fixture,
          fixture.urls.wikiManifest,
          fixture.urls.wikiChunk,
        );
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "Wiki modifications",
      mutate(fixture: EncyclopediaAssetFixture) {
        const chunk = readJsonAsset(fixture, fixture.urls.wikiChunk);
        chunk.records[0].modifications = ["wording unchanged"];
        writeJsonAsset(fixture, fixture.urls.wikiChunk, chunk);
        bindChunkMetadata(
          fixture,
          fixture.urls.wikiManifest,
          fixture.urls.wikiChunk,
        );
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "Wiki paragraph digest",
      mutate(fixture: EncyclopediaAssetFixture) {
        const chunk = readJsonAsset(fixture, fixture.urls.wikiChunk);
        chunk.records[0].sections[0].paragraphHashes[0] = "0".repeat(64);
        writeJsonAsset(fixture, fixture.urls.wikiChunk, chunk);
        bindChunkMetadata(
          fixture,
          fixture.urls.wikiManifest,
          fixture.urls.wikiChunk,
        );
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "Wiki manifest aggregate",
      mutate(fixture: EncyclopediaAssetFixture) {
        const manifest = readJsonAsset(fixture, fixture.urls.wikiManifest);
        manifest.recordCount = 2;
        writeJsonAsset(fixture, fixture.urls.wikiManifest, manifest);
        bindRuntimeToCore(fixture);
      },
    },
    {
      label: "Wiki revision cross-reference",
      mutate(fixture: EncyclopediaAssetFixture) {
        const manifest = readJsonAsset(fixture, fixture.urls.wikiManifest);
        manifest.revisions[0].revisionId += 1;
        writeJsonAsset(fixture, fixture.urls.wikiManifest, manifest);
        bindRuntimeToCore(fixture);
      },
    },
  ])("degrades a $label failure to core facts only", async ({ mutate }) => {
    const fixture = createEncyclopediaAssetFixture();
    mutate(fixture);

    await expect(
      fixtureLoader(fixture).loadEntity("terrain:S_FOUNTAIN"),
    ).resolves.toMatchObject({
      core: {
        id: "terrain:S_FOUNTAIN",
      },
      wiki: null,
    });
  });

  it("degrades a Wiki fetch failure to core facts only", async () => {
    const fixture = createEncyclopediaAssetFixture();
    const fetchBytes: FetchAsset = async (url, options) => {
      if (url === fixture.urls.wikiManifest) {
        throw new Error("Wiki is unavailable");
      }
      return fixtureFetcher(fixture)(url, options);
    };

    await expect(
      fixtureLoader(fixture, fetchBytes)
        .loadEntity("terrain:S_FOUNTAIN"),
    ).resolves.toMatchObject({
      core: {
        id: "terrain:S_FOUNTAIN",
      },
      wiki: null,
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { createEncyclopediaLoader } from "./encyclopedia-loader";
import {
  bindChunkMetadata,
  bindRuntimeToCore,
  createEncyclopediaAssetFixture,
  type EncyclopediaAssetFixture,
  readJsonAsset,
  writeJsonAsset,
} from "./encyclopedia-loader.test-fixtures";

interface FetchAssetOptions {
  signal?: AbortSignal;
}

type FetchAsset = (
  url: string,
  options?: FetchAssetOptions,
) => Promise<Uint8Array>;

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
) {
  return createEncyclopediaLoader({
    fetchBytes,
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
          kind: "terrain",
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

  it.each([
    {
      label: "core manifest byte length",
      mutate(runtime: Record<string, any>) {
        runtime.encyclopedia.manifest.bytes += 1;
      },
    },
    {
      label: "core manifest digest",
      mutate(runtime: Record<string, any>) {
        runtime.encyclopedia.manifest.sha256 = "0".repeat(64);
      },
    },
    {
      label: "source fingerprint",
      mutate(runtime: Record<string, any>) {
        runtime.encyclopedia.sourceFingerprint = "1".repeat(64);
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

  it("rejects a core manifest schema error even when runtime metadata matches", async () => {
    const fixture = createEncyclopediaAssetFixture();
    const manifest = readJsonAsset(fixture, fixture.urls.coreManifest);
    manifest.schemaVersion = 2;
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
        chunk.schemaVersion = 2;
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
        manifest.chunks[0].bytes += 1;
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
        chunk.schemaVersion = 2;
        writeJsonAsset(fixture, fixture.urls.entityChunk, chunk);
        bindChunkMetadata(
          fixture,
          fixture.urls.coreManifest,
          fixture.urls.entityChunk,
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
      : loader.loadEntity("terrain:S_FOUNTAIN");
    await expect(pending).rejects.toThrow();
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

  it("forwards AbortSignal and rejects a pending request after abort", async () => {
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
    expect(requestedSignal).toBe(controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each([
    {
      label: "Wiki manifest schema",
      mutate(fixture: EncyclopediaAssetFixture) {
        const manifest = readJsonAsset(fixture, fixture.urls.wikiManifest);
        manifest.schemaVersion = 2;
        writeJsonAsset(fixture, fixture.urls.wikiManifest, manifest);
      },
    },
    {
      label: "Wiki manifest unknown field",
      mutate(fixture: EncyclopediaAssetFixture) {
        const manifest = readJsonAsset(fixture, fixture.urls.wikiManifest);
        manifest.unexpected = true;
        writeJsonAsset(fixture, fixture.urls.wikiManifest, manifest);
      },
    },
    {
      label: "Wiki manifest unsafe chunk path",
      mutate(fixture: EncyclopediaAssetFixture) {
        const manifest = readJsonAsset(fixture, fixture.urls.wikiManifest);
        manifest.chunks[0].file = "../wiki-001.json";
        writeJsonAsset(fixture, fixture.urls.wikiManifest, manifest);
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

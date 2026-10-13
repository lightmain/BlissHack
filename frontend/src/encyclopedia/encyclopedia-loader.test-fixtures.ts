import { createHash } from "node:crypto";

export const TEST_ASSET_URLS = Object.freeze({
  runtimeManifest: "/nethack-runtime.json",
  coreManifest: "/encyclopedia/core/manifest.json",
  glyphChunk: "/encyclopedia/core/glyph-bindings-001.json",
  entityChunk: "/encyclopedia/core/terrain-001.json",
  wikiManifest: "/encyclopedia/wiki/manifest.json",
  wikiChunk: "/encyclopedia/wiki/wiki-001.json",
});

export interface EncyclopediaAssetFixture {
  assets: Map<string, Uint8Array>;
  urls: typeof TEST_ASSET_URLS;
}

const encoder = new TextEncoder();

/**
 * Encode a JSON value using the same compact UTF-8 representation as assets.
 * @param value JSON-compatible fixture value.
 * @returns Encoded fixture bytes.
 */
export function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

/**
 * Parse one JSON fixture asset.
 * @param fixture Fixture containing the asset.
 * @param url Asset URL.
 * @returns Parsed JSON value.
 */
export function readJsonAsset(
  fixture: EncyclopediaAssetFixture,
  url: string,
): Record<string, any> {
  const bytes = fixture.assets.get(url);
  if (!bytes) {
    throw new Error(`Missing fixture asset ${url}`);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Replace one JSON fixture asset.
 * @param fixture Fixture containing the asset.
 * @param url Asset URL.
 * @param value JSON-compatible replacement value.
 */
export function writeJsonAsset(
  fixture: EncyclopediaAssetFixture,
  url: string,
  value: unknown,
): void {
  fixture.assets.set(url, encodeJson(value));
}

/**
 * Calculate the lowercase SHA-256 digest for fixture bytes.
 * @param bytes Bytes to hash.
 * @returns Lowercase digest.
 */
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Rebind one manifest chunk entry to its current fixture bytes.
 * @param fixture Fixture containing the manifest and chunk.
 * @param manifestUrl Manifest URL.
 * @param chunkUrl Chunk URL.
 */
export function bindChunkMetadata(
  fixture: EncyclopediaAssetFixture,
  manifestUrl: string,
  chunkUrl: string,
): void {
  const manifest = readJsonAsset(fixture, manifestUrl);
  const chunkBytes = fixture.assets.get(chunkUrl);
  if (!chunkBytes) {
    throw new Error(`Missing fixture chunk ${chunkUrl}`);
  }
  const filename = chunkUrl.slice(chunkUrl.lastIndexOf("/") + 1);
  const entries = [
    ...(manifest.chunks ?? []),
    ...(manifest.glyphBindings?.chunks ?? []),
  ];
  const metadata = entries.find((entry: any) => entry.file === filename);
  if (!metadata) {
    throw new Error(`Missing metadata for ${filename}`);
  }
  metadata.bytes = chunkBytes.byteLength;
  metadata.sha256 = sha256(chunkBytes);
  writeJsonAsset(fixture, manifestUrl, manifest);
}

/**
 * Rebind runtime metadata to the current core manifest bytes and fingerprint.
 * @param fixture Fixture containing runtime and core manifests.
 */
export function bindRuntimeToCore(
  fixture: EncyclopediaAssetFixture,
): void {
  const runtime = readJsonAsset(fixture, fixture.urls.runtimeManifest);
  const core = readJsonAsset(fixture, fixture.urls.coreManifest);
  const coreBytes = fixture.assets.get(fixture.urls.coreManifest);
  if (!coreBytes) {
    throw new Error("Missing core manifest fixture");
  }
  runtime.encyclopedia.manifest.bytes = coreBytes.byteLength;
  runtime.encyclopedia.manifest.sha256 = sha256(coreBytes);
  runtime.encyclopedia.sourceFingerprint = core.sourceFingerprint;
  writeJsonAsset(fixture, fixture.urls.runtimeManifest, runtime);
}

/**
 * Build a complete minimal runtime, core, glyph, and Wiki asset graph.
 * @returns Independent mutable fixture.
 */
export function createEncyclopediaAssetFixture(): EncyclopediaAssetFixture {
  const urls = TEST_ASSET_URLS;
  const sourceFingerprint = "a".repeat(64);
  const entityId = "terrain:S_FOUNTAIN";
  const entityChunk = {
    schemaVersion: 1,
    kind: "terrain",
    records: [{
      schemaVersion: 1,
      id: entityId,
      kind: "terrain",
      names: { primary: "fountain" },
      symbol: 123,
      color: 6,
      facts: {
        terrainSymbol: "S_FOUNTAIN",
        category: "feature",
      },
      sourceRefs: [{
        path: "include/defsym.h",
        symbol: "S_FOUNTAIN",
      }],
    }],
  };
  const glyphChunk = {
    schemaVersion: 1,
    bindings: [{
      glyph: 0,
      status: "supported",
      binding: {
        kind: "terrain",
        terrainId: entityId,
        variant: "default",
      },
    }],
  };
  const wikiParagraph = "A fountain is a dungeon feature.";
  const wikiChunk = {
    schemaVersion: 1,
    records: [{
      schemaVersion: 1,
      entityId,
      page: {
        title: "Fountain",
        revisionId: 12345,
        revisionTimestamp: "2026-01-02T03:04:05Z",
        sourceUrl:
          "https://nethackwiki.com/index.php?title=Fountain&oldid=12345",
        historyUrl:
          "https://nethackwiki.com/index.php?title=Fountain&action=history",
        authorLabel: "NetHackWiki contributors",
      },
      license: {
        spdxLikeId: "CC-BY-SA-3.0",
        name: "Creative Commons Attribution-ShareAlike 3.0 Unported",
        url: "https://creativecommons.org/licenses/by-sa/3.0/",
      },
      modifications: [
        "internal link destinations omitted",
        "Wiki markup omitted",
        "wording unchanged",
      ],
      sections: [{
        tab: "strategy",
        sourceHeading: "Strategy",
        paragraphs: [wikiParagraph],
        paragraphHashes: [sha256(encoder.encode(wikiParagraph))],
      }],
    }],
  };
  const entityBytes = encodeJson(entityChunk);
  const glyphBytes = encodeJson(glyphChunk);
  const wikiBytes = encodeJson(wikiChunk);
  const coreManifest = {
    schemaVersion: 1,
    nethackVersion: "5.0.0",
    generatorVersion: "1.0.0",
    compileDefines: ["TILES_IN_GLYPHMAP"],
    sourceInputs: [],
    sourceFingerprint,
    entityCounts: {
      artifact: 0,
      monster: 0,
      object: 0,
      terrain: 1,
      trap: 0,
    },
    chunks: [{
      kind: "terrain",
      file: "terrain-001.json",
      bytes: entityBytes.byteLength,
      sha256: sha256(entityBytes),
      count: 1,
      firstId: entityId,
      lastId: entityId,
    }],
    glyphBindings: {
      maxGlyph: 1,
      chunks: [{
        file: "glyph-bindings-001.json",
        firstGlyph: 0,
        count: 1,
        bytes: glyphBytes.byteLength,
        sha256: sha256(glyphBytes),
      }],
    },
  };
  const wikiManifest = {
    schemaVersion: 1,
    generatorVersion: "1.0.0",
    parser: {
      packageName: "wikiparser-node",
      version: "1.48.0",
    },
    recordCount: 1,
    chunks: [{
      file: "wiki-001.json",
      bytes: wikiBytes.byteLength,
      sha256: sha256(wikiBytes),
      count: 1,
      firstEntityId: entityId,
      lastEntityId: entityId,
    }],
    revisions: [{
      entityId,
      title: "Fountain",
      revisionId: 12345,
      sha256: "b".repeat(64),
    }],
  };
  const coreManifestBytes = encodeJson(coreManifest);
  const runtimeManifest = {
    schemaVersion: 2,
    emscriptenVersion: "6.0.9",
    nodeMajor: 24,
    luaVersion: "5.4.8",
    hintsFile: "sys/unix/hints/macOS.500",
    buildTools: {
      node: "v24.19.0",
      make: "GNU Make 3.81",
      hostCompiler: "Apple clang",
    },
    files: {
      "nethack.js": {
        bytes: 1,
        sha256: "c".repeat(64),
      },
      "nethack.wasm": {
        bytes: 8,
        sha256: "d".repeat(64),
      },
    },
    encyclopedia: {
      manifest: {
        bytes: coreManifestBytes.byteLength,
        sha256: sha256(coreManifestBytes),
      },
      sourceFingerprint,
    },
  };
  return {
    urls,
    assets: new Map([
      [urls.runtimeManifest, encodeJson(runtimeManifest)],
      [urls.coreManifest, coreManifestBytes],
      [urls.glyphChunk, glyphBytes],
      [urls.entityChunk, entityBytes],
      [urls.wikiManifest, encodeJson(wikiManifest)],
      [urls.wikiChunk, wikiBytes],
    ]),
  };
}

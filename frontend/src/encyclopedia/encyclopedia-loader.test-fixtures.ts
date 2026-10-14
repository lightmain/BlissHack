import { createHash } from "node:crypto";
import type {
  RuntimeAssetIdentity,
  RuntimeFileMetadata,
} from "../bridge/runtime-manifest";

export const TEST_ASSET_URLS = Object.freeze({
  runtimeManifest: "/nethack-runtime.json",
  coreManifest: "/encyclopedia/core/manifest.json",
  glyphChunk: "/encyclopedia/core/glyph-bindings-001.json",
  visibleObjectBindings: "/encyclopedia/core/visible-object-bindings.json",
  entityChunk: "/encyclopedia/core/terrain-001.json",
  artifactChunk: "/encyclopedia/core/artifact-001.json",
  objectChunk: "/encyclopedia/core/object-001.json",
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
    manifest.visibleObjectBindings,
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
  const wikiBytes = fixture.assets.get(fixture.urls.wikiManifest);
  if (!coreBytes) {
    throw new Error("Missing core manifest fixture");
  }
  if (!wikiBytes) {
    throw new Error("Missing Wiki manifest fixture");
  }
  runtime.encyclopedia.core.manifest.bytes = coreBytes.byteLength;
  runtime.encyclopedia.core.manifest.sha256 = sha256(coreBytes);
  runtime.encyclopedia.core.sourceFingerprint = core.sourceFingerprint;
  runtime.encyclopedia.wiki.manifest.bytes = wikiBytes.byteLength;
  runtime.encyclopedia.wiki.manifest.sha256 = sha256(wikiBytes);
  writeJsonAsset(fixture, fixture.urls.runtimeManifest, runtime);
}

/**
 * Read the immutable WASM identity expected by the fixture runtime manifest.
 * @param fixture Fixture containing the runtime manifest.
 * @returns Runtime identity supplied by an initialized module.
 */
export function runtimeIdentityForFixture(
  fixture: EncyclopediaAssetFixture,
): RuntimeAssetIdentity & { loader: RuntimeFileMetadata } {
  const runtime = readJsonAsset(fixture, fixture.urls.runtimeManifest);
  return {
    loader: {
      bytes: runtime.files["nethack.js"].bytes,
      sha256: runtime.files["nethack.js"].sha256,
    },
    wasm: {
      bytes: runtime.files["nethack.wasm"].bytes,
      sha256: runtime.files["nethack.wasm"].sha256,
    },
    encyclopedia: structuredClone(runtime.encyclopedia),
  };
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
    schemaVersion: 2,
    family: "terrain",
    records: [{
      schemaVersion: 2,
      id: entityId,
      family: "terrain",
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
  const artifactId = "artifact:ART_TEST";
  const objectId = "object:TEST_WEAPON";
  const artifactChunk = {
    schemaVersion: 2,
    family: "artifact",
    records: [{
      schemaVersion: 2,
      id: artifactId,
      family: "artifact",
      names: { primary: "The Test Artifact" },
      symbol: null,
      color: null,
      facts: {
        baseObjectId: objectId,
        flags: ["SPFX_INTEL"],
        carryFlags: ["SPFX_WARN"],
        target: null,
        attack: {
          attackType: "AT_WEAP",
          damageType: "AD_FIRE",
          dice: { count: 2, sides: 4 },
        },
        defense: {
          attackType: "AT_NONE",
          damageType: "AD_COLD",
          dice: { count: 0, sides: 0 },
        },
        carry: {
          attackType: "AT_NONE",
          damageType: "AD_ELEC",
          dice: { count: 0, sides: 0 },
        },
        invoke: null,
        alignment: "A_LAWFUL",
        role: null,
        race: null,
        generationEnchantment: 3,
        giftValue: 7,
        baseCost: 4000,
      },
      sourceRefs: [{
        path: "include/artilist.h",
        symbol: "ART_TEST",
      }],
    }],
  };
  const objectChunk = {
    schemaVersion: 2,
    family: "object",
    records: [{
      schemaVersion: 2,
      id: objectId,
      family: "object",
      names: { primary: "test weapon" },
      symbol: 41,
      color: 7,
      facts: {
        objectClass: "WEAPON_CLASS",
        material: "IRON",
        probability: 7,
        weight: 40,
        baseCost: 23,
        useDelay: 1,
        property: null,
        flags: {
          nameKnown: true,
          merge: false,
          usesKnown: false,
          magic: true,
          charged: false,
          unique: false,
          notWishable: true,
          big: true,
          tough: false,
        },
        subtype: {
          damageSmall: 6,
          damageLarge: 8,
          hitBonus: 2,
          skill: "P_SPEAR",
          projectile: false,
          strikeModes: ["PIERCE", "SLASH"],
        },
      },
      sourceRefs: [{
        path: "include/objects.h",
        symbol: "TEST_WEAPON",
      }],
    }],
  };
  const glyphChunk = {
    schemaVersion: 2,
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
  const visibleObjectBindings = {
    schemaVersion: 2,
    bindings: [{
      glyph: 0,
      objectId: "object:TEST_OBJECT",
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
  const artifactBytes = encodeJson(artifactChunk);
  const objectBytes = encodeJson(objectChunk);
  const glyphBytes = encodeJson(glyphChunk);
  const visibleObjectBytes = encodeJson(visibleObjectBindings);
  const wikiBytes = encodeJson(wikiChunk);
  const coreManifest = {
    schemaVersion: 2,
    nethackVersion: "5.0.0",
    generatorVersion: "1.0.0",
    compileDefines: ["TILES_IN_GLYPHMAP"],
    sourceInputs: [],
    sourceFingerprint,
    entityCounts: {
      appearance: 0,
      artifact: 1,
      monster: 0,
      object: 1,
      terrain: 1,
      trap: 0,
    },
    chunks: [
      {
        family: "artifact",
        file: "artifact-001.json",
        bytes: artifactBytes.byteLength,
        sha256: sha256(artifactBytes),
        count: 1,
        firstId: artifactId,
        lastId: artifactId,
      },
      {
        family: "object",
        file: "object-001.json",
        bytes: objectBytes.byteLength,
        sha256: sha256(objectBytes),
        count: 1,
        firstId: objectId,
        lastId: objectId,
      },
      {
        family: "terrain",
        file: "terrain-001.json",
        bytes: entityBytes.byteLength,
        sha256: sha256(entityBytes),
        count: 1,
        firstId: entityId,
        lastId: entityId,
      },
    ],
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
    visibleObjectBindings: {
      file: "visible-object-bindings.json",
      bytes: visibleObjectBytes.byteLength,
      sha256: sha256(visibleObjectBytes),
      count: 1,
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
    schemaVersion: 3,
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
      core: {
        manifest: {
          bytes: coreManifestBytes.byteLength,
          sha256: sha256(coreManifestBytes),
        },
        sourceFingerprint,
      },
      wiki: {
        manifest: {
          bytes: encodeJson(wikiManifest).byteLength,
          sha256: sha256(encodeJson(wikiManifest)),
        },
      },
    },
  };
  return {
    urls,
    assets: new Map([
      [urls.runtimeManifest, encodeJson(runtimeManifest)],
      [urls.coreManifest, coreManifestBytes],
      [urls.glyphChunk, glyphBytes],
      [urls.visibleObjectBindings, visibleObjectBytes],
      [urls.entityChunk, entityBytes],
      [urls.artifactChunk, artifactBytes],
      [urls.objectChunk, objectBytes],
      [urls.wikiManifest, encodeJson(wikiManifest)],
      [urls.wikiChunk, wikiBytes],
    ]),
  };
}

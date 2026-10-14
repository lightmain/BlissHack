/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  validateCoreEntityChunk,
  validateCoreEntityRecord,
  validateCoreManifest,
  validateGlyphBindingChunk,
  validateVisibleObjectBindingAsset,
} from "./core-schema";

const CORE_SCHEMA_SOURCE = readFileSync(
  new URL("./core-schema.ts", import.meta.url),
  "utf8",
);
const ENTITY_FAMILIES = [
  "appearance",
  "artifact",
  "monster",
  "object",
  "terrain",
  "trap",
] as const;
const OBJECT_CLASSES = [
  "ILLOBJ_CLASS",
  "WEAPON_CLASS",
  "ARMOR_CLASS",
  "RING_CLASS",
  "AMULET_CLASS",
  "TOOL_CLASS",
  "FOOD_CLASS",
  "POTION_CLASS",
  "SCROLL_CLASS",
  "SPBOOK_CLASS",
  "WAND_CLASS",
  "COIN_CLASS",
  "GEM_CLASS",
  "ROCK_CLASS",
  "BALL_CLASS",
  "CHAIN_CLASS",
  "VENOM_CLASS",
] as const;
const HASH = "0".repeat(64);

/** Build one schema-v2 terrain record without relying on production types. */
function v2TerrainRecord(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    id: "terrain:S_FOUNTAIN",
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
  };
}

/** Build the legacy v1 equivalent for fail-closed boundary checks. */
function v1TerrainRecord(): Record<string, unknown> {
  const record = v2TerrainRecord();
  delete record.family;
  record.schemaVersion = 1;
  record.kind = "terrain";
  return record;
}

/** Build one schema-v2 object record for an exact NetHack object class. */
function v2ObjectRecord(objectClass: string): Record<string, unknown> {
  const subtype = objectClass === "WEAPON_CLASS"
      || objectClass === "TOOL_CLASS"
    ? {
      damageSmall: 4,
      damageLarge: 3,
      hitBonus: 2,
      skill: "P_DAGGER",
      projectile: false,
      strikeModes: ["PIERCE"],
    }
    : objectClass === "ARMOR_CLASS"
    ? {
      category: "ARM_SUIT",
      armorClass: 7,
      magicCancellation: 2,
    }
    : objectClass === "FOOD_CLASS"
    ? { nutrition: 800 }
    : objectClass === "SPBOOK_CLASS"
    ? { skill: "P_ATTACK_SPELL", level: 2 }
    : {};
  return {
    schemaVersion: 2,
    id: `object:TEST_${objectClass}`,
    family: "object",
    names: { primary: `test ${objectClass.toLowerCase()}` },
    symbol: 41,
    color: 7,
    facts: {
      objectClass,
      material: "IRON",
      probability: 1,
      weight: 10,
      baseCost: 5,
      useDelay: 0,
      property: null,
      flags: {
        nameKnown: true,
        merge: false,
        usesKnown: false,
        magic: false,
        charged: false,
        unique: false,
        notWishable: false,
        big: false,
        tough: false,
      },
      subtype,
    },
    sourceRefs: [{
      path: "include/objects.h",
      symbol: `TEST_${objectClass}`,
    }],
  };
}

/** Build one complete schema-v2 manifest around the terrain fixture. */
function v2Manifest(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    nethackVersion: "5.0.0",
    generatorVersion: "2.0.0",
    compileDefines: [],
    sourceInputs: [],
    sourceFingerprint: HASH,
    entityCounts: {
      appearance: 0,
      artifact: 0,
      monster: 0,
      object: 0,
      terrain: 1,
      trap: 0,
    },
    chunks: [{
      family: "terrain",
      file: "terrain-001.json",
      bytes: 1,
      sha256: HASH,
      count: 1,
      firstId: "terrain:S_FOUNTAIN",
      lastId: "terrain:S_FOUNTAIN",
    }],
    glyphBindings: {
      maxGlyph: 1,
      chunks: [{
        file: "glyph-bindings-001.json",
        firstGlyph: 0,
        count: 1,
        bytes: 1,
        sha256: HASH,
      }],
    },
    visibleObjectBindings: {
      file: "visible-object-bindings.json",
      bytes: 1,
      sha256: HASH,
      count: 1,
    },
  };
}

const V2_TERRAIN_METADATA = {
  family: "terrain",
  file: "terrain-001.json",
  bytes: 1,
  sha256: HASH,
  count: 1,
  firstId: "terrain:S_FOUNTAIN",
  lastId: "terrain:S_FOUNTAIN",
} as unknown as Parameters<typeof validateCoreEntityChunk>[1];
const V2_GLYPH_METADATA = {
  file: "glyph-bindings-001.json",
  firstGlyph: 0,
  count: 1,
  bytes: 1,
  sha256: HASH,
};
const V2_VISIBLE_OBJECT_METADATA = {
  file: "visible-object-bindings.json",
  bytes: 1,
  sha256: HASH,
  count: 1,
};
const V2_GLYPH_CHUNK = {
  schemaVersion: 2,
  bindings: [{
    glyph: 0,
    status: "supported",
    binding: {
      kind: "terrain",
      terrainId: "terrain:S_FOUNTAIN",
      variant: "default",
    },
  }],
};
const V2_VISIBLE_OBJECT_BINDINGS = {
  schemaVersion: 2,
  bindings: [{
    glyph: 0,
    objectId: "object:TEST_OBJECT",
  }],
};

describe("core encyclopedia schema v2", () => {
  it("names the six loading families without retaining CoreEntityKind", () => {
    expect(CORE_SCHEMA_SOURCE).toMatch(
      /export\s+type\s+EncyclopediaEntityFamily\s*=/,
    );
    expect(CORE_SCHEMA_SOURCE).not.toMatch(
      /(?:export\s+type|interface|type)\s+CoreEntityKind\b/,
    );
    for (const family of ENTITY_FAMILIES) {
      expect(CORE_SCHEMA_SOURCE).toContain(`| "${family}"`);
    }
  });

  it("accepts v2 manifest, record, chunk, glyph, and visible-object envelopes", () => {
    expect(() => validateCoreManifest(v2Manifest())).not.toThrow();
    expect(() => validateCoreEntityRecord(v2TerrainRecord())).not.toThrow();
    expect(() => validateCoreEntityChunk({
      schemaVersion: 2,
      family: "terrain",
      records: [v2TerrainRecord()],
    }, V2_TERRAIN_METADATA)).not.toThrow();
    expect(() => validateGlyphBindingChunk(
      V2_GLYPH_CHUNK,
      V2_GLYPH_METADATA,
    )).not.toThrow();
    expect(() => validateVisibleObjectBindingAsset(
      V2_VISIBLE_OBJECT_BINDINGS,
      V2_VISIBLE_OBJECT_METADATA,
      1,
    )).not.toThrow();
  });

  it.each([
    ["manifest", () => validateCoreManifest({
      ...v2Manifest(),
      schemaVersion: 1,
      chunks: [{
        kind: "terrain",
        file: "terrain-001.json",
        bytes: 1,
        sha256: HASH,
        count: 1,
        firstId: "terrain:S_FOUNTAIN",
        lastId: "terrain:S_FOUNTAIN",
      }],
    })],
    ["record", () => validateCoreEntityRecord(v1TerrainRecord())],
    ["entity chunk", () => validateCoreEntityChunk({
      schemaVersion: 1,
      kind: "terrain",
      records: [v1TerrainRecord()],
    }, {
      kind: "terrain",
      file: "terrain-001.json",
      bytes: 1,
      sha256: HASH,
      count: 1,
      firstId: "terrain:S_FOUNTAIN",
      lastId: "terrain:S_FOUNTAIN",
    } as unknown as Parameters<typeof validateCoreEntityChunk>[1])],
    ["glyph chunk", () => validateGlyphBindingChunk({
      ...V2_GLYPH_CHUNK,
      schemaVersion: 1,
    }, V2_GLYPH_METADATA)],
    ["visible-object binding", () => validateVisibleObjectBindingAsset({
      ...V2_VISIBLE_OBJECT_BINDINGS,
      schemaVersion: 1,
    }, V2_VISIBLE_OBJECT_METADATA, 1)],
  ])("fails closed on a legacy v1 %s", (_label, validate) => {
    expect(validate).toThrow(/schema|version/i);
  });
});

describe("schema-v2 object class contract", () => {
  it.each(OBJECT_CLASSES)(
    "accepts %s as a complete objectClass dispatch source",
    (objectClass) => {
      expect(() => validateCoreEntityRecord(v2ObjectRecord(objectClass)))
        .not.toThrow();
    },
  );

  it("rejects object classes outside the complete NetHack mapping", () => {
    expect(() => validateCoreEntityRecord(v2ObjectRecord("FUTURE_CLASS")))
      .toThrow(/objectClass|class/i);
  });

  it("removes the duplicate subtype kind discriminator", () => {
    expect(CORE_SCHEMA_SOURCE).not.toMatch(/subtype\.kind/);
    expect(CORE_SCHEMA_SOURCE).not.toMatch(
      /["']kind["'][^\n]*damageSmall|damageSmall[^\n]*["']kind["']/,
    );
    for (const objectClass of OBJECT_CLASSES) {
      const record = v2ObjectRecord(objectClass);
      const facts = record.facts as Record<string, unknown>;
      const subtype = facts.subtype as Record<string, unknown>;
      expect(subtype).not.toHaveProperty("kind");
    }
  });
});

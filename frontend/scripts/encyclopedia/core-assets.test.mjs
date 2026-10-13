import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  generateCoreEncyclopedia,
  validateCoreAssetDirectory,
  verifyCoreEncyclopedia,
} from "./core-assets.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const checkedInCoreDirectory = join(
  repositoryRoot,
  "frontend/public/encyclopedia/core",
);
const expectedEntityCounts = {
  appearance: 17,
  monster: 383,
  object: 463,
  artifact: 33,
  terrain: 49,
  trap: 25,
};
const requiredFingerprintInputs = [
  "include/artilist.h",
  "include/artifact.h",
  "include/config.h",
  "include/defsym.h",
  "include/display.h",
  "include/monattk.h",
  "include/monflag.h",
  "include/monsters.h",
  "include/objclass.h",
  "include/objects.h",
  "include/permonst.h",
  "include/rm.h",
  "include/sym.h",
  "include/trap.h",
  "src/makemon.c",
];
const temporaryDirectories = [];
let generatedDirectory;
let manifest;
let records;
let bindings;

/**
 * Return a lowercase SHA-256 digest for bytes.
 * @param {Uint8Array|string} value - Bytes or UTF-8 text to hash.
 * @returns {string} Lowercase hexadecimal digest.
 */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Serialize JSON using the repository's deterministic asset format.
 * @param {unknown} value - JSON-compatible value.
 * @returns {Buffer} Pretty-printed UTF-8 bytes with one trailing newline.
 */
function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Read and parse one JSON file.
 * @param {string} path - JSON file path.
 * @returns {Promise<any>} Parsed JSON value.
 */
async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * Recursively collect file bytes and nanosecond modification times.
 * @param {string} root - Root directory whose relative paths form keys.
 * @param {string} [current] - Current recursive directory.
 * @returns {Promise<Record<string, {bytes: Buffer, mtimeNs: bigint}>>}
 * Comparable directory snapshot.
 */
async function directorySnapshot(root, current = root) {
  const snapshot = {};
  for (const entry of (await readdir(current, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      Object.assign(snapshot, await directorySnapshot(root, path));
    } else {
      const metadata = await stat(path, { bigint: true });
      snapshot[relative(root, path)] = {
        bytes: await readFile(path),
        mtimeNs: metadata.mtimeNs,
      };
    }
  }
  return snapshot;
}

/**
 * Recursively collect only file bytes for deterministic comparisons.
 * @param {string} root - Directory to read.
 * @returns {Promise<Record<string, Buffer>>} Relative files and bytes.
 */
async function directoryBytes(root) {
  const snapshot = await directorySnapshot(root);
  return Object.fromEntries(
    Object.entries(snapshot).map(([path, value]) => [path, value.bytes]),
  );
}

/**
 * Load all entity records and glyph bindings declared by a manifest.
 * @param {string} directory - Generated core asset directory.
 * @param {Record<string, any>} coreManifest - Parsed core manifest.
 * @returns {Promise<{records: any[], bindings: any[]}>} Flattened catalogs.
 */
async function loadCatalog(directory, coreManifest) {
  const orderedGlyphChunks = [...coreManifest.glyphBindings.chunks]
    .sort((left, right) => left.firstGlyph - right.firstGlyph);
  const [chunks, glyphChunks] = await Promise.all([
    Promise.all(
      coreManifest.chunks.map((chunk) =>
        readJson(join(directory, chunk.file))
      ),
    ),
    Promise.all(
      orderedGlyphChunks.map((chunk) =>
        readJson(join(directory, chunk.file))
      ),
    ),
  ]);
  return {
    records: chunks.flatMap((chunk) => chunk.records),
    bindings: glyphChunks.flatMap((chunk) => chunk.bindings),
  };
}

/**
 * Find one generated entity by stable ID.
 * @param {string} id - Exact stable entity ID.
 * @returns {any} Matching generated record.
 */
function entity(id) {
  const record = records.find((candidate) => candidate.id === id);
  expect(record, `missing generated entity ${id}`).toBeDefined();
  return record;
}

/**
 * Apply NetHack's adj_lev arithmetic for an explicit context.
 * @param {number} baseLevel - Monster table level.
 * @param {{levelDifficulty: number, playerLevel: number}} context - Context.
 * @returns {number} Adjusted and capped monster level.
 */
function adjustedMonsterLevel(baseLevel, context) {
  if (baseLevel > 49) return 50;
  let adjusted = baseLevel;
  const difficultyDifference = context.levelDifficulty - baseLevel;
  adjusted += difficultyDifference < 0
    ? -1
    : Math.floor(difficultyDifference / 5);
  const playerDifference = context.playerLevel - baseLevel;
  if (playerDifference > 0) {
    adjusted += Math.floor(playerDifference / 4);
  }
  return Math.max(
    0,
    Math.min(adjusted, Math.min(Math.floor((3 * baseLevel) / 2), 49)),
  );
}

/**
 * Evaluate inclusive bounds for the stage-one structured HP rule.
 * @param {Record<string, any>} rule - Generated discriminated HP rule.
 * @param {{levelDifficulty: number, playerLevel: number, endgame?: boolean}}
 * context - Explicit dungeon and player context.
 * @returns {[number, number]} Inclusive minimum and maximum initial HP.
 */
function hpBounds(rule, context) {
  if (rule.kind === "golem-fixed") {
    return [rule.hitPoints, rule.hitPoints];
  }
  if (rule.kind === "rider") {
    return [
      rule.dice.count + 1,
      rule.dice.count * rule.dice.sides,
    ];
  }
  const level = adjustedMonsterLevel(rule.baseLevel, context);
  if (rule.kind === "adult-dragon") {
    if (context.endgame) {
      return [
        level * rule.endgameMultiplier,
        level * rule.endgameMultiplier,
      ];
    }
    return [
      level * (rule.normalMultiplier + 1),
      level * (rule.normalMultiplier + rule.normalBonusDieSides),
    ];
  }
  expect(rule.kind).toBe("ordinary");
  if (level === 0) {
    return [2, rule.zeroLevelDieSides];
  }
  const multiplier = rule.homeMultiplier;
  const minimum = level * multiplier;
  return [
    minimum === level ? minimum + 1 : minimum,
    level * rule.positiveLevelDieSides * multiplier,
  ];
}

/**
 * Clone the valid generated catalog for one corruption scenario.
 * @param {string} label - Short temporary-directory label.
 * @returns {Promise<string>} Cloned core asset directory.
 */
async function cloneGeneratedCatalog(label) {
  const root = await mkdtemp(join(tmpdir(), `blisshack-core-${label}-`));
  temporaryDirectories.push(root);
  const directory = join(root, "core");
  await cp(generatedDirectory, directory, { recursive: true });
  return directory;
}

/**
 * Rewrite one catalog JSON file and repair its manifest bytes and hash.
 * @param {string} directory - Cloned core asset directory.
 * @param {string} file - Manifest-relative catalog file.
 * @param {(value: any) => void} mutate - In-place JSON mutation.
 * @returns {Promise<void>} Completion after canonical rewrite.
 */
async function rewriteCatalogFile(directory, file, mutate) {
  const path = join(directory, file);
  const value = await readJson(path);
  mutate(value);
  const bytes = canonicalJsonBytes(value);
  await writeFile(path, bytes);

  const coreManifest = await readJson(join(directory, "manifest.json"));
  const metadata = [
    ...coreManifest.chunks,
    ...coreManifest.glyphBindings.chunks,
  ].find((chunk) => chunk.file === file);
  expect(metadata, `missing manifest metadata for ${file}`).toBeDefined();
  metadata.bytes = bytes.byteLength;
  metadata.sha256 = sha256(bytes);
  await writeFile(
    join(directory, "manifest.json"),
    canonicalJsonBytes(coreManifest),
  );
}

/**
 * Return the exact porcelain worktree state.
 * @returns {string} Git status including untracked files.
 */
function gitStatus() {
  return execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
}

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "blisshack-core-assets-"));
  temporaryDirectories.push(root);
  generatedDirectory = join(root, "first");
  await generateCoreEncyclopedia({
    repositoryRoot,
    outputDirectory: generatedDirectory,
  });
  manifest = await validateCoreAssetDirectory(generatedDirectory);
  ({ records, bindings } = await loadCatalog(generatedDirectory, manifest));
}, 120_000);

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("alpha-2.4 stage-one core encyclopedia assets", () => {
  /** Lock full source-table counts, stable IDs, and fencepost exclusion. */
  it("exports every real entity exactly once with stable IDs", () => {
    expect(manifest.entityCounts).toEqual(expectedEntityCounts);
    expect(records).toHaveLength(
      Object.values(expectedEntityCounts)
        .reduce((total, count) => total + count, 0),
    );

    const ids = records.map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
    expect(ids.every((id) =>
      /^(appearance:[A-Z0-9_]+:GENERIC|monster:PM_[A-Z0-9_]+|object:[A-Z0-9_]+|artifact:ART_[A-Z0-9_]+|terrain:S_[A-Z0-9_]+|trap:[A-Z0-9_]+)$/
        .test(id)
    )).toBe(true);

    expect(ids).toEqual(expect.arrayContaining([
      "appearance:POTION_CLASS:GENERIC",
      "monster:PM_GIANT_ANT",
      "monster:PM_APPRENTICE",
      "object:ARROW",
      "object:ACID_VENOM",
      "artifact:ART_EXCALIBUR",
      "artifact:ART_EYE_OF_THE_AETHIOPICA",
      "terrain:S_STONE",
      "terrain:S_WATER",
      "trap:ARROW_TRAP",
      "trap:TRAPPED_CHEST",
    ]));
    for (const fencepost of [
      "monster:NUMMONS",
      "object:STRANGE_OBJECT",
      "object:GENERIC_POTION",
      "object:NUM_OBJECTS",
      "artifact:ART_NONARTIFACT",
      "artifact:ART_TERMINATOR",
    ]) {
      expect(ids).not.toContain(fencepost);
    }
  });

  /** Require symbolic enum/flag output and preserve source attack order. */
  it("uses exhaustive symbolic enums and ordered attacks", () => {
    const monsters = records.filter((record) => record.kind === "monster");
    for (const monster of monsters) {
      for (const attack of monster.facts.attacks) {
        expect(attack.attackType).toMatch(/^AT_[A-Z0-9_]+$/);
        expect(attack.damageType).toMatch(/^AD_[A-Z0-9_]+$/);
      }
      const flagGroups = [
        monster.facts.generation.flags,
        monster.facts.resistances,
        monster.facts.conveys,
        monster.facts.flags.m1,
        monster.facts.flags.m2,
        monster.facts.flags.m3,
      ];
      for (const flags of flagGroups) {
        expect(flags.every((flag) => /^[A-Z][A-Z0-9_]+$/.test(flag)))
          .toBe(true);
        expect(new Set(flags).size).toBe(flags.length);
      }
    }

    expect(entity("monster:PM_SOLDIER_ANT").facts.attacks).toEqual([
      {
        attackType: "AT_BITE",
        damageType: "AD_PHYS",
        dice: { count: 2, sides: 4 },
      },
      {
        attackType: "AT_STNG",
        damageType: "AD_DRST",
        dice: { count: 3, sides: 4 },
      },
    ]);
  });

  /** Require one total result per glyph and explicit composite references. */
  it("classifies every glyph once and retains corpse/statue references", () => {
    expect(Object.keys(manifest.glyphBindings).sort()).toEqual([
      "chunks",
      "maxGlyph",
    ]);
    expect(manifest.glyphBindings.maxGlyph).toBe(9624);
    let nextGlyph = 0;
    for (const chunk of manifest.glyphBindings.chunks) {
      expect(Object.keys(chunk).sort()).toEqual([
        "bytes",
        "count",
        "file",
        "firstGlyph",
        "sha256",
      ]);
      expect(chunk).toMatchObject({
        file: expect.any(String),
        firstGlyph: nextGlyph,
        count: expect.any(Number),
        bytes: expect.any(Number),
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(chunk.count).toBeGreaterThan(0);
      nextGlyph += chunk.count;
    }
    expect(nextGlyph).toBe(manifest.glyphBindings.maxGlyph);
    expect(bindings).toHaveLength(manifest.glyphBindings.maxGlyph);
    for (let glyph = 0; glyph < bindings.length; glyph += 1) {
      const result = bindings[glyph];
      expect(result.glyph).toBe(glyph);
      expect(["supported", "unsupported"]).toContain(result.status);
      if (result.status === "supported") {
        expect(result.binding).toBeDefined();
        expect(result.reason).toBeUndefined();
      } else {
        expect(result.reason).toMatch(/^[a-z0-9-]+$/);
        expect(result.binding).toBeUndefined();
      }
    }

    const corpse = bindings.find((result) =>
      result.binding?.kind === "corpse"
      && result.binding.monsterId === "monster:PM_NEWT"
      && result.binding.pileTop === false
    );
    expect(corpse?.binding).toMatchObject({
      objectId: "object:CORPSE",
      monsterId: "monster:PM_NEWT",
    });

    const statue = bindings.find((result) =>
      result.binding?.kind === "statue"
      && result.binding.monsterId === "monster:PM_NEWT"
      && result.binding.pileTop === false
    );
    expect(statue?.binding).toMatchObject({
      objectId: "object:STATUE",
      monsterId: "monster:PM_NEWT",
      gender: expect.stringMatching(/^(male|female)$/),
    });
  });

  /** Keep generic object glyphs detached from concrete object effects. */
  it("does not reveal a concrete potion through its generic glyph", () => {
    const genericPotion = bindings.find((result) =>
      result.binding?.kind === "generic-object"
      && result.binding.objectClass === "POTION_CLASS"
      && result.binding.pileTop === false
    );
    expect(genericPotion?.binding).toEqual({
      kind: "generic-object",
      appearanceId: "appearance:POTION_CLASS:GENERIC",
      objectClass: "POTION_CLASS",
      pileTop: false,
    });
    expect(JSON.stringify(genericPotion)).not.toMatch(
      /POT_HEALING|POT_GAIN_LEVEL|effect|identity/i,
    );
    expect(entity("appearance:POTION_CLASS:GENERIC")).toEqual({
      schemaVersion: 1,
      id: "appearance:POTION_CLASS:GENERIC",
      kind: "appearance",
      names: { primary: "potion" },
      symbol: expect.any(Number),
      color: expect.any(Number),
      facts: { objectClass: "POTION_CLASS" },
      sourceRefs: [{
        path: "include/objects.h",
        symbol: "GENERIC_POTION",
      }],
    });
    const appearanceIds = records
      .filter((record) => record.kind === "appearance")
      .map((record) => record.id)
      .sort();
    const genericReferences = [...new Set(bindings
      .filter((result) => result.binding?.kind === "generic-object")
      .map((result) => result.binding.appearanceId))]
      .sort();
    expect(appearanceIds).toHaveLength(17);
    expect(genericReferences).toEqual(appearanceIds);
  });

  /** Lock structural HP branches and representative inclusive boundaries. */
  it("encodes newt, ordinary, golem, Rider, dragon, and home HP rules", () => {
    const newt = entity("monster:PM_NEWT").facts.hpRule;
    const gecko = entity("monster:PM_GECKO").facts.hpRule;
    const strawGolem = entity("monster:PM_STRAW_GOLEM").facts.hpRule;
    const death = entity("monster:PM_DEATH").facts.hpRule;
    const grayDragon = entity("monster:PM_GRAY_DRAGON").facts.hpRule;
    const airElemental = entity("monster:PM_AIR_ELEMENTAL").facts.hpRule;

    expect(newt).toMatchObject({
      kind: "ordinary",
      baseLevel: 0,
      zeroLevelDieSides: 4,
      positiveLevelDieSides: 8,
      homeMultiplier: 1,
    });
    expect(gecko).toMatchObject({ kind: "ordinary", baseLevel: 1 });
    expect(strawGolem).toEqual({
      kind: "golem-fixed",
      hitPoints: 20,
    });
    expect(death).toEqual({
      kind: "rider",
      dice: { count: 10, sides: 8 },
      minimumRollBoost: true,
    });
    expect(grayDragon).toMatchObject({
      kind: "adult-dragon",
      baseLevel: 15,
      normalMultiplier: 4,
      normalBonusDieSides: 4,
      endgameMultiplier: 8,
    });
    expect(airElemental).toMatchObject({
      kind: "ordinary",
      baseLevel: 8,
      homeMultiplier: 3,
    });

    expect(hpBounds(newt, { levelDifficulty: 1, playerLevel: 1 }))
      .toEqual([2, 4]);
    expect(hpBounds(gecko, { levelDifficulty: 0, playerLevel: 1 }))
      .toEqual([2, 4]);
    expect(hpBounds(gecko, { levelDifficulty: 1, playerLevel: 1 }))
      .toEqual([2, 8]);
    expect(hpBounds(strawGolem, { levelDifficulty: 1, playerLevel: 1 }))
      .toEqual([20, 20]);
    expect(hpBounds(death, { levelDifficulty: 60, playerLevel: 30 }))
      .toEqual([11, 80]);
    expect(hpBounds(grayDragon, {
      levelDifficulty: 1,
      playerLevel: 1,
      endgame: false,
    })).toEqual([70, 112]);
    expect(hpBounds(grayDragon, {
      levelDifficulty: 60,
      playerLevel: 30,
      endgame: false,
    })).toEqual([110, 176]);
    expect(hpBounds(grayDragon, {
      levelDifficulty: 60,
      playerLevel: 30,
      endgame: true,
    })).toEqual([176, 176]);
    expect(hpBounds(airElemental, {
      levelDifficulty: 60,
      playerLevel: 30,
    })).toEqual([36, 288]);
  });

  /** Require source provenance, content hashes, and initial size budgets. */
  it("binds source inputs and every asset to bounded hashes and sizes", async () => {
    expect(manifest.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.generatorVersion).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
    expect(manifest.compileDefines).toEqual(
      [...manifest.compileDefines].sort(),
    );
    const inputPaths = manifest.sourceInputs.map((input) => input.path);
    expect(inputPaths).toEqual([...inputPaths].sort());
    expect(inputPaths).toEqual(expect.arrayContaining(requiredFingerprintInputs));
    for (const input of manifest.sourceInputs) {
      const bytes = await readFile(join(repositoryRoot, input.path));
      expect(input.bytes).toBe(bytes.byteLength);
      expect(input.sha256).toBe(sha256(bytes));
    }

    let totalBytes = (await readFile(
      join(generatedDirectory, "manifest.json"),
    )).byteLength;
    for (const metadata of [
      ...manifest.chunks,
      ...manifest.glyphBindings.chunks,
    ]) {
      const bytes = await readFile(join(generatedDirectory, metadata.file));
      expect(metadata.bytes).toBe(bytes.byteLength);
      expect(metadata.sha256).toBe(sha256(bytes));
      expect(bytes.byteLength).toBeLessThanOrEqual(256 * 1024);
      totalBytes += bytes.byteLength;
    }
    expect(totalBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(records.every((record) =>
      Buffer.byteLength(JSON.stringify(record), "utf8") <= 64 * 1024
    )).toBe(true);
  });

  /** Require byte-for-byte output for two generations from identical source. */
  it("generates byte-identical output repeatedly", async () => {
    const secondDirectory = join(
      temporaryDirectories[0],
      "second",
    );
    await generateCoreEncyclopedia({
      repositoryRoot,
      outputDirectory: secondDirectory,
    });
    expect(await directoryBytes(secondDirectory)).toEqual(
      await directoryBytes(generatedDirectory),
    );
  }, 120_000);

  /** Reject malformed bytes, unknown schema fields, and unknown symbols. */
  it("strictly rejects corruption and unknown fields or enum values", async () => {
    const corrupt = await cloneGeneratedCatalog("corrupt");
    const corruptManifest = await readJson(join(corrupt, "manifest.json"));
    await writeFile(
      join(corrupt, corruptManifest.chunks[0].file),
      "{not valid json\n",
    );
    await expect(validateCoreAssetDirectory(corrupt)).rejects.toThrow(
      /JSON|SHA-256|byte/i,
    );

    const unknownField = await cloneGeneratedCatalog("unknown-field");
    const unknownManifest = await readJson(
      join(unknownField, "manifest.json"),
    );
    unknownManifest.unexpected = true;
    await writeFile(
      join(unknownField, "manifest.json"),
      canonicalJsonBytes(unknownManifest),
    );
    await expect(validateCoreAssetDirectory(unknownField)).rejects.toThrow(
      /unknown|unexpected|field/i,
    );

    const unknownSymbol = await cloneGeneratedCatalog("unknown-symbol");
    const monsterChunk = manifest.chunks.find(
      (chunk) => chunk.kind === "monster",
    );
    await rewriteCatalogFile(
      unknownSymbol,
      monsterChunk.file,
      (chunk) => {
        chunk.records[0].facts.attacks[0].attackType = "AT_FUTURE";
        chunk.records[0].facts.flags.m1.push("M1_FUTURE");
      },
    );
    await expect(validateCoreAssetDirectory(unknownSymbol)).rejects.toThrow(
      /attack|flag|enum|symbol/i,
    );
  });

  /** Reject duplicate IDs, dangling references, and incomplete glyph domains. */
  it("strictly rejects duplicate or dangling catalog references", async () => {
    const duplicate = await cloneGeneratedCatalog("duplicate");
    const monsterChunk = manifest.chunks.find(
      (chunk) => chunk.kind === "monster",
    );
    await rewriteCatalogFile(duplicate, monsterChunk.file, (chunk) => {
      chunk.records.push(structuredClone(chunk.records[0]));
    });
    await expect(validateCoreAssetDirectory(duplicate)).rejects.toThrow(
      /duplicate.*id/i,
    );

    const dangling = await cloneGeneratedCatalog("dangling");
    const corpseGlyph = bindings.find(
      (result) => result.binding?.kind === "corpse",
    ).glyph;
    const corpseGlyphChunk = manifest.glyphBindings.chunks.find((chunk) =>
      corpseGlyph >= chunk.firstGlyph
      && corpseGlyph < chunk.firstGlyph + chunk.count
    );
    expect(corpseGlyphChunk).toBeDefined();
    await rewriteCatalogFile(
      dangling,
      corpseGlyphChunk.file,
      (catalog) => {
        const corpse = catalog.bindings.find(
          (result) => result.glyph === corpseGlyph,
        );
        expect(corpse).toBeDefined();
        corpse.binding.monsterId = "monster:PM_DOES_NOT_EXIST";
      },
    );
    await expect(validateCoreAssetDirectory(dangling)).rejects.toThrow(
      /dangling|reference|PM_DOES_NOT_EXIST/i,
    );

    const danglingAppearance = await cloneGeneratedCatalog(
      "dangling-appearance",
    );
    const genericGlyph = bindings.find(
      (result) => result.binding?.kind === "generic-object",
    ).glyph;
    const genericGlyphChunk = manifest.glyphBindings.chunks.find((chunk) =>
      genericGlyph >= chunk.firstGlyph
      && genericGlyph < chunk.firstGlyph + chunk.count
    );
    expect(genericGlyphChunk).toBeDefined();
    await rewriteCatalogFile(
      danglingAppearance,
      genericGlyphChunk.file,
      (catalog) => {
        const generic = catalog.bindings.find(
          (result) => result.glyph === genericGlyph,
        );
        generic.binding.appearanceId =
          "appearance:FUTURE_CLASS:GENERIC";
        generic.binding.objectClass = "FUTURE_CLASS";
      },
    );
    await expect(validateCoreAssetDirectory(danglingAppearance))
      .rejects.toThrow(/dangling|appearance|FUTURE_CLASS/i);

    const incomplete = await cloneGeneratedCatalog("glyph-gap");
    const missingGlyph = bindings[Math.floor(bindings.length / 2)].glyph;
    const missingGlyphChunk = manifest.glyphBindings.chunks.find((chunk) =>
      missingGlyph >= chunk.firstGlyph
      && missingGlyph < chunk.firstGlyph + chunk.count
    );
    expect(missingGlyphChunk).toBeDefined();
    await rewriteCatalogFile(
      incomplete,
      missingGlyphChunk.file,
      (catalog) => {
        const missingIndex = catalog.bindings.findIndex(
          (result) => result.glyph === missingGlyph,
        );
        expect(missingIndex).toBeGreaterThanOrEqual(0);
        catalog.bindings.splice(missingIndex, 1);
      },
    );
    await expect(validateCoreAssetDirectory(incomplete)).rejects.toThrow(
      /glyph|MAX_GLYPH|coverage/i,
    );
  });

  /** Reject traversal before opening a manifest-controlled path. */
  it("rejects manifest path traversal", async () => {
    const traversal = await cloneGeneratedCatalog("traversal");
    const traversalManifest = await readJson(
      join(traversal, "manifest.json"),
    );
    traversalManifest.chunks[0].file = "../outside.json";
    await writeFile(
      join(traversal, "manifest.json"),
      canonicalJsonBytes(traversalManifest),
    );
    await expect(validateCoreAssetDirectory(traversal)).rejects.toThrow(
      /path|traversal|relative|outside/i,
    );
  });

  /** Reject an individually oversized entity even when hashes are repaired. */
  it("rejects records over the 64 KiB size limit", async () => {
    const oversized = await cloneGeneratedCatalog("oversized");
    const monsterChunk = manifest.chunks.find(
      (chunk) => chunk.kind === "monster",
    );
    await rewriteCatalogFile(oversized, monsterChunk.file, (chunk) => {
      chunk.records[0].names.primary = "x".repeat(65 * 1024);
    });
    await expect(validateCoreAssetDirectory(oversized)).rejects.toThrow(
      /64 KiB|record.*size|size limit/i,
    );
  });

  /** Regenerate into caller-owned temporary space without touching assets. */
  it("verifies through temporary regeneration without modifying the worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "blisshack-core-verify-"));
    temporaryDirectories.push(root);
    const verificationDirectory = join(root, "regenerated");
    await mkdir(verificationDirectory);
    const statusBefore = gitStatus();
    const assetsBefore = await directorySnapshot(checkedInCoreDirectory);

    await verifyCoreEncyclopedia({
      repositoryRoot,
      assetDirectory: checkedInCoreDirectory,
      temporaryDirectory: verificationDirectory,
    });

    expect(await directoryBytes(verificationDirectory)).toEqual(
      await directoryBytes(checkedInCoreDirectory),
    );
    expect(await directorySnapshot(checkedInCoreDirectory))
      .toEqual(assetsBefore);
    expect(gitStatus()).toBe(statusBefore);
  }, 120_000);
});

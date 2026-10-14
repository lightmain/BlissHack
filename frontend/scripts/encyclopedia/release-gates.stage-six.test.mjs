import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateCoreEntityChunk } from "../../src/encyclopedia/core-schema";

const frontendRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const coreRoot = join(frontendRoot, "public/encyclopedia/core");
const wikiRoot = join(frontendRoot, "public/encyclopedia/wiki");
const noticePath = join(frontendRoot, "public/encyclopedia/NOTICE.md");
const aliasPath = join(
  frontendRoot,
  "scripts/encyclopedia/wiki-aliases.json",
);
const selectionPath = join(
  frontendRoot,
  "scripts/encyclopedia/wiki-selections.json",
);
const acceptancePath = join(
  frontendRoot,
  "test/integration-tests/fixtures/newt-wiki-revision-205110.json",
);
const netHackObjectClasses = [
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
];

/** Read and parse one checked-in JSON asset. */
async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/** Load all records declared by an encyclopedia manifest. */
async function loadRecords(root, manifest) {
  return (
    await Promise.all(
      manifest.chunks.map(async (chunk) =>
        (await readJson(join(root, chunk.file))).records
      ),
    )
  ).flat();
}

/** Load the complete checked-in glyph classification domain. */
async function loadGlyphBindings(manifest) {
  return (
    await Promise.all(
      manifest.glyphBindings.chunks.map(async (chunk) =>
        (await readJson(join(coreRoot, chunk.file))).bindings
      ),
    )
  ).flat();
}

/** Return stable entity references carried by one supported glyph binding. */
function bindingEntityIds(binding) {
  return [
    binding.appearanceId,
    binding.monsterId,
    binding.objectId,
    binding.terrainId,
    binding.trapId,
  ].filter((value) => typeof value === "string");
}

describe("alpha-2.4 stage-six checked-in release gates", () => {
  it("accepts every checked-in core chunk through the production validator", async () => {
    const manifest = await readJson(join(coreRoot, "manifest.json"));
    expect(manifest.schemaVersion).toBe(2);
    for (const metadata of manifest.chunks) {
      const chunk = await readJson(join(coreRoot, metadata.file));
      expect(metadata).toHaveProperty("family");
      expect(metadata).not.toHaveProperty("kind");
      expect(chunk.schemaVersion).toBe(2);
      expect(chunk.family).toBe(metadata.family);
      expect(chunk).not.toHaveProperty("kind");
      expect(chunk.records.every((record) =>
        record.schemaVersion === 2
        && record.family === metadata.family
        && !Object.hasOwn(record, "kind")
      )).toBe(true);
      expect(
        () => validateCoreEntityChunk(chunk, metadata),
        metadata.file,
      ).not.toThrow();
    }
  });

  it("reports complete catalog coverage and explicit unsupported reasons", async () => {
    const manifest = await readJson(join(coreRoot, "manifest.json"));
    const [records, bindings] = await Promise.all([
      loadRecords(coreRoot, manifest),
      loadGlyphBindings(manifest),
    ]);
    const ids = new Set(records.map((record) => record.id));
    const actualCounts = Object.fromEntries(
      Object.keys(manifest.entityCounts).map((family) => [
        family,
        records.filter((record) => record.family === family).length,
      ]),
    );

    expect(actualCounts).toEqual(manifest.entityCounts);
    expect(ids.size).toBe(records.length);
    expect([...new Set(records
      .map((record) => record.facts?.objectClass)
      .filter((objectClass) => typeof objectClass === "string"))].sort())
      .toEqual([...netHackObjectClasses].sort());
    for (const record of records.filter((candidate) =>
      candidate.family === "object"
    )) {
      expect(record.facts.subtype).not.toHaveProperty("kind");
    }
    expect(bindings).toHaveLength(manifest.glyphBindings.maxGlyph);
    expect(bindings.map((binding) => binding.glyph))
      .toEqual(Array.from({ length: bindings.length }, (_, glyph) => glyph));

    const missingReferences = [];
    const unsupportedReasons = {};
    for (const result of bindings) {
      if (result.status === "supported") {
        for (const id of bindingEntityIds(result.binding)) {
          if (!ids.has(id)) missingReferences.push({ glyph: result.glyph, id });
        }
      } else {
        expect(result.reason).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        unsupportedReasons[result.reason] =
          (unsupportedReasons[result.reason] ?? 0) + 1;
      }
    }

    expect(missingReferences).toEqual([]);
    expect(unsupportedReasons).toEqual({
      "explosion-effect": 63,
      invisible: 1,
      "non-entity-object": 2,
      nothing: 1,
      "swallow-effect": 3064,
      "temporary-cmap": 10,
      unexplored: 1,
      warning: 6,
      "zap-effect": 32,
    });
  });

  it("binds the published Newt excerpt to revision 205110 and its NOTICE", async () => {
    const [
      aliases,
      selections,
      manifest,
      acceptance,
      notice,
    ] = await Promise.all([
      readJson(aliasPath),
      readJson(selectionPath),
      readJson(join(wikiRoot, "manifest.json")),
      readJson(acceptancePath),
      readFile(noticePath, "utf8"),
    ]);
    const records = await loadRecords(wikiRoot, manifest);
    const record = records.find(
      (candidate) => candidate.entityId === "monster:PM_NEWT",
    );
    const alias = aliases.aliases.find(
      (candidate) => candidate.entityId === "monster:PM_NEWT",
    );
    const selection = selections.selections.find(
      (candidate) => candidate.entityId === "monster:PM_NEWT",
    );

    expect(manifest.recordCount).toBe(1);
    expect(manifest.revisions).toEqual([{
      entityId: "monster:PM_NEWT",
      revisionId: 205110,
      sha256: acceptance.revisionSha256,
      title: "Newt",
    }]);
    expect(alias).toEqual({
      canonicalTitle: "Newt",
      entityId: "monster:PM_NEWT",
      title: "Newt",
    });
    expect(selection).toMatchObject({
      entityId: "monster:PM_NEWT",
      pageTitle: "Newt",
      revisionId: 205110,
      revisionHash: acceptance.revisionSha256,
      reviewStatus: "published",
    });
    expect(record.page).toMatchObject({
      authorLabel: "NetHackWiki contributors",
      historyUrl: acceptance.history,
      revisionId: 205110,
      sourceUrl: acceptance.source,
      title: "Newt",
    });
    expect(record.license).toEqual({
      name: acceptance.license,
      spdxLikeId: "CC-BY-SA-3.0",
      url: acceptance.licenseUrl,
    });

    const publishedShape = record.sections.map((section) => ({
      count: section.paragraphs.length,
      heading: section.sourceHeading,
      tab: section.tab,
    }));
    expect(publishedShape).toEqual([
      { count: 2, heading: "Strategy", tab: "strategy" },
      { count: 1, heading: "History", tab: "history" },
      { count: 1, heading: "Dudley's dungeon", tab: "history" },
    ]);
    expect(record.sections.flatMap((section) => section.paragraphs))
      .toEqual(acceptance.paragraphs);
    expect(record.sections.some((section) =>
      section.tab === "overview"
      || section.sourceHeading.toLowerCase() === "overview"
    )).toBe(false);
    expect(selection.sections).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ tab: "overview" }),
      ]),
    );

    for (const expected of [
      '- Title: "Newt"',
      "- Authors: NetHackWiki contributors",
      "- Fixed revision: 205110",
      `- Source: ${acceptance.source}`,
      `- Revision history: ${acceptance.history}`,
      `- License: ${acceptance.license}`,
      `- License URI: ${acceptance.licenseUrl}`,
    ]) {
      expect(notice).toContain(expected);
    }
    expect(notice.match(/^- Title:/gm)).toHaveLength(manifest.recordCount);
  });

  it("keeps checked-in resources within the reviewed publication budgets", async () => {
    const [coreManifest, wikiManifest] = await Promise.all([
      readJson(join(coreRoot, "manifest.json")),
      readJson(join(wikiRoot, "manifest.json")),
    ]);
    const coreFiles = [
      "manifest.json",
      ...coreManifest.chunks.map((chunk) => chunk.file),
      ...coreManifest.glyphBindings.chunks.map((chunk) => chunk.file),
    ];
    const wikiFiles = [
      "manifest.json",
      ...wikiManifest.chunks.map((chunk) => chunk.file),
    ];
    const [coreSizes, wikiSizes] = await Promise.all([
      Promise.all(coreFiles.map(async (file) => (await stat(join(coreRoot, file))).size)),
      Promise.all(wikiFiles.map(async (file) => (await stat(join(wikiRoot, file))).size)),
    ]);

    expect(coreSizes.reduce((sum, bytes) => sum + bytes, 0))
      .toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(wikiSizes.reduce((sum, bytes) => sum + bytes, 0))
      .toBeLessThanOrEqual(4 * 1024 * 1024);
    for (const chunk of [
      ...coreManifest.chunks,
      ...coreManifest.glyphBindings.chunks,
      ...wikiManifest.chunks,
    ]) {
      expect(chunk.bytes, chunk.file).toBeLessThanOrEqual(256 * 1024);
    }

    const records = [
      ...await loadRecords(coreRoot, coreManifest),
      ...await loadRecords(wikiRoot, wikiManifest),
    ];
    for (const record of records) {
      expect(
        Buffer.byteLength(JSON.stringify(record), "utf8"),
        record.id ?? record.entityId,
      ).toBeLessThanOrEqual(64 * 1024);
    }

    const initialDetailedBytes =
      coreSizes[0]
      + Math.max(...coreManifest.glyphBindings.chunks.map(
        (chunk) => chunk.bytes,
      ))
      + wikiSizes[0];
    expect(initialDetailedBytes).toBeLessThanOrEqual(150 * 1024);
  });
});

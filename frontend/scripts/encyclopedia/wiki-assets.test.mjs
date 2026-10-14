import { createHash } from "node:crypto";
import fsPromises, {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  WIKITEXT_AST_PARSER,
  extractWikiSelection,
  generateWikiNotice,
  importWikiDump,
  refreshWikiCandidates,
  resolveWikiTitle,
  selectFixedRevision,
  streamWikiPages,
  validateWikiAssetDirectory,
  wikiChunkBytes,
} from "./wiki-assets.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const fixtureDirectory = join(
  repositoryRoot,
  "frontend/scripts/encyclopedia/__fixtures__/wiki",
);
const approvedFixturePath = join(
  repositoryRoot,
  "frontend/test/integration-tests/fixtures/"
    + "newt-wiki-revision-205110.json",
);
const packagePath = join(repositoryRoot, "frontend/package.json");
const packageLockPath = join(repositoryRoot, "frontend/package-lock.json");
const temporaryDirectories = [];
const coreEntityIds = [
  "monster:PM_NEWT",
  "monster:PM_GECKO",
];
let aliasCatalog;
let approvedFixture;
let dumpXml;
let rejectedSelections;
let reviewedRevision;
let selectionCatalog;

/**
 * Read and parse one JSON fixture.
 * @param {string} path - Absolute JSON file path.
 * @returns {Promise<any>} Parsed JSON value.
 */
async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * Return a lowercase SHA-256 digest for exact bytes or UTF-8 text.
 * @param {Uint8Array|string} value - Exact content to hash.
 * @returns {string} Lowercase hexadecimal digest.
 */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Yield text in deterministic small chunks.
 * @param {string} source - Complete source text.
 * @param {number} size - Maximum UTF-16 code units per chunk.
 * @returns {AsyncGenerator<string>} Ordered text chunks.
 */
async function* chunkedText(source, size) {
  for (let offset = 0; offset < source.length; offset += size) {
    yield source.slice(offset, offset + size);
  }
}

/**
 * Yield exact UTF-8 bytes one at a time.
 * @param {string} source - Complete UTF-8 source text.
 * @returns {AsyncGenerator<Uint8Array>} One byte per chunk.
 */
async function* chunkedBytes(source) {
  for (const byte of Buffer.from(source, "utf8")) {
    yield Uint8Array.of(byte);
  }
}

/**
 * Yield the first complete page and reject eager reads of the remaining dump.
 * @param {string} source - Complete XML dump.
 * @param {{allowTail: boolean}} state - Test-controlled tail-read gate.
 * @returns {AsyncGenerator<string>} Two guarded XML chunks.
 */
async function* guardedPageChunks(source, state) {
  const firstPageEnd = source.indexOf("</page>") + "</page>".length;
  if (firstPageEnd < "</page>".length) {
    throw new Error("Fixture has no complete page");
  }
  yield source.slice(0, firstPageEnd);
  if (!state.allowTail) {
    throw new Error("stream parser requested the dump tail before yielding");
  }
  yield source.slice(firstPageEnd);
}

/**
 * Flatten excerpt sections without changing paragraph content or order.
 * @param {Array<{paragraphs: string[]}>} sections - Wiki record sections.
 * @returns {string[]} Ordered paragraph strings.
 */
function flattenParagraphs(sections) {
  return sections.flatMap((section) => section.paragraphs);
}

/**
 * Import the checked-in dump with one requested stream chunk size.
 * @param {number} chunkSize - XML input chunk size.
 * @param {object} [overrides] - Import option overrides.
 * @returns {Promise<any>} Complete candidate import result.
 */
async function importFixture(chunkSize, overrides = {}) {
  return importWikiDump({
    dump: chunkedText(dumpXml, chunkSize),
    aliasCatalog,
    selectionCatalog,
    coreEntityIds,
    ...overrides,
  });
}

/**
 * Recursively snapshot file bytes and nanosecond modification times.
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
      snapshot[path.slice(root.length + 1)] = {
        bytes: await readFile(path),
        mtimeNs: metadata.mtimeNs,
      };
    }
  }
  return snapshot;
}

/**
 * Return all page titles explicitly listed by a generated NOTICE.
 * @param {string} notice - Generated NOTICE Markdown.
 * @returns {string[]} Page titles in publication order.
 */
function noticeTitles(notice) {
  return [...notice.matchAll(/^- Title: "([^"]+)"$/gm)]
    .map((match) => match[1]);
}

/**
 * Build the reviewed four-paragraph Newt record from the approved fixture.
 * @returns {object} Complete checked Wiki record.
 */
function approvedWikiRecord() {
  const [strategyFirst, strategySecond, history, dudley] =
    approvedFixture.paragraphs;
  return {
    schemaVersion: 1,
    entityId: "monster:PM_NEWT",
    page: {
      title: "Newt",
      revisionId: 205110,
      revisionTimestamp: approvedFixture.revisionTimestamp,
      sourceUrl: approvedFixture.source,
      historyUrl: approvedFixture.history,
      authorLabel: approvedFixture.authors,
    },
    license: {
      spdxLikeId: "CC-BY-SA-3.0",
      name: approvedFixture.license,
      url: approvedFixture.licenseUrl,
    },
    modifications: [...approvedFixture.changes],
    sections: [
      {
        tab: "strategy",
        sourceHeading: "Strategy",
        paragraphs: [strategyFirst, strategySecond],
        paragraphHashes: [sha256(strategyFirst), sha256(strategySecond)],
      },
      {
        tab: "history",
        sourceHeading: "History",
        paragraphs: [history],
        paragraphHashes: [sha256(history)],
      },
      {
        tab: "history",
        sourceHeading: "Dudley's dungeon",
        paragraphs: [dudley],
        paragraphHashes: [sha256(dudley)],
      },
    ],
  };
}

/**
 * Build a unique one-paragraph record for ordering and size fixtures.
 * @param {number} index - Stable numeric identity suffix.
 * @param {string} [paragraph] - Complete paragraph text.
 * @returns {object} Complete checked Wiki record.
 */
function generatedWikiRecord(index, paragraph = `Paragraph ${index}.`) {
  const suffix = String(index).padStart(3, "0");
  const title = `Test ${suffix}`;
  return {
    schemaVersion: 1,
    entityId: `monster:PM_TEST_${suffix}`,
    page: {
      title,
      revisionId: 300000 + index,
      revisionTimestamp: "2026-01-01T00:00:00Z",
      sourceUrl:
        `https://nethackwiki.com/index.php?title=${encodeURIComponent(title)}`
        + `&oldid=${300000 + index}`,
      historyUrl:
        `https://nethackwiki.com/index.php?title=${encodeURIComponent(title)}`
        + "&action=history",
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
    sections: [
      {
        tab: "strategy",
        sourceHeading: "Strategy",
        paragraphs: [paragraph],
        paragraphHashes: [sha256(paragraph)],
      },
    ],
  };
}

/**
 * Write one complete checked Wiki asset fixture.
 * @param {string} root - Temporary test root.
 * @param {object[][]} recordChunks - Ordered records grouped by chunk.
 * @returns {Promise<{assetDirectory: string, manifest: object}>}
 * Written asset fixture and manifest.
 */
async function writeCheckedWikiFixture(root, recordChunks) {
  const assetDirectory = join(root, "wiki");
  await mkdir(assetDirectory, { recursive: true });
  const chunks = [];
  for (let index = 0; index < recordChunks.length; index += 1) {
    const records = recordChunks[index];
    const file = `wiki-${String(index + 1).padStart(3, "0")}.json`;
    const bytes = wikiChunkBytes(records);
    await writeFile(join(assetDirectory, file), bytes);
    chunks.push({
      file,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      count: records.length,
      firstEntityId: records[0]?.entityId ?? null,
      lastEntityId: records.at(-1)?.entityId ?? null,
    });
  }
  const records = recordChunks.flat();
  const manifest = {
    schemaVersion: 1,
    generatorVersion: "1.0.0",
    parser: WIKITEXT_AST_PARSER,
    recordCount: records.length,
    chunks,
    revisions: records.map((record) => ({
      entityId: record.entityId,
      title: record.page.title,
      revisionId: record.page.revisionId,
      sha256: record.entityId === "monster:PM_NEWT"
        ? sha256(reviewedRevision.text)
        : sha256(`revision:${record.entityId}`),
    })),
  };
  await writeFile(
    join(assetDirectory, "manifest.json"),
    `${JSON.stringify(manifest)}\n`,
  );
  return { assetDirectory, manifest };
}

beforeAll(async () => {
  [
    aliasCatalog,
    approvedFixture,
    dumpXml,
    rejectedSelections,
    selectionCatalog,
  ] = await Promise.all([
    readJson(join(fixtureDirectory, "wiki-aliases.json")),
    readJson(approvedFixturePath),
    readFile(
      join(fixtureDirectory, "newt-revision-205110.xml"),
      "utf8",
    ),
    readJson(join(fixtureDirectory, "rejected-selections.json")),
    readJson(join(fixtureDirectory, "wiki-selections.json")),
  ]);
  const pages = [];
  for await (const page of streamWikiPages(chunkedText(dumpXml, 97))) {
    pages.push(page);
  }
  reviewedRevision = selectFixedRevision(
    pages.find((page) => page.title === "Newt"),
    205110,
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("alpha-2.4 stage-two verbatim Wiki excerpts", () => {
  /** Require incremental XML page delivery and the selected fixed revision. */
  it("streams XML pages and selects revision 205110 instead of adjacent revisions", async () => {
    const state = { allowTail: false };
    const pages = streamWikiPages(guardedPageChunks(dumpXml, state));
    const first = await pages.next();

    expect(first.done).toBe(false);
    expect(first.value.title).toBe("Newt");
    expect(first.value.revisions.map((revision) => revision.id)).toEqual([
      205109,
      205110,
      205111,
    ]);
    const selected = selectFixedRevision(first.value, 205110);
    expect(selected).toMatchObject({
      id: 205110,
      timestamp: "2026-06-02T18:31:39Z",
    });
    const revisionHash = sha256(selected.text);
    expect(revisionHash).toBe(
      "8255e5ed686ea657f3b5cea18449b31e11f5bfe731195797b4f2dc5263522032",
    );
    expect(approvedFixture.revisionSha256).toBe(revisionHash);
    expect(selectionCatalog.selections[0].revisionHash).toBe(revisionHash);
    expect(dumpXml).toContain("<parentid>152296</parentid>");
    expect(dumpXml).toContain("<username>Watchdog</username>");
    expect(dumpXml).toContain("<comment>fix source code reference</comment>");
    expect(dumpXml).toContain(
      "<sha1>c1fa420c492d146329a46799844bc77d5fa81450</sha1>",
    );
    expect(selected.text).toMatch(/^{{monster\n/);
    expect(selected.text).toContain("==Origin==");
    expect(selected.text).toContain("==Messages==");
    expect(selected.text).toContain("==Dudley's dungeon==");
    expect(selected.text).toContain("==Variants==");
    expect(selected.text).toContain("==Encyclopedia entry==");
    expect(selected.text).toContain("==References==");
    expect(() => selectFixedRevision(first.value, 205108)).toThrow(
      /205108|revision|missing/i,
    );

    state.allowTail = true;
    await pages.return();
  });

  /** Decode a Uint8Array stream without corrupting split UTF-8 sequences. */
  it("preserves UTF-8 when every input byte is a separate chunk", async () => {
    const text = "caf\u00e9 \u65b0 \ud83e\udd8e";
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<mediawiki><page><title>UTF-8 fixture</title>",
      "<revision><id>1</id><timestamp>2026-01-01T00:00:00Z</timestamp>",
      `<text><![CDATA[${text}]]></text></revision></page></mediawiki>`,
    ].join("");
    const pages = [];

    for await (const page of streamWikiPages(chunkedBytes(xml))) {
      pages.push(page);
    }

    expect(pages).toHaveLength(1);
    expect(pages[0].revisions[0].text).toBe(text);
  });

  /** Accept only checked exact titles, redirects, and aliases. */
  it("resolves exact title, redirect, and alias entries while rejecting fuzzy matches", async () => {
    const pages = [];
    for await (const page of streamWikiPages(chunkedText(dumpXml, 23))) {
      pages.push(page);
    }

    expect(resolveWikiTitle({
      title: "Newt",
      pages,
      aliasCatalog,
    })).toMatchObject({
      requestedTitle: "Newt",
      resolvedTitle: "Newt",
      matchedBy: "title",
    });
    expect(resolveWikiTitle({
      title: "Water newt",
      pages,
      aliasCatalog,
    })).toMatchObject({
      requestedTitle: "Water newt",
      resolvedTitle: "Newt",
      matchedBy: "redirect",
    });
    expect(resolveWikiTitle({
      title: "little lizard",
      pages,
      aliasCatalog,
    })).toMatchObject({
      requestedTitle: "little lizard",
      resolvedTitle: "Newt",
      matchedBy: "alias",
    });

    for (const title of ["Newts", "newt", "Newt ", "Water-newt", "New"]) {
      expect(resolveWikiTitle({ title, pages, aliasCatalog })).toBeNull();
    }
  });

  /** Keep alias identity bound to the selected core entity. */
  it("rejects alias and selection entity ID conflicts", async () => {
    const historyOnly = structuredClone(selectionCatalog);
    historyOnly.selections[0].sections =
      historyOnly.selections[0].sections.filter((section) =>
        section.sourceHeading === "History"
      );
    const conflictingAliases = structuredClone(aliasCatalog);
    conflictingAliases.aliases.find((entry) => entry.title === "Newt")
      .entityId = "monster:PM_GECKO";

    await expect(importFixture(41, {
      aliasCatalog: conflictingAliases,
      selectionCatalog: historyOnly,
    })).rejects.toThrow(/alias|catalog|entity/i);
  });

  /** Preserve redirect origin and target in the generated manifest. */
  it("records used redirect metadata in the manifest", async () => {
    const historyOnly = structuredClone(selectionCatalog);
    historyOnly.selections[0].sections =
      historyOnly.selections[0].sections.filter((section) =>
        section.sourceHeading === "History"
      );
    historyOnly.selections[0].pageTitle = "Water newt";
    const redirected = await importFixture(41, {
      selectionCatalog: historyOnly,
    });
    expect(redirected.records).toHaveLength(1);
    expect(redirected.manifest.redirects).toEqual([
      {
        entityId: "monster:PM_NEWT",
        title: "Water newt",
        target: "Newt",
      },
    ]);
  });

  /** Pin an installed MediaWiki AST parser to one exact package version. */
  it("uses one exactly pinned MediaWiki AST parser", async () => {
    expect(WIKITEXT_AST_PARSER).toEqual({
      packageName: expect.stringMatching(
        /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/,
      ),
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
    });
    const [packageJson, packageLock] = await Promise.all([
      readJson(packagePath),
      readJson(packageLockPath),
    ]);
    const declaredVersion = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    }[WIKITEXT_AST_PARSER.packageName];
    const lockedVersion = packageLock.packages[
      `node_modules/${WIKITEXT_AST_PARSER.packageName}`
    ]?.version;

    expect(declaredVersion).toBe(WIKITEXT_AST_PARSER.version);
    expect(lockedVersion).toBe(WIKITEXT_AST_PARSER.version);
  });

  /** Preserve only the four approved paragraphs after safe markup removal. */
  it("keeps approved wording, punctuation, order, and complete paragraph boundaries", async () => {
    const imported = await importFixture(31);
    expect(imported.records).toHaveLength(1);
    const record = imported.records[0];

    expect(record).toMatchObject({
      schemaVersion: 1,
      entityId: "monster:PM_NEWT",
      page: {
        title: "Newt",
        revisionId: 205110,
        revisionTimestamp: "2026-06-02T18:31:39Z",
        sourceUrl:
          "https://nethackwiki.com/index.php?title=Newt&oldid=205110",
        historyUrl:
          "https://nethackwiki.com/index.php?title=Newt&action=history",
        authorLabel: "NetHackWiki contributors",
      },
      license: {
        spdxLikeId: "CC-BY-SA-3.0",
        name:
          "Creative Commons Attribution-ShareAlike 3.0 Unported",
        url: "https://creativecommons.org/licenses/by-sa/3.0/",
      },
      modifications: [
        "internal link destinations omitted",
        "Wiki markup omitted",
        "wording unchanged",
      ],
    });
    expect(record.sections.map((section) => ({
      tab: section.tab,
      sourceHeading: section.sourceHeading,
      count: section.paragraphs.length,
    }))).toEqual([
      { tab: "strategy", sourceHeading: "Strategy", count: 2 },
      { tab: "history", sourceHeading: "History", count: 1 },
      {
        tab: "history",
        sourceHeading: "Dudley's dungeon",
        count: 1,
      },
    ]);
    expect(flattenParagraphs(record.sections)).toEqual(
      approvedFixture.paragraphs,
    );
    expect(
      flattenParagraphs(record.sections).map((paragraph) =>
        Buffer.from(paragraph, "utf8")
      ),
    ).toEqual(
      approvedFixture.paragraphs.map((paragraph) =>
        Buffer.from(paragraph, "utf8")
      ),
    );
  });

  /** Fail closed for both template-bearing real lead paragraphs. */
  it("rejects the real Overview lead while retaining the four reviewed paragraphs", async () => {
    for (const paragraphIndex of [0, 1]) {
      const overviewSelection = {
        ...structuredClone(selectionCatalog.selections[0]),
        sections: [
          {
            tab: "overview",
            sourceHeading: "Overview",
            paragraphIndexes: [paragraphIndex],
          },
        ],
      };
      await expect.soft(
        extractWikiSelection({
          revision: reviewedRevision,
          selection: overviewSelection,
        }),
        `real Overview paragraph ${paragraphIndex}`,
      ).rejects.toMatchObject({ code: "template" });
    }

    expect(approvedFixture.paragraphs).toHaveLength(4);
    expect(approvedFixture.paragraphs).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/^A newt,/),
      expect.stringMatching(/^Eating a newt's/),
    ]));
  });

  /** Permit only internal-link destinations and emphasis delimiters to vanish. */
  it("removes internal link destinations and emphasis markup without normalizing text", async () => {
    const paragraph =
      "Before '''bold''', ''italic'', [[Target|display]], and [[plain]]; "
      + "after.";
    const expected =
      "Before bold, italic, display, and plain; after.";
    const selection = {
      entityId: "monster:PM_NEWT",
      pageTitle: "Markup fixture",
      revisionId: 1,
      sections: [
        {
          tab: "overview",
          sourceHeading: "Overview",
          paragraphIndexes: [0],
          paragraphHashes: [sha256(expected)],
        },
      ],
    };

    const extracted = await extractWikiSelection({
      revision: {
        id: 1,
        timestamp: "2025-01-01T00:00:00Z",
        text: `==Overview==\n${paragraph}`,
      },
      selection,
    });
    expect(extracted.sections).toEqual([
      {
        tab: "overview",
        sourceHeading: "Overview",
        paragraphs: [expected],
        paragraphHashes: [sha256(expected)],
      },
    ]);
  });

  /** Fail closed for partial text, mixed provenance, and unsafe AST nodes. */
  it("rejects sentence splices and every unsafe content class", async () => {
    for (const fixture of rejectedSelections.cases) {
      const selection = fixture.selection ?? {
        ...structuredClone(rejectedSelections.defaultSelection),
        pageTitle: fixture.name,
      };
      if (fixture.sourceHeading) {
        selection.sections[0].sourceHeading = fixture.sourceHeading;
      }
      if (fixture.paragraphIndexes) {
        selection.sections[0].paragraphIndexes = fixture.paragraphIndexes;
      }
      const extraction = Promise.resolve().then(() =>
        extractWikiSelection({
          revision: {
            id: 1,
            timestamp: "2025-01-01T00:00:00Z",
            text: fixture.wikitext,
          },
          selection,
        })
      );
      await expect(extraction, fixture.name).rejects.toMatchObject({
        code: fixture.expectedCode,
      });
    }
  });

  /** Keep revision, paragraph, chunk, and attribution output deterministic. */
  it("produces stable hashes and attribution independently of XML chunking", async () => {
    const [singleChunk, oneCharacterChunks] = await Promise.all([
      importFixture(dumpXml.length),
      importFixture(1),
    ]);
    expect(oneCharacterChunks.records).toEqual(singleChunk.records);
    expect(oneCharacterChunks.manifest).toEqual(singleChunk.manifest);
    expect(oneCharacterChunks.attributionManifest).toEqual(
      singleChunk.attributionManifest,
    );

    const selection = selectionCatalog.selections[0];
    expect(singleChunk.records).toHaveLength(1);
    const record = singleChunk.records[0];
    expect(singleChunk.manifest.revisions).toEqual([
      {
        entityId: "monster:PM_NEWT",
        title: "Newt",
        revisionId: 205110,
        sha256: selection.revisionHash,
      },
    ]);
    expect(record.sections.flatMap((section) => section.paragraphHashes))
      .toEqual(
        selection.sections.flatMap((section) => section.paragraphHashes),
      );

    const bytes = wikiChunkBytes(singleChunk.records);
    expect(bytes).toEqual(
      Buffer.from(
        `${JSON.stringify({
          schemaVersion: 1,
          records: singleChunk.records,
        })}\n`,
        "utf8",
      ),
    );
    expect(singleChunk.manifest.chunks).toEqual([
      {
        file: "wiki-001.json",
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        count: 1,
        firstEntityId: "monster:PM_NEWT",
        lastEntityId: "monster:PM_NEWT",
      },
    ]);
    expect(singleChunk.attributionManifest.pages).toEqual([
      {
        entityId: "monster:PM_NEWT",
        title: "Newt",
        revisionId: 205110,
        revisionTimestamp: "2026-06-02T18:31:39Z",
        sourceUrl:
          "https://nethackwiki.com/index.php?title=Newt&oldid=205110",
        historyUrl:
          "https://nethackwiki.com/index.php?title=Newt&action=history",
        authorLabel: "NetHackWiki contributors",
        license: {
          spdxLikeId: "CC-BY-SA-3.0",
          name:
            "Creative Commons Attribution-ShareAlike 3.0 Unported",
          url: "https://creativecommons.org/licenses/by-sa/3.0/",
        },
      },
    ]);
  });

  /** Report missing Wiki coverage without invalidating the core entity set. */
  it("keeps core entities valid when an exact Wiki page is absent", async () => {
    const catalogs = structuredClone(selectionCatalog);
    catalogs.selections.push({
      entityId: "monster:PM_GECKO",
      pageTitle: "Gecko",
      revisionId: 999999,
      revisionTimestamp: "2025-01-01T00:00:00Z",
      revisionHash: "0".repeat(64),
      reviewStatus: "published",
      sections: [
        {
          tab: "overview",
          sourceHeading: "Overview",
          paragraphIndexes: [0],
          paragraphHashes: ["0".repeat(64)],
        },
      ],
    });
    const aliases = structuredClone(aliasCatalog);
    aliases.aliases.push({
      entityId: "monster:PM_GECKO",
      title: "Gecko",
      canonicalTitle: "Gecko",
    });
    const immutableCoreIds = Object.freeze([...coreEntityIds]);

    const imported = await importFixture(19, {
      aliasCatalog: aliases,
      selectionCatalog: catalogs,
      coreEntityIds: immutableCoreIds,
    });
    expect(imported.records.map((record) => record.entityId)).toEqual([
      "monster:PM_NEWT",
    ]);
    expect(imported.coverage).toEqual(expect.arrayContaining([
      {
        entityId: "monster:PM_NEWT",
        status: "candidate",
        pageTitle: "Newt",
        revisionId: 205110,
      },
      {
        entityId: "monster:PM_GECKO",
        status: "wiki-missing",
        pageTitle: "Gecko",
        revisionId: 999999,
        reason: "exact-page-not-found",
      },
    ]));
    expect(immutableCoreIds).toEqual(coreEntityIds);
  });

  /** Never attach reviewed prose to a generic appearance identity. */
  it("rejects Wiki selections for spoiler-safe generic appearances", async () => {
    const appearanceId = "appearance:POTION_CLASS:GENERIC";
    const aliases = structuredClone(aliasCatalog);
    for (const alias of aliases.aliases) {
      alias.entityId = appearanceId;
    }
    const selections = structuredClone(selectionCatalog);
    selections.selections[0].entityId = appearanceId;

    const imported = await importFixture(23, {
      aliasCatalog: aliases,
      selectionCatalog: selections,
      coreEntityIds: [appearanceId],
    });

    expect(imported.records).toEqual([]);
    expect(imported.manifest.recordCount).toBe(0);
    expect(imported.attributionManifest.pages).toEqual([]);
    expect(imported.coverage).toEqual([{
      entityId: appearanceId,
      status: "wiki-rejected",
      pageTitle: "Newt",
      revisionId: 205110,
      reason: "generic-appearance-wiki-forbidden",
    }]);
  });

  /** List every and only published reviewed page in stable NOTICE output. */
  it("generates NOTICE from exactly the published attribution manifest", async () => {
    const imported = await importFixture(47);
    const notice = generateWikiNotice(imported.attributionManifest);

    expect(generateWikiNotice(imported.attributionManifest)).toBe(notice);
    expect(noticeTitles(notice)).toEqual(
      imported.attributionManifest.pages.map((page) => page.title),
    );
    expect(notice).toContain("- Fixed revision: 205110");
    expect(notice).toContain(
      "- Source: "
        + "https://nethackwiki.com/index.php?title=Newt&oldid=205110",
    );
    expect(notice).toContain(
      "- Revision history: "
        + "https://nethackwiki.com/index.php?title=Newt&action=history",
    );
    expect(notice).toContain(
      "- License URI: "
        + "https://creativecommons.org/licenses/by-sa/3.0/",
    );
    expect(notice).not.toMatch(/Water newt|Newts|Gecko/);
  });

  /** Write review artifacts separately and leave reviewed excerpts untouched. */
  it("refreshes only candidate, diff, and coverage artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "blisshack-wiki-refresh-"));
    temporaryDirectories.push(root);
    const reviewedRoot = join(root, "reviewed");
    const reviewedDirectory = join(reviewedRoot, "wiki");
    const reviewedNoticePath = join(reviewedRoot, "NOTICE.md");
    const outputDirectory = join(root, "refresh");
    await mkdir(reviewedDirectory, { recursive: true });
    const imported = await importFixture(53);
    if (imported.records.length > 0) {
      await writeFile(
        join(reviewedDirectory, "wiki-001.json"),
        wikiChunkBytes(imported.records),
      );
    }
    await writeFile(
      join(reviewedDirectory, "manifest.json"),
      `${JSON.stringify(imported.manifest)}\n`,
    );
    await writeFile(
      reviewedNoticePath,
      generateWikiNotice(imported.attributionManifest),
    );
    const before = await directorySnapshot(reviewedRoot);

    await refreshWikiCandidates({
      dump: chunkedText(dumpXml, 29),
      aliasCatalog,
      selectionCatalog,
      coreEntityIds,
      reviewedDirectory,
      reviewedNoticePath,
      outputDirectory,
    });

    expect(await readdir(outputDirectory)).toEqual([
      "candidate.json",
      "coverage.json",
      "diff.json",
    ]);
    expect(await readJson(join(outputDirectory, "candidate.json")))
      .toMatchObject({
        records: imported.records,
        attributionManifest: imported.attributionManifest,
      });
    expect(await readJson(join(outputDirectory, "coverage.json")))
      .toEqual(imported.coverage);
    expect(await readJson(join(outputDirectory, "diff.json"))).toEqual({
      schemaVersion: 1,
      reviewedRoot,
      changes: [],
    });
    expect(await directorySnapshot(reviewedRoot)).toEqual(before);
  });

  /** Reject output paths that can erase reviewed or repository content. */
  it.each(["same", "ancestor"])(
    "rejects a refresh output directory that is the %s of reviewed assets",
    async (relationship) => {
      const root = await mkdtemp(join(tmpdir(), "blisshack-wiki-paths-"));
      temporaryDirectories.push(root);
      const reviewedDirectory = join(root, "reviewed");
      const outputDirectory = relationship === "same"
        ? reviewedDirectory
        : root;
      await mkdir(reviewedDirectory, { recursive: true });
      const imported = await importFixture(43);
      if (imported.records.length > 0) {
        await writeFile(
          join(reviewedDirectory, "wiki-001.json"),
          wikiChunkBytes(imported.records),
        );
      }
      await writeFile(
        join(reviewedDirectory, "manifest.json"),
        `${JSON.stringify(imported.manifest)}\n`,
      );
      await writeFile(
        join(reviewedDirectory, "NOTICE.md"),
        generateWikiNotice(imported.attributionManifest),
      );
      const before = await directorySnapshot(reviewedDirectory);

      let refreshError = null;
      try {
        await refreshWikiCandidates({
          dump: chunkedText(dumpXml, 43),
          aliasCatalog,
          selectionCatalog,
          coreEntityIds,
          reviewedDirectory,
          outputDirectory,
        });
      } catch (error) {
        refreshError = error;
      }

      expect.soft(refreshError).toBeInstanceOf(Error);
      let after = null;
      try {
        after = await directorySnapshot(reviewedDirectory);
      } catch (error) {
        expect.soft(error).toMatchObject({ code: "ENOENT" });
      }
      expect.soft(after).toEqual(before);
    },
  );

  /** Reject the repository root before invoking recursive removal. */
  it("rejects repository refresh output without deleting repository files", async () => {
    const protectedPath = join(repositoryRoot, "AGENTS.md");
    const protectedBytes = await readFile(protectedPath);
    const root = await mkdtemp(
      join(tmpdir(), "blisshack-wiki-repository-path-"),
    );
    temporaryDirectories.push(root);
    const reviewedDirectory = join(root, "reviewed");
    await mkdir(reviewedDirectory);
    const imported = await importFixture(43);
    if (imported.records.length > 0) {
      await writeFile(
        join(reviewedDirectory, "wiki-001.json"),
        wikiChunkBytes(imported.records),
      );
    }
    await writeFile(
      join(reviewedDirectory, "manifest.json"),
      `${JSON.stringify(imported.manifest)}\n`,
    );
    await writeFile(
      join(reviewedDirectory, "NOTICE.md"),
      generateWikiNotice(imported.attributionManifest),
    );
    const originalRm = fsPromises.rm;
    let destructiveRemoveAttempted = false;
    fsPromises.rm = async (path, options) => {
      if (resolve(path) === repositoryRoot) {
        destructiveRemoveAttempted = true;
        throw new Error("destructive remove intercepted by test");
      }
      return originalRm(path, options);
    };
    syncBuiltinESMExports();

    let refreshError = null;
    try {
      await refreshWikiCandidates({
        dump: chunkedText(dumpXml, 43),
        aliasCatalog,
        selectionCatalog,
        coreEntityIds,
        reviewedDirectory,
        outputDirectory: repositoryRoot,
      });
    } catch (error) {
      refreshError = error;
    } finally {
      fsPromises.rm = originalRm;
      syncBuiltinESMExports();
    }

    expect.soft(refreshError).toBeInstanceOf(Error);
    expect.soft(refreshError?.message).toMatch(
      /output|repository|reviewed|unsafe/i,
    );
    expect.soft(destructiveRemoveAttempted).toBe(false);
    expect(await readFile(protectedPath)).toEqual(protectedBytes);
  });

  /** Reject a candidate output path that aliases another directory. */
  it("rejects a symlinked refresh output directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "blisshack-wiki-symlink-"));
    temporaryDirectories.push(root);
    const reviewedDirectory = join(root, "reviewed");
    const targetDirectory = join(root, "target");
    const outputDirectory = join(root, "refresh");
    await Promise.all([
      mkdir(reviewedDirectory),
      mkdir(targetDirectory),
    ]);
    await symlink(targetDirectory, outputDirectory);

    await expect(refreshWikiCandidates({
      dump: chunkedText(dumpXml, 43),
      aliasCatalog,
      selectionCatalog,
      coreEntityIds,
      reviewedDirectory,
      outputDirectory,
    })).rejects.toMatchObject({ code: "unsafe-output" });
    expect(await readdir(targetDirectory)).toEqual([]);
  });

  /** Accept one fully self-consistent checked Wiki asset directory. */
  it("validates a complete checked Wiki asset directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "blisshack-wiki-assets-"));
    temporaryDirectories.push(root);
    const { assetDirectory } = await writeCheckedWikiFixture(
      root,
      [[approvedWikiRecord()]],
    );

    const validated = await validateWikiAssetDirectory({ assetDirectory });
    expect(validated.records).toEqual([approvedWikiRecord()]);
  });

  /** Bind checked records to the reviewed entity and revision catalogs. */
  it("rejects a checked record rebound to another core entity", async () => {
    const root = await mkdtemp(join(tmpdir(), "blisshack-wiki-binding-"));
    temporaryDirectories.push(root);
    const written = await writeCheckedWikiFixture(
      root,
      [[approvedWikiRecord()]],
    );
    const chunkPath = join(written.assetDirectory, "wiki-001.json");
    const parsed = await readJson(chunkPath);
    parsed.records[0].entityId = "monster:PM_GECKO";
    const bytes = wikiChunkBytes(parsed.records);
    await writeFile(chunkPath, bytes);
    written.manifest.chunks[0] = {
      ...written.manifest.chunks[0],
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      firstEntityId: "monster:PM_GECKO",
      lastEntityId: "monster:PM_GECKO",
    };
    written.manifest.revisions[0].entityId = "monster:PM_GECKO";
    await writeFile(
      join(written.assetDirectory, "manifest.json"),
      `${JSON.stringify(written.manifest)}\n`,
    );

    await expect(validateWikiAssetDirectory({
      assetDirectory: written.assetDirectory,
      aliasCatalog,
      selectionCatalog,
    })).rejects.toMatchObject({ code: "catalog-binding-mismatch" });
  });

  /** Refuse an attributed NOTICE reached through a symbolic link. */
  it("rejects a symlinked checked Wiki NOTICE", async () => {
    const root = await mkdtemp(join(tmpdir(), "blisshack-wiki-notice-"));
    temporaryDirectories.push(root);
    const written = await writeCheckedWikiFixture(
      root,
      [[approvedWikiRecord()]],
    );
    const targetPath = join(root, "outside-notice.md");
    const noticePath = join(root, "NOTICE.md");
    const attributionManifest = {
      schemaVersion: 1,
      pages: [{
        entityId: "monster:PM_NEWT",
        title: "Newt",
        revisionId: 205110,
        revisionTimestamp: approvedFixture.revisionTimestamp,
        sourceUrl: approvedFixture.source,
        historyUrl: approvedFixture.history,
        authorLabel: approvedFixture.authors,
        license: approvedWikiRecord().license,
      }],
    };
    await writeFile(targetPath, generateWikiNotice(attributionManifest));
    await symlink(targetPath, noticePath);

    await expect(validateWikiAssetDirectory({
      assetDirectory: written.assetDirectory,
      noticePath,
    })).rejects.toMatchObject({ code: "invalid-notice" });
  });

  const invalidCheckedAssetCases = [
    {
      name: "stale paragraph hash",
      recordChunks() {
        const record = approvedWikiRecord();
        record.sections[0].paragraphs[0] += " Tampered.";
        return [[record]];
      },
    },
    {
      name: "invalid license metadata",
      recordChunks() {
        const record = approvedWikiRecord();
        record.license.url = "https://example.invalid/license";
        return [[record]];
      },
    },
    {
      name: "invalid source and history URLs",
      recordChunks() {
        const record = approvedWikiRecord();
        record.page.sourceUrl = "https://example.invalid/source";
        record.page.historyUrl = "https://example.invalid/history";
        return [[record]];
      },
    },
    {
      name: "unknown tab",
      recordChunks() {
        const record = approvedWikiRecord();
        record.sections[0].tab = "origin";
        return [[record]];
      },
    },
    {
      name: "wrong record schema",
      recordChunks() {
        const record = approvedWikiRecord();
        record.schemaVersion = 2;
        return [[record]];
      },
    },
    {
      name: "duplicate entity IDs",
      recordChunks() {
        const record = approvedWikiRecord();
        return [[record, structuredClone(record)]];
      },
    },
    {
      name: "records outside entity ID order",
      recordChunks() {
        return [[generatedWikiRecord(2), generatedWikiRecord(1)]];
      },
    },
    {
      name: "chunks outside filename order",
      recordChunks() {
        return [[generatedWikiRecord(1)], [generatedWikiRecord(2)]];
      },
      async afterWrite({ assetDirectory, manifest }) {
        manifest.chunks.reverse();
        await writeFile(
          join(assetDirectory, "manifest.json"),
          `${JSON.stringify(manifest)}\n`,
        );
      },
    },
    {
      name: "unlisted extra file",
      recordChunks() {
        return [[approvedWikiRecord()]];
      },
      async afterWrite({ assetDirectory }) {
        await writeFile(join(assetDirectory, "unlisted.json"), "{}\n");
      },
    },
    {
      name: "manifest-listed symlink",
      recordChunks() {
        return [[approvedWikiRecord()]];
      },
      async afterWrite({ assetDirectory }, root) {
        const chunkPath = join(assetDirectory, "wiki-001.json");
        const targetPath = join(root, "outside-chunk.json");
        const bytes = await readFile(chunkPath);
        await writeFile(targetPath, bytes);
        await rm(chunkPath);
        await symlink(targetPath, chunkPath);
      },
    },
  ];

  /** Recompute and enforce every checked-asset trust boundary. */
  it.each(invalidCheckedAssetCases)(
    "rejects checked assets with $name",
    async ({ recordChunks, afterWrite }) => {
      const root = await mkdtemp(join(tmpdir(), "blisshack-wiki-invalid-"));
      temporaryDirectories.push(root);
      const written = await writeCheckedWikiFixture(root, recordChunks());
      await afterWrite?.(written, root);

      await expect(validateWikiAssetDirectory({
        assetDirectory: written.assetDirectory,
      })).rejects.toBeInstanceOf(Error);
    },
  );

  /** Enforce the four-MiB aggregate checked Wiki budget. */
  it("rejects checked Wiki chunks whose aggregate size exceeds four MiB", async () => {
    const root = await mkdtemp(join(tmpdir(), "blisshack-wiki-size-"));
    temporaryDirectories.push(root);
    const records = Array.from({ length: 76 }, (_, index) =>
      generatedWikiRecord(
        index,
        `${index}:` + "x".repeat(56 * 1024),
      )
    );
    const recordChunks = Array.from({ length: 19 }, (_, index) =>
      records.slice(index * 4, index * 4 + 4)
    );
    const written = await writeCheckedWikiFixture(root, recordChunks);
    const totalBytes = written.manifest.chunks.reduce(
      (sum, chunk) => sum + chunk.bytes,
      0,
    );

    expect(Math.max(
      ...written.manifest.chunks.map((chunk) => chunk.bytes),
    )).toBeLessThanOrEqual(256 * 1024);
    expect(totalBytes).toBeGreaterThan(4 * 1024 * 1024);
    await expect(validateWikiAssetDirectory({
      assetDirectory: written.assetDirectory,
    })).rejects.toBeInstanceOf(Error);
  });

  /** Keep normal test and build commands offline and require an explicit dump. */
  it("does not place Wiki refresh or network access on normal command paths", async () => {
    const packageJson = await readJson(packagePath);
    expect(packageJson.scripts["encyclopedia:refresh-wiki"]).toBe(
      "node scripts/encyclopedia/import-wiki-dump.mjs",
    );
    for (const scriptName of ["test", "prebuild", "build"]) {
      expect(packageJson.scripts[scriptName]).not.toMatch(
        /refresh-wiki|import-wiki-dump|https?:\/\//i,
      );
    }

    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("network access is forbidden"),
    );
    await expect(importWikiDump({
      aliasCatalog,
      selectionCatalog,
      coreEntityIds,
    })).rejects.toThrow(/dump|required|explicit/i);
    await importFixture(37);
    expect(fetch).not.toHaveBeenCalled();
  });
});

import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
      timestamp: "2025-01-02T03:04:05Z",
    });
    expect(selected.text).toContain("==Dudley's dungeon==");
    expect(() => selectFixedRevision(first.value, 205108)).toThrow(
      /205108|revision|missing/i,
    );

    state.allowTail = true;
    await pages.return();
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

  /** Preserve all six approved paragraphs byte-for-byte after safe markup removal. */
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
        revisionTimestamp: "2025-01-02T03:04:05Z",
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
      { tab: "overview", sourceHeading: "Overview", count: 2 },
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
    const record = singleChunk.records[0];
    expect(singleChunk.manifest.revisions).toEqual([
      {
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
        revisionTimestamp: "2025-01-02T03:04:05Z",
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
    const reviewedDirectory = join(root, "reviewed");
    const outputDirectory = join(root, "refresh");
    await mkdir(reviewedDirectory);
    const imported = await importFixture(53);
    await writeFile(
      join(reviewedDirectory, "wiki-001.json"),
      wikiChunkBytes(imported.records),
    );
    await writeFile(
      join(reviewedDirectory, "manifest.json"),
      `${JSON.stringify(imported.manifest)}\n`,
    );
    await writeFile(
      join(reviewedDirectory, "NOTICE.md"),
      generateWikiNotice(imported.attributionManifest),
    );
    const before = await directorySnapshot(reviewedDirectory);

    await refreshWikiCandidates({
      dump: chunkedText(dumpXml, 29),
      aliasCatalog,
      selectionCatalog,
      coreEntityIds,
      reviewedDirectory,
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
    expect(await readJson(join(outputDirectory, "diff.json")))
      .toMatchObject({
        reviewedDirectory,
        changes: expect.any(Array),
      });
    expect(await directorySnapshot(reviewedDirectory)).toEqual(before);
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

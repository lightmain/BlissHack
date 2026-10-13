import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import Parser from "wikiparser-node";
import { SaxesParser } from "saxes";

export const WIKITEXT_AST_PARSER = Object.freeze({
  packageName: "wikiparser-node",
  version: "1.48.0",
});

const WIKI_SCHEMA_VERSION = 1;
const WIKI_GENERATOR_VERSION = "1.0.0";
const WIKI_LICENSE = Object.freeze({
  spdxLikeId: "CC-BY-SA-3.0",
  name: "Creative Commons Attribution-ShareAlike 3.0 Unported",
  url: "https://creativecommons.org/licenses/by-sa/3.0/",
});
const WIKI_MODIFICATIONS = Object.freeze([
  "internal link destinations omitted",
  "Wiki markup omitted",
  "wording unchanged",
]);
const PROHIBITED_HEADINGS = new Map([
  ["origin", "origin"],
  ["wikipedia", "wikipedia-derived"],
  ["encyclopedia entry", "encyclopedia-quotation"],
  ["encyclopedia", "encyclopedia-quotation"],
  ["messages", "game-messages"],
  ["game messages", "game-messages"],
]);

Parser.config = "enwiki";

/**
 * Error raised when Wiki input cannot be imported without changing provenance.
 */
export class WikiImportError extends Error {
  /**
   * Create a coded fail-closed import error.
   * @param {string} code Stable rejection category.
   * @param {string} message Human-readable diagnostic.
   */
  constructor(code, message) {
    super(message);
    this.name = "WikiImportError";
    this.code = code;
  }
}

/**
 * Return a lowercase SHA-256 digest for exact bytes or UTF-8 text.
 * @param {Uint8Array|string} value Exact content to hash.
 * @returns {string} Lowercase hexadecimal digest.
 */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Read one XML attribute independent of namespace representation.
 * @param {Record<string, unknown>} attributes Saxes attribute map.
 * @param {string} localName Requested local attribute name.
 * @returns {string|null} Attribute value when present.
 */
function xmlAttribute(attributes, localName) {
  for (const attribute of Object.values(attributes)) {
    if (
      attribute
      && typeof attribute === "object"
      && "local" in attribute
      && attribute.local === localName
      && "value" in attribute
    ) {
      return String(attribute.value);
    }
  }
  return null;
}

/**
 * Convert a required decimal XML field to a safe integer.
 * @param {string} value Source field value.
 * @param {string} label Diagnostic label.
 * @returns {number} Parsed safe integer.
 */
function xmlInteger(value, label) {
  if (!/^[0-9]+$/.test(value)) {
    throw new WikiImportError("invalid-xml-field", `${label} is not an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new WikiImportError("invalid-xml-field", `${label} is out of range`);
  }
  return parsed;
}

/**
 * Incrementally parse MediaWiki XML and yield each complete page.
 * @param {AsyncIterable<string|Uint8Array>} chunks Explicit local dump chunks.
 * @returns {AsyncGenerator<object>} Parsed pages in dump order.
 */
export async function* streamWikiPages(chunks) {
  if (!chunks || typeof chunks[Symbol.asyncIterator] !== "function") {
    throw new WikiImportError(
      "dump-required",
      "An explicit asynchronous XML dump is required",
    );
  }

  const completedPages = [];
  const elementStack = [];
  let capture = null;
  let currentPage = null;
  let currentRevision = null;
  let parserFailure = null;
  const parser = new SaxesParser({ xmlns: true });

  parser.on("error", (error) => {
    parserFailure = error;
  });
  parser.on("opentag", (tag) => {
    const parent = elementStack.at(-1) ?? null;
    const local = tag.local;

    if (local === "page") {
      currentPage = {
        title: "",
        redirectTitle: null,
        revisions: [],
      };
    } else if (local === "revision" && currentPage) {
      currentRevision = {
        id: null,
        timestamp: "",
        text: "",
      };
    } else if (local === "redirect" && currentPage && !currentRevision) {
      currentPage.redirectTitle = xmlAttribute(tag.attributes, "title");
    }

    if (
      currentPage
      && !currentRevision
      && parent === "page"
      && local === "title"
    ) {
      capture = { owner: "page", field: "title", tag: local, value: "" };
    } else if (
      currentRevision
      && parent === "revision"
      && ["id", "timestamp", "text"].includes(local)
    ) {
      capture = {
        owner: "revision",
        field: local,
        tag: local,
        value: "",
      };
    }
    elementStack.push(local);
  });
  const appendText = (value) => {
    if (capture) {
      capture.value += value;
    }
  };
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("closetag", (tag) => {
    const local = tag.local;
    if (capture?.tag === local) {
      if (capture.owner === "page") {
        currentPage[capture.field] = capture.value;
      } else if (capture.field === "id") {
        currentRevision.id = xmlInteger(capture.value, "revision id");
      } else {
        currentRevision[capture.field] = capture.value;
      }
      capture = null;
    }

    if (local === "revision" && currentPage && currentRevision) {
      if (
        currentRevision.id === null
        || currentRevision.timestamp.length === 0
      ) {
        throw new WikiImportError(
          "invalid-revision",
          `Page ${currentPage.title || "(untitled)"} has incomplete revision`,
        );
      }
      currentPage.revisions.push(currentRevision);
      currentRevision = null;
    } else if (local === "page" && currentPage) {
      if (currentPage.title.length === 0) {
        throw new WikiImportError("invalid-page", "Dump page has no title");
      }
      completedPages.push(currentPage);
      currentPage = null;
    }
    elementStack.pop();
  });

  for await (const chunk of chunks) {
    parser.write(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
    );
    if (parserFailure) {
      throw parserFailure;
    }
    while (completedPages.length > 0) {
      yield completedPages.shift();
    }
  }
  parser.close();
  if (parserFailure) {
    throw parserFailure;
  }
  while (completedPages.length > 0) {
    yield completedPages.shift();
  }
}

/**
 * Select one exact revision from a parsed Wiki page.
 * @param {{title: string, revisions: object[]}} page Parsed Wiki page.
 * @param {number} revisionId Required fixed revision ID.
 * @returns {object} Exact matching revision.
 */
export function selectFixedRevision(page, revisionId) {
  const matches = page.revisions.filter((revision) =>
    revision.id === revisionId
  );
  if (matches.length !== 1) {
    throw new WikiImportError(
      "revision-missing",
      `Fixed revision ${revisionId} is missing from ${page.title}`,
    );
  }
  return matches[0];
}

/**
 * Resolve an exact checked title, redirect, or explicit alias.
 * @param {{title: string, pages: object[], aliasCatalog: object}} options
 * Resolution inputs.
 * @returns {object|null} Exact resolution result, or null when unapproved.
 */
export function resolveWikiTitle({ title, pages, aliasCatalog }) {
  const aliases = aliasCatalog?.aliases?.filter((entry) =>
    entry.title === title
  ) ?? [];
  if (aliases.length !== 1) {
    return null;
  }
  const alias = aliases[0];
  const exactPage = pages.find((page) => page.title === title);
  const canonicalPage = pages.find((page) =>
    page.title === alias.canonicalTitle && !page.redirectTitle
  );
  if (!canonicalPage) {
    return null;
  }

  if (exactPage?.redirectTitle) {
    if (exactPage.redirectTitle !== alias.canonicalTitle) {
      return null;
    }
    return {
      requestedTitle: title,
      resolvedTitle: canonicalPage.title,
      matchedBy: "redirect",
      page: canonicalPage,
      redirect: {
        title: exactPage.title,
        target: exactPage.redirectTitle,
      },
    };
  }
  if (exactPage && exactPage.title === alias.canonicalTitle) {
    return {
      requestedTitle: title,
      resolvedTitle: exactPage.title,
      matchedBy: "title",
      page: exactPage,
      redirect: null,
    };
  }
  if (!exactPage) {
    return {
      requestedTitle: title,
      resolvedTitle: canonicalPage.title,
      matchedBy: "alias",
      page: canonicalPage,
      redirect: null,
    };
  }
  return null;
}

/**
 * Map a prohibited source heading to its stable rejection code.
 * @param {string} heading Exact selected source heading.
 * @returns {string|null} Rejection code when the heading is prohibited.
 */
function prohibitedHeadingCode(heading) {
  return PROHIBITED_HEADINGS.get(heading.trim().toLowerCase()) ?? null;
}

/**
 * Return the stable rejection code for a template node.
 * @param {object} node WikiParser template AST node.
 * @returns {string} Template-specific or generic rejection code.
 */
function templateRejectionCode(node) {
  const name = String(node.name ?? "")
    .replace(/^Template:/i, "")
    .trim()
    .toLowerCase();
  if (name === "rodney" || name === "hugo" || name === "basedon") {
    return name;
  }
  return "template";
}

/**
 * Validate one AST node against the small verbatim-text whitelist.
 * @param {object} node WikiParser AST node.
 * @returns {void}
 */
function validateSafeNode(node) {
  if (node.type === "text") {
    if (node.data?.includes("<") || node.data?.includes(">")) {
      throw new WikiImportError(
        "unknown-license-node",
        "Unparsed HTML-like content is not allowed",
      );
    }
    return;
  }
  if (node.type === "quote") {
    return;
  }
  if (
    node.type === "root"
    || node.type === "plain"
    || node.type === "link"
    || node.type === "link-target"
    || node.type === "link-text"
  ) {
    for (const child of node.childNodes ?? []) {
      validateSafeNode(child);
    }
    return;
  }
  if (node.type === "template" || node.type === "magic-word") {
    const code = node.type === "template"
      ? templateRejectionCode(node)
      : "template";
    throw new WikiImportError(code, `Unsafe ${node.type} node`);
  }
  if (node.type === "file") {
    const target = String(node.childNodes?.[0] ?? "");
    const code = target.toLowerCase().startsWith("image:") ? "image" : "file";
    throw new WikiImportError(code, "Wiki images are not imported");
  }
  if (node.type === "table") {
    throw new WikiImportError("table", "Wiki tables are not imported");
  }
  if (node.type === "ext" && node.name?.toLowerCase() === "ref") {
    throw new WikiImportError("ref", "Reference tags are not imported");
  }
  throw new WikiImportError(
    "unknown-license-node",
    `Unsupported Wiki AST node ${node.type}`,
  );
}

/**
 * Render one validated AST node without markup or link destinations.
 * @param {object} node Validated WikiParser AST node.
 * @returns {string} Verbatim visible text.
 */
function renderSafeNode(node) {
  if (node.type === "text") {
    return node.data ?? "";
  }
  if (node.type === "quote") {
    return "";
  }
  if (node.type === "link") {
    const visible = node.childNodes.find((child) =>
      child.type === "link-text"
    ) ?? node.childNodes[0];
    return renderSafeNode(visible);
  }
  return (node.childNodes ?? []).map(renderSafeNode).join("");
}

/**
 * Split rendered section text at MediaWiki blank-line paragraph boundaries.
 * @param {string} text Safely rendered section body.
 * @returns {string[]} Complete paragraphs in source order.
 */
function splitParagraphs(text) {
  const paragraphs = [];
  let currentLines = [];
  const flush = () => {
    if (currentLines.length > 0) {
      paragraphs.push(currentLines.join("\n"));
      currentLines = [];
    }
  };
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      flush();
    } else {
      currentLines.push(line);
    }
  }
  flush();
  return paragraphs;
}

/**
 * Extract the exact source range governed by one heading.
 * @param {object} root Parsed page AST.
 * @param {string} sourceText Original revision wikitext.
 * @param {string} sourceHeading Exact heading text.
 * @returns {string} Original section body wikitext.
 */
function sectionSource(root, sourceText, sourceHeading) {
  const headings = root.querySelectorAll("heading");
  const matches = headings.filter((heading) =>
    heading.innerText === sourceHeading
  );
  if (matches.length !== 1) {
    throw new WikiImportError(
      "section-missing",
      `Expected one exact section heading ${sourceHeading}`,
    );
  }
  const heading = matches[0];
  const start = heading.getAbsoluteIndex() + String(heading).length;
  const next = headings.find((candidate) =>
    candidate.getAbsoluteIndex() > heading.getAbsoluteIndex()
    && candidate.level <= heading.level
  );
  return sourceText.slice(
    start,
    next ? next.getAbsoluteIndex() : sourceText.length,
  );
}

/**
 * Validate selection shape before any text extraction.
 * @param {object} section Selection section.
 * @returns {void}
 */
function validateSelectionShape(section) {
  if ("paragraphSlices" in section) {
    throw new WikiImportError(
      "partial-paragraph",
      "Sentence or byte-range excerpts are forbidden",
    );
  }
  if ("paragraphGroups" in section) {
    throw new WikiImportError(
      "paragraph-splice",
      "Cross-paragraph splicing is forbidden",
    );
  }
  if (
    !Array.isArray(section.paragraphIndexes)
    || !section.paragraphIndexes.every(Number.isSafeInteger)
  ) {
    throw new WikiImportError(
      "invalid-selection",
      "Complete paragraph indexes are required",
    );
  }
  const ordered = [...section.paragraphIndexes].sort((left, right) =>
    left - right
  );
  if (
    new Set(ordered).size !== ordered.length
    || ordered.some((value, index) => value !== section.paragraphIndexes[index])
  ) {
    throw new WikiImportError(
      "paragraph-splice",
      "Paragraph indexes must be unique and ordered",
    );
  }
}

/**
 * Extract selected complete paragraphs through a fail-closed AST whitelist.
 * @param {{revision: object, selection: object}} options Extraction inputs.
 * @returns {Promise<{sections: object[], revisionHash: string}>} Safe excerpt.
 */
export async function extractWikiSelection({ revision, selection }) {
  for (const section of selection.sections) {
    validateSelectionShape(section);
  }
  if (
    selection.revisionId !== undefined
    && revision.id !== selection.revisionId
  ) {
    throw new WikiImportError(
      "revision-mismatch",
      `Expected revision ${selection.revisionId}, received ${revision.id}`,
    );
  }
  if (
    selection.revisionTimestamp
    && revision.timestamp !== selection.revisionTimestamp
  ) {
    throw new WikiImportError(
      "revision-timestamp-mismatch",
      "Fixed revision timestamp changed",
    );
  }
  const revisionHash = sha256(revision.text);
  if (selection.revisionHash && revisionHash !== selection.revisionHash) {
    throw new WikiImportError(
      "revision-hash-mismatch",
      "Fixed revision text hash changed",
    );
  }

  const root = Parser.parse(revision.text, selection.pageTitle);
  const sections = [];
  for (const section of selection.sections) {
    const headingCode = prohibitedHeadingCode(section.sourceHeading);
    if (headingCode) {
      throw new WikiImportError(
        headingCode,
        `Section ${section.sourceHeading} has excluded provenance`,
      );
    }
    const body = sectionSource(root, revision.text, section.sourceHeading);
    const bodyRoot = Parser.parse(body, selection.pageTitle);
    validateSafeNode(bodyRoot);
    const paragraphs = splitParagraphs(renderSafeNode(bodyRoot));
    const selectedParagraphs = section.paragraphIndexes.map((index) => {
      if (index < 0 || index >= paragraphs.length) {
        throw new WikiImportError(
          "paragraph-missing",
          `Paragraph ${index} is missing from ${section.sourceHeading}`,
        );
      }
      return paragraphs[index];
    });
    const paragraphHashes = selectedParagraphs.map(sha256);
    if (
      section.paragraphHashes
      && (
        section.paragraphHashes.length !== paragraphHashes.length
        || section.paragraphHashes.some((hash, index) =>
          hash !== paragraphHashes[index]
        )
      )
    ) {
      throw new WikiImportError(
        "paragraph-hash-mismatch",
        `Reviewed paragraph changed in ${section.sourceHeading}`,
      );
    }
    sections.push({
      tab: section.tab,
      sourceHeading: section.sourceHeading,
      paragraphs: selectedParagraphs,
      paragraphHashes,
    });
  }
  return { sections, revisionHash };
}

/**
 * Build a fixed oldid source URL for one exact page and revision.
 * @param {string} title Exact canonical page title.
 * @param {number} revisionId Fixed revision ID.
 * @returns {string} NetHackWiki oldid URL.
 */
function sourceUrl(title, revisionId) {
  return "https://nethackwiki.com/index.php?title="
    + `${encodeURIComponent(title)}&oldid=${revisionId}`;
}

/**
 * Build a revision-history URL for one exact page.
 * @param {string} title Exact canonical page title.
 * @returns {string} NetHackWiki history URL.
 */
function historyUrl(title) {
  return "https://nethackwiki.com/index.php?title="
    + `${encodeURIComponent(title)}&action=history`;
}

/**
 * Construct one reviewed Wiki record from exact selection output.
 * @param {object} selection Checked selection entry.
 * @param {object} page Canonical parsed Wiki page.
 * @param {object} revision Fixed parsed revision.
 * @param {object[]} sections Extracted complete sections.
 * @returns {object} Runtime Wiki excerpt record.
 */
function wikiRecord(selection, page, revision, sections) {
  return {
    schemaVersion: WIKI_SCHEMA_VERSION,
    entityId: selection.entityId,
    page: {
      title: page.title,
      revisionId: revision.id,
      revisionTimestamp: revision.timestamp,
      sourceUrl: sourceUrl(page.title, revision.id),
      historyUrl: historyUrl(page.title),
      authorLabel: "NetHackWiki contributors",
    },
    license: { ...WIKI_LICENSE },
    modifications: [...WIKI_MODIFICATIONS],
    sections,
  };
}

/**
 * Serialize Wiki records in the canonical compact chunk format.
 * @param {object[]} records Ordered Wiki records.
 * @returns {Buffer} Canonical UTF-8 chunk bytes.
 */
export function wikiChunkBytes(records) {
  return Buffer.from(
    `${JSON.stringify({
      schemaVersion: WIKI_SCHEMA_VERSION,
      records,
    })}\n`,
    "utf8",
  );
}

/**
 * Convert one record to its page-level attribution entry.
 * @param {object} record Wiki excerpt record.
 * @returns {object} Stable attribution entry.
 */
function recordAttribution(record) {
  return {
    entityId: record.entityId,
    title: record.page.title,
    revisionId: record.page.revisionId,
    revisionTimestamp: record.page.revisionTimestamp,
    sourceUrl: record.page.sourceUrl,
    historyUrl: record.page.historyUrl,
    authorLabel: record.page.authorLabel,
    license: record.license,
  };
}

/**
 * Import selected fixed revisions from an explicit local XML stream.
 * @param {object} options Import options.
 * @returns {Promise<object>} Candidate records, manifests, and coverage.
 */
export async function importWikiDump({
  dump,
  aliasCatalog,
  selectionCatalog,
  coreEntityIds,
} = {}) {
  if (!dump) {
    throw new WikiImportError(
      "dump-required",
      "An explicit local XML dump is required",
    );
  }
  if (
    aliasCatalog?.schemaVersion !== 1
    || selectionCatalog?.schemaVersion !== 1
    || !Array.isArray(coreEntityIds)
  ) {
    throw new WikiImportError(
      "invalid-catalog",
      "Alias, selection, and core catalogs are required",
    );
  }

  const requestedTitles = new Set();
  for (const selection of selectionCatalog.selections) {
    requestedTitles.add(selection.pageTitle);
  }
  for (const alias of aliasCatalog.aliases) {
    requestedTitles.add(alias.title);
    requestedTitles.add(alias.canonicalTitle);
  }
  const pages = [];
  for await (const page of streamWikiPages(dump)) {
    if (
      requestedTitles.has(page.title)
      || (page.redirectTitle && requestedTitles.has(page.redirectTitle))
    ) {
      pages.push(page);
    }
  }

  const coreIds = new Set(coreEntityIds);
  const records = [];
  const coverage = [];
  const publishedEntityIds = new Set();
  for (const selection of selectionCatalog.selections) {
    if (!coreIds.has(selection.entityId)) {
      coverage.push({
        entityId: selection.entityId,
        status: "core-missing",
        pageTitle: selection.pageTitle,
        revisionId: selection.revisionId,
        reason: "core-entity-not-found",
      });
      continue;
    }
    const resolution = resolveWikiTitle({
      title: selection.pageTitle,
      pages,
      aliasCatalog,
    });
    if (!resolution) {
      coverage.push({
        entityId: selection.entityId,
        status: "wiki-missing",
        pageTitle: selection.pageTitle,
        revisionId: selection.revisionId,
        reason: "exact-page-not-found",
      });
      continue;
    }
    try {
      const revision = selectFixedRevision(
        resolution.page,
        selection.revisionId,
      );
      const extracted = await extractWikiSelection({ revision, selection });
      const record = wikiRecord(
        selection,
        resolution.page,
        revision,
        extracted.sections,
      );
      records.push(record);
      if (selection.reviewStatus === "published") {
        publishedEntityIds.add(selection.entityId);
      }
      coverage.push({
        entityId: selection.entityId,
        status: "candidate",
        pageTitle: selection.pageTitle,
        revisionId: selection.revisionId,
      });
    } catch (error) {
      if (!(error instanceof WikiImportError)) {
        throw error;
      }
      coverage.push({
        entityId: selection.entityId,
        status: "wiki-rejected",
        pageTitle: selection.pageTitle,
        revisionId: selection.revisionId,
        reason: error.code,
      });
    }
  }
  records.sort((left, right) => left.entityId.localeCompare(right.entityId));

  const bytes = wikiChunkBytes(records);
  const chunks = records.length === 0
    ? []
    : [{
      file: "wiki-001.json",
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      count: records.length,
      firstEntityId: records[0].entityId,
      lastEntityId: records.at(-1).entityId,
    }];
  const manifest = {
    schemaVersion: WIKI_SCHEMA_VERSION,
    generatorVersion: WIKI_GENERATOR_VERSION,
    parser: WIKITEXT_AST_PARSER,
    recordCount: records.length,
    chunks,
    revisions: records.map((record) => ({
      title: record.page.title,
      revisionId: record.page.revisionId,
      sha256: selectionCatalog.selections.find((selection) =>
        selection.entityId === record.entityId
        && selection.revisionId === record.page.revisionId
      ).revisionHash,
    })),
  };
  const attributionManifest = {
    schemaVersion: WIKI_SCHEMA_VERSION,
    pages: records
      .filter((record) => publishedEntityIds.has(record.entityId))
      .map(recordAttribution),
  };
  return { records, manifest, attributionManifest, coverage };
}

/**
 * Generate deterministic Markdown attribution for published Wiki pages.
 * @param {{schemaVersion: number, pages: object[]}} attributionManifest
 * Published attribution manifest.
 * @returns {string} NOTICE Markdown.
 */
export function generateWikiNotice(attributionManifest) {
  const lines = [
    "# BlissHack Encyclopedia Content Notice",
    "",
    "## NetHackWiki excerpts",
    "",
  ];
  for (const page of attributionManifest.pages) {
    lines.push(
      `- Title: "${page.title}"`,
      `- Authors: ${page.authorLabel}`,
      `- Fixed revision: ${page.revisionId}`,
      `- Source: ${page.sourceUrl}`,
      `- Revision history: ${page.historyUrl}`,
      `- License: ${page.license.name}`,
      `- License URI: ${page.license.url}`,
      "",
    );
  }
  lines.push(
    "Only complete paragraphs from fixed revisions are selected. The text is",
    "not summarized, translated, rewritten, or spliced. Presentation changes",
    "are limited to omitting Wiki markup and internal link destinations.",
    "",
    "Origin material, encyclopedia quotations, images, game messages, and",
    "other content with separate or uncertain provenance are excluded.",
    "",
    "## NetHack data",
    "",
    "Core facts are generated separately from the NetHack 5.0 source tree.",
    "NetHack licensing terms are in `dat/license`.",
    "",
  );
  return lines.join("\n");
}

/**
 * Recursively collect file bytes under one directory.
 * @param {string} root Directory to inspect.
 * @param {string} [current] Current recursive directory.
 * @returns {Promise<Record<string, Buffer>>} Relative file byte map.
 */
async function directoryBytes(root, current = root) {
  const result = {};
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return result;
    }
    throw error;
  }
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      Object.assign(result, await directoryBytes(root, path));
    } else {
      result[path.slice(root.length + 1)] = await readFile(path);
    }
  }
  return result;
}

/**
 * Compare candidate publication bytes with an existing reviewed directory.
 * @param {string} reviewedDirectory Existing reviewed asset directory.
 * @param {Record<string, Buffer>} candidate Candidate publication bytes.
 * @returns {Promise<object[]>} Stable file-level change descriptions.
 */
async function reviewedDiff(reviewedDirectory, candidate) {
  const reviewed = await directoryBytes(reviewedDirectory);
  const paths = [...new Set([
    ...Object.keys(reviewed),
    ...Object.keys(candidate),
  ])].sort();
  return paths.flatMap((path) => {
    const before = reviewed[path];
    const after = candidate[path];
    if (before?.equals(after)) {
      return [];
    }
    return [{
      file: path,
      status: before ? (after ? "changed" : "removed") : "added",
      beforeSha256: before ? sha256(before) : null,
      afterSha256: after ? sha256(after) : null,
    }];
  });
}

/**
 * Produce review-only candidate, coverage, and diff artifacts.
 * @param {object} options Refresh options including explicit dump and paths.
 * @returns {Promise<object>} Candidate import result.
 */
export async function refreshWikiCandidates({
  dump,
  aliasCatalog,
  selectionCatalog,
  coreEntityIds,
  reviewedDirectory,
  outputDirectory,
}) {
  const imported = await importWikiDump({
    dump,
    aliasCatalog,
    selectionCatalog,
    coreEntityIds,
  });
  const candidatePublication = {
    "manifest.json": Buffer.from(
      `${JSON.stringify(imported.manifest)}\n`,
      "utf8",
    ),
    "NOTICE.md": Buffer.from(
      generateWikiNotice(imported.attributionManifest),
      "utf8",
    ),
  };
  if (imported.records.length > 0) {
    candidatePublication["wiki-001.json"] = wikiChunkBytes(imported.records);
  }
  const changes = await reviewedDiff(
    reviewedDirectory,
    candidatePublication,
  );

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      join(outputDirectory, "candidate.json"),
      `${JSON.stringify({
        schemaVersion: WIKI_SCHEMA_VERSION,
        records: imported.records,
        manifest: imported.manifest,
        attributionManifest: imported.attributionManifest,
      }, null, 2)}\n`,
    ),
    writeFile(
      join(outputDirectory, "coverage.json"),
      `${JSON.stringify(imported.coverage, null, 2)}\n`,
    ),
    writeFile(
      join(outputDirectory, "diff.json"),
      `${JSON.stringify({
        schemaVersion: WIKI_SCHEMA_VERSION,
        reviewedDirectory,
        changes,
      }, null, 2)}\n`,
    ),
  ]);
  return imported;
}

/**
 * Validate checked Wiki chunks and return their records and attribution.
 * @param {{assetDirectory: string, noticePath?: string}} options Asset paths.
 * @returns {Promise<object>} Validated manifest, records, and attribution.
 */
export async function validateWikiAssetDirectory({
  assetDirectory,
  noticePath,
}) {
  const manifest = JSON.parse(
    await readFile(join(assetDirectory, "manifest.json"), "utf8"),
  );
  if (
    manifest.schemaVersion !== WIKI_SCHEMA_VERSION
    || manifest.generatorVersion !== WIKI_GENERATOR_VERSION
    || JSON.stringify(manifest.parser) !== JSON.stringify(WIKITEXT_AST_PARSER)
    || !Array.isArray(manifest.chunks)
  ) {
    throw new WikiImportError("invalid-manifest", "Invalid Wiki manifest");
  }
  const records = [];
  for (const chunk of manifest.chunks) {
    if (
      typeof chunk.file !== "string"
      || chunk.file.includes("/")
      || chunk.file.includes("\\")
      || chunk.bytes > 256 * 1024
    ) {
      throw new WikiImportError("invalid-chunk", "Unsafe Wiki chunk metadata");
    }
    const path = join(assetDirectory, chunk.file);
    const bytes = await readFile(path);
    if (
      bytes.byteLength !== chunk.bytes
      || sha256(bytes) !== chunk.sha256
    ) {
      throw new WikiImportError("chunk-hash-mismatch", chunk.file);
    }
    const parsed = JSON.parse(bytes);
    if (
      parsed.schemaVersion !== WIKI_SCHEMA_VERSION
      || !Array.isArray(parsed.records)
      || parsed.records.length !== chunk.count
    ) {
      throw new WikiImportError("invalid-chunk", chunk.file);
    }
    records.push(...parsed.records);
  }
  if (records.length !== manifest.recordCount) {
    throw new WikiImportError("record-count-mismatch", "Wiki record count");
  }
  const attributionManifest = {
    schemaVersion: WIKI_SCHEMA_VERSION,
    pages: records.map(recordAttribution),
  };
  if (noticePath) {
    const expectedNotice = generateWikiNotice(attributionManifest);
    if (await readFile(noticePath, "utf8") !== expectedNotice) {
      throw new WikiImportError("notice-mismatch", "Wiki NOTICE changed");
    }
  }
  return { manifest, records, attributionManifest };
}

/**
 * Return file size without following symlinks.
 * @param {string} path File path.
 * @returns {Promise<number>} File size in bytes.
 */
export async function fileSize(path) {
  return (await stat(path)).size;
}

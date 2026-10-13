import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
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
const WIKI_TABS = new Set(["overview", "strategy", "history"]);
const WIKI_MAX_CHUNK_BYTES = 256 * 1024;
const WIKI_MAX_MANIFEST_BYTES = 256 * 1024;
const WIKI_MAX_NOTICE_BYTES = 256 * 1024;
const WIKI_MAX_RECORD_BYTES = 64 * 1024;
const WIKI_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const CANDIDATE_FILES = Object.freeze([
  "candidate.json",
  "coverage.json",
  "diff.json",
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
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
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let decodingBytes = false;

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
    if (typeof chunk === "string") {
      if (decodingBytes) {
        parser.write(decoder.decode());
        decodingBytes = false;
      }
      parser.write(chunk);
    } else {
      parser.write(decoder.decode(chunk, { stream: true }));
      decodingBytes = true;
    }
    if (parserFailure) {
      throw parserFailure;
    }
    while (completedPages.length > 0) {
      yield completedPages.shift();
    }
  }
  if (decodingBytes) {
    parser.write(decoder.decode());
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
 * Remove only blank boundary lines from one source paragraph.
 * @param {string} source Exact paragraph source range.
 * @returns {string} Source without surrounding blank lines.
 */
function trimParagraphBoundaryLines(source) {
  const lines = source.split("\n");
  while (lines.length > 0 && lines[0].trim().length === 0) {
    lines.shift();
  }
  while (lines.length > 0 && lines.at(-1).trim().length === 0) {
    lines.pop();
  }
  return lines.join("\n");
}

/**
 * Split only on blank lines represented by root-level AST text nodes.
 * @param {object} root Parsed complete section AST.
 * @param {string} sourceText Original complete section wikitext.
 * @returns {string[]} Complete top-level paragraph source ranges.
 */
function topLevelParagraphSources(root, sourceText) {
  const separators = [];
  for (const node of root.childNodes ?? []) {
    if (node.type !== "text") {
      continue;
    }
    const nodeText = String(node);
    for (const match of nodeText.matchAll(/\n[ \t]*\n(?:[ \t]*\n)*/g)) {
      const start = node.getAbsoluteIndex() + match.index;
      separators.push({ start, end: start + match[0].length });
    }
  }
  const paragraphs = [];
  let start = 0;
  for (const separator of separators) {
    const paragraph = trimParagraphBoundaryLines(
      sourceText.slice(start, separator.start),
    );
    if (paragraph.length > 0) {
      paragraphs.push(paragraph);
    }
    start = separator.end;
  }
  const paragraph = trimParagraphBoundaryLines(sourceText.slice(start));
  if (paragraph.length > 0) {
    paragraphs.push(paragraph);
  }
  return paragraphs;
}

/**
 * Extract the exact source range governed by one heading.
 * @param {object} root Parsed page AST.
 * @param {string} sourceText Original revision wikitext.
 * @param {string} sourceHeading Exact heading text.
 * @returns {{body: string, ancestorHeadings: string[]}} Original section
 * body and the headings whose provenance it inherits.
 */
function sectionSource(root, sourceText, sourceHeading) {
  const headings = root.querySelectorAll("heading");
  const matches = headings.filter((heading) =>
    heading.innerText === sourceHeading
  );
  if (matches.length === 0 && sourceHeading === "Overview") {
    return {
      body: sourceText.slice(
        0,
        headings[0]?.getAbsoluteIndex() ?? sourceText.length,
      ),
      ancestorHeadings: [],
    };
  }
  if (matches.length !== 1) {
    throw new WikiImportError(
      "section-missing",
      `Expected one exact section heading ${sourceHeading}`,
    );
  }
  const heading = matches[0];
  const ancestors = [];
  for (const candidate of headings) {
    if (candidate.getAbsoluteIndex() >= heading.getAbsoluteIndex()) {
      break;
    }
    while (
      ancestors.length > 0
      && ancestors.at(-1).level >= candidate.level
    ) {
      ancestors.pop();
    }
    ancestors.push(candidate);
  }
  while (
    ancestors.length > 0
    && ancestors.at(-1).level >= heading.level
  ) {
    ancestors.pop();
  }
  const start = heading.getAbsoluteIndex() + String(heading).length;
  const next = headings.find((candidate) =>
    candidate.getAbsoluteIndex() > heading.getAbsoluteIndex()
    && candidate.level <= heading.level
  );
  return {
    body: sourceText.slice(
      start,
      next ? next.getAbsoluteIndex() : sourceText.length,
    ),
    ancestorHeadings: ancestors.map((ancestor) => ancestor.innerText),
  };
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
    const source = sectionSource(
      root,
      revision.text,
      section.sourceHeading,
    );
    for (const heading of [
      section.sourceHeading,
      ...source.ancestorHeadings,
    ]) {
      const headingCode = prohibitedHeadingCode(heading);
      if (headingCode) {
        throw new WikiImportError(
          headingCode,
          `Section ${section.sourceHeading} inherits excluded provenance `
            + `from ${heading}`,
        );
      }
    }
    const bodyRoot = Parser.parse(source.body, selection.pageTitle);
    const paragraphs = topLevelParagraphSources(bodyRoot, source.body);
    const selectedParagraphs = section.paragraphIndexes.map((index) => {
      if (index < 0 || index >= paragraphs.length) {
        throw new WikiImportError(
          "paragraph-missing",
          `Paragraph ${index} is missing from ${section.sourceHeading}`,
        );
      }
      const paragraphRoot = Parser.parse(
        paragraphs[index],
        selection.pageTitle,
      );
      validateSafeNode(paragraphRoot);
      return renderSafeNode(paragraphRoot);
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
 * Validate identity-bearing alias and selection catalog relationships.
 * @param {object} aliasCatalog Checked exact-title alias catalog.
 * @param {object} selectionCatalog Checked fixed-revision selections.
 * @returns {void}
 */
function validateCatalogIdentity(aliasCatalog, selectionCatalog) {
  if (
    aliasCatalog?.schemaVersion !== 1
    || selectionCatalog?.schemaVersion !== 1
    || !Array.isArray(aliasCatalog.aliases)
    || !Array.isArray(selectionCatalog.selections)
  ) {
    throw new WikiImportError(
      "invalid-catalog",
      "Alias and selection catalogs are required",
    );
  }
  const aliasesByTitle = new Map();
  const entitiesByCanonicalTitle = new Map();
  for (const alias of aliasCatalog.aliases) {
    if (
      !alias
      || typeof alias.entityId !== "string"
      || alias.entityId.length === 0
      || typeof alias.title !== "string"
      || alias.title.length === 0
      || typeof alias.canonicalTitle !== "string"
      || alias.canonicalTitle.length === 0
      || aliasesByTitle.has(alias.title)
      || (
        entitiesByCanonicalTitle.has(alias.canonicalTitle)
        && entitiesByCanonicalTitle.get(alias.canonicalTitle)
          !== alias.entityId
      )
    ) {
      throw new WikiImportError(
        "invalid-catalog",
        "Alias titles and canonical identities must be consistent",
      );
    }
    aliasesByTitle.set(alias.title, alias);
    entitiesByCanonicalTitle.set(alias.canonicalTitle, alias.entityId);
  }
  const selectedEntityIds = new Set();
  for (const selection of selectionCatalog.selections) {
    const alias = aliasesByTitle.get(selection?.pageTitle);
    if (
      typeof selection?.entityId !== "string"
      || selectedEntityIds.has(selection.entityId)
      || !alias
      || alias.entityId !== selection.entityId
      || entitiesByCanonicalTitle.get(alias.canonicalTitle)
        !== selection.entityId
    ) {
      throw new WikiImportError(
        "catalog-entity-conflict",
        `Selection ${selection?.pageTitle ?? "(untitled)"} does not match `
          + "its alias entity",
      );
    }
    selectedEntityIds.add(selection.entityId);
  }
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
  validateCatalogIdentity(aliasCatalog, selectionCatalog);
  if (
    !Array.isArray(coreEntityIds)
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
  const redirects = [];
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
      if (resolution.redirect) {
        redirects.push({
          entityId: selection.entityId,
          title: resolution.redirect.title,
          target: resolution.redirect.target,
        });
      }
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
  redirects.sort((left, right) =>
    left.entityId.localeCompare(right.entityId)
  );

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
      entityId: record.entityId,
      title: record.page.title,
      revisionId: record.page.revisionId,
      sha256: selectionCatalog.selections.find((selection) =>
        selection.entityId === record.entityId
        && selection.revisionId === record.page.revisionId
      ).revisionHash,
    })),
    ...(redirects.length > 0 ? { redirects } : {}),
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
 * @param {string} [reviewedNoticePath] NOTICE stored beside the Wiki directory.
 * @returns {Promise<object[]>} Stable file-level change descriptions.
 */
async function reviewedDiff(
  reviewedDirectory,
  candidate,
  reviewedNoticePath,
) {
  const reviewed = Object.fromEntries(
    Object.entries(await directoryBytes(reviewedDirectory))
      .map(([path, bytes]) => [`wiki/${path}`, bytes]),
  );
  if (reviewedNoticePath) {
    reviewed["NOTICE.md"] = await readFile(reviewedNoticePath);
  }
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
 * Return whether one normalized path contains another normalized path.
 * @param {string} ancestor Candidate ancestor path.
 * @param {string} descendant Candidate descendant path.
 * @returns {boolean} True when both paths overlap in that direction.
 */
function pathContains(ancestor, descendant) {
  const relationship = relative(ancestor, descendant);
  return relationship === ""
    || (
      relationship !== ".."
      && !relationship.startsWith(`..${sep}`)
      && !isAbsolute(relationship)
    );
}

/**
 * Resolve an existing path or an absent child of an existing real directory.
 * @param {string} path Path whose symlink-aware location is required.
 * @returns {Promise<string>} Canonical absolute path.
 */
async function canonicalPath(path) {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return join(await realpath(dirname(absolute)), basename(absolute));
  }
}

/**
 * Validate a prior candidate directory before it can be replaced.
 * @param {string} outputDirectory Existing candidate output path.
 * @returns {Promise<boolean>} Whether a valid replaceable directory exists.
 */
async function validateExistingCandidateDirectory(outputDirectory) {
  let metadata;
  try {
    metadata = await lstat(outputDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new WikiImportError(
      "unsafe-output",
      "Candidate output must be a real directory",
    );
  }
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  if (
    JSON.stringify(names) !== JSON.stringify(CANDIDATE_FILES)
    || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
  ) {
    throw new WikiImportError(
      "unsafe-output",
      "Existing output is not a recognized Wiki candidate directory",
    );
  }
  let candidate;
  try {
    candidate = JSON.parse(
      await readFile(join(outputDirectory, "candidate.json"), "utf8"),
    );
  } catch {
    throw new WikiImportError(
      "unsafe-output",
      "Existing output has no valid Wiki candidate sentinel",
    );
  }
  if (
    candidate?.schemaVersion !== WIKI_SCHEMA_VERSION
    || !Array.isArray(candidate.records)
    || typeof candidate.manifest !== "object"
    || typeof candidate.attributionManifest !== "object"
  ) {
    throw new WikiImportError(
      "unsafe-output",
      "Existing output has no valid Wiki candidate sentinel",
    );
  }
  return true;
}

/**
 * Reject candidate output paths that overlap reviewed assets.
 * @param {string} reviewedDirectory Existing reviewed asset directory.
 * @param {string} outputDirectory Requested candidate output directory.
 * @returns {Promise<{outputPath: string, replaceExisting: boolean}>}
 * Canonical safe replacement state.
 */
async function validateCandidateOutputPath(
  reviewedDirectory,
  outputDirectory,
) {
  try {
    if ((await lstat(resolve(outputDirectory))).isSymbolicLink()) {
      throw new WikiImportError(
        "unsafe-output",
        "Candidate output must not be a symbolic link",
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const [reviewedPath, outputPath] = await Promise.all([
    canonicalPath(reviewedDirectory),
    canonicalPath(outputDirectory),
  ]);
  if (
    pathContains(reviewedPath, outputPath)
    || pathContains(outputPath, reviewedPath)
  ) {
    throw new WikiImportError(
      "unsafe-output",
      "Candidate output must not overlap reviewed assets",
    );
  }
  const replaceExisting = await validateExistingCandidateDirectory(
    outputPath,
  );
  return { outputPath, replaceExisting };
}

/**
 * Remove a previously validated three-file candidate directory.
 * @param {string} directory Replaceable candidate directory.
 * @returns {Promise<void>}
 */
async function removeCandidateDirectory(directory) {
  await Promise.all(
    CANDIDATE_FILES.map((file) => unlink(join(directory, file))),
  );
  await rmdir(directory);
}

/**
 * Atomically replace candidate output while retaining rollback capability.
 * @param {string} stagingDirectory Newly written candidate directory.
 * @param {string} outputDirectory Final candidate directory.
 * @param {boolean} replaceExisting Whether a validated prior output exists.
 * @returns {Promise<void>}
 */
async function replaceCandidateDirectory(
  stagingDirectory,
  outputDirectory,
  replaceExisting,
) {
  const previousDirectory = `${stagingDirectory}.previous`;
  let previousMoved = false;
  try {
    if (replaceExisting) {
      await rename(outputDirectory, previousDirectory);
      previousMoved = true;
    }
    await rename(stagingDirectory, outputDirectory);
  } catch (error) {
    if (previousMoved) {
      await rename(previousDirectory, outputDirectory);
    }
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
  if (previousMoved) {
    await removeCandidateDirectory(previousDirectory);
  }
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
  reviewedNoticePath,
  outputDirectory,
}) {
  const { outputPath, replaceExisting } =
    await validateCandidateOutputPath(
      reviewedDirectory,
      outputDirectory,
    );
  const imported = await importWikiDump({
    dump,
    aliasCatalog,
    selectionCatalog,
    coreEntityIds,
  });
  const candidatePublication = {
    "wiki/manifest.json": Buffer.from(
      `${JSON.stringify(imported.manifest)}\n`,
      "utf8",
    ),
    "NOTICE.md": Buffer.from(
      generateWikiNotice(imported.attributionManifest),
      "utf8",
    ),
  };
  if (imported.records.length > 0) {
    candidatePublication["wiki/wiki-001.json"] = wikiChunkBytes(
      imported.records,
    );
  }
  const changes = await reviewedDiff(
    reviewedDirectory,
    candidatePublication,
    reviewedNoticePath,
  );

  const stagingDirectory = await mkdtemp(
    join(dirname(outputPath), `.${basename(outputPath)}.tmp-`),
  );
  try {
    await Promise.all([
      writeFile(
        join(stagingDirectory, "candidate.json"),
        `${JSON.stringify({
          schemaVersion: WIKI_SCHEMA_VERSION,
          records: imported.records,
          manifest: imported.manifest,
          attributionManifest: imported.attributionManifest,
        }, null, 2)}\n`,
      ),
      writeFile(
        join(stagingDirectory, "coverage.json"),
        `${JSON.stringify(imported.coverage, null, 2)}\n`,
      ),
      writeFile(
        join(stagingDirectory, "diff.json"),
        `${JSON.stringify({
          schemaVersion: WIKI_SCHEMA_VERSION,
          reviewedRoot: reviewedNoticePath
            ? dirname(reviewedNoticePath)
            : dirname(reviewedDirectory),
          changes,
        }, null, 2)}\n`,
      ),
    ]);
    await replaceCandidateDirectory(
      stagingDirectory,
      outputPath,
      replaceExisting,
    );
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
  return imported;
}

/**
 * Require one plain object to have exactly the listed own keys.
 * @param {unknown} value Candidate object.
 * @param {string[]} keys Exact allowed keys.
 * @param {string} label Diagnostic label.
 * @returns {asserts value is Record<string, unknown>}
 */
function assertExactObject(value, keys, label) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify([...keys].sort())
  ) {
    throw new WikiImportError(
      "invalid-schema",
      `${label} has an invalid schema`,
    );
  }
}

/**
 * Require a lowercase SHA-256 digest.
 * @param {unknown} value Candidate digest.
 * @param {string} label Diagnostic label.
 * @returns {void}
 */
function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new WikiImportError(
      "invalid-schema",
      `${label} is not a SHA-256 digest`,
    );
  }
}

/**
 * Validate one checked Wiki record recursively.
 * @param {unknown} value Candidate record.
 * @returns {asserts value is Record<string, unknown>}
 */
function validateWikiRecord(value) {
  assertExactObject(
    value,
    ["schemaVersion", "entityId", "page", "license", "modifications", "sections"],
    "Wiki record",
  );
  if (
    value.schemaVersion !== WIKI_SCHEMA_VERSION
    || typeof value.entityId !== "string"
    || value.entityId.length === 0
    || value.entityId.length > 128
    || Buffer.byteLength(JSON.stringify(value), "utf8")
      > WIKI_MAX_RECORD_BYTES
  ) {
    throw new WikiImportError("invalid-record", "Invalid Wiki record");
  }
  assertExactObject(
    value.page,
    [
      "title",
      "revisionId",
      "revisionTimestamp",
      "sourceUrl",
      "historyUrl",
      "authorLabel",
    ],
    "Wiki page",
  );
  const page = value.page;
  if (
    typeof page.title !== "string"
    || page.title.length === 0
    || !Number.isSafeInteger(page.revisionId)
    || page.revisionId < 0
    || typeof page.revisionTimestamp !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
      .test(page.revisionTimestamp)
    || Number.isNaN(Date.parse(page.revisionTimestamp))
    || page.sourceUrl !== sourceUrl(page.title, page.revisionId)
    || page.historyUrl !== historyUrl(page.title)
    || page.authorLabel !== "NetHackWiki contributors"
  ) {
    throw new WikiImportError("invalid-record", "Invalid Wiki page metadata");
  }
  assertExactObject(
    value.license,
    ["spdxLikeId", "name", "url"],
    "Wiki license",
  );
  if (JSON.stringify(value.license) !== JSON.stringify(WIKI_LICENSE)) {
    throw new WikiImportError(
      "invalid-record",
      "Invalid Wiki license metadata",
    );
  }
  if (
    !Array.isArray(value.modifications)
    || JSON.stringify(value.modifications)
      !== JSON.stringify(WIKI_MODIFICATIONS)
    || !Array.isArray(value.sections)
    || value.sections.length === 0
  ) {
    throw new WikiImportError(
      "invalid-record",
      "Invalid Wiki record metadata",
    );
  }
  for (const section of value.sections) {
    assertExactObject(
      section,
      ["tab", "sourceHeading", "paragraphs", "paragraphHashes"],
      "Wiki section",
    );
    if (
      !WIKI_TABS.has(section.tab)
      || typeof section.sourceHeading !== "string"
      || section.sourceHeading.length === 0
      || prohibitedHeadingCode(section.sourceHeading)
      || !Array.isArray(section.paragraphs)
      || section.paragraphs.length === 0
      || !Array.isArray(section.paragraphHashes)
      || section.paragraphHashes.length !== section.paragraphs.length
    ) {
      throw new WikiImportError("invalid-record", "Invalid Wiki section");
    }
    section.paragraphs.forEach((paragraph, index) => {
      if (typeof paragraph !== "string" || paragraph.length === 0) {
        throw new WikiImportError(
          "invalid-record",
          "Wiki paragraphs must be non-empty strings",
        );
      }
      assertSha256(section.paragraphHashes[index], "Paragraph hash");
      if (sha256(paragraph) !== section.paragraphHashes[index]) {
        throw new WikiImportError(
          "paragraph-hash-mismatch",
          `Stale paragraph hash in ${value.entityId}`,
        );
      }
    });
  }
}

/**
 * Bind checked records and redirects to the reviewed selection catalogs.
 * @param {object} manifest Structurally validated Wiki manifest.
 * @param {object[]} records Structurally validated Wiki records.
 * @param {object} aliasCatalog Checked title alias catalog.
 * @param {object} selectionCatalog Checked publication selection catalog.
 * @returns {void}
 */
function validatePublishedCatalogBinding(
  manifest,
  records,
  aliasCatalog,
  selectionCatalog,
) {
  validateCatalogIdentity(aliasCatalog, selectionCatalog);
  const aliasesByTitle = new Map(
    aliasCatalog.aliases.map((alias) => [alias.title, alias]),
  );
  const selections = selectionCatalog.selections
    .filter((selection) => selection.reviewStatus === "published")
    .sort((left, right) => left.entityId.localeCompare(right.entityId));
  const expectedRevisions = selections.map((selection) => ({
    entityId: selection.entityId,
    title: aliasesByTitle.get(selection.pageTitle).canonicalTitle,
    revisionId: selection.revisionId,
    sha256: selection.revisionHash,
  }));
  if (
    JSON.stringify(manifest.revisions)
      !== JSON.stringify(expectedRevisions)
    || JSON.stringify(records.map((record) => record.entityId))
      !== JSON.stringify(selections.map((selection) => selection.entityId))
  ) {
    throw new WikiImportError(
      "catalog-binding-mismatch",
      "Checked Wiki records do not match published selections",
    );
  }
  const selectionsByEntityId = new Map(
    selections.map((selection) => [selection.entityId, selection]),
  );
  for (const redirect of manifest.redirects ?? []) {
    const selection = selectionsByEntityId.get(redirect.entityId);
    const alias = aliasesByTitle.get(selection?.pageTitle);
    if (
      !selection
      || !alias
      || redirect.title !== selection.pageTitle
      || redirect.target !== alias.canonicalTitle
    ) {
      throw new WikiImportError(
        "catalog-binding-mismatch",
        "Checked Wiki redirect does not match its selected alias",
      );
    }
  }
}

/**
 * Validate checked Wiki chunks and return their records and attribution.
 * @param {object} options Asset paths and optional publication catalogs.
 * @returns {Promise<object>} Validated manifest, records, and attribution.
 */
export async function validateWikiAssetDirectory({
  assetDirectory,
  noticePath,
  aliasCatalog,
  selectionCatalog,
}) {
  const manifestPath = join(assetDirectory, "manifest.json");
  const manifestMetadata = await lstat(manifestPath);
  if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()) {
    throw new WikiImportError(
      "invalid-manifest",
      "Wiki manifest must be a regular file",
    );
  }
  if (manifestMetadata.size > WIKI_MAX_MANIFEST_BYTES) {
    throw new WikiImportError(
      "wiki-size-limit",
      "Wiki manifest exceeds 256 KiB",
    );
  }
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  );
  assertExactObject(
    manifest,
    [
      "schemaVersion",
      "generatorVersion",
      "parser",
      "recordCount",
      "chunks",
      "revisions",
      ...("redirects" in manifest ? ["redirects"] : []),
    ],
    "Wiki manifest",
  );
  assertExactObject(
    manifest.parser,
    ["packageName", "version"],
    "Wiki parser metadata",
  );
  if (
    manifest.schemaVersion !== WIKI_SCHEMA_VERSION
    || manifest.generatorVersion !== WIKI_GENERATOR_VERSION
    || JSON.stringify(manifest.parser) !== JSON.stringify(WIKITEXT_AST_PARSER)
    || !Array.isArray(manifest.chunks)
    || !Number.isSafeInteger(manifest.recordCount)
    || manifest.recordCount < 0
    || !Array.isArray(manifest.revisions)
    || (
      "redirects" in manifest
      && !Array.isArray(manifest.redirects)
    )
  ) {
    throw new WikiImportError("invalid-manifest", "Invalid Wiki manifest");
  }
  const chunkFiles = manifest.chunks.map((chunk) => chunk?.file);
  if (
    JSON.stringify(chunkFiles)
      !== JSON.stringify([...chunkFiles].sort())
  ) {
    throw new WikiImportError(
      "invalid-manifest",
      "Wiki chunks are not in filename order",
    );
  }
  const directoryEntries = await readdir(assetDirectory, {
    withFileTypes: true,
  });
  const expectedFiles = ["manifest.json", ...chunkFiles].sort();
  const actualFiles = directoryEntries.map((entry) => entry.name).sort();
  if (
    JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)
    || directoryEntries.some((entry) =>
      !entry.isFile() || entry.isSymbolicLink()
    )
  ) {
    throw new WikiImportError(
      "invalid-file-set",
      "Wiki asset directory contains unlisted or unsafe files",
    );
  }
  const records = [];
  let totalBytes = manifestMetadata.size;
  for (const chunk of manifest.chunks) {
    assertExactObject(
      chunk,
      [
        "file",
        "bytes",
        "sha256",
        "count",
        "firstEntityId",
        "lastEntityId",
      ],
      "Wiki chunk metadata",
    );
    if (
      typeof chunk.file !== "string"
      || chunk.file.includes("/")
      || chunk.file.includes("\\")
      || !/^wiki-\d{3}\.json$/.test(chunk.file)
      || !Number.isSafeInteger(chunk.bytes)
      || chunk.bytes <= 0
      || chunk.bytes > WIKI_MAX_CHUNK_BYTES
      || !Number.isSafeInteger(chunk.count)
      || chunk.count <= 0
      || typeof chunk.firstEntityId !== "string"
      || typeof chunk.lastEntityId !== "string"
    ) {
      throw new WikiImportError("invalid-chunk", "Unsafe Wiki chunk metadata");
    }
    assertSha256(chunk.sha256, "Chunk hash");
    const path = join(assetDirectory, chunk.file);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new WikiImportError(
        "invalid-chunk",
        `${chunk.file} must be a regular file`,
      );
    }
    totalBytes += metadata.size;
    if (totalBytes > WIKI_MAX_TOTAL_BYTES) {
      throw new WikiImportError(
        "wiki-size-limit",
        "Checked Wiki assets exceed four MiB",
      );
    }
    const bytes = await readFile(path);
    if (
      bytes.byteLength !== chunk.bytes
      || sha256(bytes) !== chunk.sha256
    ) {
      throw new WikiImportError("chunk-hash-mismatch", chunk.file);
    }
    const parsed = JSON.parse(bytes);
    assertExactObject(
      parsed,
      ["schemaVersion", "records"],
      "Wiki chunk",
    );
    if (
      parsed.schemaVersion !== WIKI_SCHEMA_VERSION
      || !Array.isArray(parsed.records)
      || parsed.records.length !== chunk.count
    ) {
      throw new WikiImportError("invalid-chunk", chunk.file);
    }
    parsed.records.forEach(validateWikiRecord);
    if (
      parsed.records[0].entityId !== chunk.firstEntityId
      || parsed.records.at(-1).entityId !== chunk.lastEntityId
    ) {
      throw new WikiImportError(
        "invalid-chunk",
        `${chunk.file} entity bounds changed`,
      );
    }
    records.push(...parsed.records);
  }
  if (records.length !== manifest.recordCount) {
    throw new WikiImportError("record-count-mismatch", "Wiki record count");
  }
  const entityIds = records.map((record) => record.entityId);
  if (
    new Set(entityIds).size !== entityIds.length
    || JSON.stringify(entityIds)
      !== JSON.stringify([...entityIds].sort((left, right) =>
        left.localeCompare(right)
      ))
  ) {
    throw new WikiImportError(
      "invalid-record-order",
      "Wiki records must have unique ordered entity IDs",
    );
  }
  if (manifest.revisions.length !== records.length) {
    throw new WikiImportError(
      "invalid-manifest",
      "Wiki revision count does not match records",
    );
  }
  manifest.revisions.forEach((revision, index) => {
    assertExactObject(
      revision,
      ["entityId", "title", "revisionId", "sha256"],
      "Wiki revision",
    );
    assertSha256(revision.sha256, "Revision hash");
    if (
      revision.entityId !== records[index].entityId
      || revision.title !== records[index].page.title
      || revision.revisionId !== records[index].page.revisionId
    ) {
      throw new WikiImportError(
        "invalid-manifest",
        "Wiki revision metadata does not match records",
      );
    }
  });
  const recordsByEntityId = new Map(
    records.map((record) => [record.entityId, record]),
  );
  const redirectEntityIds = new Set();
  for (const redirect of manifest.redirects ?? []) {
    assertExactObject(
      redirect,
      ["entityId", "title", "target"],
      "Wiki redirect",
    );
    const record = recordsByEntityId.get(redirect.entityId);
    if (
      !record
      || redirectEntityIds.has(redirect.entityId)
      || typeof redirect.title !== "string"
      || redirect.title.length === 0
      || redirect.target !== record.page.title
    ) {
      throw new WikiImportError(
        "invalid-manifest",
        "Invalid Wiki redirect metadata",
      );
    }
    redirectEntityIds.add(redirect.entityId);
  }
  if (aliasCatalog || selectionCatalog) {
    if (!aliasCatalog || !selectionCatalog) {
      throw new WikiImportError(
        "invalid-catalog",
        "Both Wiki publication catalogs are required",
      );
    }
    validatePublishedCatalogBinding(
      manifest,
      records,
      aliasCatalog,
      selectionCatalog,
    );
  }
  const attributionManifest = {
    schemaVersion: WIKI_SCHEMA_VERSION,
    pages: records.map(recordAttribution),
  };
  if (noticePath) {
    const noticeMetadata = await lstat(noticePath);
    if (
      !noticeMetadata.isFile()
      || noticeMetadata.isSymbolicLink()
      || noticeMetadata.size > WIKI_MAX_NOTICE_BYTES
    ) {
      throw new WikiImportError(
        "invalid-notice",
        "Wiki NOTICE must be a bounded regular file",
      );
    }
    totalBytes += noticeMetadata.size;
    if (totalBytes > WIKI_MAX_TOTAL_BYTES) {
      throw new WikiImportError(
        "wiki-size-limit",
        "Checked Wiki assets exceed four MiB",
      );
    }
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
  return (await lstat(path)).size;
}

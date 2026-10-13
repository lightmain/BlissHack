export interface WikiChunkMetadata {
  file: string;
  bytes: number;
  sha256: string;
  count: number;
  firstEntityId: string;
  lastEntityId: string;
}

export interface WikiManifest {
  schemaVersion: 1;
  generatorVersion: string;
  parser: {
    packageName: string;
    version: string;
  };
  recordCount: number;
  chunks: WikiChunkMetadata[];
  revisions: Array<{
    entityId: string;
    title: string;
    revisionId: number;
    sha256: string;
  }>;
}

export interface WikiRecord {
  schemaVersion: 1;
  entityId: string;
  page: {
    title: string;
    revisionId: number;
    revisionTimestamp: string;
    sourceUrl: string;
    historyUrl: string;
    authorLabel: string;
  };
  license: {
    spdxLikeId: string;
    name: string;
    url: string;
  };
  modifications: string[];
  sections: Array<{
    tab: "strategy" | "history";
    sourceHeading: string;
    paragraphs: string[];
    paragraphHashes: string[];
  }>;
}

export interface WikiChunk {
  schemaVersion: 1;
  records: WikiRecord[];
}

const AUTHOR_LABEL = "NetHackWiki contributors";
const LICENSE = Object.freeze({
  spdxLikeId: "CC-BY-SA-3.0",
  name: "Creative Commons Attribution-ShareAlike 3.0 Unported",
  url: "https://creativecommons.org/licenses/by-sa/3.0/",
});
const MODIFICATIONS = Object.freeze([
  "internal link destinations omitted",
  "Wiki markup omitted",
  "wording unchanged",
]);

/**
 * Validate the runtime Wiki manifest before following any controlled path.
 * @param value Untrusted decoded JSON.
 * @returns Strictly validated manifest.
 */
export function validateWikiManifest(value: unknown): WikiManifest {
  const manifest = objectValue(value, "Wiki manifest");
  exactKeys(
    manifest,
    [
      "schemaVersion",
      "generatorVersion",
      "parser",
      "recordCount",
      "chunks",
      "revisions",
    ],
    "Wiki manifest",
  );
  if (manifest.schemaVersion !== 1) {
    throw new Error("Wiki manifest has unsupported schemaVersion");
  }
  semanticVersion(manifest.generatorVersion, "Wiki manifest generatorVersion");
  const parser = objectValue(manifest.parser, "Wiki manifest parser");
  exactKeys(parser, ["packageName", "version"], "Wiki manifest parser");
  if (boundedString(parser.packageName, "Wiki parser package", 64) !== "wikiparser-node") {
    throw new Error("Wiki parser package is unsupported");
  }
  semanticVersion(parser.version, "Wiki parser version");
  safeInteger(manifest.recordCount, "Wiki record count", 0, 10000);
  const chunks = boundedArray(manifest.chunks, "Wiki chunks", 128);
  chunks.forEach((chunk, index) => validateChunkMetadata(chunk, index));
  const revisions = boundedArray(manifest.revisions, "Wiki revisions", 10000);
  revisions.forEach((revision, index) => {
    const label = `Wiki revisions[${index}]`;
    const entry = objectValue(revision, label);
    exactKeys(entry, ["entityId", "title", "revisionId", "sha256"], label);
    canonicalEntityId(entry.entityId, `${label}.entityId`);
    boundedString(entry.title, `${label}.title`, 256);
    safeInteger(entry.revisionId, `${label}.revisionId`, 1);
    digest(entry.sha256, `${label}.sha256`);
  });
  validateManifestRelationships(
    manifest.recordCount as number,
    chunks as Array<Record<string, unknown>>,
    revisions as Array<Record<string, unknown>>,
  );
  return manifest as unknown as WikiManifest;
}

/**
 * Validate a fetched Wiki chunk against trusted manifest metadata.
 * @param value Untrusted decoded chunk JSON.
 * @param metadata Validated metadata selected from the manifest.
 * @returns Strictly validated chunk.
 */
export function validateWikiChunk(
  value: unknown,
  metadata: WikiChunkMetadata,
  manifest: WikiManifest,
): WikiChunk {
  const chunk = objectValue(value, metadata.file);
  exactKeys(chunk, ["schemaVersion", "records"], metadata.file);
  if (chunk.schemaVersion !== 1) {
    throw new Error(`${metadata.file} has unsupported schemaVersion`);
  }
  const records = boundedArray(
    chunk.records,
    `${metadata.file}.records`,
    10000,
  );
  if (records.length !== metadata.count) {
    throw new Error(`${metadata.file} record count mismatch`);
  }
  const validated = records.map((record, index) =>
    validateWikiRecord(record, `${metadata.file}.records[${index}]`)
  );
  if (
    validated[0]?.entityId !== metadata.firstEntityId
    || validated.at(-1)?.entityId !== metadata.lastEntityId
  ) {
    throw new Error(`${metadata.file} entity range mismatch`);
  }
  const revisions = manifest.revisions.filter((revision) =>
    revision.entityId >= metadata.firstEntityId
    && revision.entityId <= metadata.lastEntityId
  );
  if (revisions.length !== validated.length) {
    throw new Error(`${metadata.file} revision count mismatch`);
  }
  validated.forEach((record, index) => {
    const revision = revisions[index];
    if (
      record.entityId !== revision.entityId
      || record.page.title !== revision.title
      || record.page.revisionId !== revision.revisionId
    ) {
      throw new Error(`${metadata.file} revision metadata mismatch`);
    }
    if (index > 0 && validated[index - 1].entityId >= record.entityId) {
      throw new Error(`${metadata.file} records are not uniquely ordered`);
    }
  });
  return chunk as unknown as WikiChunk;
}

/**
 * Validate one attributed Wiki record and its verbatim paragraph envelope.
 * @param value Untrusted record.
 * @param label Diagnostic path.
 * @returns Strictly validated record.
 */
function validateWikiRecord(value: unknown, label: string): WikiRecord {
  const record = objectValue(value, label);
  exactKeys(
    record,
    [
      "schemaVersion",
      "entityId",
      "page",
      "license",
      "modifications",
      "sections",
    ],
    label,
  );
  if (record.schemaVersion !== 1) {
    throw new Error(`${label} has unsupported schemaVersion`);
  }
  canonicalEntityId(record.entityId, `${label}.entityId`);
  const page = objectValue(record.page, `${label}.page`);
  exactKeys(
    page,
    [
      "title",
      "revisionId",
      "revisionTimestamp",
      "sourceUrl",
      "historyUrl",
      "authorLabel",
    ],
    `${label}.page`,
  );
  const title = boundedString(page.title, `${label}.page.title`, 256);
  const revisionId = safeInteger(
    page.revisionId,
    `${label}.page.revisionId`,
    1,
  );
  const timestamp = boundedString(
    page.revisionTimestamp,
    `${label}.page.revisionTimestamp`,
    32,
  );
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(timestamp)
    || Number.isNaN(Date.parse(timestamp))
  ) {
    throw new Error(`${label}.page.revisionTimestamp is invalid`);
  }
  if (page.sourceUrl !== sourceUrl(title, revisionId)) {
    throw new Error(`${label}.page.sourceUrl is invalid`);
  }
  if (page.historyUrl !== historyUrl(title)) {
    throw new Error(`${label}.page.historyUrl is invalid`);
  }
  if (page.authorLabel !== AUTHOR_LABEL) {
    throw new Error(`${label}.page.authorLabel is invalid`);
  }

  const license = objectValue(record.license, `${label}.license`);
  exactKeys(
    license,
    ["spdxLikeId", "name", "url"],
    `${label}.license`,
  );
  if (
    license.spdxLikeId !== LICENSE.spdxLikeId
    || license.name !== LICENSE.name
    || license.url !== LICENSE.url
  ) {
    throw new Error(`${label}.license is unsupported`);
  }

  const modifications = boundedArray(
    record.modifications,
    `${label}.modifications`,
    16,
  );
  if (
    modifications.length !== MODIFICATIONS.length
    || modifications.some((entry, index) => entry !== MODIFICATIONS[index])
  ) {
    throw new Error(`${label}.modifications are invalid`);
  }
  const sections = boundedArray(record.sections, `${label}.sections`, 16);
  if (sections.length === 0) {
    throw new Error(`${label}.sections must not be empty`);
  }
  sections.forEach((section, index) =>
    validateSection(section, `${label}.sections[${index}]`)
  );
  return record as unknown as WikiRecord;
}

/**
 * Cross-check aggregate counts, ordering, uniqueness, and revision coverage.
 * @param recordCount Declared total record count.
 * @param chunks Validated chunk metadata records.
 * @param revisions Validated revision metadata records.
 */
function validateManifestRelationships(
  recordCount: number,
  chunks: Array<Record<string, unknown>>,
  revisions: Array<Record<string, unknown>>,
): void {
  if (
    chunks.reduce((total, chunk) => total + (chunk.count as number), 0)
      !== recordCount
    || revisions.length !== recordCount
  ) {
    throw new Error("Wiki manifest aggregate count mismatch");
  }
  const filenames = new Set<string>();
  chunks.forEach((chunk, index) => {
    const file = chunk.file as string;
    const first = chunk.firstEntityId as string;
    const last = chunk.lastEntityId as string;
    if (
      filenames.has(file)
      || first > last
      || (
        index > 0
        && (chunks[index - 1].lastEntityId as string) >= first
      )
    ) {
      throw new Error("Wiki manifest chunks are not uniquely ordered");
    }
    filenames.add(file);
    const covered = revisions.filter((revision) =>
      (revision.entityId as string) >= first
      && (revision.entityId as string) <= last
    );
    if (
      covered.length !== chunk.count
      || covered[0]?.entityId !== first
      || covered.at(-1)?.entityId !== last
    ) {
      throw new Error(`Wiki manifest revision coverage mismatch for ${file}`);
    }
  });
  revisions.forEach((revision, index) => {
    if (
      index > 0
      && (revisions[index - 1].entityId as string)
        >= (revision.entityId as string)
    ) {
      throw new Error("Wiki manifest revisions are not uniquely ordered");
    }
  });
}

/**
 * Validate one selected Wiki section and aligned paragraph hashes.
 * @param value Untrusted section.
 * @param label Diagnostic path.
 */
function validateSection(value: unknown, label: string): void {
  const section = objectValue(value, label);
  exactKeys(
    section,
    ["tab", "sourceHeading", "paragraphs", "paragraphHashes"],
    label,
  );
  if (section.tab !== "strategy" && section.tab !== "history") {
    throw new Error(`${label}.tab is unsupported`);
  }
  boundedString(section.sourceHeading, `${label}.sourceHeading`, 256);
  const paragraphs = boundedArray(section.paragraphs, `${label}.paragraphs`, 32);
  const hashes = boundedArray(
    section.paragraphHashes,
    `${label}.paragraphHashes`,
    32,
  );
  if (paragraphs.length === 0 || paragraphs.length !== hashes.length) {
    throw new Error(`${label} paragraph hashes are not aligned`);
  }
  paragraphs.forEach((paragraph, index) =>
    boundedString(paragraph, `${label}.paragraphs[${index}]`, 16384)
  );
  hashes.forEach((hash, index) =>
    digest(hash, `${label}.paragraphHashes[${index}]`)
  );
}

/**
 * Validate one Wiki chunk metadata entry.
 * @param value Untrusted metadata.
 * @param index Entry index.
 */
function validateChunkMetadata(value: unknown, index: number): void {
  const label = `Wiki chunks[${index}]`;
  const metadata = objectValue(value, label);
  exactKeys(
    metadata,
    [
      "file",
      "bytes",
      "sha256",
      "count",
      "firstEntityId",
      "lastEntityId",
    ],
    label,
  );
  flatFilename(metadata.file, `${label}.file`);
  safeInteger(metadata.bytes, `${label}.bytes`, 1, 256 * 1024);
  digest(metadata.sha256, `${label}.sha256`);
  safeInteger(metadata.count, `${label}.count`, 1, 10000);
  canonicalEntityId(metadata.firstEntityId, `${label}.firstEntityId`);
  canonicalEntityId(metadata.lastEntityId, `${label}.lastEntityId`);
}

/**
 * Build the exact fixed-revision source URL used by the importer.
 * @param title Canonical Wiki page title.
 * @param revisionId Fixed revision identifier.
 * @returns Exact NetHackWiki oldid URL.
 */
function sourceUrl(title: string, revisionId: number): string {
  return "https://nethackwiki.com/index.php?title="
    + `${encodeURIComponent(title)}&oldid=${revisionId}`;
}

/**
 * Build the exact page history URL used by the importer.
 * @param title Canonical Wiki page title.
 * @returns Exact NetHackWiki history URL.
 */
function historyUrl(title: string): string {
  return "https://nethackwiki.com/index.php?title="
    + `${encodeURIComponent(title)}&action=history`;
}

/**
 * Narrow a candidate to a non-array object.
 * @param value Candidate value.
 * @param label Diagnostic path.
 * @returns Narrowed object.
 */
function objectValue(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Enforce an exact object field set.
 * @param value Object to inspect.
 * @param keys Required and allowed keys.
 * @param label Diagnostic path.
 */
function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const expected = new Set(keys);
  if (
    Object.keys(value).some((key) => !expected.has(key))
    || keys.some((key) => !(key in value))
  ) {
    throw new Error(`${label} fields are invalid`);
  }
}

/**
 * Require a string no longer than the supplied bound.
 * @param value Candidate value.
 * @param label Diagnostic path.
 * @param maximumLength UTF-16 code-unit limit.
 * @returns Narrowed string.
 */
function boundedString(
  value: unknown,
  label: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximumLength
  ) {
    throw new Error(`${label} must be a bounded nonempty string`);
  }
  return value;
}

/**
 * Require a bounded array.
 * @param value Candidate value.
 * @param label Diagnostic path.
 * @param maximumLength Item count limit.
 * @returns Narrowed array.
 */
function boundedArray(
  value: unknown,
  label: string,
  maximumLength: number,
): unknown[] {
  if (!Array.isArray(value) || value.length > maximumLength) {
    throw new Error(`${label} must be a bounded array`);
  }
  return value;
}

/**
 * Require a bounded safe integer.
 * @param value Candidate value.
 * @param label Diagnostic path.
 * @param minimum Inclusive minimum.
 * @param maximum Inclusive maximum.
 * @returns Narrowed integer.
 */
function safeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum
  ) {
    throw new Error(`${label} must be a bounded integer`);
  }
  return value as number;
}

/**
 * Require a lowercase SHA-256 digest.
 * @param value Candidate value.
 * @param label Diagnostic path.
 * @returns Narrowed digest.
 */
function digest(value: unknown, label: string): string {
  const hash = boundedString(value, label, 64);
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
  return hash;
}

/**
 * Require a stable core entity identifier.
 * @param value Candidate value.
 * @param label Diagnostic path.
 * @returns Narrowed entity ID.
 */
function canonicalEntityId(value: unknown, label: string): string {
  const id = boundedString(value, label, 160);
  if (
    !/^(monster:PM_|object:|artifact:ART_|terrain:S_|trap:)[A-Z0-9_]+$/
      .test(id)
  ) {
    throw new Error(`${label} is not a canonical entity ID`);
  }
  return id;
}

/**
 * Require a flat manifest-owned filename.
 * @param value Candidate value.
 * @param label Diagnostic path.
 * @returns Narrowed filename.
 */
function flatFilename(value: unknown, label: string): string {
  const filename = boundedString(value, label, 128);
  if (
    filename === "."
    || filename === ".."
    || filename.includes("/")
    || filename.includes("\\")
    || filename.includes("\0")
  ) {
    throw new Error(`${label} is not a safe filename`);
  }
  return filename;
}

/**
 * Require a semantic version string.
 * @param value Candidate value.
 * @param label Diagnostic path.
 * @returns Narrowed version.
 */
function semanticVersion(value: unknown, label: string): string {
  const version = boundedString(value, label, 32);
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`${label} is invalid`);
  }
  return version;
}

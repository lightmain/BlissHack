import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const RUNTIME_MANIFEST_FILENAME = "nethack-runtime.json";
export const RUNTIME_FILENAMES = ["nethack.js", "nethack.wasm"];

const WASM_HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/**
 * Calculate the SHA-256 and byte length of one runtime file.
 * @param {string} filePath - absolute or relative path to the file.
 * @returns {Promise<{bytes: number, sha256: string}>} stable file metadata.
 */
async function fileMetadata(filePath) {
  const contents = await readFile(filePath);
  return {
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

/**
 * Create a runtime manifest from a complete staged asset directory.
 * @param {{
 *   assetDirectory: string,
 *   emscriptenVersion: string,
 *   nodeVersion: string,
 *   makeVersion: string,
 *   hostCompiler: string,
 *   luaVersion: string,
 *   hintsFile: string,
 *   encyclopediaManifestPath?: string,
 *   wikiManifestPath?: string
 * }} options - build metadata and staged runtime location.
 * @returns {Promise<object>} serializable runtime manifest.
 */
export async function createRuntimeManifest(options) {
  const encyclopediaManifestPath = resolve(
    options.encyclopediaManifestPath
      ?? resolve(
        options.assetDirectory,
        "encyclopedia/core/manifest.json",
      ),
  );
  const wikiManifestPath = resolve(
    options.wikiManifestPath
      ?? resolve(
        options.assetDirectory,
        "encyclopedia/wiki/manifest.json",
      ),
  );
  const [loader, wasm, core, wiki] = await Promise.all([
    ...RUNTIME_FILENAMES.map((name) =>
      fileMetadata(resolve(options.assetDirectory, name))
    ),
    coreEncyclopediaMetadata(encyclopediaManifestPath),
    wikiEncyclopediaMetadata(wikiManifestPath),
  ]);
  return {
    schemaVersion: 3,
    emscriptenVersion: options.emscriptenVersion,
    nodeMajor: Number.parseInt(options.nodeVersion.replace(/^v/, ""), 10),
    luaVersion: options.luaVersion,
    hintsFile: options.hintsFile,
    buildTools: {
      node: options.nodeVersion,
      make: options.makeVersion,
      hostCompiler: options.hostCompiler,
    },
    files: {
      "nethack.js": loader,
      "nethack.wasm": wasm,
    },
    encyclopedia: { core, wiki },
  };
}

/**
 * Write a deterministic runtime manifest into an asset directory.
 * @param {string} assetDirectory - directory containing both runtime files.
 * @param {Parameters<typeof createRuntimeManifest>[0]} options - build metadata.
 * @returns {Promise<object>} the manifest written to disk.
 */
export async function writeRuntimeManifest(assetDirectory, options) {
  const manifest = await createRuntimeManifest({
    ...options,
    assetDirectory,
  });
  await writeFile(
    resolve(assetDirectory, RUNTIME_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

/**
 * Verify runtime file shape, pinned tools, byte lengths, and SHA-256 values.
 * @param {string} assetDirectory - directory containing the runtime triplet.
 * @param {{
 *   emscriptenVersion?: string,
 *   nodeMajor?: number,
 *   luaVersion?: string,
 *   encyclopediaManifestPath?: string,
 *   wikiManifestPath?: string
 * }} [expected] - repository-pinned values to enforce.
 * @returns {Promise<object>} validated manifest.
 */
export async function verifyRuntimeAssets(assetDirectory, expected = {}) {
  const manifestPath = resolve(assetDirectory, RUNTIME_MANIFEST_FILENAME);
  await assertRegularFile(manifestPath, "runtime manifest");
  let manifestSource;
  try {
    manifestSource = await readFile(manifestPath, "utf8");
  } catch {
    throw new Error(`Missing runtime manifest: ${manifestPath}`);
  }
  const manifest = parseManifest(manifestSource);
  assertExpectedTools(manifest, expected);
  const encyclopediaManifestPath = resolve(
    expected.encyclopediaManifestPath
      ?? resolve(
        assetDirectory,
        "encyclopedia/core/manifest.json",
      ),
  );
  const wikiManifestPath = resolve(
    expected.wikiManifestPath
      ?? resolve(
        assetDirectory,
        "encyclopedia/wiki/manifest.json",
      ),
  );
  const [core, wiki] = await Promise.all([
    coreEncyclopediaMetadata(encyclopediaManifestPath),
    wikiEncyclopediaMetadata(wikiManifestPath),
  ]);
  if (
    core.manifest.bytes !== manifest.encyclopedia.core.manifest.bytes
    || core.manifest.sha256
      !== manifest.encyclopedia.core.manifest.sha256
    || core.sourceFingerprint
      !== manifest.encyclopedia.core.sourceFingerprint
    || wiki.manifest.bytes !== manifest.encyclopedia.wiki.manifest.bytes
    || wiki.manifest.sha256
      !== manifest.encyclopedia.wiki.manifest.sha256
  ) {
    throw new Error("Runtime and encyclopedia manifests are not from the same build");
  }

  const loaderPath = resolve(assetDirectory, "nethack.js");
  const wasmPath = resolve(assetDirectory, "nethack.wasm");
  await Promise.all([
    assertRegularFile(loaderPath),
    assertRegularFile(wasmPath),
  ]);

  const [loader, wasm] = await Promise.all([
    readFile(loaderPath),
    readFile(wasmPath),
  ]);
  if (!/\bexport\s+default\b/.test(loader.toString("utf8"))) {
    throw new Error("nethack.js is not an Emscripten ES module");
  }
  if (!/Module\["wasmBinary"\]/.test(loader.toString("utf8"))) {
    throw new Error("nethack.js does not accept verified wasmBinary bytes");
  }
  if (wasm.length < WASM_HEADER.length || !wasm.subarray(0, 8).equals(WASM_HEADER)) {
    throw new Error("nethack.wasm does not have a valid WebAssembly header");
  }

  await Promise.all(RUNTIME_FILENAMES.map(async (name) => {
    const actual = await fileMetadata(resolve(assetDirectory, name));
    const recorded = manifest.files[name];
    if (actual.bytes !== recorded.bytes) {
      throw new Error(
        `${name} byte length mismatch: expected ${recorded.bytes}, got ${actual.bytes}`,
      );
    }
    if (actual.sha256 !== recorded.sha256) {
      throw new Error(`${name} SHA-256 mismatch`);
    }
  }));
  return manifest;
}

/**
 * Parse and strictly validate an untrusted runtime manifest.
 * @param {string} source - manifest JSON text.
 * @returns {object} validated manifest object.
 */
function parseManifest(source) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("nethack-runtime.json is not valid JSON");
  }
  assertRecord(value, "runtime manifest");
  assertExactKeys(value, [
    "schemaVersion",
    "emscriptenVersion",
    "nodeMajor",
    "luaVersion",
    "hintsFile",
    "buildTools",
    "files",
    "encyclopedia",
  ], "runtime manifest");
  if (value.schemaVersion !== 3) {
    throw new Error("Unsupported runtime manifest schemaVersion");
  }
  assertVersion(value.emscriptenVersion, "emscriptenVersion");
  if (!Number.isInteger(value.nodeMajor) || value.nodeMajor < 1) {
    throw new Error("Invalid runtime manifest nodeMajor");
  }
  assertVersion(value.luaVersion, "luaVersion");
  assertBoundedText(value.hintsFile, "hintsFile");

  assertRecord(value.buildTools, "buildTools");
  assertExactKeys(
    value.buildTools,
    ["node", "make", "hostCompiler"],
    "buildTools",
  );
  for (const key of ["node", "make", "hostCompiler"]) {
    assertBoundedText(value.buildTools[key], `buildTools.${key}`);
  }

  assertRecord(value.files, "files");
  assertExactKeys(value.files, RUNTIME_FILENAMES, "files");
  for (const name of RUNTIME_FILENAMES) {
    assertRecord(value.files[name], `files.${name}`);
    assertExactKeys(value.files[name], ["bytes", "sha256"], `files.${name}`);
    if (!Number.isSafeInteger(value.files[name].bytes) || value.files[name].bytes < 1) {
      throw new Error(`Invalid runtime manifest files.${name}.bytes`);
    }
    if (!/^[a-f0-9]{64}$/.test(value.files[name].sha256)) {
      throw new Error(`Invalid runtime manifest files.${name}.sha256`);
    }
  }
  assertRecord(value.encyclopedia, "encyclopedia");
  assertExactKeys(
    value.encyclopedia,
    ["core", "wiki"],
    "encyclopedia",
  );
  assertRecord(value.encyclopedia.core, "encyclopedia.core");
  assertExactKeys(
    value.encyclopedia.core,
    ["manifest", "sourceFingerprint"],
    "encyclopedia.core",
  );
  assertFileMetadata(
    value.encyclopedia.core.manifest,
    "encyclopedia.core.manifest",
  );
  assertRecord(value.encyclopedia.wiki, "encyclopedia.wiki");
  assertExactKeys(
    value.encyclopedia.wiki,
    ["manifest"],
    "encyclopedia.wiki",
  );
  assertFileMetadata(
    value.encyclopedia.wiki.manifest,
    "encyclopedia.wiki.manifest",
  );
  for (const [field, digest] of [
    [
      "encyclopedia.core.sourceFingerprint",
      value.encyclopedia.core.sourceFingerprint,
    ],
  ]) {
    if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error(`Invalid runtime manifest ${field}`);
    }
  }
  return value;
}

/**
 * Read and validate the core encyclopedia manifest metadata bound to WASM.
 * @param {string} manifestPath - core encyclopedia manifest path.
 * @returns {Promise<{
 *   manifest: {bytes: number, sha256: string},
 *   sourceFingerprint: string
 * }>} integrity and source identity.
 */
async function coreEncyclopediaMetadata(manifestPath) {
  await assertRegularFile(manifestPath, "encyclopedia manifest");
  const bytes = await readFile(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Encyclopedia manifest is not valid JSON");
  }
  assertRecord(manifest, "encyclopedia source");
  if (
    manifest.schemaVersion !== 1
    || typeof manifest.sourceFingerprint !== "string"
    || !/^[a-f0-9]{64}$/.test(manifest.sourceFingerprint)
  ) {
    throw new Error("Invalid encyclopedia source fingerprint");
  }
  return {
    manifest: {
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    sourceFingerprint: manifest.sourceFingerprint,
  };
}

/**
 * Read and validate the reviewed Wiki manifest metadata bound to WASM.
 * @param {string} manifestPath - Wiki encyclopedia manifest path.
 * @returns {Promise<{manifest: {bytes: number, sha256: string}}>} integrity
 * metadata.
 */
async function wikiEncyclopediaMetadata(manifestPath) {
  await assertRegularFile(manifestPath, "Wiki encyclopedia manifest");
  const bytes = await readFile(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Wiki encyclopedia manifest is not valid JSON");
  }
  assertRecord(manifest, "Wiki encyclopedia source");
  if (manifest.schemaVersion !== 1) {
    throw new Error("Invalid Wiki encyclopedia manifest schema");
  }
  return {
    manifest: {
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

/**
 * Require a path to refer to a regular file.
 * @param {string} filePath - path to inspect.
 * @param {string} [label] - asset label used in an error.
 * @returns {Promise<void>} completion after successful validation.
 */
async function assertRegularFile(filePath, label = "runtime file") {
  let details;
  try {
    details = await lstat(filePath);
  } catch {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
  if (!details.isFile()) {
    throw new Error(`${label} is not a regular file: ${filePath}`);
  }
}

/**
 * Compare manifest tool fields with repository-pinned values.
 * @param {object} manifest - validated runtime manifest.
 * @param {object} expected - optional pinned tool versions.
 * @returns {void}
 */
function assertExpectedTools(manifest, expected) {
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (
      field !== "encyclopediaManifestPath"
      && field !== "wikiManifestPath"
      && expectedValue !== undefined
      && manifest[field] !== expectedValue
    ) {
      throw new Error(
        `Runtime manifest ${field} mismatch: expected ${expectedValue}, got ${manifest[field]}`,
      );
    }
  }
}

/**
 * Require a runtime file metadata object with bounded size and digest.
 * @param {unknown} value - metadata candidate.
 * @param {string} label - field label used in diagnostics.
 * @returns {void}
 */
function assertFileMetadata(value, label) {
  assertRecord(value, label);
  assertExactKeys(value, ["bytes", "sha256"], label);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 1) {
    throw new Error(`Invalid runtime manifest ${label}.bytes`);
  }
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error(`Invalid runtime manifest ${label}.sha256`);
  }
}

/**
 * Require a plain JSON object.
 * @param {unknown} value - value to inspect.
 * @param {string} label - field name used in an error.
 * @returns {void}
 */
function assertRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid runtime manifest ${label}`);
  }
}

/**
 * Require an object to contain exactly the allowed keys.
 * @param {object} value - object to inspect.
 * @param {string[]} allowed - complete allowed key set.
 * @param {string} label - field name used in an error.
 * @returns {void}
 */
function assertExactKeys(value, allowed, label) {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Invalid runtime manifest ${label} fields`);
  }
}

/**
 * Require a dotted numeric tool version.
 * @param {unknown} value - version to inspect.
 * @param {string} label - field name used in an error.
 * @returns {void}
 */
function assertVersion(value, label) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)+$/.test(value)) {
    throw new Error(`Invalid runtime manifest ${label}`);
  }
}

/**
 * Require short printable build metadata.
 * @param {unknown} value - text to inspect.
 * @param {string} label - field name used in an error.
 * @returns {void}
 */
function assertBoundedText(value, label) {
  if (typeof value !== "string"
      || value.length < 1
      || value.length > 256) {
    throw new Error(`Invalid runtime manifest ${label}`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      throw new Error(`Invalid runtime manifest ${label}`);
    }
  }
}

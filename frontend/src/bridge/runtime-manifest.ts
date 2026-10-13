export interface RuntimeFileMetadata {
  bytes: number;
  sha256: string;
}

export interface RuntimeAssetIdentity {
  wasm: RuntimeFileMetadata;
  encyclopedia: RuntimeManifest["encyclopedia"];
}

export interface RuntimeManifest {
  schemaVersion: 3;
  emscriptenVersion: string;
  nodeMajor: number;
  luaVersion: string;
  hintsFile: string;
  buildTools: {
    node: string;
    make: string;
    hostCompiler: string;
  };
  files: {
    "nethack.js": RuntimeFileMetadata;
    "nethack.wasm": RuntimeFileMetadata;
  };
  encyclopedia: {
    core: {
      manifest: RuntimeFileMetadata;
      sourceFingerprint: string;
    };
    wiki: {
      manifest: RuntimeFileMetadata;
    };
  };
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Decode and strictly validate one browser runtime manifest.
 * @param bytes UTF-8 JSON bytes fetched from the runtime asset directory.
 * @returns Validated schema-v3 runtime manifest.
 */
export function decodeRuntimeManifest(bytes: Uint8Array): RuntimeManifest {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error("Runtime manifest is not valid UTF-8 JSON");
  }
  return validateRuntimeManifest(value);
}

/**
 * Strictly validate one decoded browser runtime manifest.
 * @param value Untrusted decoded JSON value.
 * @returns Validated schema-v3 runtime manifest.
 */
export function validateRuntimeManifest(value: unknown): RuntimeManifest {
  const root = recordValue(value, "runtime manifest");
  exactFields(root, [
    "schemaVersion",
    "emscriptenVersion",
    "nodeMajor",
    "luaVersion",
    "hintsFile",
    "buildTools",
    "files",
    "encyclopedia",
  ], "runtime manifest");
  if (root.schemaVersion !== 3) {
    throw new Error("Runtime manifest schema is unsupported");
  }
  version(root.emscriptenVersion, "runtime emscriptenVersion");
  boundedInteger(root.nodeMajor, "runtime nodeMajor", 1);
  version(root.luaVersion, "runtime luaVersion");
  boundedText(root.hintsFile, "runtime hintsFile", 256);

  const buildTools = recordValue(root.buildTools, "runtime buildTools");
  exactFields(
    buildTools,
    ["node", "make", "hostCompiler"],
    "runtime buildTools",
  );
  boundedText(buildTools.node, "runtime buildTools.node", 256);
  boundedText(buildTools.make, "runtime buildTools.make", 256);
  boundedText(
    buildTools.hostCompiler,
    "runtime buildTools.hostCompiler",
    256,
  );

  const files = recordValue(root.files, "runtime files");
  exactFields(files, ["nethack.js", "nethack.wasm"], "runtime files");
  validateFileMetadata(files["nethack.js"], "runtime files.nethack.js");
  validateFileMetadata(files["nethack.wasm"], "runtime files.nethack.wasm");

  const encyclopedia = recordValue(
    root.encyclopedia,
    "runtime encyclopedia",
  );
  exactFields(encyclopedia, ["core", "wiki"], "runtime encyclopedia");
  const core = recordValue(encyclopedia.core, "runtime encyclopedia.core");
  exactFields(
    core,
    ["manifest", "sourceFingerprint"],
    "runtime encyclopedia.core",
  );
  validateFileMetadata(
    core.manifest,
    "runtime encyclopedia.core.manifest",
  );
  digest(
    core.sourceFingerprint,
    "runtime encyclopedia.core.sourceFingerprint",
  );
  const wiki = recordValue(encyclopedia.wiki, "runtime encyclopedia.wiki");
  exactFields(wiki, ["manifest"], "runtime encyclopedia.wiki");
  validateFileMetadata(
    wiki.manifest,
    "runtime encyclopedia.wiki.manifest",
  );
  return root as unknown as RuntimeManifest;
}

/**
 * Verify asset bytes against runtime-owned metadata.
 * @param bytes Fetched asset bytes.
 * @param metadata Trusted byte count and SHA-256 digest.
 * @param label Diagnostic asset label.
 * @returns Completion after byte count and digest verification.
 */
export async function verifyRuntimeAssetBytes(
  bytes: Uint8Array,
  metadata: RuntimeFileMetadata,
  label: string,
): Promise<void> {
  if (bytes.byteLength !== metadata.bytes) {
    throw new Error(`${label} byte length mismatch`);
  }
  const actualDigest = await sha256(bytes);
  if (actualDigest !== metadata.sha256) {
    throw new Error(`${label} digest mismatch`);
  }
}

/**
 * Create a deeply frozen identity for one module and its encyclopedia roots.
 * @param manifest Validated runtime manifest.
 * @returns Immutable module runtime identity.
 */
export function runtimeIdentityFromManifest(
  manifest: RuntimeManifest,
): RuntimeAssetIdentity {
  return Object.freeze({
    wasm: Object.freeze({ ...manifest.files["nethack.wasm"] }),
    encyclopedia: Object.freeze({
      core: Object.freeze({
        manifest: Object.freeze({
          ...manifest.encyclopedia.core.manifest,
        }),
        sourceFingerprint: manifest.encyclopedia.core.sourceFingerprint,
      }),
      wiki: Object.freeze({
        manifest: Object.freeze({
          ...manifest.encyclopedia.wiki.manifest,
        }),
      }),
    }),
  });
}

/**
 * Require a module identity to match the complete runtime-owned asset roots.
 * @param identity Identity exposed by the active initialized module.
 * @param manifest Validated runtime manifest.
 */
export function assertRuntimeIdentityMatches(
  identity: RuntimeAssetIdentity,
  manifest: RuntimeManifest,
): void {
  const expectedWasm = manifest.files["nethack.wasm"];
  const expectedCore = manifest.encyclopedia.core;
  const expectedWiki = manifest.encyclopedia.wiki;
  if (
    identity?.wasm?.bytes !== expectedWasm.bytes
    || identity?.wasm?.sha256 !== expectedWasm.sha256
    || identity?.encyclopedia?.core?.manifest?.bytes
      !== expectedCore.manifest.bytes
    || identity?.encyclopedia?.core?.manifest?.sha256
      !== expectedCore.manifest.sha256
    || identity?.encyclopedia?.core?.sourceFingerprint
      !== expectedCore.sourceFingerprint
    || identity?.encyclopedia?.wiki?.manifest?.bytes
      !== expectedWiki.manifest.bytes
    || identity?.encyclopedia?.wiki?.manifest?.sha256
      !== expectedWiki.manifest.sha256
  ) {
    throw new Error("Active module runtime identity does not match runtime manifest");
  }
}

/**
 * Validate one file metadata object.
 * @param value Untrusted metadata.
 * @param label Diagnostic field label.
 */
function validateFileMetadata(value: unknown, label: string): void {
  const metadata = recordValue(value, label);
  exactFields(metadata, ["bytes", "sha256"], label);
  boundedInteger(metadata.bytes, `${label}.bytes`, 1);
  digest(metadata.sha256, `${label}.sha256`);
}

/**
 * Calculate a lowercase SHA-256 digest.
 * @param bytes Input bytes.
 * @returns Lowercase hexadecimal digest.
 */
async function sha256(bytes: Uint8Array): Promise<string> {
  const result = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer,
  );
  return Array.from(new Uint8Array(result), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Narrow an untrusted value to a non-array object.
 * @param value Candidate value.
 * @param label Diagnostic field label.
 * @returns Narrowed record.
 */
function recordValue(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Enforce an exact field set.
 * @param value Record to inspect.
 * @param fields Complete allowed and required fields.
 * @param label Diagnostic field label.
 */
function exactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  const allowed = new Set(fields);
  if (
    Object.keys(value).some((field) => !allowed.has(field))
    || fields.some((field) => !(field in value))
  ) {
    throw new Error(`${label} fields are invalid`);
  }
}

/**
 * Require a bounded positive safe integer.
 * @param value Candidate value.
 * @param label Diagnostic field label.
 * @param minimum Inclusive minimum.
 * @returns Narrowed integer.
 */
function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

/**
 * Require bounded printable text.
 * @param value Candidate value.
 * @param label Diagnostic field label.
 * @param maximumLength Maximum UTF-16 code units.
 * @returns Narrowed string.
 */
function boundedText(
  value: unknown,
  label: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximumLength
    || Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

/**
 * Require a dotted numeric version.
 * @param value Candidate value.
 * @param label Diagnostic field label.
 * @returns Narrowed version.
 */
function version(value: unknown, label: string): string {
  const candidate = boundedText(value, label, 32);
  if (!/^\d+(?:\.\d+)+$/.test(candidate)) {
    throw new Error(`${label} is invalid`);
  }
  return candidate;
}

/**
 * Require a lowercase SHA-256 digest.
 * @param value Candidate value.
 * @param label Diagnostic field label.
 * @returns Narrowed digest.
 */
function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

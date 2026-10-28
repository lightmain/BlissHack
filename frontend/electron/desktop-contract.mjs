import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const APP_ORIGIN = "blisshack://app";
export const MAX_NATIVE_SAVE_BYTES = 96 * 1024 * 1024;

export const DESKTOP_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
});

export const DESKTOP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' blob: data:",
  "object-src 'none'",
  "script-src 'self' blob: 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
].join("; ");

const WINDOWS_RESERVED_FILE_NAME =
  /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/iu;

/**
 * Resolve one custom-protocol request to an existing regular file below the
 * immutable renderer asset root.
 * @param {{method: string, url: string}} request protocol request shape.
 * @param {string} assetRoot absolute renderer asset root.
 * @returns {Promise<string>} canonical path to the requested asset.
 */
export async function resolveAppResource(request, assetRoot) {
  if (request?.method !== "GET" && request?.method !== "HEAD") {
    throw new Error("Desktop assets only support GET and HEAD");
  }
  if (typeof request.url !== "string") {
    throw new Error("Desktop asset URL is required");
  }

  const rawMatch = /^blisshack:\/\/([^/?#]+)(\/[^?#]*)?(?:[?#].*)?$/i.exec(
    request.url,
  );
  if (!rawMatch || rawMatch[1] !== "app") {
    throw new Error("Desktop asset origin is not allowed");
  }

  const decodedPath = decodeRequestPath(rawMatch[2] ?? "/");
  const segments = decodedPath.replaceAll("\\", "/").split("/");
  if (
    decodedPath.includes("\0")
    || segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Desktop asset path traversal is not allowed");
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const requestedCandidate = resolve(assetRoot, relativePath);
  const canonicalRoot = await realpath(assetRoot);
  const candidate = resolve(canonicalRoot, relativePath);
  if (!isWithinRoot(canonicalRoot, candidate)) {
    throw new Error("Desktop asset path escaped its root");
  }

  const canonicalCandidate = await realpath(candidate);
  if (!isWithinRoot(canonicalRoot, canonicalCandidate)) {
    throw new Error("Desktop asset symbolic link escaped its root");
  }
  const metadata = await stat(canonicalCandidate);
  if (!metadata.isFile()) {
    throw new Error("Desktop asset must be a regular file");
  }
  return requestedCandidate;
}

/**
 * Validate the renderer-controlled portion of one native Save request.
 * @param {unknown} value untrusted IPC payload.
 * @returns {{fileName: string, data: ArrayBuffer}} validated payload.
 */
export function validateNativeSaveRequest(value) {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError("Native save request must be a plain object");
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "data" || keys[1] !== "fileName") {
    throw new TypeError("Native save request has unsupported fields");
  }

  const { fileName, data } = value;
  if (
    typeof fileName !== "string"
    || fileName.length === 0
    || fileName.length > 255
    || fileName.trim() !== fileName
    || fileName === "."
    || fileName === ".."
    || fileName.endsWith(".")
    || /[\\/:<>"|?*]/.test(fileName)
    || [...fileName].some((character) => character.codePointAt(0) < 32)
    || WINDOWS_RESERVED_FILE_NAME.test(fileName)
  ) {
    throw new TypeError("Native save filename is not portable");
  }
  if (!(data instanceof ArrayBuffer)) {
    throw new TypeError("Native save data must be an ArrayBuffer");
  }
  if (data.byteLength > MAX_NATIVE_SAVE_BYTES) {
    throw new RangeError("Native save data exceeds the 96 MiB limit");
  }
  return { fileName, data };
}

/** Decode repeatedly so nested percent-encoding cannot hide traversal. */
function decodeRequestPath(path) {
  let decoded = path;
  for (let index = 0; index < 4; index += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error("Desktop asset path has invalid percent-encoding");
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
  if (decoded.includes("%")) {
    throw new Error("Desktop asset path is excessively encoded");
  }
  return decoded;
}

/** Return whether a path is the root itself or one of its descendants. */
function isWithinRoot(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === ""
    || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".."
      && !isAbsolute(pathFromRoot));
}

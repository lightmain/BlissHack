import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DESKTOP_CONTENT_SECURITY_POLICY,
  DESKTOP_WEB_PREFERENCES,
  MAX_NATIVE_SAVE_BYTES,
  resolveAppResource,
  validateNativeSaveRequest,
} from "./desktop-contract.mjs";

const temporaryDirectories = [];
const WINDOWS_RESERVED_FILE_NAMES = [
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
  ..."¹²³".split("").map((suffix) => `COM${suffix}`),
  ..."¹²³".split("").map((suffix) => `LPT${suffix}`),
];

async function createAssetRoot() {
  const root = await mkdtemp(join(tmpdir(), "blisshack-desktop-assets-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "assets"));
  await Promise.all([
    writeFile(join(root, "index.html"), "<!doctype html>", "utf8"),
    writeFile(join(root, "assets", "app.js"), "export {};", "utf8"),
  ]);
  return root;
}

function scriptSources(policy) {
  const directive = policy
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === "script-src");
  expect(directive, "CSP must define script-src").toBeDefined();
  return directive.slice(1);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("blisshack app resource resolution", () => {
  it("resolves GET / to index.html and HEAD resources below the asset root", async () => {
    const root = await createAssetRoot();

    await expect(resolveAppResource({
      method: "GET",
      url: "blisshack://app/",
    }, root)).resolves.toBe(join(root, "index.html"));
    await expect(resolveAppResource({
      method: "HEAD",
      url: "blisshack://app/assets/app.js",
    }, root)).resolves.toBe(join(root, "assets", "app.js"));
  });

  it.each([
    ["wrong scheme", "GET", "https://app/index.html"],
    ["wrong host", "GET", "blisshack://other/index.html"],
    ["unsupported method", "POST", "blisshack://app/index.html"],
    ["plain traversal", "GET", "blisshack://app/../outside.txt"],
    ["encoded traversal", "GET", "blisshack://app/%2e%2e/outside.txt"],
    ["double-encoded traversal", "GET", "blisshack://app/%252e%252e/outside.txt"],
    ["encoded separators", "GET", "blisshack://app/assets%2f..%2foutside.txt"],
  ])("rejects %s", async (_label, method, url) => {
    const root = await createAssetRoot();

    await expect(resolveAppResource({ method, url }, root)).rejects.toThrow();
  });

  it("rejects missing resources and symbolic links outside the asset root", async () => {
    const root = await createAssetRoot();
    const outside = await mkdtemp(join(tmpdir(), "blisshack-desktop-outside-"));
    temporaryDirectories.push(outside);
    const outsideFile = join(outside, "outside.txt");
    await writeFile(outsideFile, "outside", "utf8");
    await symlink(outsideFile, join(root, "linked.txt"));

    await expect(resolveAppResource({
      method: "GET",
      url: "blisshack://app/missing.txt",
    }, root)).rejects.toThrow();
    await expect(resolveAppResource({
      method: "GET",
      url: "blisshack://app/linked.txt",
    }, root)).rejects.toThrow();
  });
});

describe("desktop renderer security", () => {
  it("keeps BrowserWindow web preferences isolated and sandboxed", () => {
    expect(DESKTOP_WEB_PREFERENCES).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    });
  });

  it("allows same-origin and Blob scripts without unsafe-eval", () => {
    const sources = scriptSources(DESKTOP_CONTENT_SECURITY_POLICY);

    expect(sources).toContain("'self'");
    expect(sources).toContain("blob:");
    expect(sources).toContain("'wasm-unsafe-eval'");
    expect(sources).not.toContain("'unsafe-eval'");
  });

  it("keeps the checked-in WASM loader free of runtime eval", async () => {
    const [loader, source] = await Promise.all([
      readFile(join(import.meta.dirname, "../public/nethack.js"), "utf8"),
      readFile(
        join(import.meta.dirname, "../../sys/libnh/libnhmain.c"),
        "utf8",
      ),
    ]);

    expect(loader).not.toMatch(/\beval\s*\(/);
    expect(source).not.toContain("emscripten_run_script");
  });
});

describe("native save IPC validation", () => {
  it("accepts only a safe flat filename and an ArrayBuffer", () => {
    const request = {
      fileName: "blisshack-backup-2026-10-28.zip",
      data: new ArrayBuffer(16),
    };

    expect(validateNativeSaveRequest(request)).toEqual(request);
  });

  it.each([
    ["empty", ""],
    ["current directory", "."],
    ["parent directory", ".."],
    ["slash", "folder/save.zip"],
    ["backslash", "folder\\save.zip"],
    ["absolute path", "/tmp/save.zip"],
    ["drive path", "C:\\temp\\save.zip"],
    ["NUL", "save\0.zip"],
    ["less-than sign", "save<old.zip"],
    ["greater-than sign", "save>new.zip"],
    ["double quote", 'save"copy.zip'],
    ["vertical bar", "save|copy.zip"],
    ["question mark", "save?.zip"],
    ["asterisk", "save*.zip"],
  ])("rejects a %s filename", (_label, fileName) => {
    expect(() => validateNativeSaveRequest({
      fileName,
      data: new ArrayBuffer(1),
    })).toThrow();
  });

  it("rejects every raw Windows device filename", () => {
    const acceptedNames = WINDOWS_RESERVED_FILE_NAMES.filter((fileName) => {
      try {
        validateNativeSaveRequest({
          fileName,
          data: new ArrayBuffer(1),
        });
        return true;
      } catch {
        return false;
      }
    });

    expect(acceptedNames).toEqual([]);
  });

  it("requires exactly fileName and ArrayBuffer data fields", () => {
    expect(() => validateNativeSaveRequest({
      fileName: "save.zip",
      data: new Uint8Array(1),
    })).toThrow();
    expect(() => validateNativeSaveRequest({
      fileName: "save.zip",
    })).toThrow();
    expect(() => validateNativeSaveRequest({
      fileName: "save.zip",
      data: new ArrayBuffer(1),
      destination: "/tmp/save.zip",
    })).toThrow();
  });

  it("accepts exactly 96 MiB and rejects one additional byte", () => {
    expect(MAX_NATIVE_SAVE_BYTES).toBe(96 * 1024 * 1024);

    expect(validateNativeSaveRequest({
      fileName: "maximum-size.bin",
      data: new ArrayBuffer(MAX_NATIVE_SAVE_BYTES),
    })).toEqual({
      fileName: "maximum-size.bin",
      data: expect.any(ArrayBuffer),
    });
    expect(() => validateNativeSaveRequest({
      fileName: "too-large.bin",
      data: new ArrayBuffer(MAX_NATIVE_SAVE_BYTES + 1),
    })).toThrow(/96 MiB/i);
  });
});

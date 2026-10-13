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
  createRuntimeManifest,
  verifyRuntimeAssets,
  writeRuntimeManifest,
} from "./runtime-assets.mjs";

const TOOLCHAIN = {
  emscriptenVersion: "6.0.9",
  nodeVersion: "v24.20.0",
  makeVersion: "GNU Make 4.3",
  hostCompiler: "gcc 13.3.0",
  luaVersion: "5.4.8",
  hintsFile: "sys/unix/hints/linux.500",
};
const EXPECTED_TOOLS = {
  emscriptenVersion: "6.0.9",
  nodeMajor: 24,
  luaVersion: "5.4.8",
};
const temporaryDirectories = [];

/**
 * Create a complete minimal runtime triplet for one test.
 * @returns {Promise<string>} temporary asset directory.
 */
async function runtimeFixture() {
  const directory = await mkdtemp(join(tmpdir(), "blisshack-runtime-"));
  temporaryDirectories.push(directory);
  const encyclopediaDirectory = join(directory, "encyclopedia/core");
  const wikiDirectory = join(directory, "encyclopedia/wiki");
  await Promise.all([
    mkdir(encyclopediaDirectory, { recursive: true }),
    mkdir(wikiDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(directory, "nethack.js"),
      "const runtime = {}; runtime.wasm = Module[\"wasmBinary\"];\n"
        + "export default runtime;\n",
      "utf8",
    ),
    writeFile(
      join(directory, "nethack.wasm"),
      Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01]),
    ),
    writeFile(
      join(encyclopediaDirectory, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        sourceFingerprint: "a".repeat(64),
      }),
      "utf8",
    ),
    writeFile(
      join(wikiDirectory, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        recordCount: 0,
      }),
      "utf8",
    ),
  ]);
  await writeRuntimeManifest(directory, TOOLCHAIN);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("runtime asset manifest", () => {
  it("generates stable metadata and verifies a complete runtime triplet", async () => {
    const directory = await runtimeFixture();
    const first = await createRuntimeManifest({
      ...TOOLCHAIN,
      assetDirectory: directory,
    });
    const second = await createRuntimeManifest({
      ...TOOLCHAIN,
      assetDirectory: directory,
    });

    expect(first).toEqual(second);
    await expect(
      verifyRuntimeAssets(directory, EXPECTED_TOOLS),
    ).resolves.toMatchObject(EXPECTED_TOOLS);
  });

  it("rejects a missing manifest or runtime file", async () => {
    const withoutManifest = await mkdtemp(
      join(tmpdir(), "blisshack-runtime-"),
    );
    temporaryDirectories.push(withoutManifest);
    await expect(verifyRuntimeAssets(withoutManifest)).rejects.toThrow(
      /Missing runtime manifest/,
    );

    const withoutLoader = await runtimeFixture();
    await rm(join(withoutLoader, "nethack.js"));
    await expect(verifyRuntimeAssets(withoutLoader)).rejects.toThrow(
      /Missing runtime file:.*nethack\.js/,
    );
  });

  it("rejects an invalid WebAssembly header", async () => {
    const directory = await runtimeFixture();
    await writeFile(join(directory, "nethack.wasm"), Buffer.alloc(9));

    await expect(verifyRuntimeAssets(directory)).rejects.toThrow(
      /valid WebAssembly header/,
    );
  });

  it("rejects a loader which cannot consume verified WASM bytes", async () => {
    const directory = await runtimeFixture();
    await writeFile(
      join(directory, "nethack.js"),
      "const runtime = {};\nexport default runtime;\n",
      "utf8",
    );
    const manifest = await createRuntimeManifest({
      ...TOOLCHAIN,
      assetDirectory: directory,
    });
    await writeFile(
      join(directory, "nethack-runtime.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    await expect(verifyRuntimeAssets(directory)).rejects.toThrow(
      /verified wasmBinary bytes/,
    );
  });

  it("rejects symbolic links in the runtime triplet", async () => {
    const directory = await runtimeFixture();
    const wasmPath = join(directory, "nethack.wasm");
    const targetPath = join(directory, "wasm-target");
    await writeFile(
      targetPath,
      Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01]),
    );
    await rm(wasmPath);
    await symlink(targetPath, wasmPath);

    await expect(verifyRuntimeAssets(directory)).rejects.toThrow(
      /runtime file is not a regular file/,
    );
  });

  it("rejects byte-length and same-length digest changes", async () => {
    const lengthDirectory = await runtimeFixture();
    await writeFile(
      join(lengthDirectory, "nethack.js"),
      "const runtime = {}; runtime.wasm = Module[\"wasmBinary\"];\n"
        + "export default runtime;\nextra",
      "utf8",
    );
    await expect(verifyRuntimeAssets(lengthDirectory)).rejects.toThrow(
      /nethack\.js byte length mismatch/,
    );

    const digestDirectory = await runtimeFixture();
    const loaderPath = join(digestDirectory, "nethack.js");
    const loader = await readFile(loaderPath, "utf8");
    await writeFile(loaderPath, loader.replace("{}", "[]"), "utf8");
    await expect(verifyRuntimeAssets(digestDirectory)).rejects.toThrow(
      /nethack\.js SHA-256 mismatch/,
    );
  });

  it("rejects a runtime built with a different pinned tool version", async () => {
    const directory = await runtimeFixture();

    await expect(verifyRuntimeAssets(directory, {
      ...EXPECTED_TOOLS,
      emscriptenVersion: "6.0.8",
    })).rejects.toThrow(
      /emscriptenVersion mismatch: expected 6\.0\.8, got 6\.0\.9/,
    );
  });

  it("rejects unknown manifest fields", async () => {
    const directory = await runtimeFixture();
    const manifestPath = join(directory, "nethack-runtime.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.unexpected = true;
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    await expect(verifyRuntimeAssets(directory)).rejects.toThrow(
      /runtime manifest fields/,
    );
  });
});

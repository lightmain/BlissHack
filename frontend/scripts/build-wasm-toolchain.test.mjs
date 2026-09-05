import {
  access,
  chmod,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const buildScript = join(repositoryRoot, "scripts/build-wasm.sh");
const temporaryDirectories = [];

/**
 * Write one executable used to isolate toolchain preflight behavior.
 * @param {string} directory - fake binary directory.
 * @param {string} name - command name.
 * @param {string} body - POSIX shell body.
 * @returns {Promise<void>} completion after the executable is ready.
 */
async function writeExecutable(directory, name, body) {
  const path = join(directory, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`, "utf8");
  await chmod(path, 0o755);
}

/**
 * Create all fake commands needed to reach an Emscripten preflight check.
 * @param {string} directory - fake binary directory.
 * @param {string} emscriptenVersion - version reported by emcc.
 * @param {string} marker - file touched if make is incorrectly reached.
 * @returns {Promise<void>} completion after commands are ready.
 */
async function writeBaseToolchain(
  directory,
  emscriptenVersion,
  marker,
) {
  await Promise.all([
    writeExecutable(
      directory,
      "node",
      'if [ "$1" = "--version" ]; then echo v24.19.0; '
        + 'elif [ "$1" = "-p" ]; then echo 24; else exit 2; fi',
    ),
    writeExecutable(directory, "npm", "echo 11.6.0"),
    writeExecutable(
      directory,
      "emcc",
      `echo "emcc (Emscripten) ${emscriptenVersion}"`,
    ),
    writeExecutable(directory, "emar", "exit 0"),
    writeExecutable(directory, "emranlib", "exit 0"),
    writeExecutable(directory, "make", `touch "${marker}"; exit 99`),
  ]);
}

/**
 * Run build preflight with an isolated PATH.
 * @param {string[]} fakeDirectories - fake binary directories in PATH order.
 * @param {string} marker - make invocation marker.
 * @returns {ReturnType<typeof spawnSync>} completed child process.
 */
function runPreflight(fakeDirectories, marker) {
  return spawnSync("/bin/sh", [buildScript], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      MAKE_CALLED_MARKER: marker,
      PATH: [...fakeDirectories, "/usr/bin", "/bin"].join(":"),
    },
  });
}

/**
 * Check whether a path exists.
 * @param {string} path - path to inspect.
 * @returns {Promise<boolean>} true when the path exists.
 */
async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("WASM toolchain preflight", () => {
  it("rejects the wrong Emscripten version before make", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blisshack-tools-"));
    temporaryDirectories.push(directory);
    const marker = join(directory, "make-called");
    await writeBaseToolchain(directory, "6.0.8", marker);

    const result = runPreflight([directory], marker);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Emscripten version mismatch: expected 6.0.9, got 6.0.8",
    );
    await expect(pathExists(marker)).resolves.toBe(false);
  });

  it("rejects wrappers from different SDK directories before make", async () => {
    const primary = await mkdtemp(join(tmpdir(), "blisshack-tools-"));
    const secondary = await mkdtemp(join(tmpdir(), "blisshack-tools-"));
    temporaryDirectories.push(primary, secondary);
    const marker = join(primary, "make-called");
    await writeBaseToolchain(primary, "6.0.9", marker);
    await rm(join(primary, "emranlib"));
    await writeExecutable(secondary, "emranlib", "exit 0");

    const result = runPreflight([primary, secondary], marker);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "emranlib is not from the same Emscripten SDK as emcc",
    );
    await expect(pathExists(marker)).resolves.toBe(false);
  });
});

import {
  access,
  chmod,
  readFile,
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
const crossPre2 = join(
  repositoryRoot,
  "sys/unix/hints/include/cross-pre2.500",
);
const crossPost = join(
  repositoryRoot,
  "sys/unix/hints/include/cross-post.500",
);
const temporaryDirectories = [];

/**
 * Extract one top-level make conditional section using its labelled endif.
 * @param {string} source - complete make fragment.
 * @param {string} condition - make variable used by the conditional.
 * @returns {string} conditional section including its delimiters.
 */
function makeConditionalSection(source, condition) {
  const startMarker = `ifdef ${condition}`;
  const endMarker = `endif  # ${condition}`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + endMarker.length);
}

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
 * Create marker paths used to distinguish preflight from build side effects.
 * @param {string} directory - temporary directory containing marker files.
 * @returns {{makeVersion: string, makeBuild: string, setup: string}} markers.
 */
function toolchainMarkers(directory) {
  return {
    makeVersion: join(directory, "make-version-called"),
    makeBuild: join(directory, "make-build-called"),
    setup: join(directory, "setup-called"),
  };
}

/**
 * Create all fake commands needed to exercise toolchain preflight behavior.
 * @param {string} directory - fake binary directory.
 * @param {object} options - fake toolchain configuration.
 * @param {string} options.emscriptenVersion - version reported by emcc.
 * @param {string} [options.nodeVersion] - version reported by node.
 * @param {{makeVersion: string, makeBuild: string, setup: string}} options.markers
 * invocation marker paths.
 * @returns {Promise<void>} completion after commands are ready.
 */
async function writeBaseToolchain(
  directory,
  {
    emscriptenVersion,
    nodeVersion = "24.19.0",
    markers,
  },
) {
  const nodeMajor = nodeVersion.split(".")[0];

  await Promise.all([
    writeExecutable(
      directory,
      "node",
      `if [ "$1" = "--version" ]; then echo v${nodeVersion}; `
        + `elif [ "$1" = "-p" ]; then echo ${nodeMajor}; else exit 2; fi`,
    ),
    writeExecutable(directory, "npm", "echo 11.6.0"),
    writeExecutable(
      directory,
      "emcc",
      `echo "emcc (Emscripten) ${emscriptenVersion}"`,
    ),
    writeExecutable(directory, "emar", "exit 0"),
    writeExecutable(directory, "emranlib", "exit 0"),
    writeExecutable(
      directory,
      "cc",
      'if [ "$1" = "--version" ]; then echo "Fake CC 1.0"; '
        + "else exit 2; fi",
    ),
    writeExecutable(
      directory,
      "make",
      `if [ "$1" = "--version" ]; then : > "${markers.makeVersion}"; `
        + 'echo "GNU Make 4.4"; exit 0; fi\n'
        + `printf '%s\\n' "$*" >> "${markers.makeBuild}"\n`
        + "exit 99",
    ),
    writeExecutable(
      directory,
      "sh",
      `printf '%s\\n' "$*" >> "${markers.setup}"\nexit 98`,
    ),
  ]);
}

/**
 * Run build preflight with an isolated PATH.
 * @param {string[]} fakeDirectories - fake binary directories in PATH order.
 * @param {string[]} [args] - arguments passed to the build script.
 * @param {boolean} [includeSystemPath] - whether standard system paths remain.
 * @returns {ReturnType<typeof spawnSync>} completed child process.
 */
function runPreflight(
  fakeDirectories,
  args = [],
  includeSystemPath = true,
) {
  const searchPath = includeSystemPath
    ? [...fakeDirectories, "/usr/bin", "/bin"]
    : fakeDirectories;

  return spawnSync("/bin/sh", [buildScript, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: searchPath.join(":"),
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
  it("rejects the wrong Node.js major before any make or setup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blisshack-tools-"));
    temporaryDirectories.push(directory);
    const markers = toolchainMarkers(directory);
    await writeBaseToolchain(directory, {
      emscriptenVersion: "6.0.9",
      nodeVersion: "23.11.0",
      markers,
    });

    const result = runPreflight([directory]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Node.js version mismatch: expected major 24, got v23.11.0",
    );
    await expect(pathExists(markers.makeVersion)).resolves.toBe(false);
    await expect(pathExists(markers.makeBuild)).resolves.toBe(false);
    await expect(pathExists(markers.setup)).resolves.toBe(false);
  });

  it("rejects a missing required command before any make or setup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blisshack-tools-"));
    temporaryDirectories.push(directory);
    const markers = toolchainMarkers(directory);
    await writeBaseToolchain(directory, {
      emscriptenVersion: "6.0.9",
      markers,
    });
    await Promise.all([
      writeExecutable(
        directory,
        "dirname",
        'exec /usr/bin/dirname "$@"',
      ),
      writeExecutable(directory, "tr", 'exec /usr/bin/tr "$@"'),
      rm(join(directory, "emranlib")),
    ]);

    const result = runPreflight(
      [directory],
      ["--hints", "sys/unix/hints/linux.500"],
      false,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "required command not found: emranlib",
    );
    await expect(pathExists(markers.makeVersion)).resolves.toBe(false);
    await expect(pathExists(markers.makeBuild)).resolves.toBe(false);
    await expect(pathExists(markers.setup)).resolves.toBe(false);
  });

  it("checks the toolchain without running setup or a build", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blisshack-tools-"));
    temporaryDirectories.push(directory);
    const markers = toolchainMarkers(directory);
    await writeBaseToolchain(directory, {
      emscriptenVersion: "6.0.9",
      markers,
    });

    const result = runPreflight([directory], ["--check-only"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Node.js: v24.19.0");
    expect(result.stdout).toContain("npm: 11.6.0");
    expect(result.stdout).toContain("Emscripten: 6.0.9");
    expect(result.stdout).toContain("Make: GNU Make 4.4");
    expect(result.stdout).toContain("Host compiler: Fake CC 1.0");
    expect(result.stdout).toContain("Lua: 5.4.8");
    expect(result.stdout).toMatch(
      /Hints: sys\/unix\/hints\/(?:macOS|linux)\.500/,
    );
    await expect(pathExists(markers.makeVersion)).resolves.toBe(true);
    await expect(pathExists(markers.makeBuild)).resolves.toBe(false);
    await expect(pathExists(markers.setup)).resolves.toBe(false);
  });

  it("combines check-only with explicit Linux hints", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blisshack-tools-"));
    temporaryDirectories.push(directory);
    const markers = toolchainMarkers(directory);
    await writeBaseToolchain(directory, {
      emscriptenVersion: "6.0.9",
      markers,
    });

    const result = runPreflight(
      [directory],
      ["--check-only", "--hints", "sys/unix/hints/linux.500"],
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Hints: sys/unix/hints/linux.500",
    );
    await expect(pathExists(markers.makeVersion)).resolves.toBe(true);
    await expect(pathExists(markers.makeBuild)).resolves.toBe(false);
    await expect(pathExists(markers.setup)).resolves.toBe(false);
  });

  it("rejects the wrong Emscripten version before make", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blisshack-tools-"));
    temporaryDirectories.push(directory);
    const markers = toolchainMarkers(directory);
    await writeBaseToolchain(directory, {
      emscriptenVersion: "6.0.8",
      markers,
    });

    const result = runPreflight([directory]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Emscripten version mismatch: expected 6.0.9, got 6.0.8",
    );
    await expect(pathExists(markers.makeBuild)).resolves.toBe(false);
    await expect(pathExists(markers.setup)).resolves.toBe(false);
  });

  it("rejects wrappers from different SDK directories before make", async () => {
    const primary = await mkdtemp(join(tmpdir(), "blisshack-tools-"));
    const secondary = await mkdtemp(join(tmpdir(), "blisshack-tools-"));
    temporaryDirectories.push(primary, secondary);
    const markers = toolchainMarkers(primary);
    await writeBaseToolchain(primary, {
      emscriptenVersion: "6.0.9",
      markers,
    });
    await rm(join(primary, "emranlib"));
    await writeExecutable(secondary, "emranlib", "exit 0");

    const result = runPreflight([primary, secondary]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "emranlib is not from the same Emscripten SDK as emcc",
    );
    await expect(pathExists(markers.makeBuild)).resolves.toBe(false);
    await expect(pathExists(markers.setup)).resolves.toBe(false);
  });
});

describe("WASM tile mapping build wiring", () => {
  it("enables glyph tile mapping and target tile.o in CROSS_TO_WASM only", async () => {
    const source = await readFile(crossPre2, "utf8");
    const wasmSection = makeConditionalSection(source, "CROSS_TO_WASM");

    expect(wasmSection).toMatch(
      /^WASM_CFLAGS \+= -DTILES_IN_GLYPHMAP$/m,
    );
    expect(wasmSection).toMatch(
      /^override GENTILEOFILE = \$\(TARGETPFX\)tile\.o$/m,
    );
  });

  it("compiles the generated tile source with the target compiler", async () => {
    const source = await readFile(crossPost, "utf8");
    const wasmSection = makeConditionalSection(source, "CROSS_TO_WASM");

    expect(wasmSection).toMatch(
      /^\$\(TARGETPFX\)tile\.o\s*:\s*\$\(SRCDIR\)\/tile\.c(?:\s+\$\(HACK_H\))?$/m,
    );
    expect(wasmSection).toMatch(
      /^\s*\$\(TARGET_CC\) \$\(TARGET_CFLAGS\) -c -o \$@ \$\(SRCDIR\)\/tile\.c$/m,
    );
  });

  it("makes the WASM target depend on and link target tile.o", async () => {
    const source = await readFile(crossPost, "utf8");
    const wasmSection = makeConditionalSection(source, "CROSS_TO_WASM");
    const targetRule = wasmSection.slice(
      wasmSection.indexOf("$(WASM_TARGET):"),
      wasmSection.indexOf("\n\n", wasmSection.indexOf("$(WASM_TARGET):")),
    );

    expect(targetRule).toMatch(
      /^\$\(WASM_TARGET\):.*\$\(GENTILEOFILE\)/m,
    );
    expect(targetRule).toMatch(
      /^\s*\$\(HOBJ\).*\$\(GENTILEOFILE\).*\$\(TARGET_HACKLIB\)/m,
    );
  });
});

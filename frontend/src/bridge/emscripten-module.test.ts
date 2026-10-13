import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createGameModule,
  type EmscriptenFactory,
  type EmscriptenModule,
} from "./emscripten-module";

const encoder = new TextEncoder();
const loaderUrl = "https://example.test/runtime/nethack.js";
const manifestUrl = "https://example.test/runtime/nethack-runtime.json";
const wasmUrl = "https://example.test/runtime/nethack.wasm";
const loaderBytes = encoder.encode(
  "export default async function createNethackModule() {}",
);

/**
 * Calculate a lowercase SHA-256 fixture digest.
 * @param bytes Input fixture bytes.
 * @returns Lowercase hexadecimal digest.
 */
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Build a valid schema-v3 runtime manifest around loader and WASM fixtures.
 * @param wasm Verified WASM fixture bytes.
 * @param loader Verified JavaScript loader fixture bytes.
 * @returns Encoded runtime manifest bytes.
 */
function runtimeManifest(
  wasm: Uint8Array,
  loader = loaderBytes,
): Uint8Array {
  return encoder.encode(JSON.stringify({
    schemaVersion: 3,
    emscriptenVersion: "6.0.9",
    nodeMajor: 24,
    luaVersion: "5.4.8",
    hintsFile: "sys/unix/hints/macOS.500",
    buildTools: {
      node: "v24.19.0",
      make: "GNU Make 3.81",
      hostCompiler: "Apple clang",
    },
    files: {
      "nethack.js": {
        bytes: loader.byteLength,
        sha256: sha256(loader),
      },
      "nethack.wasm": {
        bytes: wasm.byteLength,
        sha256: sha256(wasm),
      },
    },
    encyclopedia: {
      core: {
        manifest: {
          bytes: 1,
          sha256: "b".repeat(64),
        },
        sourceFingerprint: "c".repeat(64),
      },
      wiki: {
        manifest: {
          bytes: 1,
          sha256: "d".repeat(64),
        },
      },
    },
  }));
}

/**
 * Build the minimum Emscripten module required by module-loader tests.
 * @returns Mutable fake module.
 */
function fakeModule(): EmscriptenModule {
  return {
    ccall: vi.fn(),
    getValue: vi.fn(),
    setValue: vi.fn(),
    UTF8ToString: vi.fn(),
    stringToUTF8: vi.fn(),
    _malloc: vi.fn(),
    _free: vi.fn(),
    ENV: {},
    FS: {
      analyzePath: vi.fn(),
      mkdir: vi.fn(),
      mount: vi.fn(),
      readFile: vi.fn(),
      syncfs: vi.fn(),
    },
  };
}

describe("Emscripten module runtime binding", () => {
  it("loads the factory from verified loader bytes and freezes its identity", async () => {
    const wasm = Uint8Array.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]);
    const module = fakeModule();
    let fetchedLoader: Uint8Array | undefined;
    let factoryOptions: Record<string, unknown> | undefined;
    const factory: EmscriptenFactory = vi.fn(async (options) => {
      factoryOptions = options;
      return module;
    });
    const fetchBytes = vi.fn(async (url: string) => {
      if (url === manifestUrl) return runtimeManifest(wasm);
      if (url === wasmUrl) return wasm.slice();
      if (url === loaderUrl) {
        fetchedLoader = loaderBytes.slice();
        return fetchedLoader;
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const loadFactory = vi.fn(async (..._args: unknown[]) => factory);

    await expect(createGameModule(loaderUrl, {
      fetchBytes,
      loadFactory,
    })).resolves.toBe(module);

    expect(fetchBytes.mock.calls.map(([url]) => url)).toEqual([
      manifestUrl,
      wasmUrl,
      loaderUrl,
    ]);
    expect(fetchedLoader).toBeDefined();
    expect(loadFactory).toHaveBeenCalledOnce();
    expect(loadFactory.mock.calls[0]).toEqual(
      expect.arrayContaining([fetchedLoader]),
    );
    expect(factoryOptions?.wasmBinary).toEqual(wasm);
    expect(module.blisshackRuntimeIdentity).toEqual({
      loader: {
        bytes: loaderBytes.byteLength,
        sha256: sha256(loaderBytes),
      },
      wasm: {
        bytes: wasm.byteLength,
        sha256: sha256(wasm),
      },
      encyclopedia: {
        core: {
          manifest: {
            bytes: 1,
            sha256: "b".repeat(64),
          },
          sourceFingerprint: "c".repeat(64),
        },
        wiki: {
          manifest: {
            bytes: 1,
            sha256: "d".repeat(64),
          },
        },
      },
    });
    const loaderIdentity = (
      module.blisshackRuntimeIdentity as unknown as { loader?: object }
    )?.loader;
    expect(Object.isFrozen(module.blisshackRuntimeIdentity)).toBe(true);
    expect(loaderIdentity).toBeDefined();
    expect(Object.isFrozen(loaderIdentity)).toBe(true);
    expect(Object.isFrozen(module.blisshackRuntimeIdentity?.wasm)).toBe(true);
    expect(
      Object.isFrozen(module.blisshackRuntimeIdentity?.encyclopedia),
    ).toBe(true);
    expect(
      Object.isFrozen(module.blisshackRuntimeIdentity?.encyclopedia.core),
    ).toBe(true);
    expect(
      Object.isFrozen(
        module.blisshackRuntimeIdentity?.encyclopedia.core.manifest,
      ),
    ).toBe(true);
    expect(
      Object.isFrozen(module.blisshackRuntimeIdentity?.encyclopedia.wiki),
    ).toBe(true);
    expect(
      Object.isFrozen(
        module.blisshackRuntimeIdentity?.encyclopedia.wiki.manifest,
      ),
    ).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(module, "blisshackRuntimeIdentity"),
    ).toMatchObject({
      configurable: false,
      enumerable: true,
      writable: false,
    });
  });

  it.each([
    {
      label: "runtime schema",
      manifest(wasm: Uint8Array) {
        const value = JSON.parse(new TextDecoder().decode(runtimeManifest(wasm)));
        value.schemaVersion = 2;
        return encoder.encode(JSON.stringify(value));
      },
    },
    {
      label: "WASM digest",
      manifest(wasm: Uint8Array) {
        const value = JSON.parse(new TextDecoder().decode(runtimeManifest(wasm)));
        value.files["nethack.wasm"].sha256 = "0".repeat(64);
        return encoder.encode(JSON.stringify(value));
      },
    },
    {
      label: "WASM header",
      manifest(wasm: Uint8Array) {
        return runtimeManifest(wasm);
      },
      wasm: Uint8Array.from([
        0x01, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01,
      ]),
    },
  ])("rejects an invalid $label before importing the loader", async (testCase) => {
    const wasm = testCase.wasm ?? Uint8Array.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]);
    const fetchBytes = vi.fn(async (url: string) =>
      url === manifestUrl ? testCase.manifest(wasm) : wasm.slice()
    );
    const loadFactory = vi.fn(async () =>
      vi.fn(async () => fakeModule()) as EmscriptenFactory
    );

    await expect(createGameModule(loaderUrl, {
      fetchBytes,
      loadFactory,
    })).rejects.toThrow();
    expect(loadFactory).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "byte length",
      manifest(wasm: Uint8Array) {
        const value = JSON.parse(
          new TextDecoder().decode(runtimeManifest(wasm)),
        );
        value.files["nethack.js"].bytes += 1;
        return encoder.encode(JSON.stringify(value));
      },
    },
    {
      label: "digest",
      manifest(wasm: Uint8Array) {
        const value = JSON.parse(
          new TextDecoder().decode(runtimeManifest(wasm)),
        );
        value.files["nethack.js"].sha256 = "0".repeat(64);
        return encoder.encode(JSON.stringify(value));
      },
    },
  ])(
    "rejects an invalid loader $label before loading the factory",
    async (testCase) => {
      const wasm = Uint8Array.from([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01,
      ]);
      const fetchBytes = vi.fn(async (url: string) => {
        if (url === manifestUrl) return testCase.manifest(wasm);
        if (url === wasmUrl) return wasm.slice();
        if (url === loaderUrl) return loaderBytes.slice();
        throw new Error(`Unexpected URL ${url}`);
      });
      const loadFactory = vi.fn(async () =>
        vi.fn(async () => fakeModule()) as EmscriptenFactory
      );

      await expect(createGameModule(loaderUrl, {
        fetchBytes,
        loadFactory,
      })).rejects.toThrow(/nethack\.js.*mismatch/);
      expect(loadFactory).not.toHaveBeenCalled();
    },
  );
});

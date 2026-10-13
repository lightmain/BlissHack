import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createGameModule,
  type EmscriptenFactory,
  type EmscriptenModule,
  type GameModuleOptions,
} from "./emscripten-module";

const encoder = new TextEncoder();
const loaderUrl = "https://example.test/runtime/nethack.js";
const manifestUrl = "https://example.test/runtime/nethack-runtime.json";
const wasmUrl = "https://example.test/runtime/nethack.wasm";
const loaderBytes = encoder.encode(
  "export default async function createNethackModule() {}",
);

type EmscriptenFactoryImporter = (
  bytes: Uint8Array,
  sourceUrl: string,
) => Promise<EmscriptenFactory>;

interface DefaultFactoryCacheOptions extends GameModuleOptions {
  importFactory: EmscriptenFactoryImporter;
}

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
  loader: Uint8Array = loaderBytes,
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

/**
 * Fetch one internally consistent runtime triplet for cache tests.
 * @param wasm Verified WASM fixture bytes.
 * @param loader Verified JavaScript loader fixture bytes.
 * @returns Runtime asset fetch mock.
 */
function runtimeFixtureFetcher(
  wasm: Uint8Array,
  loader: Uint8Array,
) {
  return vi.fn(async (url: string) => {
    if (url === manifestUrl) return runtimeManifest(wasm, loader);
    if (url === wasmUrl) return wasm.slice();
    if (url === loaderUrl) return loader.slice();
    throw new Error(`Unexpected URL ${url}`);
  });
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

describe("default Emscripten factory cache", () => {
  it("imports one factory for repeated modules with the same loader digest", async () => {
    const wasm = Uint8Array.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]);
    const loader = encoder.encode(
      "export default async function sameDigestFactory() {}",
    );
    const modules = [fakeModule(), fakeModule(), fakeModule()];
    let factoryCall = 0;
    const factory: EmscriptenFactory = vi.fn(async () =>
      modules[factoryCall++]!
    );
    const importFactory = vi.fn(async (
      _bytes: Uint8Array,
      _sourceUrl: string,
    ) => factory);
    const options: DefaultFactoryCacheOptions = {
      fetchBytes: runtimeFixtureFetcher(wasm, loader),
      importFactory,
    };

    const firstModules = await Promise.all([
      createGameModule(loaderUrl, options),
      createGameModule(loaderUrl, options),
    ]);
    const thirdModule = await createGameModule(loaderUrl, options);

    expect([...firstModules, thirdModule]).toEqual(modules);
    expect(importFactory).toHaveBeenCalledOnce();
    expect(importFactory).toHaveBeenCalledWith(loader, loaderUrl);
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it("isolates the same loader digest by importer while reusing each importer", async () => {
    const wasm = Uint8Array.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]);
    const loader = encoder.encode(
      "export default async function importerScopedFactory() {}",
    );
    const firstModules: EmscriptenModule[] = [];
    const secondModules: EmscriptenModule[] = [];
    const firstFactory: EmscriptenFactory = vi.fn(async () => {
      const module = fakeModule();
      firstModules.push(module);
      return module;
    });
    const secondFactory: EmscriptenFactory = vi.fn(async () => {
      const module = fakeModule();
      secondModules.push(module);
      return module;
    });
    const firstImportFactory = vi.fn(async (
      _bytes: Uint8Array,
      _sourceUrl: string,
    ) => firstFactory);
    const secondImportFactory = vi.fn(async (
      _bytes: Uint8Array,
      _sourceUrl: string,
    ) => secondFactory);
    const firstOptions: DefaultFactoryCacheOptions = {
      fetchBytes: runtimeFixtureFetcher(wasm, loader),
      importFactory: firstImportFactory,
    };
    const secondOptions: DefaultFactoryCacheOptions = {
      fetchBytes: runtimeFixtureFetcher(wasm, loader),
      importFactory: secondImportFactory,
    };

    const firstResults = await Promise.all([
      createGameModule(loaderUrl, firstOptions),
      createGameModule(loaderUrl, firstOptions),
    ]);
    const secondResults = await Promise.all([
      createGameModule(loaderUrl, secondOptions),
      createGameModule(loaderUrl, secondOptions),
    ]);

    expect(firstImportFactory).toHaveBeenCalledOnce();
    expect(secondImportFactory).toHaveBeenCalledOnce();
    expect(firstFactory).toHaveBeenCalledTimes(2);
    expect(secondFactory).toHaveBeenCalledTimes(2);
    expect(firstResults).toEqual(firstModules);
    expect(secondResults).toEqual(secondModules);
  });

  it("retries the same loader digest after its first import fails", async () => {
    const wasm = Uint8Array.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]);
    const loader = encoder.encode(
      "export default async function retryFactory() {}",
    );
    const module = fakeModule();
    const factory: EmscriptenFactory = vi.fn(async () => module);
    const importError = new Error("loader import failed");
    let importAttempt = 0;
    const importFactory = vi.fn(async (
      _bytes: Uint8Array,
      _sourceUrl: string,
    ) => {
      importAttempt += 1;
      if (importAttempt === 1) throw importError;
      return factory;
    });
    const options: DefaultFactoryCacheOptions = {
      fetchBytes: runtimeFixtureFetcher(wasm, loader),
      importFactory,
    };

    await expect(createGameModule(loaderUrl, options)).rejects.toBe(importError);
    await expect(createGameModule(loaderUrl, options)).resolves.toBe(module);

    expect(importFactory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenCalledOnce();
  });

  it("keeps factories separate for different loader digests", async () => {
    const wasm = Uint8Array.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]);
    const firstLoader = encoder.encode(
      "export default async function firstDigestFactory() {}",
    );
    const secondLoader = encoder.encode(
      "export default async function secondDigestFactory() {}",
    );
    const firstModule = fakeModule();
    const secondModule = fakeModule();
    const firstFactory: EmscriptenFactory = vi.fn(async () => firstModule);
    const secondFactory: EmscriptenFactory = vi.fn(async () => secondModule);
    const factories = [firstFactory, secondFactory];
    let importCall = 0;
    const importFactory = vi.fn(async (
      _bytes: Uint8Array,
      _sourceUrl: string,
    ) => factories[importCall++]!);

    await expect(createGameModule(loaderUrl, {
      fetchBytes: runtimeFixtureFetcher(wasm, firstLoader),
      importFactory,
    } as DefaultFactoryCacheOptions)).resolves.toBe(firstModule);
    await expect(createGameModule(loaderUrl, {
      fetchBytes: runtimeFixtureFetcher(wasm, secondLoader),
      importFactory,
    } as DefaultFactoryCacheOptions)).resolves.toBe(secondModule);

    expect(importFactory).toHaveBeenCalledTimes(2);
    expect(importFactory.mock.calls.map(([bytes]) => sha256(bytes))).toEqual([
      sha256(firstLoader),
      sha256(secondLoader),
    ]);
    expect(firstFactory).toHaveBeenCalledOnce();
    expect(secondFactory).toHaveBeenCalledOnce();
  });
});

import { ATR_BOLD, appendWindowText } from "../game-state";
import {
  decodeRuntimeManifest,
  runtimeIdentityFromManifest,
  verifyRuntimeAssetBytes,
  type RuntimeAssetIdentity,
} from "./runtime-manifest";

/** Emscripten filesystem surface used by DLB access and save persistence. */
export interface EmscriptenFileSystem {
  analyzePath(path: string): { exists: boolean };
  mkdir(path: string): unknown;
  mount(type: unknown, options: Record<string, unknown>, path: string): unknown;
  readFile(
    path: string,
    options?: { encoding: "utf8" },
  ): string | Uint8Array;
  syncfs(
    populate: boolean,
    callback: (error: unknown | null) => void,
  ): void;
}

/** Emscripten module APIs required by the shim bridge. */
export interface EmscriptenModule {
  ccall(
    name: string,
    returnType: string | null,
    argumentTypes: string[],
    arguments_: unknown[],
    options?: { async: boolean },
  ): unknown;
  getValue(ptr: number, type: string): number | bigint;
  setValue(ptr: number, value: number, type: string): void;
  UTF8ToString(ptr: number): string;
  stringToUTF8(value: string, ptr: number, maxBytes: number): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  ENV?: Record<string, string>;
  FS: EmscriptenFileSystem;
  IDBFS?: unknown;
  readonly blisshackRuntimeIdentity?: RuntimeAssetIdentity;
}

interface NethackGlobals {
  shim_restore_required?: boolean;
  program_state?: {
    readonly gameover?: boolean;
  };
  svp?: { plname?: string };
  iflags?: {
    wc2_hitpointbar?: boolean;
    window_inited?: boolean;
  };
  flags?: {
    initrole?: number;
    initrace?: number;
    initgend?: number;
    initalign?: number;
  };
}

interface NethackGlobal {
  actionCatalog?: unknown;
  characterCatalog?: unknown;
  globals?: NethackGlobals;
  pointers?: { extcmdlist?: number };
}

declare global {
  var nethackGlobal: NethackGlobal | undefined;
}

export type EmscriptenFactory = (
  options: Record<string, unknown>,
) => Promise<EmscriptenModule>;

/** Session guard used while a module factory is still loading asynchronously. */
export interface GameModuleOptions {
  isCurrent?: () => boolean;
  fetchBytes?: (url: string) => Promise<Uint8Array>;
  loadFactory?: (
    bytes: Uint8Array,
    sourceUrl: string,
  ) => Promise<EmscriptenFactory>;
  runtimeManifestUrl?: string;
  wasmBinaryUrl?: string;
}

/**
 * Remove Emscripten's synthetic login name before NetHack calls whoami().
 * This makes plnamesuffix() invoke askname before save lookup and role selection.
 */
export function preparePlayerNamePrompt(module: EmscriptenModule): void {
  module.ENV ??= {};
  module.ENV.USER = "";
  module.ENV.LOGNAME = "";
}

/** Load one fresh NetHack module without registering callbacks or running main. */
export async function createGameModule(
  wasmUrl = `${import.meta.env.BASE_URL}nethack.js`,
  options: GameModuleOptions = {},
): Promise<EmscriptenModule> {
  const isCurrent = options.isCurrent ?? (() => true);
  const baseUrl = globalThis.location?.href ?? "http://localhost/";
  const loaderUrl = new URL(wasmUrl, baseUrl).href;
  const runtimeManifestUrl = new URL(
    options.runtimeManifestUrl ?? "nethack-runtime.json",
    loaderUrl,
  ).href;
  const wasmBinaryUrl = new URL(
    options.wasmBinaryUrl ?? "nethack.wasm",
    loaderUrl,
  ).href;
  const fetchBytes = options.fetchBytes ?? fetchRuntimeBytes;
  const loadFactory = options.loadFactory ?? importEmscriptenFactory;
  const runtimeBytes = await fetchBytes(runtimeManifestUrl);
  const runtime = decodeRuntimeManifest(runtimeBytes);
  const wasmBinary = await fetchBytes(wasmBinaryUrl);
  await verifyRuntimeAssetBytes(
    wasmBinary,
    runtime.files["nethack.wasm"],
    wasmBinaryUrl,
  );
  assertWasmHeader(wasmBinary);
  const loaderBytes = await fetchBytes(loaderUrl);
  await verifyRuntimeAssetBytes(
    loaderBytes,
    runtime.files["nethack.js"],
    loaderUrl,
  );
  const factory = await loadFactory(loaderBytes, loaderUrl);
  const module = await factory({
    noInitialRun: true,
    wasmBinary,
    locateFile: (path: string) => new URL(path, loaderUrl).href,
    preRun: (runtimeModule: EmscriptenModule) =>
      preparePlayerNamePrompt(runtimeModule),
    print: (text: string) => {
      if (isCurrent()) appendWindowText(-1, 0, text);
    },
    printErr: (text: string) => {
      if (isCurrent()) appendWindowText(-1, ATR_BOLD, text);
    },
  });
  Object.defineProperty(module, "blisshackRuntimeIdentity", {
    value: runtimeIdentityFromManifest(runtime),
    configurable: false,
    enumerable: true,
    writable: false,
  });
  return module;
}

/**
 * Require the standard WebAssembly magic and version-one header.
 * @param bytes Verified runtime bytes.
 */
function assertWasmHeader(bytes: Uint8Array): void {
  const expected = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  if (
    bytes.byteLength < expected.length
    || expected.some((byte, index) => bytes[index] !== byte)
  ) {
    throw new Error("NetHack runtime does not have a valid WebAssembly header");
  }
}

/**
 * Fetch one same-origin runtime asset as independent bytes.
 * @param url Absolute runtime asset URL.
 * @returns Response bytes.
 */
async function fetchRuntimeBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Import the Emscripten factory from already verified JavaScript bytes.
 * @param bytes Verified loader module bytes.
 * @param sourceUrl Original asset URL used for diagnostics.
 * @returns Emscripten module factory.
 */
async function importEmscriptenFactory(
  bytes: Uint8Array,
  sourceUrl: string,
): Promise<EmscriptenFactory> {
  const moduleUrl = URL.createObjectURL(new Blob(
    [bytes.slice().buffer],
    { type: "text/javascript" },
  ));
  try {
    const imported = await import(/* @vite-ignore */ moduleUrl) as {
      default?: EmscriptenFactory;
    };
    if (typeof imported.default !== "function") {
      throw new Error(`${sourceUrl} does not export an Emscripten factory`);
    }
    return imported.default;
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

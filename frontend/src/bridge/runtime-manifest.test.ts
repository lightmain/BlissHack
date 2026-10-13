import { describe, expect, it } from "vitest";
import {
  assertRuntimeIdentityMatches,
  runtimeIdentityFromManifest,
  type RuntimeAssetIdentity,
  type RuntimeFileMetadata,
  type RuntimeManifest,
} from "./runtime-manifest";

const manifest: RuntimeManifest = {
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
      bytes: 17,
      sha256: "a".repeat(64),
    },
    "nethack.wasm": {
      bytes: 23,
      sha256: "b".repeat(64),
    },
  },
  encyclopedia: {
    core: {
      manifest: {
        bytes: 31,
        sha256: "c".repeat(64),
      },
      sourceFingerprint: "d".repeat(64),
    },
    wiki: {
      manifest: {
        bytes: 47,
        sha256: "e".repeat(64),
      },
    },
  },
};

type LoaderBoundRuntimeIdentity = RuntimeAssetIdentity & {
  loader: RuntimeFileMetadata;
};

/**
 * Build the complete runtime identity expected by matching assertions.
 * @param loader Loader metadata to include in the identity.
 * @returns Runtime identity with independent mutable metadata.
 */
function runtimeIdentity(
  loader: RuntimeFileMetadata = manifest.files["nethack.js"],
): LoaderBoundRuntimeIdentity {
  return {
    loader: { ...loader },
    wasm: { ...manifest.files["nethack.wasm"] },
    encyclopedia: structuredClone(manifest.encyclopedia),
  };
}

describe("runtime asset identity", () => {
  it("includes and freezes JavaScript loader metadata", () => {
    const identity = runtimeIdentityFromManifest(
      manifest,
    ) as LoaderBoundRuntimeIdentity;

    expect(identity.loader).toEqual(manifest.files["nethack.js"]);
    expect(Object.isFrozen(identity.loader)).toBe(true);
  });

  it.each([
    {
      label: "byte length",
      loader: {
        ...manifest.files["nethack.js"],
        bytes: manifest.files["nethack.js"].bytes + 1,
      },
    },
    {
      label: "digest",
      loader: {
        ...manifest.files["nethack.js"],
        sha256: "0".repeat(64),
      },
    },
  ])("rejects a loader $label mismatch", ({ loader }) => {
    expect(() => assertRuntimeIdentityMatches(
      runtimeIdentity(loader),
      manifest,
    )).toThrow(/runtime identity/);
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Read and validate the player-visible product version.
 * @param versionPath - VERSION file to read.
 * @returns the canonical product version from the repository root.
 */
export function readProductVersion(
  versionPath = fileURLToPath(new URL("../VERSION", import.meta.url)),
): string {
  let version: string;
  try {
    version = readFileSync(versionPath, "utf8").trim();
  } catch {
    throw new Error(`Unable to read product version from ${versionPath}`);
  }
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i.test(version)) {
    throw new Error(`Invalid product version in ${versionPath}`);
  }
  return version;
}

/** Shared Vite/Vitest replacement for the compile-time product version. */
export const productVersionDefine = {
  __BLISSHACK_PRODUCT_VERSION__: JSON.stringify(readProductVersion()),
};

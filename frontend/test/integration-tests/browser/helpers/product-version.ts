import { readProductVersion } from "../../../../product-version.js";

/**
 * Read the canonical product version expected by browser assertions.
 * @returns the trimmed contents of the repository root VERSION file.
 */
export function readExpectedProductVersion(): string {
  return readProductVersion();
}

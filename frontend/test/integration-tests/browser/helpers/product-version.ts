import { readFile } from "node:fs/promises";

const repositoryVersionUrl = new URL("../../../../../VERSION", import.meta.url);

/**
 * Read the canonical product version expected by browser assertions.
 * @returns the trimmed contents of the repository root VERSION file.
 */
export async function readExpectedProductVersion(): Promise<string> {
  return (await readFile(repositoryVersionUrl, "utf8")).trim();
}

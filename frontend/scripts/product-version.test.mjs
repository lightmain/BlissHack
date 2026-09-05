import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProductVersion } from "../product-version.ts";

const temporaryDirectories = [];

/**
 * Create a temporary VERSION file with exact test content.
 * @param {string} contents - file contents to write.
 * @returns {Promise<string>} path to the temporary VERSION file.
 */
async function versionFixture(contents) {
  const directory = await mkdtemp(join(tmpdir(), "blisshack-version-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "VERSION");
  await writeFile(path, contents, "utf8");
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("product version source", () => {
  it("reads and trims a valid product version", async () => {
    const path = await versionFixture("prealpha-3\n");
    expect(readProductVersion(path)).toBe("prealpha-3");
  });

  it("rejects missing, empty, and malformed version files", async () => {
    const missingDirectory = await mkdtemp(
      join(tmpdir(), "blisshack-version-"),
    );
    temporaryDirectories.push(missingDirectory);
    expect(() => readProductVersion(join(missingDirectory, "VERSION"))).toThrow(
      /Unable to read product version/,
    );

    const emptyPath = await versionFixture("\n");
    expect(() => readProductVersion(emptyPath)).toThrow(
      /Invalid product version/,
    );

    const malformedPath = await versionFixture("prealpha 3\n");
    expect(() => readProductVersion(malformedPath)).toThrow(
      /Invalid product version/,
    );
  });
});

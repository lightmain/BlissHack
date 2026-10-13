import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCoreEncyclopedia } from "./core-assets.mjs";
import { validateWikiAssetDirectory } from "./wiki-assets.mjs";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(frontendRoot, "..");
const temporaryRoot = await mkdtemp(
  join(tmpdir(), "blisshack-encyclopedia-verify-"),
);

/**
 * Read one checked JSON file.
 * @param {string} path Absolute JSON path.
 * @returns {Promise<object>} Parsed JSON value.
 */
async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

try {
  const encyclopediaRoot = join(frontendRoot, "public/encyclopedia");
  const [coreManifest, wiki, selections] = await Promise.all([
    verifyCoreEncyclopedia({
      repositoryRoot,
      assetDirectory: join(encyclopediaRoot, "core"),
      temporaryDirectory: join(temporaryRoot, "core"),
    }),
    validateWikiAssetDirectory({
      assetDirectory: join(encyclopediaRoot, "wiki"),
      noticePath: join(encyclopediaRoot, "NOTICE.md"),
    }),
    readJson(join(frontendRoot, "scripts/encyclopedia/wiki-selections.json")),
  ]);
  const expectedRevisions = selections.selections
    .filter((selection) => selection.reviewStatus === "published")
    .map((selection) => ({
      title: selection.pageTitle,
      revisionId: selection.revisionId,
      sha256: selection.revisionHash,
    }));
  if (
    JSON.stringify(wiki.manifest.revisions)
    !== JSON.stringify(expectedRevisions)
  ) {
    throw new Error("Wiki manifest does not match published selections");
  }
  console.log(
    `Verified ${coreManifest.glyphBindings.maxGlyph} glyph classifications `
      + `and ${wiki.records.length} reviewed Wiki excerpt record(s).`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

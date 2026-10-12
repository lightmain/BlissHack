import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCoreEncyclopedia } from "./core-assets.mjs";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(frontendRoot, "..");
const assetDirectory = resolve(frontendRoot, "public/encyclopedia/core");
const temporaryRoot = await mkdtemp(
  join(tmpdir(), "blisshack-core-verify-"),
);
const temporaryDirectory = join(temporaryRoot, "core");

try {
  const manifest = await verifyCoreEncyclopedia({
    repositoryRoot,
    assetDirectory,
    temporaryDirectory,
  });
  console.log(
    `Verified ${manifest.glyphBindings.maxGlyph} glyph classifications `
      + `against NetHack ${manifest.nethackVersion} sources.`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

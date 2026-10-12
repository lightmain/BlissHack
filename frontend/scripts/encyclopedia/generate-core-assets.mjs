import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCoreEncyclopedia } from "./core-assets.mjs";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(frontendRoot, "..");
const outputDirectory = resolve(
  frontendRoot,
  "public/encyclopedia/core",
);

const manifest = await generateCoreEncyclopedia({
  repositoryRoot,
  outputDirectory,
});
const totalEntities = Object.values(manifest.entityCounts)
  .reduce((total, count) => total + count, 0);
console.log(
  `Generated ${totalEntities} encyclopedia entities and `
    + `${manifest.glyphBindings.maxGlyph} glyph classifications.`,
);

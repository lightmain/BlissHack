import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateTileAssets } from "./tiles/tile-assets.mjs";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(frontendRoot, "..");
const inputDirectory = resolve(repositoryRoot, "win/share");
const outputDirectory = resolve(frontendRoot, "public/tiles");

const manifest = await generateTileAssets({
  inputDirectory,
  outputDirectory,
  columns: 40,
});
console.log(
  `Generated ${manifest.atlas.tileCount} tiles in `
    + `${manifest.atlas.columns}x${manifest.atlas.rows} atlas.`,
);

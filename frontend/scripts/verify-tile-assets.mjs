import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyTileAssets } from "./tiles/tile-assets.mjs";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(frontendRoot, "..");
const inputDirectory = resolve(repositoryRoot, "win/share");
const outputDirectory = resolve(frontendRoot, "public/tiles");

const manifest = await verifyTileAssets({ inputDirectory, outputDirectory });
console.log(
  `Verified ${manifest.atlas.tileCount} tiles and source checksums.`,
);

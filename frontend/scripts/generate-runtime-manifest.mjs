import { resolve } from "node:path";
import { writeRuntimeManifest } from "./runtime-assets.mjs";

const [
  assetDirectory,
  emscriptenVersion,
  nodeVersion,
  makeVersion,
  hostCompiler,
  luaVersion,
  hintsFile,
  encyclopediaManifestPath,
  wikiManifestPath,
] = process.argv.slice(2);

if (!wikiManifestPath) {
  throw new Error(
    "Usage: generate-runtime-manifest.mjs <asset-dir> <emscripten> "
      + "<node> <make> <host-compiler> <lua> <hints> "
      + "<core-encyclopedia-manifest> <wiki-encyclopedia-manifest>",
  );
}

const resolvedDirectory = resolve(assetDirectory);
await writeRuntimeManifest(resolvedDirectory, {
  emscriptenVersion,
  nodeVersion,
  makeVersion,
  hostCompiler,
  luaVersion,
  hintsFile,
  encyclopediaManifestPath: resolve(encyclopediaManifestPath),
  wikiManifestPath: resolve(wikiManifestPath),
});
console.log(`Generated ${resolvedDirectory}/nethack-runtime.json`);

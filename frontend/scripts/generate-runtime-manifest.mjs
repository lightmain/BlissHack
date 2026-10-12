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
] = process.argv.slice(2);

if (!encyclopediaManifestPath) {
  throw new Error(
    "Usage: generate-runtime-manifest.mjs <asset-dir> <emscripten> "
      + "<node> <make> <host-compiler> <lua> <hints> "
      + "<encyclopedia-manifest>",
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
});
console.log(`Generated ${resolvedDirectory}/nethack-runtime.json`);

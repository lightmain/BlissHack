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
] = process.argv.slice(2);

if (!hintsFile) {
  throw new Error(
    "Usage: generate-runtime-manifest.mjs <asset-dir> <emscripten> "
      + "<node> <make> <host-compiler> <lua> <hints>",
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
});
console.log(`Generated ${resolvedDirectory}/nethack-runtime.json`);

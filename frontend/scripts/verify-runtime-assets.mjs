import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRuntimeAssets } from "./runtime-assets.mjs";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(frontendRoot, "..");
const assetDirectory = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(frontendRoot, "public");
const [emscriptenVersion, nodeVersion] = await Promise.all([
  readFile(resolve(repositoryRoot, ".emscripten-version"), "utf8"),
  readFile(resolve(repositoryRoot, ".nvmrc"), "utf8"),
]);

await verifyRuntimeAssets(assetDirectory, {
  emscriptenVersion: emscriptenVersion.trim(),
  nodeMajor: Number.parseInt(nodeVersion.trim(), 10),
  luaVersion: "5.4.8",
});
console.log("Verified nethack.js, nethack.wasm, and runtime manifest.");

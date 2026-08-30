import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const loaderPath = resolve(frontendRoot, "public/nethack.js");
const wasmPath = resolve(frontendRoot, "public/nethack.wasm");

const [loader, wasm] = await Promise.all([
  readFile(loaderPath, "utf8"),
  readFile(wasmPath),
]);

if (!loader.includes("export default")) {
  throw new Error("public/nethack.js is not an Emscripten ES module");
}

if (
  wasm.length < 8
  || wasm[0] !== 0x00
  || wasm[1] !== 0x61
  || wasm[2] !== 0x73
  || wasm[3] !== 0x6d
) {
  throw new Error("public/nethack.wasm is not a valid WebAssembly module");
}

console.log("Verified nethack.js and nethack.wasm runtime assets.");

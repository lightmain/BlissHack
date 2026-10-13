import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { refreshWikiCandidates } from "./wiki-assets.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDirectory, "../..");

/**
 * Parse the explicit local dump and optional candidate output arguments.
 * @param {string[]} arguments_ Process arguments after the script path.
 * @returns {{dumpPath: string, outputDirectory: string}} Parsed paths.
 */
function parseArguments(arguments_) {
  let dumpPath = null;
  let outputDirectory = join(
    frontendRoot,
    ".encyclopedia-wiki-refresh",
  );
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dump") {
      dumpPath = arguments_[index + 1] ?? null;
      index += 1;
    } else if (argument === "--output") {
      outputDirectory = resolve(arguments_[index + 1] ?? "");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!dumpPath || /^https?:\/\//i.test(dumpPath)) {
    throw new Error("--dump must name an explicit local MediaWiki XML file");
  }
  return {
    dumpPath: resolve(dumpPath),
    outputDirectory,
  };
}

/**
 * Read one checked JSON catalog.
 * @param {string} path Absolute JSON path.
 * @returns {Promise<object>} Parsed JSON object.
 */
async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * Load every stable entity ID declared by checked core chunks.
 * @returns {Promise<string[]>} Sorted core entity IDs.
 */
async function loadCoreEntityIds() {
  const coreDirectory = join(frontendRoot, "public/encyclopedia/core");
  const manifest = await readJson(join(coreDirectory, "manifest.json"));
  const chunks = await Promise.all(
    manifest.chunks.map((chunk) =>
      readJson(join(coreDirectory, chunk.file))
    ),
  );
  return chunks
    .flatMap((chunk) => chunk.records.map((record) => record.id))
    .sort();
}

const { dumpPath, outputDirectory } = parseArguments(process.argv.slice(2));
const [aliasCatalog, selectionCatalog, coreEntityIds] = await Promise.all([
  readJson(join(scriptDirectory, "wiki-aliases.json")),
  readJson(join(scriptDirectory, "wiki-selections.json")),
  loadCoreEntityIds(),
]);
const dump = createReadStream(dumpPath, { encoding: "utf8" });
const imported = await refreshWikiCandidates({
  dump,
  aliasCatalog,
  selectionCatalog,
  coreEntityIds,
  reviewedDirectory: join(frontendRoot, "public/encyclopedia/wiki"),
  reviewedNoticePath: join(frontendRoot, "public/encyclopedia/NOTICE.md"),
  outputDirectory,
});

console.log(
  `Generated ${imported.records.length} Wiki candidate record(s) in `
    + `${outputDirectory}. Reviewed assets were not modified.`,
);

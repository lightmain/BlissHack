import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { PNG } from "pngjs";
import { parseTileText } from "./tile-text.mjs";

const TILE_WIDTH = 16;
const TILE_HEIGHT = 16;
const ATLAS_FILENAME = "nethack-classic.png";
const MANIFEST_FILENAME = "nethack-classic.json";
const MAPPING_SOURCE_FILE = "tilemap.c";
const SOURCE_FILES = [
  "monsters.txt",
  "objects.txt",
  "other.txt",
  "decals.txt",
];
const GRAY_MAPPINGS = [
  0, 1, 17, 18, 19, 20, 27, 22, 23, 24, 25, 26, 21, 15, 13, 14, 14,
  1, 17, 18, 19, 20, 27, 22, 23, 24, 25, 20,
];

/**
 * Generate the checked browser atlas and manifest from official tile text.
 * @param {{
 *   inputDirectory: string,
 *   outputDirectory: string,
 *   columns?: number
 * }} options - Source, destination, and atlas width.
 * @returns {Promise<object>} generated manifest.
 */
export async function generateTileAssets(options) {
  const columns = options.columns ?? 40;
  assertColumns(columns);
  await recoverInterruptedPublication(options.outputDirectory);
  const sources = await loadSources(options.inputDirectory);
  const assets = buildTileAssets(sources, columns);

  await publishAssetDirectory(
    options.outputDirectory,
    assets.pngBytes,
    assets.manifestBytes,
  );
  return assets.manifest;
}

/**
 * Verify checked assets against source checksums and decoded PNG dimensions.
 * This function is deliberately read-only.
 * @param {{
 *   inputDirectory: string,
 *   outputDirectory: string,
 *   columns?: number
 * }} options - Paths and optional required atlas width.
 * @returns {Promise<object>} validated manifest.
 */
export async function verifyTileAssets(options) {
  const manifestPath = join(options.outputDirectory, MANIFEST_FILENAME);
  const pngPath = join(options.outputDirectory, ATLAS_FILENAME);
  const [manifestBytes, pngBytes, sources] = await Promise.all([
    readFile(manifestPath),
    readFile(pngPath),
    loadSources(options.inputDirectory),
  ]);

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("Tile manifest is not valid JSON");
  }
  assertManifestShape(manifest);

  const columns = options.columns ?? manifest.atlas.columns;
  assertColumns(columns);
  const expected = buildTileAssets(sources, columns);
  const expectedSources = expected.manifest.sources;
  for (const expected of expectedSources) {
    const recorded = manifest.sources.find(
      (source) => source.file === expected.file,
    );
    if (!recorded || recorded.sha256 !== expected.sha256) {
      throw new Error(`${expected.file} SHA-256 mismatch`);
    }
    if (recorded.tileCount !== expected.tileCount) {
      throw new Error(`${expected.file} tile count mismatch`);
    }
  }
  if (
    manifest.mappingSource?.file !== expected.manifest.mappingSource.file
    || manifest.mappingSource.sha256 !== expected.manifest.mappingSource.sha256
  ) {
    throw new Error(`${MAPPING_SOURCE_FILE} SHA-256 mismatch`);
  }

  if (manifest.atlas.tileCount !== expected.manifest.atlas.tileCount) {
    throw new Error("Manifest tile count does not match source layout");
  }
  if (manifest.atlas.rows !== expected.manifest.atlas.rows) {
    throw new Error("Manifest row count does not match tile count");
  }
  if (
    JSON.stringify(manifest.segments)
      !== JSON.stringify(expected.manifest.segments)
  ) {
    throw new Error("Manifest segments do not match source layout");
  }
  if (
    JSON.stringify(manifest.specialTiles)
      !== JSON.stringify(expected.manifest.specialTiles)
  ) {
    throw new Error("Manifest special tiles do not match source layout");
  }

  const pngHash = sha256(pngBytes);
  if (manifest.atlas.sha256 !== pngHash) {
    throw new Error("Atlas SHA-256 mismatch");
  }
  let png;
  try {
    png = PNG.sync.read(pngBytes);
  } catch {
    throw new Error("Tile atlas is not a valid PNG");
  }
  if (
    png.width !== manifest.atlas.columns * TILE_WIDTH
    || png.height !== manifest.atlas.rows * TILE_HEIGHT
  ) {
    throw new Error("Tile atlas dimensions do not match manifest");
  }
  if (!manifestBytes.equals(expected.manifestBytes)) {
    throw new Error(
      "Tile manifest does not match canonical source-generated output",
    );
  }
  if (!pngBytes.equals(expected.pngBytes)) {
    throw new Error("Tile atlas SHA-256 mismatch from canonical output");
  }
  return manifest;
}

/**
 * Build the canonical asset bytes without touching the filesystem.
 * @param {Record<string, object>} sources - Parsed sources by filename.
 * @param {number} columns - Atlas columns.
 * @returns {{
 *   manifest: object,
 *   manifestBytes: Buffer,
 *   pngBytes: Buffer
 * }} canonical generated assets.
 */
function buildTileAssets(sources, columns) {
  const layout = createLayout(sources, columns);
  const png = renderAtlas(layout, columns);
  const pngBytes = PNG.sync.write(png, {
    bitDepth: 8,
    colorType: 6,
    deflateLevel: 9,
    deflateStrategy: 3,
    inputColorType: 6,
  });
  const manifest = createManifest(sources, layout, columns, pngBytes);
  return {
    manifest,
    manifestBytes: Buffer.from(
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    ),
    pngBytes,
  };
}

/**
 * Load and parse all official tile inputs.
 * @param {string} inputDirectory - Directory containing tile text files.
 * @returns {Promise<Record<string, object>>} parsed source records.
 */
async function loadSources(inputDirectory) {
  const [entries, mappingBytes] = await Promise.all([
    Promise.all(SOURCE_FILES.map(async (file) => {
      const bytes = await readFile(join(inputDirectory, file));
      const source = bytes.toString("utf8");
      return [file, {
        bytes,
        parsed: parseTileText(source, { sourceName: file }),
      }];
    })),
    readFile(join(inputDirectory, MAPPING_SOURCE_FILE)),
  ]);
  return {
    ...Object.fromEntries(entries),
    [MAPPING_SOURCE_FILE]: { bytes: mappingBytes },
  };
}

/**
 * Build the official five-segment tile order and special indices.
 * @param {Record<string, object>} sources - Parsed sources by filename.
 * @param {number} columns - Atlas columns.
 * @returns {{ tiles: object[], segments: object[], specialTiles: object }}
 * layout.
 */
function createLayout(sources, columns) {
  assertColumns(columns);
  const definitions = [
    ["monsters", "monsters.txt", "identity"],
    ["objects", "objects.txt", "identity"],
    ["other", "other.txt", "identity"],
    ["statues", "monsters.txt", "grayscale"],
    ["decals", "decals.txt", "identity"],
  ];
  const tiles = [];
  const segments = [];
  for (const [id, source, transform] of definitions) {
    const sourceTiles = sources[source].parsed.tiles;
    segments.push({
      id,
      source,
      firstTile: tiles.length,
      tileCount: sourceTiles.length,
      transform,
    });
    for (const tile of sourceTiles) {
      tiles.push({
        ...tile,
        paletteColors: sources[source].parsed.paletteColors,
        transform,
      });
    }
  }

  const otherSegment = segments.find((segment) => segment.id === "other");
  const decalSegment = segments.find((segment) => segment.id === "decals");
  return {
    tiles,
    segments,
    specialTiles: {
      blank: otherSegment.firstTile
        + findNamedTile(sources["other.txt"].parsed.tiles, "nothing"),
      unexplored: otherSegment.firstTile
        + findNamedTile(sources["other.txt"].parsed.tiles, "unexplored"),
      petMark: decalSegment.firstTile
        + findNamedTile(sources["decals.txt"].parsed.tiles, "decal_pet"),
      pileMark: decalSegment.firstTile
        + findNamedTile(sources["decals.txt"].parsed.tiles, "decal_pile"),
    },
  };
}

/**
 * Render all tile records into one RGBA PNG buffer.
 * @param {{ tiles: object[] }} layout - Ordered tile layout.
 * @param {number} columns - Atlas columns.
 * @returns {PNG} populated PNG.
 */
function renderAtlas(layout, columns) {
  const rows = Math.ceil(layout.tiles.length / columns);
  const png = new PNG({
    width: columns * TILE_WIDTH,
    height: rows * TILE_HEIGHT,
    colorType: 6,
    inputColorType: 6,
  });
  png.data.fill(0);

  layout.tiles.forEach((tile, tileIndex) => {
    const tileX = (tileIndex % columns) * TILE_WIDTH;
    const tileY = Math.floor(tileIndex / columns) * TILE_HEIGHT;
    for (let y = 0; y < TILE_HEIGHT; y += 1) {
      for (let x = 0; x < TILE_WIDTH; x += 1) {
        const sourcePixel = y * TILE_WIDTH + x;
        const destinationPixel = (
          (tileY + y) * png.width + tileX + x
        ) * 4;
        const color = tile.transform === "grayscale"
          ? grayscaleColor(tile, sourcePixel)
          : tile.rgba.subarray(sourcePixel * 4, sourcePixel * 4 + 4);
        png.data.set(color, destinationPixel);
      }
    }
  });
  return png;
}

/**
 * Apply NetHack tiletext.c's statue palette-index transformation.
 * @param {object} tile - Parsed monster tile.
 * @param {number} pixelIndex - Pixel offset within the tile.
 * @returns {Uint8Array | number[]} transformed RGBA color.
 */
function grayscaleColor(tile, pixelIndex) {
  const sourceIndex = tile.colorIndices[pixelIndex];
  const mappedIndex = GRAY_MAPPINGS[sourceIndex];
  if (mappedIndex === undefined || !tile.paletteColors[mappedIndex]) {
    throw new Error(`Missing grayscale mapping for palette index ${sourceIndex}`);
  }
  return tile.paletteColors[mappedIndex];
}

/**
 * Create deterministic manifest metadata.
 * @param {Record<string, object>} sources - Parsed source records.
 * @param {{ tiles: object[], segments: object[], specialTiles: object }} layout
 * ordered layout.
 * @param {number} columns - Atlas columns.
 * @param {Buffer} pngBytes - Encoded atlas.
 * @returns {object} serializable manifest.
 */
function createManifest(sources, layout, columns, pngBytes) {
  return {
    formatVersion: 1,
    tile: { width: TILE_WIDTH, height: TILE_HEIGHT },
    atlas: {
      file: ATLAS_FILENAME,
      columns,
      rows: Math.ceil(layout.tiles.length / columns),
      tileCount: layout.tiles.length,
      sha256: sha256(pngBytes),
    },
    sources: sourceMetadata(sources),
    mappingSource: {
      file: MAPPING_SOURCE_FILE,
      sha256: sha256(sources[MAPPING_SOURCE_FILE].bytes),
    },
    segments: layout.segments,
    specialTiles: layout.specialTiles,
  };
}

/**
 * Build source checksum records in canonical order.
 * @param {Record<string, object>} sources - Parsed sources.
 * @returns {object[]} manifest source entries.
 */
function sourceMetadata(sources) {
  return SOURCE_FILES.map((file) => ({
    file,
    tileCount: sources[file].parsed.tiles.length,
    sha256: sha256(sources[file].bytes),
  }));
}

/**
 * Find one exact tile name and reject missing or ambiguous names.
 * @param {{ name: string }[]} tiles - Parsed source tiles.
 * @param {string} name - Expected tile name.
 * @returns {number} source-local tile index.
 */
function findNamedTile(tiles, name) {
  const matches = tiles.filter((tile) => tile.name === name);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one tile named ${name}`);
  }
  return matches[0].index;
}

/**
 * Publish both assets as one directory without exposing a mixed file pair.
 * @param {string} outputDirectory - Destination directory.
 * @param {Buffer} pngBytes - Encoded atlas.
 * @param {Buffer} manifestBytes - Encoded manifest.
 * @returns {Promise<void>} completion after publication and cleanup.
 */
async function publishAssetDirectory(
  outputDirectory,
  pngBytes,
  manifestBytes,
) {
  const parentDirectory = dirname(outputDirectory);
  const outputName = basename(outputDirectory);
  await mkdir(parentDirectory, { recursive: true });
  const backupDirectory = assetBackupPath(outputDirectory);
  await recoverInterruptedPublication(outputDirectory);
  const stagingDirectory = await mkdtemp(
    join(parentDirectory, `.${outputName}.staging-`),
  );
  let previousMoved = false;
  let published = false;
  try {
    await Promise.all([
      writeFile(join(stagingDirectory, ATLAS_FILENAME), pngBytes),
      writeFile(join(stagingDirectory, MANIFEST_FILENAME), manifestBytes),
    ]);
    try {
      await rename(outputDirectory, backupDirectory);
      previousMoved = true;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    await rename(stagingDirectory, outputDirectory);
    published = true;
    if (previousMoved) {
      await rm(backupDirectory, { recursive: true, force: true });
      previousMoved = false;
    }
  } catch (error) {
    if (previousMoved && !published) {
      try {
        await rename(backupDirectory, outputDirectory);
        previousMoved = false;
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Tile asset publication and rollback both failed",
        );
      }
    }
    throw error;
  } finally {
    await Promise.all([
      rm(stagingDirectory, { recursive: true, force: true }),
      published || !previousMoved
        ? rm(backupDirectory, { recursive: true, force: true })
        : Promise.resolve(),
    ]);
  }
}

/**
 * Restore or clean the deterministic backup left by an interrupted publish.
 * @param {string} outputDirectory - Destination directory.
 * @returns {Promise<void>} completion after recovery.
 */
async function recoverInterruptedPublication(outputDirectory) {
  const backupDirectory = assetBackupPath(outputDirectory);
  const [outputExists, backupExists] = await Promise.all([
    pathExists(outputDirectory),
    pathExists(backupDirectory),
  ]);
  if (!backupExists) return;
  if (outputExists) {
    await rm(backupDirectory, { recursive: true, force: true });
    return;
  }
  await rename(backupDirectory, outputDirectory);
}

/**
 * Return the deterministic backup path for one generated asset directory.
 * @param {string} outputDirectory - Destination directory.
 * @returns {string} sibling backup path.
 */
function assetBackupPath(outputDirectory) {
  return join(
    dirname(outputDirectory),
    `.${basename(outputDirectory)}.previous`,
  );
}

/**
 * Return whether a filesystem path currently exists.
 * @param {string} path - Path to inspect.
 * @returns {Promise<boolean>} whether the path exists.
 */
async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Validate an atlas column count.
 * @param {number} columns - Proposed number of columns.
 * @returns {void}
 */
function assertColumns(columns) {
  if (!Number.isSafeInteger(columns) || columns < 1) {
    throw new Error("Tile atlas columns must be a positive integer");
  }
}

/**
 * Validate manifest fields consumed by verification.
 * @param {unknown} manifest - Parsed JSON.
 * @returns {void}
 */
function assertManifestShape(manifest) {
  if (
    !manifest
    || typeof manifest !== "object"
    || manifest.formatVersion !== 1
    || manifest.tile?.width !== TILE_WIDTH
    || manifest.tile?.height !== TILE_HEIGHT
    || manifest.atlas?.file !== ATLAS_FILENAME
    || !Array.isArray(manifest.sources)
    || manifest.mappingSource?.file !== MAPPING_SOURCE_FILE
    || !Array.isArray(manifest.segments)
    || !manifest.specialTiles
  ) {
    throw new Error("Invalid tile manifest");
  }
  assertColumns(manifest.atlas.columns);
}

/**
 * Calculate a lowercase SHA-256 digest.
 * @param {Uint8Array} bytes - File bytes.
 * @returns {string} hexadecimal digest.
 */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

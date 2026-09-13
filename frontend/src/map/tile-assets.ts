/** Tile dimensions and atlas metadata consumed by the map renderer. */
export interface TileManifest {
  formatVersion: number;
  tile: {
    width: number;
    height: number;
  };
  atlas: {
    file: string;
    columns: number;
    rows: number;
    tileCount: number;
  };
  specialTiles: {
    blank: number;
    unexplored: number;
    petMark: number;
    pileMark: number;
  };
}

/** A decoded tile image paired with its validated manifest. */
export interface TileAtlas {
  image: HTMLImageElement;
  manifest: TileManifest;
}

/** Injectable browser operations and path used to load tile assets. */
export interface TileAssetLoadOptions {
  baseUrl?: string;
  fetchManifest?(url: string): Promise<unknown>;
  loadImage?(url: string): Promise<HTMLImageElement>;
}

const EXPECTED_TILE_WIDTH = 16;
const EXPECTED_TILE_HEIGHT = 16;
const EXPECTED_COLUMNS = 40;
const EXPECTED_ROWS = 58;
const EXPECTED_TILE_COUNT = 2307;
const MANIFEST_FILE = "nethack-classic.json";
const EXPECTED_SPECIAL_TILES: TileManifest["specialTiles"] = {
  blank: 1470,
  unexplored: 1469,
  petMark: 2305,
  pileMark: 2306,
};

let cachedAtlas: Promise<TileAtlas> | null = null;

/**
 * Load and validate the classic NetHack tile atlas once.
 * @param options - optional URL and browser loader overrides.
 * @returns the shared decoded atlas.
 */
export function loadTileAtlas(
  options: TileAssetLoadOptions = {},
): Promise<TileAtlas> {
  if (cachedAtlas) return cachedAtlas;

  const baseUrl = normalizeBaseUrl(options.baseUrl ?? import.meta.env.BASE_URL);
  const fetchManifest = options.fetchManifest ?? defaultFetchManifest;
  const loadImage = options.loadImage ?? defaultLoadImage;
  const manifestUrl = `${baseUrl}tiles/${MANIFEST_FILE}`;

  const request = fetchManifest(manifestUrl)
    .then(validateTileManifest)
    .then(async (manifest) => {
      const imageUrl = `${baseUrl}tiles/${manifest.atlas.file}`;
      const image = await loadImage(imageUrl);
      validateImageDimensions(image, manifest);
      return { image, manifest };
    });

  cachedAtlas = request;
  void request.catch(() => {
    if (cachedAtlas === request) cachedAtlas = null;
  });
  return request;
}

/** Clear the module cache so a later call performs a fresh asset load. */
export function resetTileAtlasCacheForTests(): void {
  cachedAtlas = null;
}

/**
 * Fetch one JSON tile manifest.
 * @param url - manifest URL.
 * @returns parsed JSON.
 */
async function defaultFetchManifest(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load tile manifest: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Decode one browser image.
 * @param url - image URL.
 * @returns loaded image element.
 */
function defaultLoadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load tile image: ${url}`));
    image.src = url;
  });
}

/**
 * Validate the runtime subset of the generated tile manifest.
 * @param value - parsed JSON value.
 * @returns validated manifest.
 */
function validateTileManifest(value: unknown): TileManifest {
  if (!isRecord(value)) throw new Error("Invalid tile manifest");
  const tile = value.tile;
  const atlas = value.atlas;
  const specialTiles = value.specialTiles;
  if (!isRecord(tile) || !isRecord(atlas) || !isRecord(specialTiles)) {
    throw new Error("Invalid tile manifest");
  }

  const manifest = value as unknown as TileManifest;
  requireValue(manifest.formatVersion, 1, "format version");
  requireValue(manifest.tile.width, EXPECTED_TILE_WIDTH, "tile width");
  requireValue(manifest.tile.height, EXPECTED_TILE_HEIGHT, "tile height");
  requireValue(manifest.atlas.file, "nethack-classic.png", "atlas file");
  requireValue(manifest.atlas.columns, EXPECTED_COLUMNS, "atlas columns");
  requireValue(manifest.atlas.rows, EXPECTED_ROWS, "atlas rows");
  requireValue(manifest.atlas.tileCount, EXPECTED_TILE_COUNT, "tile count");

  for (const [name, tileIndex] of Object.entries(EXPECTED_SPECIAL_TILES)) {
    requireValue(
      manifest.specialTiles[name as keyof TileManifest["specialTiles"]],
      tileIndex,
      `${name} tile index`,
    );
  }
  return manifest;
}

/**
 * Ensure the decoded image matches the generated manifest.
 * @param image - decoded tile image.
 * @param manifest - validated tile manifest.
 */
function validateImageDimensions(
  image: HTMLImageElement,
  manifest: TileManifest,
): void {
  const expectedWidth = manifest.atlas.columns * manifest.tile.width;
  const expectedHeight = manifest.atlas.rows * manifest.tile.height;
  requireValue(image.naturalWidth, expectedWidth, "image width");
  requireValue(image.naturalHeight, expectedHeight, "image height");
}

/**
 * Require one generated asset value to match the renderer contract.
 * @param actual - parsed value.
 * @param expected - required value.
 * @param label - human-readable field name.
 */
function requireValue(
  actual: unknown,
  expected: number | string,
  label: string,
): void {
  if (actual !== expected) {
    throw new Error(`Invalid ${label}: expected ${expected}, received ${String(actual)}`);
  }
}

/**
 * Normalize a Vite base URL for child asset paths.
 * @param value - configured base URL.
 * @returns a path ending in one slash.
 */
function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

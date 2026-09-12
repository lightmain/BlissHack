import type {
  GameSnapshot,
  GlyphInfo,
  MapCell,
} from "../../../src/game-state";
import {
  COLNO,
  ROWNO,
} from "../../../src/game-state";
import {
  drawTileMap,
  resizeCanvasBackingStore,
} from "../../../src/map/canvas-rendering";
import {
  loadTileAtlas,
  type TileAtlas,
} from "../../../src/map/tile-assets";

interface TilePerformanceResult {
  averageDurationMs: number;
  canvasHeight: number;
  canvasWidth: number;
  columnCount: number;
  maxDurationMs: number;
  p95DurationMs: number;
  roundCount: number;
  rowCount: number;
  totalDurationMs: number;
}

declare global {
  interface Window {
    tilePerformanceHarness: {
      measure(roundCount: number): TilePerformanceResult;
    };
  }
}

const WARMUP_ROUNDS = 5;

/** Return the required tile performance canvas. */
function requireCanvas(): HTMLCanvasElement {
  const element = document.querySelector<HTMLCanvasElement>("#tile-map");
  if (!element) throw new Error("Tile performance canvas is missing");
  return element;
}

const canvas = requireCanvas();

/**
 * Create one complete glyph fixture using a valid checked-in atlas index.
 * @param tileIndex - source index in the classic NetHack atlas.
 * @param glyphFlags - optional pet or pile display flags.
 * @returns glyph accepted by the production map renderer.
 */
function createGlyph(tileIndex: number, glyphFlags = 0): GlyphInfo {
  return {
    glyph: tileIndex,
    ttyChar: ".".charCodeAt(0),
    frameColor: 0,
    glyphFlags,
    color: 7,
    symbolIndex: 0,
    customColor: 0,
    color256: 0,
    tileIndex,
  };
}

/**
 * Build a deterministic fully populated 80 by 21 map.
 * @returns complete map containing varied foreground and background tiles.
 */
function createPerformanceMap(): MapCell[][] {
  return Array.from({ length: ROWNO }, (_, y) =>
    Array.from({ length: COLNO }, (_, x) => {
      const ordinal = y * COLNO + x;
      const glyphFlags = ordinal % 97 === 0
        ? 0x10
        : ordinal % 89 === 0
          ? 0x80
          : 0;
      return {
        foreground: createGlyph((ordinal * 37) % 1469, glyphFlags),
        background: createGlyph(1272 + (ordinal % 197)),
      };
    }));
}

/**
 * Return one nearest-rank percentile from measured frame durations.
 * @param values - unsorted non-empty duration list.
 * @param fraction - percentile as a value from zero through one.
 * @returns selected duration in milliseconds.
 */
function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index];
}

/**
 * Execute the same resize and full draw sequence used by TileMapRenderer.
 * @param atlas - decoded checked-in classic atlas.
 * @param map - deterministic complete map.
 * @param cursor - visible cursor included in the frame.
 * @returns configured context used for the completed frame.
 */
function renderTileFrame(
  atlas: TileAtlas,
  map: readonly (readonly MapCell[])[],
  cursor: GameSnapshot["cursor"],
): CanvasRenderingContext2D {
  const context = resizeCanvasBackingStore(
    canvas,
    COLNO * atlas.manifest.tile.width,
    ROWNO * atlas.manifest.tile.height,
    1,
  );
  if (!context) throw new Error("Tile performance 2D context is unavailable");
  drawTileMap({ context, atlas, map, cursor });
  return context;
}

/**
 * Measure repeated full-map paints through the production draw function.
 * @param atlas - decoded checked-in classic atlas.
 * @param map - deterministic complete map.
 * @param roundCount - number of measured full redraws.
 * @returns timing distribution and rendered dimensions.
 */
function measureTileMap(
  atlas: TileAtlas,
  map: readonly (readonly MapCell[])[],
  roundCount: number,
): TilePerformanceResult {
  if (!Number.isInteger(roundCount) || roundCount <= 0) {
    throw new Error("Tile performance round count must be a positive integer");
  }
  const cursor: GameSnapshot["cursor"] = {
    x: Math.floor(COLNO / 2),
    y: Math.floor(ROWNO / 2),
    visible: true,
  };
  for (let round = 0; round < WARMUP_ROUNDS; round += 1) {
    renderTileFrame(atlas, map, cursor);
  }

  const durations: number[] = [];
  const totalStarted = performance.now();
  for (let round = 0; round < roundCount; round += 1) {
    const started = performance.now();
    const context = renderTileFrame(atlas, map, cursor);
    context.getImageData(0, 0, 1, 1);
    durations.push(performance.now() - started);
  }
  const totalDurationMs = performance.now() - totalStarted;

  return {
    averageDurationMs: totalDurationMs / roundCount,
    canvasHeight: canvas.height,
    canvasWidth: canvas.width,
    columnCount: COLNO,
    maxDurationMs: Math.max(...durations),
    p95DurationMs: percentile(durations, 0.95),
    roundCount,
    rowCount: ROWNO,
    totalDurationMs,
  };
}

/**
 * Load the checked-in atlas and expose the performance measurement boundary.
 */
async function initializeTileHarness(): Promise<void> {
  const atlas = await loadTileAtlas();
  const map = createPerformanceMap();
  window.tilePerformanceHarness = {
    measure: (roundCount) => measureTileMap(atlas, map, roundCount),
  };
  document.documentElement.dataset.tilePerformanceReady = "true";
}

void initializeTileHarness().catch((error: unknown) => {
  document.documentElement.dataset.tilePerformanceError =
    error instanceof Error ? error.message : String(error);
});

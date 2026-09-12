import type { GameSnapshot, GlyphInfo, MapCell } from "../game-state";
import type { TileAtlas, TileManifest } from "./tile-assets";

const MG_PET = 0x00010;
const MG_OBJPILE = 0x00080;

/** One source rectangle inside the generated tile atlas. */
export interface TileSourceRect {
  tileIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Inputs for one complete tile-map paint. */
export interface DrawTileMapOptions {
  context: CanvasRenderingContext2D;
  atlas: TileAtlas;
  map: readonly (readonly MapCell[])[];
  cursor: GameSnapshot["cursor"];
}

/** Coalesce map invalidations into browser animation frames. */
export interface FrameScheduler {
  schedule(): void;
  dispose(): void;
}

/**
 * Locate a tile inside the atlas, falling back to unexplored for bad indices.
 * @param tileIndex - authoritative tile index from glyph_info.
 * @param manifest - generated atlas metadata.
 * @returns the source rectangle and effective tile index.
 */
export function tileSourceRect(
  tileIndex: number,
  manifest: TileManifest,
): TileSourceRect {
  const effectiveTileIndex = Number.isInteger(tileIndex)
      && tileIndex >= 0
      && tileIndex < manifest.atlas.tileCount
    ? tileIndex
    : manifest.specialTiles.unexplored;
  return {
    tileIndex: effectiveTileIndex,
    x: (effectiveTileIndex % manifest.atlas.columns) * manifest.tile.width,
    y: Math.floor(effectiveTileIndex / manifest.atlas.columns)
      * manifest.tile.height,
    width: manifest.tile.width,
    height: manifest.tile.height,
  };
}

/**
 * Configure CSS and device-pixel dimensions for a sharp canvas.
 * @param canvas - destination canvas.
 * @param cssWidth - logical width in CSS pixels.
 * @param cssHeight - logical height in CSS pixels.
 * @param devicePixelRatio - current display scale.
 * @returns the 2D context, or null when unavailable.
 */
export function resizeCanvasBackingStore(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): CanvasRenderingContext2D | null {
  const pixelRatio = Number.isFinite(devicePixelRatio)
    ? Math.max(1, devicePixelRatio)
    : 1;
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.imageSmoothingEnabled = false;
  return context;
}

/**
 * Paint a complete map from immutable cell state.
 * @param options - context, atlas, map, and cursor state.
 */
export function drawTileMap({
  context,
  atlas,
  map,
  cursor,
}: DrawTileMapOptions): void {
  const { width, height } = atlas.manifest.tile;
  const columnCount = map.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0,
  );
  context.clearRect(0, 0, columnCount * width, map.length * height);

  for (let y = 0; y < map.length; y += 1) {
    const row = map[y];
    for (let x = 0; x < row.length; x += 1) {
      const cell = row[x];
      drawGlyph(context, atlas, cell.background, x, y);
      drawGlyph(context, atlas, cell.foreground, x, y);

      const flags = cell.foreground?.glyphFlags ?? 0;
      if ((flags & MG_PET) !== 0) {
        drawTile(context, atlas, atlas.manifest.specialTiles.petMark, x, y);
      }
      if ((flags & MG_OBJPILE) !== 0) {
        drawTile(context, atlas, atlas.manifest.specialTiles.pileMark, x, y);
      }
    }
  }

  if (
    cursor.visible
    && cursor.y >= 0
    && cursor.y < map.length
    && cursor.x >= 0
    && cursor.x < (map[cursor.y]?.length ?? 0)
  ) {
    context.save();
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1;
    context.strokeRect(cursor.x * width, cursor.y * height, width, height);
    context.restore();
  }
}

/**
 * Create an animation-frame scheduler that coalesces repeated invalidations.
 * @param render - paint operation to execute.
 * @param requestFrame - browser frame request function.
 * @param cancelFrame - browser frame cancellation function.
 * @returns scheduler lifecycle.
 */
export function createFrameScheduler(
  render: () => void,
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (handle: number) => void,
): FrameScheduler {
  let pendingFrame: number | null = null;
  let disposed = false;

  return {
    schedule(): void {
      if (disposed || pendingFrame !== null) return;
      pendingFrame = requestFrame(() => {
        pendingFrame = null;
        if (!disposed) render();
      });
    },
    dispose(): void {
      disposed = true;
      if (pendingFrame !== null) {
        cancelFrame(pendingFrame);
        pendingFrame = null;
      }
    },
  };
}

/**
 * Paint one optional glyph at a map coordinate.
 * @param context - destination context.
 * @param atlas - loaded tile atlas.
 * @param glyph - foreground or background glyph.
 * @param x - map column.
 * @param y - map row.
 */
function drawGlyph(
  context: CanvasRenderingContext2D,
  atlas: TileAtlas,
  glyph: GlyphInfo | null,
  x: number,
  y: number,
): void {
  if (!glyph) return;
  drawTile(context, atlas, glyph.tileIndex, x, y);
}

/**
 * Paint one atlas tile at a map coordinate.
 * @param context - destination context.
 * @param atlas - loaded tile atlas.
 * @param tileIndex - source tile index.
 * @param x - map column.
 * @param y - map row.
 */
function drawTile(
  context: CanvasRenderingContext2D,
  atlas: TileAtlas,
  tileIndex: number,
  x: number,
  y: number,
): void {
  const source = tileSourceRect(tileIndex, atlas.manifest);
  context.drawImage(
    atlas.image,
    source.x,
    source.y,
    source.width,
    source.height,
    x * source.width,
    y * source.height,
    source.width,
    source.height,
  );
}

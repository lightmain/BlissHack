import { describe, expect, it, vi } from "vitest";
import type {
  GameSnapshot,
  GlyphInfo,
  MapCell,
} from "../game-state";
import {
  createFrameScheduler,
  drawTileMap,
  resizeCanvasBackingStore,
  tileSourceRect,
} from "./canvas-rendering";
import type { TileAtlas, TileManifest } from "./tile-assets";

const manifest: TileManifest = {
  formatVersion: 1,
  tile: {
    width: 16,
    height: 16,
  },
  atlas: {
    file: "nethack-classic.png",
    columns: 40,
    rows: 58,
    tileCount: 2307,
  },
  specialTiles: {
    blank: 1470,
    unexplored: 1469,
    petMark: 2305,
    pileMark: 2306,
  },
};

/** Create one complete glyph fixture for a tile and optional display flags. */
function glyph(tileIndex: number, glyphFlags = 0): GlyphInfo {
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

/** Create one map cell from nullable foreground and background glyphs. */
function cell(
  foreground: GlyphInfo | null,
  background: GlyphInfo | null = null,
): MapCell {
  return { foreground, background };
}

/** Create an atlas fixture whose image identity can be asserted in draw calls. */
function atlas(): TileAtlas {
  return {
    image: {
      naturalWidth: 640,
      naturalHeight: 928,
    } as TileAtlas["image"],
    manifest,
  };
}

/** Create the Canvas methods observed by the renderer tests. */
function drawingContext() {
  const drawImage = vi.fn();
  const strokeRect = vi.fn();
  const context = {
    clearRect: vi.fn(),
    drawImage,
    restore: vi.fn(),
    save: vi.fn(),
    strokeRect,
    lineWidth: 0,
    strokeStyle: "",
  } as unknown as CanvasRenderingContext2D;
  return { context, drawImage, strokeRect };
}

describe("tileSourceRect", () => {
  it("maps 16 by 16 tiles across 40 atlas columns", () => {
    expect(tileSourceRect(0, manifest)).toEqual({
      tileIndex: 0,
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    });
    expect(tileSourceRect(39, manifest)).toEqual({
      tileIndex: 39,
      x: 624,
      y: 0,
      width: 16,
      height: 16,
    });
    expect(tileSourceRect(40, manifest)).toEqual({
      tileIndex: 40,
      x: 0,
      y: 16,
      width: 16,
      height: 16,
    });
    expect(tileSourceRect(41, manifest)).toEqual({
      tileIndex: 41,
      x: 16,
      y: 16,
      width: 16,
      height: 16,
    });
  });

  it.each([-1, 2307, Number.NaN, 1.5])(
    "uses the unexplored tile for invalid tile index %s",
    (tileIndex) => {
      expect(tileSourceRect(tileIndex, manifest)).toEqual({
        tileIndex: 1469,
        x: 464,
        y: 576,
        width: 16,
        height: 16,
      });
    },
  );
});

describe("resizeCanvasBackingStore", () => {
  it("uses DPR-scaled backing dimensions and disables image smoothing", () => {
    const context = {
      imageSmoothingEnabled: true,
      setTransform: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      style: {
        width: "",
        height: "",
      },
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement;

    const result = resizeCanvasBackingStore(canvas, 640, 336, 2);

    expect(result).toBe(context);
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(672);
    expect(canvas.style.width).toBe("640px");
    expect(canvas.style.height).toBe("336px");
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(context.imageSmoothingEnabled).toBe(false);
  });
});

describe("drawTileMap", () => {
  it("draws a cell background before its foreground", () => {
    const tileAtlas = atlas();
    const { context, drawImage } = drawingContext();
    const map = [[
      cell(null),
      cell(glyph(41), glyph(40)),
    ]];

    drawTileMap({
      context,
      atlas: tileAtlas,
      map,
      cursor: { x: 1, y: 0, visible: false },
    });

    expect(drawImage.mock.calls).toEqual([
      [tileAtlas.image, 0, 16, 16, 16, 16, 0, 16, 16],
      [tileAtlas.image, 16, 16, 16, 16, 16, 0, 16, 16],
    ]);
  });

  it("draws pet and object-pile overlays from the manifest", () => {
    const tileAtlas = atlas();
    const { context, drawImage } = drawingContext();
    const map = [[
      cell(null),
      cell(glyph(100, 0x10)),
      cell(glyph(101, 0x80)),
    ]];

    drawTileMap({
      context,
      atlas: tileAtlas,
      map,
      cursor: { x: 1, y: 0, visible: false },
    });

    const overlayCalls = drawImage.mock.calls.filter(
      (call) => call[2] === 912,
    );
    expect(overlayCalls).toEqual([
      [tileAtlas.image, 400, 912, 16, 16, 16, 0, 16, 16],
      [tileAtlas.image, 416, 912, 16, 16, 32, 0, 16, 16],
    ]);
  });

  it("rejects the frame when a glyph tile index is invalid", () => {
    const tileAtlas = atlas();
    const { context, drawImage } = drawingContext();

    expect(() => drawTileMap({
      context,
      atlas: tileAtlas,
      map: [[cell(null), cell(glyph(2307))]],
      cursor: { x: 1, y: 0, visible: false },
    })).toThrow(/tile index 2307/i);

    expect(drawImage).not.toHaveBeenCalled();
  });

  it("draws the cursor last without changing the map data", () => {
    const tileAtlas = atlas();
    const { context, drawImage, strokeRect } = drawingContext();
    const foreground = Object.freeze(glyph(41));
    const map = Object.freeze([
      Object.freeze([
        Object.freeze(cell(null)),
        Object.freeze(cell(foreground)),
      ]),
    ]);
    const cursor: GameSnapshot["cursor"] = { x: 1, y: 0, visible: true };

    drawTileMap({ context, atlas: tileAtlas, map, cursor });

    expect(strokeRect).toHaveBeenCalledWith(16, 0, 16, 16);
    expect(strokeRect.mock.invocationCallOrder[0]).toBeGreaterThan(
      drawImage.mock.invocationCallOrder.at(-1) ?? 0,
    );
    expect(map[0][1].foreground).toBe(foreground);
    expect(map[0][1].foreground?.tileIndex).toBe(41);
  });
});

describe("createFrameScheduler", () => {
  it("coalesces repeated schedules into one animation frame", () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const render = vi.fn();
    const scheduler = createFrameScheduler(render, requestFrame, vi.fn());

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();

    callbacks[0](16);
    expect(render).toHaveBeenCalledTimes(1);

    scheduler.schedule();
    expect(requestFrame).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending frame when disposed", () => {
    const requestFrame = vi.fn((_callback: FrameRequestCallback) => 73);
    const cancelFrame = vi.fn();
    const render = vi.fn();
    const scheduler = createFrameScheduler(
      render,
      requestFrame,
      cancelFrame,
    );

    scheduler.schedule();
    scheduler.dispose();
    scheduler.schedule();

    expect(cancelFrame).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledWith(73);
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(render).not.toHaveBeenCalled();
  });
});

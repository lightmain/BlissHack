import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GlyphInfo, MapCell } from "../game-state";
import { AsciiMapRenderer } from "./AsciiMapRenderer";
import { TileMapRenderer } from "./TileMapRenderer";

/** Create one map cell with the requested ASCII character. */
function cell(character: string): MapCell {
  const foreground: GlyphInfo = {
    glyph: character.charCodeAt(0),
    ttyChar: character.charCodeAt(0),
    frameColor: 0,
    glyphFlags: 0,
    color: 7,
    symbolIndex: 0,
    customColor: 0,
    color256: 0,
    tileIndex: 0,
  };
  return { foreground, background: null };
}

const map = [[cell("."), cell("@"), cell("d")]];
const cursor = { x: 1, y: 0, visible: true };

describe("AsciiMapRenderer", () => {
  it("renders the dungeon characters and visible cursor as accessible ASCII", () => {
    const html = renderToStaticMarkup(createElement(AsciiMapRenderer, {
      map,
      cursor,
    }));

    expect(html).toContain('aria-label="Dungeon map"');
    expect(html).toContain("nh-map-ascii");
    expect(html.replace(/<[^>]+>/g, "")).toBe(".@d");
    expect(html).toContain("nh-cursor");
  });
});

describe("TileMapRenderer", () => {
  it("renders the same ASCII map while the atlas is not ready", () => {
    const html = renderToStaticMarkup(createElement(TileMapRenderer, {
      map,
      cursor,
    }));

    expect(html).toContain('aria-label="Dungeon map"');
    expect(html).toContain("nh-map-fallback");
    expect(html).toContain("nh-map-ascii");
    expect(html.replace(/<[^>]+>/g, "")).toBe(".@d");
  });
});

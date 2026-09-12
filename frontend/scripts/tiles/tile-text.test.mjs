import { describe, expect, it } from "vitest";
import { parseTileText } from "./tile-text.mjs";
import {
  createTileText,
  solidTileRows,
} from "./__fixtures__/tile-text-fixture.mjs";

/**
 * Capture a parser error so each diagnostic property can be asserted.
 * @param {string} source - Tile text to parse.
 * @returns {string} Error text.
 */
function parseError(source) {
  try {
    parseTileText(source, { sourceName: "fixture.txt" });
  } catch (error) {
    return String(error);
  }
  throw new Error("Expected tile parsing to fail");
}

describe("parseTileText", () => {
  it("parses a palette, tile comment, and exactly 16x16 RGBA pixels", () => {
    const rows = solidTileRows(".");
    rows[0] = "AB..............";

    const parsed = parseTileText(
      createTileText([{ index: 0, name: "sample", rows }]),
      { sourceName: "fixture.txt" },
    );

    expect(parsed.palette.get(".")).toEqual([71, 108, 108, 255]);
    expect(parsed.tiles).toHaveLength(1);
    expect(parsed.tiles[0]).toMatchObject({ index: 0, name: "sample" });
    expect(parsed.tiles[0].rgba).toBeInstanceOf(Uint8Array);
    expect(parsed.tiles[0].rgba).toHaveLength(16 * 16 * 4);
    expect(Array.from(parsed.tiles[0].rgba.slice(0, 12))).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
      71, 108, 108, 255,
    ]);
  });

  it("rejects unknown palette characters with tile coordinates", () => {
    const rows = solidTileRows(".");
    rows[8] = `Z${".".repeat(15)}`;
    const message = parseError(
      createTileText([{ index: 0, name: "unknown color", rows }]),
    );

    expect(message).toMatch(/fixture\.txt/i);
    expect(message).toMatch(/unknown palette character.*Z/i);
    expect(message).toMatch(/tile 0/i);
    expect(message).toMatch(/row 9.*column 1/i);
  });

  it.each([
    ["15 rows", solidTileRows(".").slice(0, 15), /16 rows/i],
    ["17 rows", [...solidTileRows("."), ".".repeat(16)], /16 rows/i],
    [
      "15 columns",
      [".".repeat(15), ...solidTileRows(".").slice(1)],
      /16 columns/i,
    ],
    [
      "17 columns",
      [".".repeat(17), ...solidTileRows(".").slice(1)],
      /16 columns/i,
    ],
  ])("rejects a tile with %s", (_label, rows, expectedMessage) => {
    const message = parseError(
      createTileText([{ index: 0, name: "bad dimensions", rows }]),
    );

    expect(message).toMatch(/fixture\.txt/i);
    expect(message).toMatch(/tile 0/i);
    expect(message).toMatch(expectedMessage);
  });

  it("rejects duplicate palette entries and non-sequential tile comments", () => {
    const duplicatePalette = createTileText([
      { index: 0, name: "duplicate palette", rows: solidTileRows(".") },
    ]).replace(
      "A = (255, 0, 0)",
      "A = (255, 0, 0)\nA = (254, 0, 0)",
    );
    expect(parseError(duplicatePalette)).toMatch(
      /duplicate palette (symbol|character).*A/i,
    );

    const skippedTile = createTileText([
      { index: 1, name: "wrong index", rows: solidTileRows(".") },
    ]);
    expect(parseError(skippedTile)).toMatch(/expected tile 0.*(?:found|got) 1/i);
  });

  it("rejects palette symbols outside the official tiletext character set", () => {
    const unsupported = createTileText([
      { index: 0, name: "unsupported palette", rows: solidTileRows(".") },
    ]).replace(
      "A = (255, 0, 0)",
      "$ = (255, 0, 0)",
    );

    expect(parseError(unsupported)).toMatch(/invalid palette entry/i);
  });
});

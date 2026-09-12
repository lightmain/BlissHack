const DEFAULT_PALETTE = {
  ".": [71, 108, 108],
  A: [255, 0, 0],
  B: [0, 255, 0],
  C: [0, 0, 255],
};

/**
 * Create sixteen equal rows for one fixture tile.
 * @param {string} symbol - Single palette symbol used for every pixel.
 * @returns {string[]} Sixteen rows containing sixteen symbols each.
 */
export function solidTileRows(symbol) {
  return Array.from({ length: 16 }, () => symbol.repeat(16));
}

/**
 * Serialize small tile definitions in the official text format.
 * Deliberately leaves row validation to the production parser under test.
 * @param {{ index: number, name: string, rows: string[] }[]} tiles - Tiles.
 * @param {Record<string, number[]>} [palette] - Palette entries.
 * @returns {string} Tile text fixture.
 */
export function createTileText(tiles, palette = DEFAULT_PALETTE) {
  const paletteLines = Object.entries(palette).map(
    ([symbol, [red, green, blue]]) =>
      `${symbol} = (${red}, ${green}, ${blue})`,
  );
  const tileBlocks = tiles.map(({ index, name, rows }) =>
    [
      `# tile ${index} (${name})`,
      "{",
      ...rows.map((row) => `  ${row}`),
      "}",
    ].join("\n")
  );

  return [
    "# Minimal NetHack tile fixture",
    ...paletteLines,
    ...tileBlocks,
    "",
  ].join("\n");
}

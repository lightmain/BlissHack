const TILE_WIDTH = 16;
const TILE_HEIGHT = 16;

/**
 * Parse one NetHack text tileset into indexed and RGBA pixels.
 * @param {string} source - Complete tile text source.
 * @param {{ sourceName?: string }} [options] - Diagnostic source metadata.
 * @returns {{
 *   palette: Map<string, [number, number, number, number]>,
 *   paletteColors: [number, number, number, number][],
 *   tiles: {
 *     index: number,
 *     name: string,
 *     colorIndices: Uint8Array,
 *     rgba: Uint8Array
 *   }[]
 * }} parsed tiles.
 */
export function parseTileText(source, options = {}) {
  const sourceName = options.sourceName ?? "tile source";
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const palette = new Map();
  const paletteIndices = new Map();
  const paletteColors = [];
  const tiles = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex].trim();
    if (line === "" || (line.startsWith("#") && !isTileHeader(line))) {
      lineIndex += 1;
      continue;
    }
    if (isTileHeader(line)) break;

    const match = /^([.A-Za-z0-9])\s*=\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/
      .exec(line);
    if (!match) {
      throw tileError(sourceName, lineIndex + 1, "invalid palette entry");
    }
    const [, symbol, redText, greenText, blueText] = match;
    if (palette.has(symbol)) {
      throw tileError(
        sourceName,
        lineIndex + 1,
        `duplicate palette symbol ${symbol}`,
      );
    }
    if (palette.size >= 62) {
      throw tileError(sourceName, lineIndex + 1, "palette exceeds 62 colors");
    }
    const color = [
      Number(redText),
      Number(greenText),
      Number(blueText),
      255,
    ];
    if (color.slice(0, 3).some((channel) => channel > 255)) {
      throw tileError(sourceName, lineIndex + 1, "palette channel exceeds 255");
    }
    palette.set(symbol, color);
    paletteIndices.set(symbol, paletteColors.length);
    paletteColors.push(color);
    lineIndex += 1;
  }

  if (palette.size === 0) {
    throw new Error(`${sourceName}: tile palette is empty`);
  }

  while (lineIndex < lines.length) {
    lineIndex = skipIgnoredLines(lines, lineIndex);
    if (lineIndex >= lines.length) break;

    const header = parseTileHeader(lines[lineIndex].trim());
    if (!header) {
      throw tileError(sourceName, lineIndex + 1, "expected tile header");
    }
    const expectedIndex = tiles.length;
    if (header.index !== expectedIndex) {
      throw tileError(
        sourceName,
        lineIndex + 1,
        `expected tile ${expectedIndex}, found ${header.index}`,
      );
    }
    lineIndex += 1;
    lineIndex = skipIgnoredLines(lines, lineIndex);
    if (lines[lineIndex]?.trim() !== "{") {
      throw tileError(sourceName, lineIndex + 1, `tile ${header.index} missing '{'`);
    }
    lineIndex += 1;

    const colorIndices = new Uint8Array(TILE_WIDTH * TILE_HEIGHT);
    const rgba = new Uint8Array(TILE_WIDTH * TILE_HEIGHT * 4);
    for (let row = 0; row < TILE_HEIGHT; row += 1) {
      const line = lines[lineIndex];
      if (line === undefined || line.trim() === "}") {
        throw tileError(
          sourceName,
          lineIndex + 1,
          `tile ${header.index} must contain 16 rows`,
        );
      }
      const pixels = line.trim();
      if (pixels.length !== TILE_WIDTH) {
        throw tileError(
          sourceName,
          lineIndex + 1,
          `tile ${header.index} row ${row + 1} must contain 16 columns`,
        );
      }
      for (let column = 0; column < TILE_WIDTH; column += 1) {
        const symbol = pixels[column];
        const color = palette.get(symbol);
        if (!color) {
          throw tileError(
            sourceName,
            lineIndex + 1,
            `unknown palette character ${symbol} in tile ${header.index}, `
              + `row ${row + 1}, column ${column + 1}`,
          );
        }
        const colorIndex = paletteIndices.get(symbol);
        const pixelIndex = row * TILE_WIDTH + column;
        colorIndices[pixelIndex] = colorIndex;
        rgba.set(color, pixelIndex * 4);
      }
      lineIndex += 1;
    }

    if (lines[lineIndex]?.trim() !== "}") {
      throw tileError(
        sourceName,
        lineIndex + 1,
        `tile ${header.index} must contain exactly 16 rows`,
      );
    }
    tiles.push({
      index: header.index,
      name: header.name,
      colorIndices,
      rgba,
    });
    lineIndex += 1;
  }

  return { palette, paletteColors, tiles };
}

/**
 * Return whether one line starts a tile definition.
 * @param {string} line - Trimmed source line.
 * @returns {boolean} True for tile and placeholder headers.
 */
function isTileHeader(line) {
  return /^# (?:tile|placeholder) \d+ \(.+\)$/.test(line);
}

/**
 * Decode one tile header.
 * @param {string} line - Trimmed source line.
 * @returns {{ index: number, name: string } | null} decoded header.
 */
function parseTileHeader(line) {
  const match = /^# (?:tile|placeholder) (\d+) \((.+)\)$/.exec(line);
  return match ? { index: Number(match[1]), name: match[2] } : null;
}

/**
 * Skip blank lines and comments which are not tile headers.
 * @param {string[]} lines - Source lines.
 * @param {number} start - First line to inspect.
 * @returns {number} next meaningful line index.
 */
function skipIgnoredLines(lines, start) {
  let index = start;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (line === "" || (line.startsWith("#") && !isTileHeader(line))) {
      index += 1;
    } else {
      break;
    }
  }
  return index;
}

/**
 * Create a source-located parser error.
 * @param {string} sourceName - Source label.
 * @param {number} line - One-based line.
 * @param {string} message - Failure detail.
 * @returns {Error} parser error.
 */
function tileError(sourceName, line, message) {
  return new Error(`${sourceName}:${line}: ${message}`);
}

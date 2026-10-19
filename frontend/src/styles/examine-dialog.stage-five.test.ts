/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(new URL("./game.css", import.meta.url), "utf8");

/** Return declarations for one exact selector from a CSS fragment. */
function cssFor(source: string, selector: string): string {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) =>
      match[1].split(",").some((candidate) => candidate.trim() === selector)
    )
    .map((match) => match[2])
    .join("\n");
}

/** Return one balanced media-query block containing the supplied marker. */
function mediaBlock(marker: RegExp): string {
  const start = CSS.search(marker);
  expect(start, `missing media query ${marker}`).toBeGreaterThan(-1);
  const openingBrace = CSS.indexOf("{", start);
  let depth = 0;
  for (let index = openingBrace; index < CSS.length; index += 1) {
    if (CSS[index] === "{") depth += 1;
    if (CSS[index] === "}") depth -= 1;
    if (depth === 0) return CSS.slice(openingBrace + 1, index);
  }
  throw new Error(`Unbalanced media query ${marker}`);
}

describe("stage-five Examine responsive scroll ownership", () => {
  it("uses the full-width layout as the sole desktop scroll owner", () => {
    const responsiveStart = CSS.search(
      /@media\s*\(\s*max-height\s*:\s*\d+px\s*\)/,
    );
    expect(responsiveStart, "missing Examine responsive CSS")
      .toBeGreaterThan(-1);
    const desktop = CSS.slice(
      CSS.indexOf(".examine-backdrop"),
      responsiveStart,
    );
    const dialog = cssFor(desktop, ".examine-dialog");
    const layout = cssFor(desktop, ".examine-layout");
    const article = cssFor(desktop, ".examine-article");
    const facts = cssFor(desktop, ".examine-facts");

    expect(dialog).toMatch(/\bwidth\s*:\s*min\(/);
    expect(dialog).toMatch(/\bheight\s*:\s*min\(/);
    expect(dialog).toMatch(/\boverflow\s*:\s*hidden\s*;/);
    expect(layout).toMatch(/\bmin-height\s*:\s*0\s*;/);
    expect(layout).toMatch(/\boverflow-y\s*:\s*auto\s*;/);
    expect(desktop).not.toMatch(
      /\bgrid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+330px\s*;/,
    );
    expect(article).not.toMatch(
      /\boverflow-y\s*:\s*(?:auto|scroll)\s*;/,
    );
    expect(facts).not.toMatch(
      /\boverflow-y\s*:\s*(?:auto|scroll)\s*;/,
    );
    expect(desktop.match(/\boverflow-y\s*:\s*auto\s*;/g) ?? [])
      .toHaveLength(1);
    expect(desktop).not.toMatch(/\.examine-tabs?\b|\.examine-tab-panel\b/);
  });

  it("keeps only the layout scrollable in narrow viewports", () => {
    const narrow = mediaBlock(
      /@media\s*\(\s*max-width\s*:\s*(?:[3-7]\d{2}|820)px\s*\)/,
    );

    expect(cssFor(narrow, ".examine-dialog"))
      .toMatch(/\bmin-height\s*:\s*0\s*;/);
    expect(cssFor(narrow, ".examine-layout"))
      .toMatch(/\boverflow-y\s*:\s*auto\s*;/);
    expect(cssFor(narrow, ".examine-facts"))
      .not.toMatch(/\boverflow-y\s*:\s*(?:auto|scroll)\s*;/);
    expect(cssFor(narrow, ".examine-article"))
      .not.toMatch(/\boverflow-y\s*:\s*(?:auto|scroll)\s*;/);
    expect(narrow.match(/\boverflow-y\s*:\s*auto\s*;/g) ?? [])
      .toHaveLength(1);
    expect(narrow).not.toMatch(/\.examine-tabs?\b|\.examine-tab-panel\b/);
  });

  it("keeps only the layout scrollable in short viewports", () => {
    const short = mediaBlock(
      /@media\s*\(\s*max-height\s*:\s*\d+px\s*\)/,
    );

    expect(cssFor(short, ".examine-dialog"))
      .toMatch(/\bmin-height\s*:\s*0\s*;/);
    expect(cssFor(short, ".examine-dialog"))
      .toMatch(/\bheight\s*:\s*calc\(100(?:dvh|vh)\s*-/);
    expect(cssFor(short, ".examine-layout"))
      .toMatch(/\boverflow-y\s*:\s*auto\s*;/);
    expect(cssFor(short, ".examine-facts"))
      .not.toMatch(/\boverflow-y\s*:\s*(?:auto|scroll)\s*;/);
    expect(cssFor(short, ".examine-article"))
      .not.toMatch(/\boverflow-y\s*:\s*(?:auto|scroll)\s*;/);
    expect(short.match(/\boverflow-y\s*:\s*auto\s*;/g) ?? [])
      .toHaveLength(1);
    expect(short).not.toMatch(/\.examine-tabs?\b|\.examine-tab-panel\b/);
  });
});

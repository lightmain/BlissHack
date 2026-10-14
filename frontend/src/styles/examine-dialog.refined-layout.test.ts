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

describe("refined Examine typography and fact hierarchy", () => {
  it("inherits the game's configured monospace family and font size", () => {
    const dialog = cssFor(CSS, ".examine-dialog");

    expect(dialog).toMatch(
      /\bfont-family\s*:\s*var\(--blisshack-monospace-font\)\s*;/,
    );
    expect(dialog).toMatch(/\bfont-size\s*:\s*inherit\s*;/);
    expect(dialog).not.toMatch(/\bInter\b|ui-sans-serif|system-ui/);
  });

  it("keeps one stable main layout whether optional Wiki content exists", () => {
    const layout = cssFor(CSS, ".examine-layout");

    expect(layout).toMatch(
      /\bgrid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+330px\s*;/,
    );
    expect(CSS).not.toContain("data-facts-only");
    expect(CSS).not.toContain("data-entity-kind");
    expect(CSS).not.toMatch(/\bnewt\b/i);
  });

  it("uses monster columns only when facts span the full layout", () => {
    const facts = cssFor(CSS, ".examine-facts");
    const factsOnly = cssFor(CSS, ".examine-facts:only-child");
    const monsterFacts = cssFor(
      CSS,
      '.examine-facts[data-examine-template="monster"]:only-child',
    );
    const primary = cssFor(
      CSS,
      '.examine-facts[data-examine-template="monster"]:only-child '
        + ".examine-facts-primary",
    );
    const statistics = cssFor(
      CSS,
      ".examine-core-statistics .examine-detail-list",
    );
    const keyValue = cssFor(CSS, ".examine-key-fact dd");
    const provenance = cssFor(CSS, ".examine-provenance");

    expect(facts).toMatch(/\bwidth\s*:\s*100%\s*;/);
    expect(facts).toMatch(/\bmax-width\s*:\s*none\s*;/);
    expect(facts).not.toMatch(/\bdisplay\s*:\s*grid\s*;/);
    expect(facts).not.toMatch(/\bgrid-template-columns\s*:/);
    expect(factsOnly).toMatch(/\bgrid-column\s*:\s*1\s*\/\s*-1\s*;/);
    expect(monsterFacts).toMatch(/\bdisplay\s*:\s*grid\s*;/);
    expect(monsterFacts).toMatch(
      /\bgrid-template-columns\s*:\s*minmax\(0,\s*1\.08fr\)\s+minmax\(0,\s*0\.92fr\)\s*;/,
    );
    expect(primary).toMatch(/\bborder-right\s*:\s*1px\s+solid\b/);
    expect(primary).toMatch(/\bpadding-right\s*:\s*\d+px\s*;/);
    expect(statistics).toMatch(
      /\bgrid-template-columns\s*:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*;/,
    );
    expect(keyValue).toMatch(/\bfont-weight\s*:\s*(?:[7-9]00|bold)\s*;/);
    expect(provenance).toMatch(/\bgrid-column\s*:\s*1\s*\/\s*-1\s*;/);
  });
});

describe("refined Examine narrow-screen scroll ownership", () => {
  it("collapses the fact columns without introducing a nested scroll owner", () => {
    const narrow = mediaBlock(
      /@media\s*\(\s*max-width\s*:\s*(?:[3-7]\d{2}|820)px\s*\)/,
    );
    const monsterFacts = cssFor(
      narrow,
      '.examine-facts[data-examine-template="monster"]',
    );
    const primary = cssFor(
      narrow,
      '.examine-facts[data-examine-template="monster"]:only-child '
        + ".examine-facts-primary",
    );

    expect(cssFor(narrow, ".examine-layout"))
      .toMatch(/\boverflow-y\s*:\s*auto\s*;/);
    expect(monsterFacts).toMatch(/\bdisplay\s*:\s*block\s*;/);
    expect(primary).toMatch(/\bborder-right\s*:\s*(?:0|none)\s*;/);
    expect(cssFor(narrow, ".examine-tab-panel"))
      .toMatch(/\boverflow\s*:\s*visible\s*;/);
    expect(cssFor(narrow, ".examine-facts"))
      .toMatch(/\boverflow\s*:\s*visible\s*;/);
    expect(narrow.match(/\boverflow-y\s*:\s*auto\s*;/g) ?? [])
      .toHaveLength(1);
  });
});

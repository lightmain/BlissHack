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

    expect([
      /\bdisplay\s*:\s*block\s*;/,
      /\bgrid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s*;/,
    ].some((pattern) => pattern.test(layout))).toBe(true);
    expect(CSS).not.toMatch(
      /\bgrid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+330px\s*;/,
    );
    expect(CSS).not.toContain("data-facts-only");
    expect(CSS).not.toContain("data-entity-kind");
    expect(CSS).not.toMatch(/\bnewt\b/i);
    expect(CSS).not.toContain(".examine-tabs");
    expect(CSS).not.toContain(".examine-tab");
    expect(CSS).not.toContain(".examine-tab-panel");
  });

  it("uses one responsive fact document for every family", () => {
    const facts = cssFor(CSS, ".examine-facts");
    const document = cssFor(CSS, ".examine-fact-document");
    const section = cssFor(CSS, ".examine-fact-section");
    const keyFacts = cssFor(
      CSS,
      ".examine-key-facts .examine-detail-list",
    );
    const keyValue = cssFor(CSS, ".examine-key-fact dd");

    expect(facts).toMatch(/\bwidth\s*:\s*100%\s*;/);
    expect(facts).toMatch(/\bmax-width\s*:\s*none\s*;/);
    expect(facts).toMatch(/\bmin-width\s*:\s*0\s*;/);
    expect(facts).not.toMatch(/\boverflow-y\s*:\s*(?:auto|scroll)\s*;/);
    expect(document).toMatch(/\bmin-width\s*:\s*0\s*;/);
    expect(section).toMatch(/\bborder-bottom\s*:\s*1px\s+solid\b/);
    expect(keyFacts).toMatch(
      /\bgrid-template-columns\s*:\s*repeat\(\s*auto-fit\s*,\s*minmax\([^;]+\)\s*\)\s*;/,
    );
    expect(keyValue).toMatch(/\bfont-weight\s*:\s*(?:[7-9]00|bold)\s*;/);
    expect(CSS).not.toMatch(/:(?:not\(\s*)?only-child\b/);
    expect(CSS).not.toMatch(
      /\[data-examine-template\s*=\s*["']monster["']\]/,
    );
    expect(CSS).not.toContain(".examine-facts-primary");
    expect(CSS).not.toContain(".examine-facts-secondary");
  });
});

describe("refined Examine narrow-screen scroll ownership", () => {
  it("keeps one scroll owner without any family-specific layout branch", () => {
    const narrow = mediaBlock(
      /@media\s*\(\s*max-width\s*:\s*(?:[3-7]\d{2}|820)px\s*\)/,
    );

    expect(cssFor(narrow, ".examine-layout"))
      .toMatch(/\boverflow-y\s*:\s*auto\s*;/);
    expect(narrow.match(/\boverflow-y\s*:\s*auto\s*;/g) ?? [])
      .toHaveLength(1);
    expect(narrow).not.toContain("data-examine-template");
    expect(narrow).not.toContain(".examine-tabs");
    expect(narrow).not.toContain(".examine-tab");
    expect(narrow).not.toContain(".examine-tab-panel");
    expect(narrow).not.toContain("examine-facts-primary");
    expect(narrow).not.toContain("examine-facts-secondary");
  });
});

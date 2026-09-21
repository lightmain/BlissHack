/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexCss = readFileSync(
  new URL("../index.css", import.meta.url),
  "utf8",
);
const endgameCss = readFileSync(
  new URL("./endgame-summary.css", import.meta.url),
  "utf8",
);
const gameCss = readFileSync(
  new URL("./game.css", import.meta.url),
  "utf8",
);

/** Return all declarations attached to one exact CSS selector. */
function cssFor(source: string, selector: string): string {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) =>
      match[1].split(",").some((candidate) => candidate.trim() === selector)
    )
    .map((match) => match[2])
    .join("\n");
}

/** Return a global WebKit scrollbar rule with or without an explicit universal selector. */
function globalWebkitCssFor(suffix: string): string {
  return [
    cssFor(indexCss, `::-webkit-scrollbar${suffix}`),
    cssFor(indexCss, `*::-webkit-scrollbar${suffix}`),
  ].join("\n");
}

/** Collect custom property names and values from one declaration block. */
function customProperties(
  declarations: string,
): ReadonlyMap<string, string> {
  return new Map(
    [...declarations.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
      .map((match) => [match[1], match[2].trim()]),
  );
}

/** Find the centralized scrollbar token assigned to one visual role. */
function scrollbarToken(
  properties: ReadonlyMap<string, string>,
  role: "active" | "hover" | "size" | "thumb" | "track",
): string | undefined {
  return [...properties.keys()].find((name) => {
    if (!name.includes("scrollbar") || !name.includes(role)) return false;
    return role !== "thumb"
      || (!name.includes("hover") && !name.includes("active"));
  });
}

/** Escape one custom property name for use in a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("global scrollbar CSS contract", () => {
  it("[defect-probing] centralizes scrollbar color and size tokens on :root", () => {
    const properties = customProperties(cssFor(indexCss, ":root"));

    for (const role of ["track", "thumb", "hover", "active", "size"] as const) {
      const token = scrollbarToken(properties, role);
      expect(token, `missing :root scrollbar ${role} token`).toBeDefined();
      expect(properties.get(token ?? "")).toBeTruthy();
    }
  });

  it("[defect-probing] applies inherited Firefox and global WebKit scrollbar styles", () => {
    const root = cssFor(indexCss, ":root");
    const properties = customProperties(root);
    const trackToken = scrollbarToken(properties, "track");
    const thumbToken = scrollbarToken(properties, "thumb");
    const hoverToken = scrollbarToken(properties, "hover");
    const activeToken = scrollbarToken(properties, "active");
    const sizeToken = scrollbarToken(properties, "size");

    for (const token of [
      trackToken,
      thumbToken,
      hoverToken,
      activeToken,
      sizeToken,
    ]) {
      expect(token, "missing a required :root scrollbar token").toBeDefined();
    }

    expect(root).toMatch(/\bscrollbar-width\s*:\s*thin\s*;/);
    expect(root).toMatch(new RegExp(
      `\\bscrollbar-color\\s*:\\s*var\\(${escapeRegExp(
        thumbToken ?? "",
      )}\\)\\s+var\\(${escapeRegExp(trackToken ?? "")}\\)\\s*;`,
    ));

    const scrollbar = globalWebkitCssFor("");
    expect(scrollbar).toMatch(new RegExp(
      `\\bwidth\\s*:\\s*var\\(${escapeRegExp(sizeToken ?? "")}\\)\\s*;`,
    ));
    expect(scrollbar).toMatch(new RegExp(
      `\\bheight\\s*:\\s*var\\(${escapeRegExp(sizeToken ?? "")}\\)\\s*;`,
    ));
    expect(globalWebkitCssFor("-track")).toMatch(new RegExp(
      `\\bbackground(?:-color)?\\s*:\\s*var\\(${
        escapeRegExp(trackToken ?? "")
      }\\)\\s*;`,
    ));
    expect(globalWebkitCssFor("-thumb")).toMatch(new RegExp(
      `\\bbackground(?:-color)?\\s*:\\s*var\\(${
        escapeRegExp(thumbToken ?? "")
      }\\)\\s*;`,
    ));
    expect(globalWebkitCssFor("-thumb:hover")).toMatch(new RegExp(
      `\\bbackground(?:-color)?\\s*:\\s*var\\(${
        escapeRegExp(hoverToken ?? "")
      }\\)\\s*;`,
    ));
    expect(globalWebkitCssFor("-thumb:active")).toMatch(new RegExp(
      `\\bbackground(?:-color)?\\s*:\\s*var\\(${
        escapeRegExp(activeToken ?? "")
      }\\)\\s*;`,
    ));
  });

  it("[defect-probing] excludes Gecko from the WebKit reset branch", () => {
    expect(indexCss).toMatch(
      /@supports\s+selector\(\s*::-webkit-scrollbar\s*\)\s+and\s+\(\s*not\s+\(\s*-moz-appearance\s*:\s*none\s*\)\s*\)\s*\{/,
    );
  });

  it("[defect-probing] leaves Endgame scrollbars to the global contract", () => {
    expect(endgameCss).not.toMatch(/\bscrollbar-width\s*:/);
  });

  it("keeps the map scrollbar hidden in Firefox and WebKit", () => {
    expect(cssFor(gameCss, ".nh-map-scroll"))
      .toMatch(/\bscrollbar-width\s*:\s*none\s*;/);
    const webkitScrollbar = cssFor(
      gameCss,
      ".nh-map-scroll::-webkit-scrollbar",
    );
    expect(webkitScrollbar).toMatch(/\bwidth\s*:\s*0\s*;/);
    expect(webkitScrollbar).toMatch(/\bheight\s*:\s*0\s*;/);
  });
});

/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gameCss = readFileSync(
  new URL("./game.css", import.meta.url),
  "utf8",
);
const indexCss = readFileSync(
  new URL("../index.css", import.meta.url),
  "utf8",
);

/** Return all declarations attached to one exact CSS selector. */
function cssFor(selector: string): string {
  return [...gameCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) =>
      match[1].split(",").some((candidate) => candidate.trim() === selector)
    )
    .map((match) => match[2])
    .join("\n");
}

describe("stage-three action dock CSS", () => {
  it("contains dock overflow locally across HUD modes, renderers, 320px width, and low heights", () => {
    for (
      const selector of [
        ".nh-shell",
        ".nh-terminal",
        ".nh-hud-layout",
        ".nh-action-dock",
        ".nh-action-workspace",
        ".nh-action-grid-viewport",
      ]
    ) {
      expect(cssFor(selector), selector).toMatch(/\bmin-width\s*:\s*0\s*;/);
    }
    expect(cssFor(".nh-shell")).toMatch(/\boverflow\s*:\s*hidden\s*;/);
    expect(cssFor(".nh-terminal")).toMatch(/\boverflow\s*:\s*hidden\s*;/);
    expect(cssFor(".nh-hud-layout")).toMatch(/\boverflow\s*:\s*hidden\s*;/);
    expect(indexCss).toMatch(
      /\bbody\s*\{[^}]*\boverflow\s*:\s*hidden\s*;/s,
    );

    const gridViewport = cssFor(".nh-action-grid-viewport");
    expect(gridViewport).toMatch(/\boverflow-x\s*:\s*auto\s*;/);
    expect(gridViewport).toMatch(/\boverflow-y\s*:\s*hidden\s*;/);
    expect(cssFor(".nh-action-slot")).toMatch(
      /\baspect-ratio\s*:\s*1(?:\s*\/\s*1)?\s*;/,
    );

    const tools = cssFor(".nh-action-dock-tools");
    expect(tools).toMatch(/\bdisplay\s*:\s*flex\s*;/);
    expect(tools).toMatch(/\bflex-direction\s*:\s*column\s*;/);
    expect(tools).toMatch(/\bjustify-content\s*:\s*space-between\s*;/);
    const toolButton = cssFor(".nh-action-dock-tool");
    const width = toolButton.match(/\bwidth\s*:\s*([^;]+)\s*;/)?.[1].trim();
    const height = toolButton.match(/\bheight\s*:\s*([^;]+)\s*;/)?.[1].trim();
    expect(width).toBeTruthy();
    expect(height).toBe(width);
    expect(toolButton).toMatch(/\bborder-radius\s*:\s*50%\s*;/);

    for (
      const selector of [
        '.nh-hud-layout-right[data-action-bar-style="blisshack"]',
        '.nh-hud-layout-below[data-action-bar-style="blisshack"]',
      ]
    ) {
      const layout = cssFor(selector);
      expect(layout, selector).toMatch(/\bgrid-template-areas\s*:/);
      expect(layout).toContain("actions");
      expect(layout).toContain("map");
      expect(layout).toContain("inventory");
      expect(layout).toContain("minmax(0, 1fr)");
    }
    expect(cssFor(
      '.nh-hud-layout-below[data-action-bar-style="blisshack"][data-has-inventory="true"][data-inventory-collapsed="true"]',
    )).toMatch(
      /\bgrid-template-rows\s*:\s*auto\s+minmax\(0,\s*max-content\)\s+42px\s+auto\s*;/,
    );
    expect(cssFor(
      '.nh-hud-layout-below[data-action-bar-style="blisshack"][data-has-inventory="false"]',
    )).not.toContain("inventory");

    expect(cssFor(".nh-map-scroll")).toMatch(/\boverflow\s*:\s*auto\s*;/);
    expect(cssFor(".nh-map")).toMatch(/\bwidth\s*:\s*80ch\s*;/);
    expect(cssFor(".nh-map.nh-map-tiles"))
      .toMatch(/\bwidth\s*:\s*1280px\s*;/);

    expect(gameCss).toMatch(
      /@media\s*\(\s*max-width\s*:\s*(?:3[2-9]\d|[4-9]\d{2})px\s*\)[\s\S]*?\.nh-hud-layout-right\[data-action-bar-style="blisshack"\][\s\S]*?grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s*;/,
    );
    expect(gameCss).toMatch(
      /@media\s*\(\s*max-width\s*:\s*(?:3[2-9]\d|[4-9]\d{2})px\s*\)[\s\S]*?\.nh-hud-layout-below\[data-action-bar-style="blisshack"\][\s\S]*?grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s*;/,
    );
    expect(gameCss).toMatch(
      /@media\s*\(\s*max-height\s*:\s*\d+px\s*\)[\s\S]*?\.nh-hud-layout[\s\S]*?\boverflow-y\s*:\s*auto\s*;/,
    );
  });
});

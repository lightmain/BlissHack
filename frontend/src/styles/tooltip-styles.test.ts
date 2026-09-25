/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexCss = readFileSync(
  new URL("../index.css", import.meta.url),
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

/** Return declarations for selectors containing a tooltip and interaction state. */
function tooltipStateCss(tooltip: string, state: string): string {
  return [...gameCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) =>
      match[1].split(",").some((candidate) =>
        candidate.includes(tooltip) && candidate.includes(state)
      )
    )
    .map((match) => match[2])
    .join("\n");
}

describe("shared tooltip CSS contract", () => {
  it("defines the common tooltip appearance in the global stylesheet", () => {
    const shared = cssFor(indexCss, ".nh-tooltip");

    expect(shared).toMatch(/\bwidth\s*:\s*max-content\s*;/);
    expect(shared).toMatch(
      /\bmax-width\s*:\s*min\(28rem,\s*calc\(100vw\s*-\s*24px\)\)\s*;/,
    );
    expect(shared).toMatch(/\bpadding\s*:\s*7px\s+9px\s*;/);
    expect(shared).toMatch(/\bborder\s*:\s*1px\s+solid\s+#69747a\s*;/);
    expect(shared).toMatch(/\bborder-radius\s*:\s*3px\s*;/);
    expect(shared).toMatch(/\bbackground\s*:\s*#111517\s*;/);
    expect(shared).toMatch(/\bcolor\s*:\s*#f1f1eb\s*;/);
    expect(shared).toMatch(
      /\bbox-shadow\s*:\s*0\s+4px\s+14px\s+rgb\(0\s+0\s+0\s*\/\s*45%\)\s*;/,
    );
    expect(shared).toMatch(/\bwhite-space\s*:\s*normal\s*;/);
    expect(shared).toMatch(/\bfont-weight\s*:\s*400\s*;/);
    expect(shared).not.toMatch(
      /\b(?:position|inset|left|right|top|bottom|visibility|opacity|z-index)\s*:/,
    );
  });

  it("leaves inspect and control tooltip rules responsible for placement and visibility", () => {
    const inspect = cssFor(gameCss, ".nh-inspect-tooltip");
    const control = cssFor(gameCss, ".nh-control-tooltip");

    expect(inspect).toMatch(/\bposition\s*:\s*fixed\s*;/);
    expect(inspect).toMatch(
      /\bleft\s*:\s*var\(--overlay-left\)\s*;/,
    );
    expect(inspect).toMatch(
      /\btop\s*:\s*var\(--overlay-top\)\s*;/,
    );
    expect(cssFor(gameCss, '.nh-inspect-tooltip[aria-hidden="true"]'))
      .toMatch(/\bvisibility\s*:\s*hidden\s*;/);

    expect(control).toMatch(/\bposition\s*:\s*absolute\s*;/);
    expect(control).toMatch(/\b(?:left|right|inset-inline(?:-start|-end)?)\s*:/);
    expect(control).toMatch(/\b(?:top|bottom|inset-block(?:-start|-end)?)\s*:/);
    expect(control).toMatch(/\bvisibility\s*:\s*hidden\s*;/);
    expect(control).toMatch(/\bpointer-events\s*:\s*none\s*;/);
    expect(tooltipStateCss(".nh-control-tooltip", ":hover"))
      .toMatch(/\bvisibility\s*:\s*visible\s*;/);
    expect(tooltipStateCss(".nh-control-tooltip", ":focus"))
      .toMatch(/\bvisibility\s*:\s*visible\s*;/);

    for (const declarations of [inspect, control]) {
      expect(declarations).not.toMatch(
        /\b(?:background|border|border-radius|box-shadow|color|font-weight|max-width|padding|white-space|width)\s*:/,
      );
    }
  });

  it("[defect-probing] keeps the shared action tooltip outside layout and pointer flow", () => {
    const action = cssFor(gameCss, ".nh-action-tooltip");

    expect(action).toMatch(/\bposition\s*:\s*fixed\s*;/);
    expect(action).toMatch(/\bz-index\s*:\s*\d+\s*;/);
    expect(action).toMatch(/\bpointer-events\s*:\s*none\s*;/);
    expect(action).not.toMatch(
      /\b(?:background|border|border-radius|box-shadow|color|font-size|font-weight|max-width|padding|white-space|width)\s*:/,
    );
  });
});

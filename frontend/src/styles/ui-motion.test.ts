/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = [
  "../App.css",
  "../index.css",
  "./home.css",
  "./settings.css",
  "./game.css",
  "./endgame-summary.css",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");

/** Return all declarations attached to one exact CSS selector. */
function cssFor(selector: string): string {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) =>
      match[1].split(",").some((candidate) => candidate.trim() === selector)
    )
    .map((match) => match[2])
    .join("\n");
}

/** Return the balanced body of the first at-rule matching a prelude. */
function atRuleBody(prelude: RegExp): string {
  const match = prelude.exec(css);
  expect(match, `missing ${prelude.source} at-rule`).toBeDefined();
  const openingBrace = css.indexOf("{", match?.index ?? 0);
  let depth = 0;

  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return css.slice(openingBrace + 1, index);
  }
  return "";
}

describe("UI motion CSS contract", () => {
  it("disables nonessential motion when reduced motion is requested", () => {
    const reducedMotion = atRuleBody(
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/,
    );

    expect(reducedMotion).toMatch(
      /\banimation(?:-duration)?\s*:\s*(?:none|0(?:\.0+)?m?s)\b/,
    );
    expect(reducedMotion).toMatch(
      /\btransition(?:-duration)?\s*:\s*(?:none|0(?:\.0+)?m?s)\b/,
    );
  });

  it("gives each page phase a restrained entrance", () => {
    expect(css).toMatch(/@keyframes\s+[\w-]*page[\w-]*/i);

    for (
      const selector of [
        ".app-loading",
        ".home-screen",
        ".settings-screen",
        ".session-loading",
        ".fatal-screen",
      ]
    ) {
      expect(cssFor(selector), selector).toMatch(
        /\banimation(?:-name)?\s*:[^;]*page/i,
      );
    }
  });

  it("keeps later game stages on the local stage animation", () => {
    const stage = cssFor(".game-stage");

    expect(stage).toMatch(/\banimation(?:-name)?\s*:[^;]*game/i);
    expect(css).toMatch(/@keyframes\s+[\w-]*game[\w-]*stage[\w-]*/i);
  });

  it("permanently suppresses only the initial game stage with native transitions", () => {
    const initialStage = cssFor(
      'html[data-ui-motion-capable="true"] .game-stage[data-game-stage-initial="true"]',
    );
    const transientStage = cssFor("html[data-ui-motion] .game-stage");

    expect.soft(initialStage).toMatch(
      /\banimation(?:-name)?\s*:\s*none\b/i,
    );
    expect.soft(transientStage).not.toMatch(
      /\banimation(?:-name)?\s*:\s*none\b/i,
    );
    expect(cssFor(".game-stage")).toMatch(
      /\banimation(?:-name)?\s*:[^;]*game/i,
    );
  });

  it("uses a shared entrance contract for dialog surfaces", () => {
    expect(css).toMatch(/@keyframes\s+[\w-]*dialog[\w-]*/i);

    for (
      const selector of [
        ".save-picker-popover",
        ".settings-modal",
        ".nh-dialog",
        ".nh-secondary-dialog",
        ".nh-pause",
        ".examine-dialog",
        ".end-summary-screen",
      ]
    ) {
      expect(cssFor(selector), selector).toMatch(
        /\banimation(?:-name)?\s*:[^;]*dialog/i,
      );
    }
  });
});

/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(new URL("../App.css", import.meta.url), "utf8");
const settingsCss = readFileSync(
  new URL("./settings.css", import.meta.url),
  "utf8",
);
const css = [
  "../index.css",
  "./home.css",
  "./game.css",
  "./endgame-summary.css",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .concat(appCss, settingsCss)
  .join("\n");

/** Return all declarations attached to one exact CSS selector. */
function cssFor(selector: string, source = css): string {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) =>
      match[1].split(",").some((candidate) => candidate.trim() === selector)
    )
    .map((match) => match[2])
    .join("\n");
}

/** Return the balanced body of the first at-rule matching a prelude. */
function atRuleBody(prelude: RegExp, source = css): string {
  const match = prelude.exec(source);
  expect(match, `missing ${prelude.source} at-rule`).toBeDefined();
  const openingBrace = source.indexOf("{", match?.index ?? 0);
  let depth = 0;

  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }
  return "";
}

/** Convert one CSS time token to milliseconds. */
function durationMs(value: string, unit: string): number {
  const duration = Number(value);
  return unit.toLowerCase() === "s" ? duration * 1000 : duration;
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

  it("keeps the fixed settings footer anchored after page entrance", () => {
    const screen = cssFor(".settings-screen", settingsCss);
    const footer = cssFor(".settings-actions", settingsCss);
    const animation = /\banimation\s*:\s*([^;]+);/i.exec(screen)?.[1] ?? "";
    const animationName = [...appCss.matchAll(/@keyframes\s+([\w-]+)/g)]
      .map((match) => match[1])
      .find((name) => animation.split(/\s+/).includes(name));

    expect(screen).toMatch(/\boverflow-y\s*:\s*auto\s*;/);
    expect(animationName, "missing Settings entrance keyframes").toBeDefined();
    expect(footer).toMatch(/\bposition\s*:\s*fixed\s*;/);
    expect(footer).toMatch(/\bbottom\s*:\s*0\s*;/);
    const settingsEntrance = atRuleBody(
      new RegExp(`@keyframes\\s+${animationName}\\b`),
      appCss,
    );

    expect(settingsEntrance).toMatch(/\bopacity\s*:/);
    expect.soft(animationName).not.toBe("ui-page-enter");
    // A transform makes the scrolling screen the fixed footer's containing block.
    expect.soft(settingsEntrance).not.toMatch(/\btransform\s*:/);
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

  it("briefly transitions both inventory-driven HUD grid dimensions", () => {
    const layout = cssFor('.nh-hud-layout[data-has-inventory="true"]');
    const transitions = [...layout.matchAll(/\btransition\s*:\s*([^;]+);/gi)]
      .map((match) => match[1])
      .join(", ");

    for (
      const property of ["grid-template-columns", "grid-template-rows"]
    ) {
      const transition = new RegExp(
        `\\b${property}\\s+(\\d+(?:\\.\\d+)?)(m?s)\\b`,
        "i",
      ).exec(transitions);

      if (!transition) {
        throw new Error(`missing ${property} transition on inventory HUD`);
      }
      const milliseconds = durationMs(transition[1], transition[2]);
      expect(
        milliseconds,
        `${property} transition duration`,
      ).toBeGreaterThanOrEqual(120);
      expect(
        milliseconds,
        `${property} transition duration`,
      ).toBeLessThanOrEqual(180);
    }
  });

  it("gives expanded permanent inventory items a short entrance", () => {
    const items = cssFor(
      '.permanent-inventory-items[data-collapse-motion="enter"]',
    );
    const animation = /\banimation\s*:\s*([^;]+);/i.exec(items)?.[1] ?? "";
    const animationName =
      /\b[\w-]*inventory[\w-]*enter[\w-]*\b/i.exec(animation)?.[0] ?? "";
    const duration = /(\d+(?:\.\d+)?)(m?s)\b/i.exec(animation);

    if (!animationName) {
      throw new Error("missing permanent inventory entrance animation");
    }
    expect(css).toMatch(
      new RegExp(`@keyframes\\s+${animationName}\\b`, "i"),
    );
    if (!duration) {
      throw new Error("missing permanent inventory animation duration");
    }
    const milliseconds = durationMs(duration[1], duration[2]);
    expect(milliseconds).toBeGreaterThanOrEqual(80);
    expect(milliseconds).toBeLessThanOrEqual(180);
  });
});

/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(new URL("../App.css", import.meta.url), "utf8");
const settingsCss = readFileSync(
  new URL("./settings.css", import.meta.url),
  "utf8",
);
const homeCss = readFileSync(new URL("./home.css", import.meta.url), "utf8");
const css = [
  "../index.css",
  "./game.css",
  "./endgame-summary.css",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .concat(appCss, homeCss, settingsCss)
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

/** Count how often each coordinate occurs in an animation path. */
function coordinateCounts(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
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

  it("gives animated page phases a restrained entrance", () => {
    expect(css).toMatch(/@keyframes\s+[\w-]*page[\w-]*/i);

    for (
      const selector of [
        ".app-loading",
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

  it("keeps Home free of a local page-enter animation", () => {
    expect(cssFor(".home-screen", homeCss)).not.toMatch(
      /\banimation(?:-name)?\s*:[^;]*page/i,
    );
  });

  it("moves the loading player around eight discrete 3x3 perimeter cells", () => {
    const player = cssFor(
      ".app-loading .home-dungeon-player",
      homeCss,
    );
    const animation = /\banimation\s*:\s*([^;]+);/i.exec(player)?.[1] ?? "";
    const animationName = [...homeCss.matchAll(/@keyframes\s+([\w-]+)/g)]
      .map((match) => match[1])
      .find((name) => animation.split(/\s+/).includes(name));

    expect(animation).toMatch(/\binfinite\b/i);
    expect(animation).toMatch(
      /(?:\bstep-end\b|\bsteps\(\s*1\s*,\s*(?:end|jump-end)\s*\))/i,
    );
    expect(
      animationName,
      "missing loading-player keyframes",
    ).toBeDefined();
    if (!animationName) return;

    const keyframes = atRuleBody(
      new RegExp(`@keyframes\\s+${animationName}\\b`),
      homeCss,
    );
    const positions = [...keyframes.matchAll(
      /\btransform\s*:\s*translate\(\s*([^,\s)]+)\s*(?:,\s*|\s+)([^)\s]+)\s*\)/gi,
    )].map((match) => [match[1], match[2]] as const);
    const uniquePositions = [...new Map(
      positions.map((position) => [position.join("\u0000"), position]),
    ).values()];

    expect(uniquePositions).toHaveLength(8);
    const xCounts = coordinateCounts(uniquePositions.map(([x]) => x));
    const yCounts = coordinateCounts(uniquePositions.map(([, y]) => y));
    expect(xCounts).toHaveLength(3);
    expect(yCounts).toHaveLength(3);
    const middleX = [...xCounts].find(([, count]) => count === 2)?.[0];
    const middleY = [...yCounts].find(([, count]) => count === 2)?.[0];
    expect(middleX, "missing middle column in 3x3 path").toBeDefined();
    expect(middleY, "missing middle row in 3x3 path").toBeDefined();
    expect(uniquePositions).not.toContainEqual([middleX, middleY]);
  });

  it("does not loop the loading player under reduced motion", () => {
    const reducedMotion = atRuleBody(
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/,
    );
    const player = cssFor(
      ".app-loading .home-dungeon-player",
      reducedMotion,
    );
    const universal = cssFor("*", reducedMotion);

    expect(`${player}\n${universal}`).toMatch(
      /\banimation(?:-iteration-count)?\s*:\s*(?:none|1)\b/i,
    );
  });

  it("shares the room only during the loading-to-Home transition", () => {
    const room = cssFor(
      'html[data-ui-motion-shared="home-dungeon"] .home-dungeon',
      homeCss,
    );
    const transitionName =
      /\bview-transition-name\s*:\s*([\w-]+)\s*;/i.exec(room)?.[1];

    expect(transitionName).toBeDefined();
    expect(transitionName).not.toBe("none");
    expect(cssFor(".home-dungeon", homeCss)).not.toMatch(
      /\bview-transition-name\s*:/i,
    );
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

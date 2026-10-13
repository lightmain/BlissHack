/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const GAME_SCREEN_SOURCE = readFileSync(
  new URL("../GameScreen.tsx", import.meta.url),
  "utf8",
);
const COMPAT_CONFIG_SOURCE = readFileSync(
  new URL("../../../playwright.compat.config.ts", import.meta.url),
  "utf8",
);

/**
 * Return the stage-six preload effect without coupling to adjacent effects.
 * @returns Source for the useEffect that owns EncyclopediaLoader.preload.
 */
function preloadEffectSource(): string {
  const callIndex = GAME_SCREEN_SOURCE.indexOf("encyclopediaLoader.preload");
  expect(
    callIndex,
    "GameScreen must initiate Detailed encyclopedia manifest preload",
  ).toBeGreaterThan(-1);
  const effectStart = GAME_SCREEN_SOURCE.lastIndexOf(
    "useEffect(() => {",
    callIndex,
  );
  const effectEnd = GAME_SCREEN_SOURCE.indexOf(
    "\n  useEffect(",
    callIndex,
  );
  expect(effectStart).toBeGreaterThan(-1);
  expect(effectEnd).toBeGreaterThan(callIndex);
  return GAME_SCREEN_SOURCE.slice(effectStart, effectEnd);
}

/**
 * Reconstruct the compatibility grep from its static basic-flow names.
 * @returns Configured compatibility test-name matcher.
 */
function compatibilityGrep(): RegExp {
  const namesStart = COMPAT_CONFIG_SOURCE.indexOf(
    "const basicFlowNames = [",
  );
  const namesEnd = COMPAT_CONFIG_SOURCE.indexOf(
    '].join("|")',
    namesStart,
  );
  expect(namesStart).toBeGreaterThan(-1);
  expect(namesEnd).toBeGreaterThan(namesStart);
  const namesSource = COMPAT_CONFIG_SOURCE.slice(namesStart, namesEnd);
  const names = [...namesSource.matchAll(/^\s*"([^"]+)",?\s*$/gm)]
    .map((match) => match[1]);
  expect(names.length).toBeGreaterThan(0);
  expect(COMPAT_CONFIG_SOURCE).toContain(
    "grep: new RegExp(basicFlowNames)",
  );
  return new RegExp(names.join("|"));
}

describe("stage-six Detailed encyclopedia preload ownership", () => {
  it("starts preload only for Detailed with an active runtime loader", () => {
    const effect = preloadEffectSource();
    const guard = effect.indexOf(
      'settings.informationLevel !== "detailed"',
    );
    const loaderGuard = effect.indexOf("!encyclopediaLoader");
    const preload = effect.indexOf("encyclopediaLoader.preload");

    expect(GAME_SCREEN_SOURCE).toMatch(
      /runtimeIdentity\s*\?\s*createEncyclopediaLoader\s*\(/,
    );
    expect(guard).toBeGreaterThan(-1);
    expect(loaderGuard).toBeGreaterThan(-1);
    expect(preload).toBeGreaterThan(loaderGuard);
    expect(preload).toBeGreaterThan(guard);
  });

  it("aborts on mode, session, module, and unmount changes without leaking rejection", () => {
    const effect = preloadEffectSource();
    const dependencies = effect.match(/\},\s*\[([^\]]*)\]\);/)?.[1] ?? "";

    expect(effect).toContain("new AbortController()");
    expect(effect).toMatch(
      /encyclopediaLoader\.preload\s*\(\s*\{\s*signal:\s*controller\.signal\s*\}\s*\)/,
    );
    expect(effect).toMatch(
      /(?:encyclopediaLoader\.preload[^]*?\.catch\s*\(|try\s*\{[^]*?await\s+encyclopediaLoader\.preload[^]*?\}\s*catch(?:\s*\([^)]*\))?\s*\{)/,
    );
    expect(effect).toMatch(
      /return\s*\(\)\s*=>\s*(?:controller\.abort\(\)|\{[^]*?controller\.abort\(\)[^]*?\})/,
    );
    for (const dependency of [
      "encyclopediaLoader",
      "moduleId",
      "sessionId",
      "settings.informationLevel",
    ]) {
      expect(dependencies).toContain(dependency);
    }
  });
});

describe("stage-six Examine browser compatibility gate", () => {
  it("runs an Examine lifecycle flow in Firefox and WebKit", () => {
    expect(
      compatibilityGrep().test(
        "Examine browser lifecycle: contains keys and restores an inventory trigger",
      ),
    ).toBe(true);
  });
});

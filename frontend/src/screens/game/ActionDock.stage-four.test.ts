/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ACTION_DOCK_SOURCE = readFileSync(
  new URL("./ActionDock.tsx", import.meta.url),
  "utf8",
);
const GAME_TERMINAL_SOURCE = readFileSync(
  new URL("./GameTerminal.tsx", import.meta.url),
  "utf8",
);
const GAME_SCREEN_SOURCE = readFileSync(
  new URL("../GameScreen.tsx", import.meta.url),
  "utf8",
);
const KEYBOARD_HANDLER_SOURCE = GAME_SCREEN_SOURCE.slice(
  GAME_SCREEN_SOURCE.indexOf("function handleKeyDown"),
  GAME_SCREEN_SOURCE.indexOf(
    'window.addEventListener("keydown", handleKeyDown)',
  ),
);

describe("stage-four ActionDock execution contract", () => {
  it("sends an available catalog identity through a semantic callback", () => {
    expect(ACTION_DOCK_SOURCE).toMatch(
      /\bonActionRequest\??\s*:\s*\([^)]*\bname\b[^)]*\bsessionCommandId\b[^)]*\)\s*=>\s*void/,
    );
    expect(ACTION_DOCK_SOURCE).toMatch(
      /\bpresentation\.state\s*===\s*"available"[\s\S]*?\bonActionRequest\??\.\s*\([\s\S]*?\bname\s*:\s*presentation\.name\b[\s\S]*?\bsessionCommandId\s*:\s*presentation\.sessionCommandId\b/,
    );
    expect(GAME_TERMINAL_SOURCE).toMatch(
      /<ActionDock[\s\S]*?\bonActionRequest=\{onActionRequest\}/,
    );
    expect(GAME_SCREEN_SOURCE).toMatch(
      /\bonActionRequest[\s\S]*?\bactionController\.request\s*\(\s*\{[\s\S]*?\bkind\s*:\s*"catalog-action"[\s\S]*?\bactionName\b[\s\S]*?\bsessionCommandId\b/,
    );
  });

  it("does not translate dock actions into keyboard input", () => {
    expect(ACTION_DOCK_SOURCE).not.toMatch(
      /\b(?:import|require)[\s\S]*?\bsendKey\b/,
    );
    expect(ACTION_DOCK_SOURCE).not.toMatch(/\bsendKey\s*\(/);
  });

  it("routes active core input before the browser-keyboard control guard", () => {
    const browserControlGuard = KEYBOARD_HANDLER_SOURCE.indexOf(
      'event.target.closest("[data-browser-keyboard]")',
    );
    const cancelRoute = KEYBOARD_HANDLER_SOURCE.indexOf(
      'actionController.cancel("user-cancelled")',
    );
    const directionRoute = KEYBOARD_HANDLER_SOURCE.indexOf(
      "actionController.chooseDirection(value)",
    );

    expect(browserControlGuard).toBeGreaterThan(-1);
    expect(cancelRoute).toBeGreaterThan(-1);
    expect(directionRoute).toBeGreaterThan(-1);
    expect(cancelRoute).toBeLessThan(browserControlGuard);
    expect(directionRoute).toBeLessThan(browserControlGuard);
    expect(KEYBOARD_HANDLER_SOURCE).toMatch(
      /currentAction\.status\s*===\s*"targeting-position"[\s\S]*?\bisDirectionKey\s*\(\s*value[\s\S]*?\bsubmitActionKey\s*\(\s*value\s*\)/,
    );
    expect(browserControlGuard).toBeLessThan(
      KEYBOARD_HANDLER_SOURCE.lastIndexOf("sendKey(value)"),
    );
  });

  it("passes prefix continuation keys through the action-owned core input path", () => {
    expect(KEYBOARD_HANDLER_SOURCE).toMatch(
      /currentAction\.status\s*===\s*"waiting-prefix-continuation"[\s\S]*?\bsubmitActionKey\s*\(\s*value\s*\)/,
    );
  });
});

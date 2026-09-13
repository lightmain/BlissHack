/// <reference types="node" />

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  beginMenu,
  createWindow,
  endMenu,
  MENU_BEHAVE_PERMINV,
  NHW_PERMINVENT,
  resetGameState,
  setInventoryWindow,
} from "../../game-state";
import {
  createDefaultProfile,
  type BlissHackProfile,
  type MapRenderer,
  type MessageHistoryLines,
  type PermanentInventoryPosition,
} from "../../settings/profile";
import { FatalScreen } from "../FatalScreen";
import { GameScreen } from "../GameScreen";
import { SettingsScreen } from "../SettingsScreen";
import { PauseOverlay } from "./PauseOverlay";

const gameCss = readFileSync(
  new URL("../../styles/game.css", import.meta.url),
  "utf8",
);

interface GameRenderOptions {
  collapsed?: boolean;
  historyLines?: MessageHistoryLines;
  position?: PermanentInventoryPosition;
  renderer?: MapRenderer;
}

/** Render a game with permanent inventory available to the HUD. */
function renderGame({
  collapsed = false,
  historyLines = 5,
  position = "right",
  renderer = "tiles",
}: GameRenderOptions = {}): string {
  const profile = createDefaultProfile();
  profile.interface.mapRenderer = renderer;
  profile.interface.messageHistoryLines = historyLines;
  profile.interface.permanentInventoryPosition = position;
  profile.interface.permanentInventoryCollapsed = collapsed;
  profile.nethack.permInvent = true;
  seedPermanentInventory();
  return renderGameScreen(profile);
}

/** Render the game screen with stable session identities. */
function renderGameScreen(profile: BlissHackProfile): string {
  return renderToStaticMarkup(createElement(GameScreen, {
    loadStatus: "loaded",
    moduleId: "module-1",
    sessionId: "session-1",
    onApplyProfile: async (candidate: BlissHackProfile) => candidate,
    profile,
  }));
}

/** Publish one committed inventory snapshot with observable content. */
function seedPermanentInventory(): void {
  const windowId = createWindow(NHW_PERMINVENT);
  beginMenu(windowId, MENU_BEHAVE_PERMINV);
  endMenu(windowId, "Inventory");
  setInventoryWindow(windowId);
}

/** Count elements carrying one exact class token. */
function classTokenCount(html: string, token: string): number {
  return [...html.matchAll(/\bclass="([^"]*)"/g)]
    .filter((match) => match[1].split(/\s+/).includes(token))
    .length;
}

/** Return all declarations attached to one exact CSS selector. */
function cssFor(selector: string): string {
  return [...gameCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) =>
      match[1].split(",").some((candidate) => candidate.trim() === selector)
    )
    .map((match) => match[2])
    .join("\n");
}

describe("GameHudLayout contract", () => {
  it("statically renders one owner for all HUD regions and preserves display modes", () => {
    const pause = renderToStaticMarkup(createElement(PauseOverlay, {
      onResume: vi.fn(),
      onSaveAndExit: vi.fn(),
      onSettings: vi.fn(),
      ready: true,
    }));
    const settings = renderToStaticMarkup(createElement(SettingsScreen, {
      context: "game",
      loadStatus: "loaded",
      moduleId: "module-1",
      onApply: async (candidate: BlissHackProfile) => candidate,
      onBack: vi.fn(),
      profile: createDefaultProfile(),
    }));
    const fatal = renderToStaticMarkup(createElement(FatalScreen, {
      errorId: "BH-HUD-RED",
      hasFailedSession: true,
      onExportDiagnostics: vi.fn(),
      onReload: vi.fn(),
      onReturnHome: vi.fn(),
    }));

    expect(pause).toContain('aria-label="Game paused"');
    expect(pause).toContain('class="nh-pause"');
    expect(settings).toContain('aria-label="Back to Pause"');
    expect(settings).toContain("Current game and future defaults");
    expect(fatal).toContain("BH-HUD-RED");
    expect(fatal).toContain("Reload Application");

    const variants = [
      {
        collapsed: false,
        historyLines: 5,
        position: "right",
        renderer: "tiles",
      },
      {
        collapsed: true,
        historyLines: 3,
        position: "below",
        renderer: "ascii",
      },
    ] as const;

    for (const { collapsed, historyLines, position, renderer } of variants) {
      resetGameState();
      const html = renderGame({
        collapsed,
        historyLines,
        position,
        renderer,
      });

      expect(classTokenCount(html, "nh-hud-layout")).toBe(1);
      expect(
        html.match(/data-layout-owner="GameHudLayout"/g) ?? [],
      ).toHaveLength(1);
      for (
        const region of ["messages", "map", "inventory", "status", "actions"]
      ) {
        expect(
          html.match(new RegExp(`data-hud-region="${region}"`, "g")) ?? [],
        ).toHaveLength(1);
      }
      for (const region of ["messages", "map", "inventory", "status"]) {
        expect(
          html.match(new RegExp(`data-overflow-owner="${region}"`, "g")) ?? [],
        ).toHaveLength(1);
      }
      expect(html).not.toContain("nh-header");
      expect(html).toContain(`nh-hud-layout-${position}`);
      expect(html).toContain(`data-inventory-position="${position}"`);
      expect(html).toContain(`nh-messages-${historyLines}`);
      expect(html).toContain("nh-map-ascii");
      expect(html.includes("nh-map-fallback")).toBe(renderer === "tiles");
      expect(html.includes("permanent-inventory-collapsed"))
        .toBe(collapsed);
      expect(html).toMatch(
        /<([a-z]+)(?=[^>]*\bclass="[^"]*\bnh-hud-action-slot\b[^"]*")(?=[^>]*\bdata-hud-region="actions")[^>]*><\/\1>/,
      );
    }
  });

  it("defines the grid, empty action slot, and unique overflow-owner CSS", () => {
    const base = cssFor(".nh-hud-layout");
    const right = cssFor(".nh-hud-layout-right");
    const below = cssFor(".nh-hud-layout-below");

    expect(base).toMatch(/\bdisplay\s*:\s*grid\s*;/);
    expect(base).toMatch(/\bmin-height\s*:\s*0\s*;/);
    expect(base).toMatch(/\bmin-width\s*:\s*0\s*;/);
    for (const layout of [right, below]) {
      expect(layout).toMatch(/\bgrid-template-areas\s*:/);
      expect(layout).toMatch(/\bgrid-template-columns\s*:/);
      for (
        const region of ["messages", "map", "inventory", "status", "actions"]
      ) {
        expect(layout).toContain(region);
      }
    }
    expect(right).toContain("minmax(0, 1fr)");
    expect(below).toContain("minmax(0, 1fr)");
    expect(cssFor(".nh-hud-action-slot:empty"))
      .toMatch(/\bdisplay\s*:\s*none\s*;/);
    expect(cssFor(
      '.nh-hud-layout-below[data-inventory-collapsed="true"]',
    )).toContain("42px");
    expect(cssFor(".nh-messages-3")).toContain("3.45em + 13px");
    expect(cssFor(".nh-messages-5")).toContain("5.75em + 13px");

    const owners = {
      inventory: ".permanent-inventory",
      map: ".nh-map-scroll",
      messages: ".nh-messages",
      status: ".nh-hud-status-region",
    } as const;

    for (const selector of Object.values(owners)) {
      expect(cssFor(selector))
        .toMatch(/\boverflow\s*:\s*(?:auto|hidden)\s*;/);
    }
  });
});

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
  inventoryEnabled?: boolean;
  position?: PermanentInventoryPosition;
  renderer?: MapRenderer;
}

/** Render a game with permanent inventory available to the HUD. */
function renderGame({
  collapsed = false,
  historyLines = 5,
  inventoryEnabled = true,
  position = "right",
  renderer = "tiles",
}: GameRenderOptions = {}): string {
  const profile = createDefaultProfile();
  profile.interface.mapRenderer = renderer;
  profile.interface.messageHistoryLines = historyLines;
  profile.interface.permanentInventoryPosition = position;
  profile.interface.permanentInventoryCollapsed = collapsed;
  profile.nethack.permInvent = inventoryEnabled;
  if (inventoryEnabled) seedPermanentInventory();
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
    expect(right).toContain('"messages inventory"');
    expect(right).toContain('"map inventory"');
    expect(right).toContain('"status inventory"');
    expect(below).toContain('"messages messages"');
    expect(below).toContain('"map map"');
    expect(below).toContain('"status inventory"');
    expect(below).toMatch(
      /\bgrid-template-rows\s*:\s*auto\s+minmax\(0,\s*max-content\)\s+minmax\(11rem,\s*1fr\)\s+0\s*;/,
    );
    expect(below).toMatch(
      /\bgrid-template-columns\s*:\s*clamp\(10rem,\s*28%,\s*22rem\)\s+minmax\(0,\s*1fr\)\s*;/,
    );
    expect(below).toMatch(/\boverflow-y\s*:\s*auto\s*;/);
    expect(cssFor(".nh-hud-layout-below .nh-map-scroll"))
      .toMatch(/\bjustify-items\s*:\s*safe center\s*;/);
    expect(cssFor(".nh-hud-action-slot:empty"))
      .toMatch(/\bdisplay\s*:\s*none\s*;/);
    expect(cssFor(
      '.nh-hud-layout-below[data-has-inventory="true"][data-inventory-collapsed="true"]',
    )).toMatch(
      /\bgrid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+42px\s*;/,
    );
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

  it("[defect-probing] defines distinct long and short right-side topologies", () => {
    const rightLong = cssFor(".nh-hud-layout-right");
    const rightShort = cssFor(".nh-hud-layout-right-short");
    const rightShortBlissHack = cssFor(
      '.nh-hud-layout-right-short[data-action-bar-style="blisshack"]',
    );

    expect(rightLong).toContain('"messages inventory"');
    expect(rightLong).toContain('"map inventory"');
    expect(rightLong).toContain('"status inventory"');
    expect(rightLong).toContain('"actions inventory"');

    expect(rightShort).toContain('"messages inventory"');
    expect(rightShort).toContain('"map inventory"');
    expect(rightShort).toContain('"status status"');
    expect(rightShort).toContain('"actions actions"');
    expect(rightShort).toMatch(
      /\bgrid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+clamp\(22rem,\s*42vw,\s*38rem\)\s*;/,
    );

    expect(rightShortBlissHack).toContain('"messages inventory"');
    expect(rightShortBlissHack).toContain('"map inventory"');
    expect(rightShortBlissHack).toContain('"actions actions"');

    const html = renderGame({
      position: "right-short" as PermanentInventoryPosition,
    });
    expect(html).toContain("nh-hud-layout-right-short");
    expect(html).toContain('data-inventory-position="right-short"');
  });

  it("does not reserve a collapsed track when permanent inventory is disabled", () => {
    resetGameState();
    const html = renderGame({
      collapsed: true,
      inventoryEnabled: false,
      position: "below",
    });

    expect(html).toContain('data-has-inventory="false"');
    expect(html).toContain('data-inventory-collapsed="true"');
    expect(html).not.toContain('data-hud-region="inventory"');
    expect(cssFor(
      '.nh-hud-layout-below[data-has-inventory="false"]',
    )).toMatch(/\bgrid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s*;/);
  });

  it("suppresses the browser outline on the programmatic map focus target", () => {
    expect(cssFor(".nh-map-interaction"))
      .toMatch(/\boutline\s*:\s*(?:0|none)\s*;/);
  });

  it("uses the fixed overlay layer instead of revealing inline status tooltips", () => {
    const statusGroup = cssFor(".nh-status-group");
    const statusConditions = cssFor(".nh-status-conditions");
    const hiddenStatusText = cssFor(".nh-status-tooltip");
    const overlayRoot = cssFor(".nh-overlay-root");
    const inspectTooltip = cssFor(".nh-inspect-tooltip");

    expect(statusGroup).toMatch(/\bflex-wrap\s*:\s*wrap\s*;/);
    expect(statusGroup).not.toMatch(/\boverflow\s*:\s*hidden\s*;/);
    expect(statusConditions).toMatch(/\bflex-wrap\s*:\s*wrap\s*;/);
    expect(statusConditions).toMatch(/\bmax-width\s*:\s*100%\s*;/);
    expect(statusConditions).not.toMatch(/\boverflow\s*:\s*hidden\s*;/);

    expect(hiddenStatusText).toMatch(/\bwidth\s*:\s*1px\s*;/);
    expect(hiddenStatusText).toMatch(/\bheight\s*:\s*1px\s*;/);
    expect(hiddenStatusText).toMatch(/\boverflow\s*:\s*hidden\s*;/);
    expect(hiddenStatusText).toMatch(/\bclip\s*:\s*rect\(0 0 0 0\)\s*;/);

    expect(overlayRoot).toMatch(/\bposition\s*:\s*fixed\s*;/);
    expect(overlayRoot).toMatch(/\binset\s*:\s*0\s*;/);
    expect(overlayRoot).toMatch(/\bpointer-events\s*:\s*none\s*;/);
    expect(inspectTooltip).toMatch(/\bposition\s*:\s*fixed\s*;/);
    expect(inspectTooltip).toMatch(
      /\bleft\s*:\s*var\(--overlay-left\)\s*;/,
    );
    expect(inspectTooltip).toMatch(
      /\btop\s*:\s*var\(--overlay-top\)\s*;/,
    );
    expect(inspectTooltip).not.toMatch(/\bpointer-events\s*:\s*(?:auto|all)\s*;/);
    expect(inspectTooltip).not.toMatch(/\bvisibility\s*:\s*hidden\s*;/);
    expect(cssFor('.nh-inspect-tooltip[aria-hidden="true"]'))
      .toMatch(/\bvisibility\s*:\s*hidden\s*;/);

    for (
      const legacySelector of [
        ".nh-status-metric:hover .nh-status-tooltip",
        ".nh-status-metric:focus .nh-status-tooltip",
        ".nh-status-metric:focus-within .nh-status-tooltip",
        ".nh-status-condition-entry:hover .nh-status-tooltip",
        ".nh-status-condition-entry:focus .nh-status-tooltip",
        ".nh-status-condition-entry:focus-within .nh-status-tooltip",
      ]
    ) {
      expect(cssFor(legacySelector)).toBe("");
    }
  });
});

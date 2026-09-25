/// <reference types="node" />

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  diffActionBarLayouts,
  parseActionBarLayoutImport,
  serializeActionBarLayoutExport,
  validateActionBarLayout,
} from "../../action-bar/action-bar-layout";
import { buildActionPresentations } from "../../action-bar/action-catalog-metadata";
import { parseBackupImport, serializeBackup } from "../../backup/backup-file";
import {
  beginMenu,
  createWindow,
  endMenu,
  MENU_BEHAVE_PERMINV,
  NHW_PERMINVENT,
  resetGameState,
  setCommandInput,
  setInventoryWindow,
  setRuntimePhase,
} from "../../game-state";
import {
  decodeActionCatalog,
  type ActionCatalogEntry,
} from "../../game-actions/action-catalog";
import {
  createDefaultProfile,
  validateProfile,
  type BlissHackProfile,
  type MapRenderer,
} from "../../settings/profile";
import { GameScreen } from "../GameScreen";
import { ActionDock } from "./ActionDock";

const ACTION_DOCK_SOURCE = readFileSync(
  new URL("./ActionDock.tsx", import.meta.url),
  "utf8",
);
const ALL_ACTIONS_PANEL_SOURCE = readOptionalSource(
  new URL("./AllActionsPanel.tsx", import.meta.url),
);
const GAME_SCREEN_SOURCE = readFileSync(
  new URL("../GameScreen.tsx", import.meta.url),
  "utf8",
);
const GAME_TERMINAL_SOURCE = readFileSync(
  new URL("./GameTerminal.tsx", import.meta.url),
  "utf8",
);
const GAME_CSS_SOURCE = readFileSync(
  new URL("../../styles/game.css", import.meta.url),
  "utf8",
);
const LAYOUT_PERSISTENCE_SOURCE = GAME_SCREEN_SOURCE.slice(
  GAME_SCREEN_SOURCE.indexOf("async function setActionBarLayout"),
  GAME_SCREEN_SOURCE.indexOf(
    "const onActionRequest",
    GAME_SCREEN_SOURCE.indexOf("async function setActionBarLayout"),
  ),
);
const INDEX_CSS_SOURCE = readFileSync(
  new URL("../../index.css", import.meta.url),
  "utf8",
);
const EXPECTED_SECTIONS = [
  "common",
  "gear",
  "magic",
  "items",
  "explore",
  "info",
  "system",
] as const;

vi.mock("../../map/MapViewport", async () => {
  const { createElement: createReactElement } = await import("react");
  return {
    MapViewport({ mapRenderer }: { mapRenderer: MapRenderer }) {
      return createReactElement("div", {
        className: `nh-map-scroll nh-map-${mapRenderer}`,
        "data-hud-region": "map",
      });
    },
  };
});

/** Read an implementation planned for this stage without breaking collection. */
function readOptionalSource(url: URL): string {
  try {
    return readFileSync(url, "utf8");
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return "";
    }
    throw error;
  }
}

/** Render the BlissHack action dock with every content region present. */
function renderActionDock(): string {
  const profile = createDefaultProfile();
  profile.interface.actionBarStyle = "blisshack";
  profile.nethack.permInvent = true;
  return renderToStaticMarkup(createElement(GameScreen, {
    loadStatus: "loaded",
    moduleId: "module-stage-six",
    sessionId: "session-stage-six",
    onApplyProfile: async (candidate: BlissHackProfile) => candidate,
    profile,
  }));
}

/** Publish the smallest permanent-inventory snapshot needed by the HUD. */
function seedPermanentInventory(): void {
  const windowId = createWindow(NHW_PERMINVENT);
  beginMenu(windowId, MENU_BEHAVE_PERMINV);
  endMenu(windowId, "Inventory");
  setInventoryWindow(windowId);
}

/** Load the reviewed 104-action fixture without duplicating catalog names. */
function baselineActions(): Array<{
  category: (typeof EXPECTED_SECTIONS)[number];
  key: string;
  name: string;
}> {
  const prototype = readFileSync(
    new URL(
      "../../../../doc/BlissHack/prototypes/alpha-2.3-action-bar.html",
      import.meta.url,
    ),
    "utf8",
  );
  const match = prototype.match(
    /<script type="application\/json" id="action-bar-config">\s*([\s\S]*?)\s*<\/script>/,
  );
  if (!match) throw new Error("Missing reviewed action-bar-config baseline");
  return (JSON.parse(match[1]) as {
    catalog: ReturnType<typeof baselineActions>;
  }).catalog;
}

/** Reconstruct one validated session catalog from the reviewed fixture. */
function actionCatalogFixture() {
  const commands: ActionCatalogEntry[] = baselineActions().map(
    ({ key, name }, sessionCommandId) => ({
      defaultKey: key === `#${name}` ? 0 : key.charCodeAt(0),
      flags: name === "toggle" ? 0x4000 : 0x0008,
      name,
      sessionCommandId,
    }),
  );
  return decodeActionCatalog(
    { schemaVersion: 1, commands },
    { moduleId: "module-stage-six", sessionId: "session-stage-six" },
  );
}

/** Render the dock and optional catalog panel in one shared tooltip scope. */
function renderActionSurfaces(allActionsOpen: boolean): string {
  const profile = createDefaultProfile();
  return renderToStaticMarkup(createElement(ActionDock, {
    allActionsOpen,
    blocked: false,
    catalog: actionCatalogFixture(),
    input: null,
    layout: profile.interface.actionBarLayout,
    onAllActionsOpenChange: () => undefined,
    sessionKey: "session-stage-six",
    status: null,
  }));
}

/** Return one action button opening tag by class and catalog name. */
function actionButtonTag(
  html: string,
  className: string,
  actionName: string,
): string {
  return [...html.matchAll(/<button\b[^>]*>/g)]
    .find((match) =>
      match[0].includes(`class="${className}"`)
      && match[0].includes(`data-action-name="${actionName}"`)
    )?.[0] ?? "";
}

beforeEach(() => {
  resetGameState();
  setRuntimePhase("running");
  setCommandInput(true);
  seedPermanentInventory();
});

describe("stage-six All Actions shell contract", () => {
  it("[defect-probing] shares one accessible action tooltip across dock and catalog actions", () => {
    const html = renderActionSurfaces(true);
    const dockAction = actionButtonTag(html, "nh-action-slot", "eat");
    const panelAction = actionButtonTag(
      html,
      "nh-all-actions-slot",
      "eat",
    );
    const tooltipMatches = [...html.matchAll(
      /<([a-z]+)(?=[^>]*\bid="action-hover-tooltip")(?=[^>]*\brole="tooltip")([^>]*)>([\s\S]*?)<\/\1>/g,
    )];

    for (const action of [dockAction, panelAction]) {
      expect(action).not.toBe("");
      expect(action).not.toContain("title=");
      expect(action).not.toContain("aria-describedby=");
    }
    expect(tooltipMatches).toHaveLength(1);
    const tooltip = tooltipMatches[0];
    expect(tooltip?.[1]).toBe("div");
    expect(tooltip?.[2].match(/\bclass="([^"]+)"/)?.[1].split(/\s+/))
      .toEqual(expect.arrayContaining(["nh-tooltip", "nh-action-tooltip"]));
    expect(tooltip?.[2]).not.toMatch(/\btabindex=/);
    expect(tooltip?.[3]).toMatch(/<strong>[\s\S]*<\/strong>/);
    expect(tooltip?.[3]).toMatch(/<kbd>[\s\S]*<\/kbd>/);
    expect(tooltip?.[3]).not.toMatch(
      /<(?:a|button|input|select|textarea)\b/,
    );
  });

  it("[defect-probing] renders seven vertical sections and all 104 catalog actions", () => {
    const presentations = buildActionPresentations(
      actionCatalogFixture(),
      { blocked: false },
    );
    const grouped = Object.fromEntries(EXPECTED_SECTIONS.map((category) => [
      category,
      presentations.filter((action) => action.category === category).length,
    ]));

    expect(presentations).toHaveLength(104);
    expect(grouped).toEqual({
      common: 11,
      gear: 19,
      magic: 10,
      items: 11,
      explore: 21,
      info: 14,
      system: 18,
    });
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain("buildActionPresentations");
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain("data-all-actions-panel");
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain("data-all-actions-section");
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain("data-action-name");
  });

  it("[defect-probing] exposes one stateful dialog trigger from the dock", () => {
    const html = renderActionDock();
    const trigger = html.match(
      /<button(?=[^>]*aria-label="All Actions")[^>]*>/,
    )?.[0];

    expect(trigger).toBeDefined();
    expect(trigger).toContain('aria-haspopup="dialog"');
    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).toMatch(/\baria-controls="[^"]+"/);
  });

  it("[defect-probing] keeps a nonmodal scroll panel above rather than over the dock", () => {
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain('data-fullscreen="false"');
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain(
      'data-layout="vertical-sections"',
    );
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain(
      'data-overlap-action-dock="false"',
    );
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain("data-browser-keyboard");
    expect(ALL_ACTIONS_PANEL_SOURCE).not.toMatch(
      /\baria-modal=(?:"true"|\{"true"\})/,
    );
    expect(ALL_ACTIONS_PANEL_SOURCE).toMatch(
      /querySelector<HTMLElement>\s*\(\s*"\[data-action-dock\]"/,
    );
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain("ResizeObserver");
    expect(GAME_CSS_SOURCE).toMatch(
      /\.nh-all-actions-(?:panel|sections)\s*\{[^}]*overflow-y\s*:\s*auto\s*;/,
    );
    expect(INDEX_CSS_SOURCE).toMatch(/\*::-(?:webkit-)?scrollbar/);
  });

  it("[defect-probing] separates inert game content from the interactive bottom region", () => {
    const html = renderActionDock();
    const gameContent = html.indexOf('data-game-content="true"');
    const messages = html.indexOf('data-hud-region="messages"');
    const map = html.indexOf('data-hud-region="map"');
    const inventory = html.indexOf('data-hud-region="inventory"');
    const bottomRegion = html.indexOf('data-bottom-region="true"');
    const dock = html.indexOf("data-action-dock");

    expect(gameContent).toBeGreaterThan(-1);
    expect(messages).toBeGreaterThan(gameContent);
    expect(map).toBeGreaterThan(gameContent);
    expect(inventory).toBeGreaterThan(gameContent);
    expect(bottomRegion).toBeGreaterThan(inventory);
    expect(dock).toBeGreaterThan(bottomRegion);
    expect(GAME_TERMINAL_SOURCE).toMatch(
      /data-game-content[\s\S]*?\binert=\{[^}]*allActions[^}]*\}/,
    );
    expect(GAME_TERMINAL_SOURCE).not.toMatch(
      /className="nh-terminal"\s+inert=\{[^}]*allActions/,
    );
    expect(GAME_CSS_SOURCE).toMatch(
      /\[data-all-actions-open="true"\][^{]*\[data-game-content\][^{]*\{[^}]*opacity\s*:/,
    );
  });

  it("[defect-probing] keeps panel and dock in one focus and drag interaction scope", () => {
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain(
      'data-action-drop-zone="all-actions"',
    );
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain(
      'kind: "all-actions"',
    );
    expect(ALL_ACTIONS_PANEL_SOURCE).toMatch(
      /\bonPointerDown\b[\s\S]*?\bonPointerMove\b[\s\S]*?\bonPointerUp\b/,
    );
    expect(ACTION_DOCK_SOURCE).toContain(
      'closest("[data-action-drop-zone=\\"all-actions\\"]")',
    );
    expect(GAME_SCREEN_SOURCE).toMatch(
      /(?:panel|allActions)[\s\S]*?(?:dock|ActionDock)[\s\S]*?\bTab\b/i,
    );
  });

  it("[defect-probing] isolates browser keys, restores focus, and closes before one action request", () => {
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain('event.key === "Escape"');
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain("event.preventDefault()");
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain("event.stopPropagation()");
    expect(ALL_ACTIONS_PANEL_SOURCE).toMatch(/\btriggerRef\b[\s\S]*?\.focus\s*\(/);
    expect(ALL_ACTIONS_PANEL_SOURCE).toMatch(
      /\bonClose\s*\(\s*\)[\s\S]*?\bonActionRequest\??\s*\(/,
    );
    expect(ACTION_DOCK_SOURCE).toContain("data-browser-keyboard");
    expect(GAME_SCREEN_SOURCE).toContain(
      'event.target.closest("[data-browser-keyboard]")',
    );
  });

  it("[defect-probing] previews and atomically imports only .bhactions layout state", async () => {
    const current = createDefaultProfile();
    current.interface.actionBarStyle = "blisshack";
    current.interface.mapRenderer = "ascii";
    current.interface.followPlayer = false;
    current.nethack.autopickup = false;
    const incoming = validateActionBarLayout({
      ...current.interface.actionBarLayout,
      activeCategory: "custom",
      locked: false,
      rows: 3,
      categories: {
        ...current.interface.actionBarLayout.categories,
        custom: ["wait", null, "future-action"],
      },
    });
    const document = parseActionBarLayoutImport(
      new TextEncoder().encode(serializeActionBarLayoutExport(incoming)),
    );

    expect(diffActionBarLayouts(
      current.interface.actionBarLayout,
      document.actionBarLayout,
    ).map(({ label }) => label)).toEqual([
      "Rows",
      "Active category",
      "Layout lock",
      "Slots",
    ]);
    const imported = validateProfile({
      ...current,
      interface: {
        ...current.interface,
        actionBarLayout: document.actionBarLayout,
      },
    });
    expect(imported.interface.actionBarLayout).toEqual(incoming);
    expect(imported.interface.actionBarStyle).toBe("blisshack");
    expect(imported.interface.mapRenderer).toBe("ascii");
    expect(imported.interface.followPlayer).toBe(false);
    expect(imported.nethack.autopickup).toBe(false);

    const backup = await serializeBackup(
      imported,
      [],
      "alpha-2.3",
      "stage-six-test",
      new Date("2026-09-24T00:00:00.000Z"),
    );
    await expect(parseBackupImport(new TextEncoder().encode(backup)))
      .resolves.toMatchObject({ profile: imported });

    const beforeInvalid = structuredClone(imported);
    expect(() => parseActionBarLayoutImport(
      new TextEncoder().encode("{bad"),
    )).toThrow();
    expect(imported).toEqual(beforeInvalid);

    expect(ALL_ACTIONS_PANEL_SOURCE).toContain(".bhactions");
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain(
      "serializeActionBarLayoutExport",
    );
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain(
      "parseActionBarLayoutImport",
    );
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain("diffActionBarLayouts");
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain("Cancel");
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain("Import");
    expect(ALL_ACTIONS_PANEL_SOURCE).not.toContain("localStorage");
  });

  it("[defect-probing] blocks action races and preserves unrelated persisted fields", () => {
    expect(ACTION_DOCK_SOURCE).toContain("layoutEditBlocksActions");
    expect(ACTION_DOCK_SOURCE).toMatch(
      /\["pending",\s*"dragging",\s*"committing"\][\s\S]*?controller\.getState\(\)\.status/,
    );
    expect(ALL_ACTIONS_PANEL_SOURCE).toContain(
      "restoreTriggerFocusRef.current = false",
    );
    expect(ALL_ACTIONS_PANEL_SOURCE).toMatch(
      /setImportError\(null\);\s*setPreview\(null\);\s*if \(!file\.name/,
    );
    expect(LAYOUT_PERSISTENCE_SOURCE).toMatch(
      /\.\.\.profile,[\s\S]*?\.\.\.profile\.interface,[\s\S]*?actionBarLayout/,
    );
    expect(LAYOUT_PERSISTENCE_SOURCE).not.toContain("...gameProfile");
  });
});

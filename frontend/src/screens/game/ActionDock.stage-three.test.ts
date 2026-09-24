/// <reference types="node" />

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushStatus,
  resetGameState,
  setCommandInput,
  setInputRequest,
  setRuntimePhase,
  setStatusFieldMetadata,
  setStatusValue,
} from "../../game-state";
import {
  createDefaultProfile,
  type ActionBarStyle,
  type MapRenderer,
  type PermanentInventoryPosition,
} from "../../settings/profile";
import { GameScreen } from "../GameScreen";

const GAME_CSS_SOURCE = readFileSync(
  new URL("../../styles/game.css", import.meta.url),
  "utf8",
);

vi.mock("../../map/MapViewport", async () => {
  const { createElement: createReactElement } = await import("react");
  return {
    MapViewport({
      layoutKey,
      mapRenderer,
    }: {
      layoutKey: string;
      mapRenderer: MapRenderer;
    }) {
      return createReactElement("div", {
        className: `nh-map-scroll nh-map-${mapRenderer}`,
        "data-hud-region": "map",
        "data-map-layout-key": layoutKey,
        "data-map-renderer": mapRenderer,
        "data-overflow-owner": "map",
      });
    },
  };
});

const EXPECTED_TABS = [
  "all",
  "common",
  "gear",
  "magic",
  "items",
  "explore",
  "custom",
];
const EXPECTED_SECTIONS = ["common", "gear", "magic", "items"];
const EXPECTED_DEFAULT_ACTIONS = [
  "eat",
  "quaff",
  "kick",
  "search",
  "wield",
  "wear",
  "puton",
  "takeoff",
  "remove",
  "swap",
  "cast",
  "zap",
  "read",
  "fire",
  "throw",
  "quiver",
  "apply",
  "engrave",
  "dip",
  "loot",
  "tip",
  "rub",
];

/** Return all current action names from the reviewed prototype baseline. */
function baselineActionNames(): string[] {
  const html = readFileSync(
    new URL(
      "../../../../doc/BlissHack/prototypes/alpha-2.3-action-bar.html",
      import.meta.url,
    ),
    "utf8",
  );
  const match = html.match(
    /<script type="application\/json" id="action-bar-config">\s*([\s\S]*?)\s*<\/script>/,
  );
  if (!match) throw new Error("Missing reviewed action-bar-config baseline");
  const config = JSON.parse(match[1]) as {
    catalog: Array<{ name: string }>;
  };
  return config.catalog.map(({ name }) => name);
}

/** Install a complete session catalog without invoking any command path. */
function installCatalog(): void {
  globalThis.nethackGlobal = {
    actionCatalog: {
      schemaVersion: 1,
      commands: baselineActionNames().map((name, sessionCommandId) => ({
        sessionCommandId,
        name,
        defaultKey: 0,
        flags: name === "toggle" ? 0x4000 : 0x0008,
      })),
    },
  };
}

/** Seed one visible status metric and one unique prompt. */
function seedHudState(): void {
  resetGameState();
  setRuntimePhase("running");
  setCommandInput(true);
  setStatusFieldMetadata(18, {
    enabled: true,
    format: "HP:%d (%d)",
    name: "hitpoints",
  });
  setStatusValue(18, {
    attributes: 0,
    change: 0,
    color: 7,
    conditionColors: [],
    percent: 75,
    text: "HP:12 (16)",
  });
  flushStatus();
  setInputRequest({
    acceptedCode: 27,
    kind: "message",
    message: "Stage three input prompt",
  });
}

/** Render one profile through the production GameScreen and GameTerminal. */
function renderGame(options: {
  position: PermanentInventoryPosition;
  renderer: MapRenderer;
  rows: 1 | 2 | 3 | 4;
  style: ActionBarStyle;
}): string {
  const profile = createDefaultProfile();
  profile.interface.actionBarStyle = options.style;
  profile.interface.actionBarLayout.rows = options.rows;
  profile.interface.mapRenderer = options.renderer;
  profile.interface.messageHistoryLines = 5;
  profile.interface.permanentInventoryPosition = options.position;
  return renderToStaticMarkup(createElement(GameScreen, {
    loadStatus: "loaded",
    moduleId: "module-stage-three",
    sessionId: "session-stage-three",
    onApplyProfile: async () => profile,
    profile,
  }));
}

/** Return all opening tags which carry one data attribute. */
function tagsWithAttribute(html: string, attribute: string): string[] {
  return html.match(
    new RegExp(
      `<[^>]+\\b${attribute}(?:(?:="[^"]*")|(?=\\s|>))[^>]*>`,
      "g",
    ),
  ) ?? [];
}

/** Read one quoted attribute from an opening tag. */
function attribute(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
}

/** Count elements carrying one exact class token. */
function classTokenCount(html: string, token: string): number {
  return [...html.matchAll(/\bclass="([^"]*)"/g)]
    .filter((match) => match[1].split(/\s+/).includes(token))
    .length;
}

beforeEach(() => {
  installCatalog();
  seedHudState();
});

describe("stage-three ActionDock and GameTerminal structure", () => {
  it("renders one BlissHack bottom branch and leaves Original without a dock", () => {
    for (
      const [position, renderer] of [
        ["right", "tiles"],
        ["below", "ascii"],
      ] as const
    ) {
      const html = renderGame({
        position,
        renderer,
        rows: 4,
        style: "blisshack",
      });

      expect(tagsWithAttribute(html, "data-action-dock")).toHaveLength(1);
      expect(classTokenCount(html, "nh-status")).toBe(1);
      expect(html.match(/Stage three input prompt/g) ?? []).toHaveLength(1);
      expect(tagsWithAttribute(html, "data-dock-region")
        .map((tag) => attribute(tag, "data-dock-region")))
        .toEqual(["status", "input"]);
      expect(html).toContain("data-browser-keyboard");
      expect(html).toContain(`nh-hud-layout-${position}`);
      expect(html).toContain(`data-map-renderer="${renderer}"`);

      expect(tagsWithAttribute(html, "data-action-category")
        .map((tag) => attribute(tag, "data-action-category")))
        .toEqual(EXPECTED_TABS);
      expect(tagsWithAttribute(html, "data-action-section")
        .map((tag) => attribute(tag, "data-action-section")))
        .toEqual(EXPECTED_SECTIONS);
      expect(tagsWithAttribute(html, "data-action-name")
        .map((tag) => attribute(tag, "data-action-name")))
        .toEqual(EXPECTED_DEFAULT_ACTIONS);
      expect(tagsWithAttribute(html, "data-empty-action-slot").length)
        .toBeGreaterThan(0);

      const toolLabels = tagsWithAttribute(html, "data-action-dock-tool")
        .map((tag) => attribute(tag, "aria-label"));
      expect(toolLabels).toEqual([
        "Decrease rows",
        "Increase rows",
        "Unlock action bar",
        "All Actions",
      ]);

      const dividers = tagsWithAttribute(html, "data-section-divider");
      expect(dividers).toHaveLength(3);
      expect(dividers.every((tag) =>
        attribute(tag, "data-snap") === "column"
        && attribute(tag, "data-preview-only") === "true"
      )).toBe(true);

      const layoutKey = attribute(
        tagsWithAttribute(html, "data-map-layout-key")[0] ?? "",
        "data-map-layout-key",
      );
      expect(layoutKey?.split(":")).toContain("blisshack");
      expect(layoutKey?.split(":")).toContain("4");
    }

    const stableProfile = createDefaultProfile();
    stableProfile.interface.actionBarStyle = "blisshack";
    stableProfile.interface.actionBarLayout.all[0].slots = [
      "search",
      null,
      "future-command",
      "toggle",
    ];
    const stableHtml = renderToStaticMarkup(createElement(GameScreen, {
      loadStatus: "loaded",
      moduleId: "module-stage-three",
      sessionId: "session-stage-three",
      onApplyProfile: async () => stableProfile,
      profile: stableProfile,
    }));
    const firstFourSlots = tagsWithAttribute(stableHtml, "data-action-slot")
      .slice(0, 4);
    expect(firstFourSlots.map((tag) => ({
      index: attribute(tag, "data-slot-index"),
      name: attribute(tag, "data-action-name"),
      state: attribute(tag, "data-action-state"),
    }))).toEqual([
      { index: "0", name: "search", state: "available" },
      { index: "1", name: null, state: "empty" },
      { index: "2", name: "future-command", state: "unavailable" },
      { index: "3", name: "toggle", state: "unavailable" },
    ]);

    const original = renderGame({
      position: "right",
      renderer: "tiles",
      rows: 1,
      style: "original",
    });
    expect(tagsWithAttribute(original, "data-action-dock")).toHaveLength(0);
    expect(tagsWithAttribute(original, "data-action-category")).toHaveLength(0);
    expect(tagsWithAttribute(original, "data-action-dock-tool")).toHaveLength(0);
    expect(classTokenCount(original, "nh-status")).toBe(1);
    expect(original.match(/Stage three input prompt/g) ?? []).toHaveLength(1);
    const originalLayoutKey = attribute(
      tagsWithAttribute(original, "data-map-layout-key")[0] ?? "",
      "data-map-layout-key",
    );
    expect(originalLayoutKey?.split(":")).toContain("original");
    expect(originalLayoutKey?.split(":")).toContain("1");
  });

  it("[defect-probing] fills each All section vertically by column", () => {
    const sectionRule = GAME_CSS_SOURCE.match(
      /\.nh-action-section\s*\{([^}]*)\}/,
    )?.[1];

    expect(sectionRule).toBeDefined();
    expect(sectionRule).toMatch(/\bgrid-auto-flow\s*:\s*column\s*;/);
    expect(sectionRule).toMatch(
      /\bgrid-template-rows\s*:\s*repeat\(var\(--action-row-count\),\s*var\(--action-slot-size\)\)\s*;/,
    );
  });

  it("[defect-probing] omits the input row at a clean command boundary", () => {
    setInputRequest(null);
    setCommandInput(true);

    for (const style of ["original", "blisshack"] as const) {
      const html = renderGame({
        position: "right",
        renderer: "tiles",
        rows: 2,
        style,
      });

      expect(classTokenCount(html, "nh-prompt")).toBe(0);
      if (style === "blisshack") {
        expect(tagsWithAttribute(html, "data-dock-region")
          .map((tag) => attribute(tag, "data-dock-region")))
          .toEqual(["status"]);
      }
    }
  });
});

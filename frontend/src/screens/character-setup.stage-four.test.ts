import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  resetGameState,
  setInputRequest,
} from "../game-state";
import {
  resetBridgeState,
  setCharacterSetupContext,
  type CharacterCatalog,
} from "../nethack-bridge";
import { createDefaultProfile } from "../settings/profile";
import { GameScreen } from "./GameScreen";

const OWNER = {
  moduleId: "module-stage-four",
  sessionId: "session-stage-four",
};

/**
 * Build the minimum catalog needed to assert labels and preview tile choice.
 * @returns authoritative role metadata copied from a hypothetical WASM build.
 */
function catalogFixture(): CharacterCatalog {
  return {
    schemaVersion: 1,
    masks: {
      race: 0x0001,
      gender: 0x0006,
      alignment: 0x0008,
    },
    roles: [{
      index: 0,
      name: "Adventurer",
      femaleName: "Adventuress",
      fileCode: "Adv",
      accelerator: "a",
      allow: 0x000f,
      maleGlyph: 10,
      femaleGlyph: 11,
      maleTileIndex: 430,
      femaleTileIndex: 431,
    }],
    races: [{
      index: 0,
      name: "human",
      fileCode: "Hum",
      accelerator: "h",
      allow: 0x000f,
    }],
    genders: [
      {
        index: 0,
        name: "male",
        fileCode: "Mal",
        accelerator: "m",
        allow: 0x0002,
      },
      {
        index: 1,
        name: "female",
        fileCode: "Fem",
        accelerator: "f",
        allow: 0x0004,
      },
    ],
    alignments: [{
      index: 0,
      name: "lawful",
      fileCode: "Law",
      accelerator: "l",
      allow: 0x0008,
    }],
    legalTupleCount: 2,
  };
}

/**
 * Render the active session with one character setup input boundary.
 * @param mapRenderer - preview renderer selected by the profile.
 * @returns server-rendered character setup markup.
 */
function renderSetup(mapRenderer: "tiles" | "ascii"): string {
  const profile = createDefaultProfile();
  profile.interface.characterSetupStyle = "blisshack";
  profile.interface.mapRenderer = mapRenderer;
  return renderToStaticMarkup(createElement(GameScreen, {
    loadStatus: "loaded",
    moduleId: OWNER.moduleId,
    sessionId: OWNER.sessionId,
    onApplyProfile: async (candidate) => candidate,
    profile,
  }));
}

beforeEach(() => {
  resetBridgeState();
  resetGameState();
  setCharacterSetupContext({
    ...OWNER,
    style: "blisshack",
    saveIdentities: [{
      playerName: "Ada",
      role: "Adv",
      race: "Hum",
      gender: "Fem",
      alignment: "Law",
    }],
  });
  globalThis.nethackGlobal = {
    characterCatalog: catalogFixture(),
    globals: {
      flags: {
        initrole: 0,
        initrace: 0,
        initgend: 1,
        initalign: 0,
      },
      iflags: {},
      svp: { plname: "" },
    },
    pointers: {},
  };
});

describe("stage-four unified character setup component", () => {
  it("renders the initial name-focused unified form instead of the game HUD", () => {
    setInputRequest({
      kind: "line",
      purpose: "name",
      query: "Who are you?",
      existingSaveNames: ["Ada"],
    });

    const html = renderSetup("tiles");

    expect(html).toContain('data-character-setup="true"');
    expect(html).toContain('data-character-focus="name"');
    expect(html).toMatch(/<input[^>]*autofocus=""/);
    expect(html).toMatch(/Role/);
    expect(html).toMatch(/Race/);
    expect(html).toMatch(/Gender/);
    expect(html).toMatch(/Alignment/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm<\/button>/);
    expect(html).not.toContain('aria-label="Dungeon map"');
  });

  it.each([
    {
      renderer: "tiles" as const,
      marker: 'data-preview-tile-index="431"',
    },
    {
      renderer: "ascii" as const,
      marker: 'data-preview-glyph="@"',
    },
  ])("renders the $renderer preview without uninitialized stats", ({
    renderer,
    marker,
  }) => {
    setInputRequest({ kind: "player-selection" });

    const html = renderSetup(renderer);

    expect(html).toContain(`data-preview-renderer="${renderer}"`);
    expect(html).toContain(marker);
    expect(html).not.toMatch(/\bHP\b|\bEnergy\b|\bStrength\b/);
    expect(html).not.toContain("nh-hud-status-region");
  });
});

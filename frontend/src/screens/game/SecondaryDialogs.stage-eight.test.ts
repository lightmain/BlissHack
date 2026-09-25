/// <reference types="node" />

import { readFileSync } from "node:fs";
import {
  createElement,
  type ComponentType,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addMenuItem,
  beginMenu,
  createWindow,
  INPUT_STATE_GETDIR,
  INPUT_STATE_OTHER,
  MENU_BEHAVE_STANDARD,
  NHW_MENU,
  PICK_ANY,
  PICK_NONE,
  PICK_ONE,
  resetGameState,
  setCommandInput,
  setCursor,
  setInputRequest,
  setRuntimePhase,
  type GameModal,
  type MenuItem,
} from "../../game-state";
import type { ActionItemMenuPresentation } from "../../game-actions/game-action-controller";
import {
  createDefaultProfile,
  type ActionBarStyle,
  type BlissHackProfile,
} from "../../settings/profile";
import { GameScreen } from "../GameScreen";
import { ActionItemChooser } from "./ActionItemChooser";
import { GameModalRenderer } from "./GameModals";

const INDEX_CSS_SOURCE = readFileSync(
  new URL("../../index.css", import.meta.url),
  "utf8",
);
const GAME_CSS_SOURCE = readFileSync(
  new URL("../../styles/game.css", import.meta.url),
  "utf8",
);

const StyledGameModalRenderer = GameModalRenderer as ComponentType<{
  actionBarStyle: ActionBarStyle;
  modal: GameModal;
}>;

/** Build one selectable menu row whose text has no presentation significance. */
function menuItem(identifier: number, accelerator: string): MenuItem {
  return {
    accelerator: accelerator.charCodeAt(0),
    attribute: 0,
    color: 7,
    glyph: null,
    groupAccelerator: 0,
    identifier,
    itemFlags: 0,
    text: `opaque option ${identifier}`,
  };
}

/** Create one ordinary core menu with no action-getobj provenance. */
function ordinaryMenu(how: number): GameModal {
  const windowId = createWindow(NHW_MENU);
  beginMenu(windowId, MENU_BEHAVE_STANDARD);
  addMenuItem(windowId, menuItem(701, "a"));
  addMenuItem(windowId, menuItem(702, "b"));
  return { kind: "menu", how, windowId };
}

/** Render a core modal under one explicit Action bar presentation mode. */
function renderModal(modal: GameModal, actionBarStyle: ActionBarStyle): string {
  return renderToStaticMarkup(createElement(StyledGameModalRenderer, {
    actionBarStyle,
    modal,
  }));
}

/** Render the production game shell with one pending core input request. */
function renderInput(
  actionBarStyle: ActionBarStyle,
  inputState: number,
  request: Parameters<typeof setInputRequest>[0],
): string {
  const profile = createDefaultProfile();
  profile.interface.actionBarStyle = actionBarStyle;
  setRuntimePhase("running");
  setCommandInput(false);
  setCursor(0, 40, 10);
  setInputRequest(request, inputState);
  return renderToStaticMarkup(createElement(GameScreen, {
    loadStatus: "loaded",
    moduleId: "module-secondary-dialog",
    sessionId: "session-secondary-dialog",
    onApplyProfile: async (candidate: BlissHackProfile) => candidate,
    profile,
  }));
}

/** Return every exact class token used in rendered static markup. */
function classTokens(html: string): string[] {
  return [...html.matchAll(/\bclass="([^"]*)"/g)]
    .flatMap((match) => match[1].split(/\s+/).filter(Boolean));
}

/** Return accessible button names in source order. */
function buttonLabels(html: string): string[] {
  return [...html.matchAll(/<button[^>]*aria-label="([^"]+)"[^>]*>/g)]
    .map((match) => match[1]);
}

/** Return all CSS declarations whose selector uses the shared secondary dialog. */
function secondaryDialogCss(): string {
  return [...INDEX_CSS_SOURCE.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].includes(".nh-secondary-dialog"))
    .map((match) => `${match[1]}{${match[2]}}`)
    .join("\n");
}

/** Return declarations for one exact selector from a stylesheet. */
function cssFor(source: string, selector: string): string {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) =>
      match[1].split(",").some((candidate) => candidate.trim() === selector)
    )
    .map((match) => match[2])
    .join("\n");
}

beforeEach(() => {
  resetGameState();
});

describe("stage-eight compact secondary input dialogs", () => {
  it("[defect-probing] presents every real getdir in BlissHack without adding a dock input row", () => {
    const blissHack = renderInput("blisshack", INPUT_STATE_GETDIR, {
      choices: null,
      defaultCode: 0,
      kind: "yn",
      query: "Opaque directional request",
    });
    const original = renderInput("original", INPUT_STATE_GETDIR, {
      choices: null,
      defaultCode: 0,
      kind: "yn",
      query: "Opaque directional request",
    });

    expect(blissHack).toContain('role="dialog"');
    expect(blissHack).toContain('aria-label="Opaque directional request"');
    expect(classTokens(blissHack)).toContain("nh-secondary-dialog");
    expect(classTokens(blissHack)).not.toContain("nh-prompt");
    expect(blissHack).not.toContain('data-dock-region="input"');
    expect(
      blissHack.match(/data-direction-target-highlight="true"/g) ?? [],
    ).toHaveLength(8);

    expect(classTokens(original)).toContain("nh-prompt");
    expect(classTokens(original)).not.toContain("nh-secondary-dialog");
  });

  it.each([
    { choices: "yn", labels: ["Yes", "No"] },
    { choices: "ynq", labels: ["Yes", "No", "Quit"] },
  ])("[defect-probing] derives $choices buttons from the real yn choices", ({
    choices,
    labels,
  }) => {
    const blissHack = renderInput("blisshack", INPUT_STATE_OTHER, {
      choices,
      defaultCode: "n".charCodeAt(0),
      kind: "yn",
      query: `Opaque ${choices} request`,
    });
    const original = renderInput("original", INPUT_STATE_OTHER, {
      choices,
      defaultCode: "n".charCodeAt(0),
      kind: "yn",
      query: `Opaque ${choices} request`,
    });

    expect(classTokens(blissHack)).toContain("nh-secondary-dialog");
    expect(buttonLabels(blissHack)).toEqual(expect.arrayContaining(labels));
    expect(buttonLabels(blissHack).includes("Quit")).toBe(
      choices.includes("q"),
    );
    expect(blissHack).not.toContain('data-dock-region="input"');

    expect(classTokens(original)).toContain("nh-prompt");
    expect(classTokens(original)).not.toContain("nh-secondary-dialog");
    expect(original).toContain(`[${choices}]`);
  });
});

describe("stage-eight shared secondary dialog presentation", () => {
  it("[defect-probing] reuses one surface, list, and option contract for all compact selectors", () => {
    const actionChooser = renderToStaticMarkup(createElement(
      ActionItemChooser,
      {
        menu: {
          items: [menuItem(801, "x")],
          menuGeneration: 17,
          windowId: 9,
        } satisfies ActionItemMenuPresentation,
        onCancel: vi.fn(),
        onChoose: vi.fn(),
      },
    ));
    const pickOne = renderModal(ordinaryMenu(PICK_ONE), "blisshack");
    const direction = renderInput("blisshack", INPUT_STATE_GETDIR, {
      choices: null,
      defaultCode: 0,
      kind: "yn",
      query: "Choose a bearing",
    });
    const yn = renderInput("blisshack", INPUT_STATE_OTHER, {
      choices: "ynq",
      defaultCode: "n".charCodeAt(0),
      kind: "yn",
      query: "Confirm opaque operation",
    });

    for (const html of [actionChooser, pickOne, direction, yn]) {
      const classes = classTokens(html);
      expect(classes).toContain("nh-secondary-dialog");
      expect(classes).toContain("nh-secondary-dialog-list");
      expect(classes).toContain("nh-secondary-dialog-option");
    }
  });

  it("[defect-probing] routes ordinary PICK_ONE by selection semantics while retaining large PICK_ANY and PICK_NONE menus", () => {
    const pickOne = renderModal(ordinaryMenu(PICK_ONE), "blisshack");
    const pickAny = renderModal(ordinaryMenu(PICK_ANY), "blisshack");
    const pickNone = renderModal(ordinaryMenu(PICK_NONE), "blisshack");
    const originalPickOne = renderModal(ordinaryMenu(PICK_ONE), "original");

    expect(classTokens(pickOne)).toContain("nh-secondary-dialog");
    for (const largeMenu of [pickAny, pickNone, originalPickOne]) {
      expect(classTokens(largeMenu)).toEqual(
        expect.arrayContaining(["nh-dialog", "nh-menu"]),
      );
      expect(classTokens(largeMenu)).not.toContain("nh-secondary-dialog");
    }
  });

  it("[defect-probing] defines the shared secondary styles only in index.css with the green accent", () => {
    const css = secondaryDialogCss();

    expect(css).toContain(".nh-secondary-dialog");
    expect(css).toContain(".nh-secondary-dialog-list");
    expect(css).toContain(".nh-secondary-dialog-option");
    expect(css.toLowerCase()).toContain("#7ddc8c");
    expect(css.toLowerCase()).not.toContain("#ffcf5c");
    expect(GAME_CSS_SOURCE).not.toMatch(/\.nh-secondary-dialog(?:\b|[-])/);
  });
});

describe("stage-eight message history affordance", () => {
  it("[defect-probing] exposes prevmsg from Messages and gives history a dedicated large dialog", () => {
    const html = renderInput("blisshack", INPUT_STATE_OTHER, null);
    const button = html.match(
      /<button(?=[^>]*aria-label="Message history")(?=[^>]*data-action-name="prevmsg")[^>]*>/,
    )?.[0];
    const history = renderModal({
      kind: "history",
      lines: [{ attribute: 0, text: "A prior message" }],
    }, "blisshack");
    const historyCss = cssFor(GAME_CSS_SOURCE, ".nh-history-dialog")
      || cssFor(INDEX_CSS_SOURCE, ".nh-history-dialog");

    expect(button).toBeDefined();
    expect(history).toContain("nh-history-dialog");
    expect(history).toContain("A prior message");
    expect(historyCss).toMatch(/\bwidth\s*:/);
    expect(historyCss).toMatch(/\bmax-height\s*:/);
  });
});

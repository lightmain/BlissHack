import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendWindowText,
  ATR_NONE,
  createWindow,
  NHW_MESSAGE,
  resetGameState,
  showText,
} from "../game-state";
import { createDefaultProfile } from "../settings/profile";
import { GameScreen } from "./GameScreen";

describe("GameScreen interface settings", () => {
  beforeEach(() => resetGameState());

  it("routes a tiles profile through TileMapRenderer", () => {
    const profile = createDefaultProfile();
    (profile.interface as unknown as Record<string, unknown>).mapRenderer =
      "tiles";

    const html = renderToStaticMarkup(createElement(GameScreen, {
      loadStatus: "loaded",
      moduleId: "module-1",
      sessionId: "session-1",
      onApplyProfile: async (candidate) => candidate,
      profile,
    }));

    expect(html).toContain("nh-map-fallback");
    expect(html).toContain("nh-map-ascii");
  });

  it("routes an ASCII profile directly through AsciiMapRenderer", () => {
    const profile = createDefaultProfile();
    (profile.interface as unknown as Record<string, unknown>).mapRenderer =
      "ascii";

    const html = renderToStaticMarkup(createElement(GameScreen, {
      loadStatus: "loaded",
      moduleId: "module-1",
      sessionId: "session-1",
      onApplyProfile: async (candidate) => candidate,
      profile,
    }));

    expect(html).toContain("nh-map-ascii");
    expect(html).not.toContain("nh-map-fallback");
  });

  it.each(["small", "medium", "large"] as const)(
    "applies the %s terminal font class",
    (terminalFontSize) => {
      const profile = createDefaultProfile();
      profile.interface.terminalFontSize = terminalFontSize;

      const html = renderToStaticMarkup(createElement(GameScreen, {
        loadStatus: "loaded",
        moduleId: "module-1",
        sessionId: "session-1",
        onApplyProfile: async (candidate) => candidate,
        profile,
      }));

      expect(html).toContain(`nh-font-${terminalFontSize}`);
      expect(html).toContain('data-number-pad="off"');
    },
  );

  it.each([3, 5] as const)(
    "renders only the newest %s messages",
    (messageHistoryLines) => {
      const messageWindow = createWindow(NHW_MESSAGE);
      for (let index = 1; index <= 6; index += 1) {
        appendWindowText(messageWindow, ATR_NONE, `message-${index}`);
      }
      const profile = createDefaultProfile();
      profile.interface.messageHistoryLines = messageHistoryLines;

      const html = renderToStaticMarkup(createElement(GameScreen, {
        loadStatus: "loaded",
        moduleId: "module-1",
        sessionId: "session-1",
        onApplyProfile: async (candidate) => candidate,
        profile,
      }));

      expect(html).toContain(`nh-messages-${messageHistoryLines}`);
      for (let index = 1; index <= 6; index += 1) {
        if (index <= 6 - messageHistoryLines) {
          expect(html).not.toContain(`message-${index}`);
        } else {
          expect(html).toContain(`message-${index}`);
        }
      }
    },
  );

  it("makes the terminal inert while a core modal is open", () => {
    showText("Help", [{ text: "Modal content", attribute: ATR_NONE }]);

    const html = renderToStaticMarkup(createElement(GameScreen, {
      loadStatus: "loaded",
      moduleId: "module-1",
      sessionId: "session-1",
      onApplyProfile: async (candidate) => candidate,
      profile: createDefaultProfile(),
    }));

    expect(html).toMatch(/<section[^>]*class="nh-terminal"[^>]*inert=""/);
    expect(html).toContain('role="dialog"');
  });

  it("mounts one session overlay root outside the inert game terminal", () => {
    const html = renderToStaticMarkup(createElement(GameScreen, {
      loadStatus: "loaded",
      moduleId: "module-1",
      sessionId: "session-1",
      onApplyProfile: async (candidate) => candidate,
      profile: createDefaultProfile(),
    }));
    const overlayRootIndex = html.indexOf('data-overlay-root="true"');

    expect(html.match(/data-overlay-root="true"/g) ?? []).toHaveLength(1);
    expect(overlayRootIndex).toBeGreaterThan(html.lastIndexOf("</section>"));
  });
});

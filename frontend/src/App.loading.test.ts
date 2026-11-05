import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SaxesParser, type SaxesTag } from "saxes";
import { describe, expect, it, vi } from "vitest";
import type { DiagnosticLog } from "./diagnostics/diagnostic-log";
import App from "./App";
import { HomeScreen } from "./screens/HomeScreen";

vi.mock("./session/session-manager", () => ({
  createSessionManager: vi.fn(() => ({})),
}));

vi.mock("./settings/profile-context", () => ({
  useProfileSettings: vi.fn(() => ({
    loadStatus: "ready",
    profile: {},
    reloadProfile: vi.fn(),
    replaceProfile: vi.fn(),
    resetProfile: vi.fn(),
  })),
}));

interface MarkupFrame {
  attributes: Record<string, string>;
  hidden: boolean;
  hiddenRoot: boolean;
  text: string;
}

interface MarkupSummary {
  hiddenRegions: Array<{
    classes: string[];
    text: string;
  }>;
  visibleText: string;
}

const ROOM_GLYPHS = ["|", "-", ".", "#", "+", "@", ">"] as const;

/** Summarize visible text and independently hidden regions in server markup. */
function summarizeMarkup(html: string): MarkupSummary {
  const frames: MarkupFrame[] = [];
  const hiddenRegions: MarkupSummary["hiddenRegions"] = [];
  let visibleText = "";
  const parser = new SaxesParser();

  parser.on("opentag", (tag: SaxesTag) => {
    const attributes = Object.fromEntries(
      Object.entries(tag.attributes).map(([name, value]) => [
        name,
        String(value),
      ]),
    );
    const parentHidden = frames.at(-1)?.hidden ?? false;
    const hiddenRoot = !parentHidden && attributes["aria-hidden"] === "true";
    frames.push({
      attributes,
      hidden: parentHidden || hiddenRoot,
      hiddenRoot,
      text: "",
    });
  });
  parser.on("text", (text: string) => {
    for (const frame of frames) frame.text += text;
    if (!(frames.at(-1)?.hidden ?? false)) visibleText += text;
  });
  parser.on("closetag", () => {
    const frame = frames.pop();
    if (!frame?.hiddenRoot) return;
    hiddenRegions.push({
      classes: (frame.attributes.class ?? "").split(/\s+/).filter(Boolean),
      text: frame.text,
    });
  });
  parser.write(html).close();

  return { hiddenRegions, visibleText };
}

/** Return the hidden region containing the complete decorative room alphabet. */
function hiddenAsciiRoom(summary: MarkupSummary): {
  classes: string[];
  text: string;
} {
  const room = summary.hiddenRegions.find((region) =>
    ROOM_GLYPHS.every((glyph) => region.text.includes(glyph))
  );
  expect(room, "missing an aria-hidden ASCII room").toBeDefined();
  return room ?? { classes: [], text: "" };
}

/** Normalize formatting whitespace without changing the room glyph sequence. */
function roomGlyphs(room: string): string {
  return room.replace(/\s+/g, "");
}

/** Create the minimum diagnostic surface needed during server rendering. */
function diagnosticStub(): DiagnosticLog {
  return {
    buildId: "test-build",
    productVersion: "test-version",
    clear: vi.fn(),
    events: vi.fn(() => []),
    exportData: vi.fn(),
    exportJson: vi.fn(),
    record: vi.fn(),
    recordFatal: vi.fn(),
    reset: vi.fn(),
  } as unknown as DiagnosticLog;
}

describe("App loading screen", () => {
  it("uses the same hidden ASCII room as Home", () => {
    const loading = summarizeMarkup(renderToStaticMarkup(createElement(App, {
      diagnostics: diagnosticStub(),
    })));
    const home = summarizeMarkup(renderToStaticMarkup(
      createElement(HomeScreen, { onNewGame: vi.fn() }),
    ));
    const loadingRoom = hiddenAsciiRoom(loading);
    const homeRoom = hiddenAsciiRoom(home);

    expect(roomGlyphs(loadingRoom.text)).toBe(roomGlyphs(homeRoom.text));
    expect(loadingRoom.classes).toContain("home-dungeon");
    expect(homeRoom.classes).toContain("home-dungeon");
  });

  it("keeps the loading text available to assistive technology", () => {
    const loading = summarizeMarkup(renderToStaticMarkup(createElement(App, {
      diagnostics: diagnosticStub(),
    })));

    expect(loading.visibleText).toContain("Preparing BlissHack");
  });
});

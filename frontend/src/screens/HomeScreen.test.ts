import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomeScreen } from "./HomeScreen";

/**
 * Return the opening button tag whose accessible text matches a label.
 * @param html - server-rendered HomeScreen markup.
 * @param label - visible button label.
 * @returns the complete button element.
 */
function buttonMarkup(html: string, label: string): string {
  const match = html.match(
    new RegExp(`<button[^>]*>\\s*${label}\\s*</button>`, "i"),
  );
  expect(match, `missing ${label} button`).not.toBeNull();
  return match?.[0] ?? "";
}

describe("HomeScreen", () => {
  it("renders the product identity and required footer information", () => {
    const html = renderToStaticMarkup(createElement(HomeScreen, {
      onNewGame: vi.fn(),
    }));

    expect(html).toMatch(/<h1[^>]*>\s*BlissHack\s*<\/h1>/i);
    expect(html).toMatch(/NetHack\s*5\.0/i);
    expect(html).toMatch(/unofficial|非官方/i);
    expect(html).toMatch(/<footer[\s\S]*BlissHack[\s\S]*copyright/i);
    expect(html).toMatch(/<a[^>]+href=[^>]+>[^<]*licen[cs]e[^<]*<\/a>/i);
  });

  it("does not start a session while rendering the home screen", () => {
    const startSession = vi.fn();

    renderToStaticMarkup(createElement(HomeScreen, {
      onNewGame: startSession,
    }));

    expect(startSession).not.toHaveBeenCalled();
  });

  it("renders New Game, Continue, and Settings in command order", () => {
    const html = renderToStaticMarkup(createElement(HomeScreen, {
      onNewGame: vi.fn(),
    }));
    const newGameIndex = html.indexOf(">New Game<");
    const continueIndex = html.indexOf(">Continue<");
    const settingsIndex = html.indexOf(">Settings<");

    expect(newGameIndex).toBeGreaterThan(-1);
    expect(continueIndex).toBeGreaterThan(newGameIndex);
    expect(settingsIndex).toBeGreaterThan(continueIndex);
  });

  it("uses native disabled attributes for Continue and Settings only", () => {
    const html = renderToStaticMarkup(createElement(HomeScreen, {
      onNewGame: vi.fn(),
    }));

    expect(buttonMarkup(html, "New Game")).not.toMatch(/\sdisabled(?:=|>)/i);
    expect(buttonMarkup(html, "Continue")).toMatch(/\sdisabled(?:=""|>)/i);
    expect(buttonMarkup(html, "Settings")).toMatch(/\sdisabled(?:=""|>)/i);
  });
});

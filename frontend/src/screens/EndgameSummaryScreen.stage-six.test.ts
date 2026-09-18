import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EndgameSummary } from "../nethack-bridge";

interface EndgameSummaryScreenProps {
  summary: EndgameSummary;
  onConfirm(): void;
}

interface EndgameSummaryScreenModule {
  EndgameSummaryScreen?: ComponentType<EndgameSummaryScreenProps>;
}

/**
 * Require the planned screen while keeping this test file executable before
 * the product implementation exists.
 * @returns the implemented result screen component.
 */
async function requireScreen(): Promise<
  ComponentType<EndgameSummaryScreenProps>
> {
  const modulePath = "./EndgameSummaryScreen";
  let module: EndgameSummaryScreenModule = {};
  try {
    module = await import(
      /* @vite-ignore */ modulePath
    ) as EndgameSummaryScreenModule;
  } catch (error) {
    if (
      !(error instanceof Error)
      || !/cannot find|failed to load|unknown variable dynamic import/i.test(
        error.message,
      )
    ) {
      throw error;
    }
  }
  expect(module.EndgameSummaryScreen).toBeTypeOf("function");
  return module.EndgameSummaryScreen as ComponentType<
    EndgameSummaryScreenProps
  >;
}

/** Build a complete summary with empty and deliberately unordered sections. */
function endgameSummaryFixture(): EndgameSummary {
  return {
    owner: {
      moduleId: "module-completed",
      sessionId: "session-completed",
    },
    sections: [
      {
        kind: "disclosure",
        title: "Possessions identified",
        blocks: [{
          kind: "menu",
          sourceWindowId: 41,
          lines: [{ text: "Inventory:", attribute: 1 }],
          prompt: "Inventory",
          items: [{
            glyph: null,
            identifier: 1,
            accelerator: "a".charCodeAt(0),
            groupAccelerator: 0,
            attribute: 0,
            color: 7,
            text: "a - a blessed +1 long sword",
            itemFlags: 0,
          }],
        }],
      },
      {
        kind: "ranking",
        title: "Ranking",
        blocks: [{
          kind: "text",
          sourceWindowId: null,
          lines: [{ text: " No  Points     Name", attribute: 1 }],
        }],
      },
      {
        kind: "summary",
        title: "Summary",
        blocks: [{
          kind: "text",
          sourceWindowId: 52,
          lines: [{ text: "Ada the Wizard...", attribute: 1 }],
        }],
      },
      {
        kind: "disclosure",
        title: "Empty disclosure",
        blocks: [],
      },
      {
        kind: "disclosure",
        title: "Dungeon overview",
        blocks: [{
          kind: "text",
          sourceWindowId: 48,
          lines: Array.from({ length: 80 }, (_, index) => ({
            text: `Dungeon overview line ${index + 1}`,
            attribute: index === 0 ? 1 : 0,
          })),
        }],
      },
    ],
  };
}

/** Count exact serialized attributes in server-rendered markup. */
function attributeCount(html: string, attribute: string): number {
  return html.match(new RegExp(attribute, "g"))?.length ?? 0;
}

describe("alpha-2.2 EndgameSummaryScreen contract", () => {
  it("[defect-probing] renders Summary first, Ranking last, and no empty disclosure", async () => {
    const Screen = await requireScreen();
    const html = renderToStaticMarkup(createElement(Screen, {
      summary: endgameSummaryFixture(),
      onConfirm: vi.fn(),
    }));

    const summaryIndex = html.indexOf(">Summary<");
    const possessionsIndex = html.indexOf(">Possessions identified<");
    const overviewIndex = html.indexOf(">Dungeon overview<");
    const rankingIndex = html.indexOf(">Ranking<");

    expect(summaryIndex).toBeGreaterThan(-1);
    expect(possessionsIndex).toBeGreaterThan(summaryIndex);
    expect(overviewIndex).toBeGreaterThan(possessionsIndex);
    expect(rankingIndex).toBeGreaterThan(overviewIndex);
    expect(html).not.toContain("Empty disclosure");
  });

  it("exposes a horizontal tablist with complete tab and panel relationships", async () => {
    const Screen = await requireScreen();
    const html = renderToStaticMarkup(createElement(Screen, {
      summary: endgameSummaryFixture(),
      onConfirm: vi.fn(),
    }));

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-orientation="horizontal"');
    expect(html).toContain('data-browser-tab-navigation="true"');
    expect(attributeCount(html, 'role="tab"')).toBe(4);
    expect(attributeCount(html, 'role="tabpanel"')).toBe(4);
    expect(attributeCount(html, 'aria-selected="true"')).toBe(1);
    expect(attributeCount(html, 'tabindex="0"')).toBe(1);
    expect(attributeCount(html, 'data-end-summary-scroll="true"')).toBe(4);
    expect(html).toMatch(/role="tab"[^>]+aria-controls="[^"]+"/);
    expect(html).toMatch(/role="tabpanel"[^>]+aria-labelledby="[^"]+"/);
  });

  it("renders core text without exposing retired session implementation details", async () => {
    const Screen = await requireScreen();
    const html = renderToStaticMarkup(createElement(Screen, {
      summary: endgameSummaryFixture(),
      onConfirm: vi.fn(),
    }));

    expect(html).toContain("Ada the Wizard...");
    expect(html).toContain("a - a blessed +1 long sword");
    expect(html).toContain("No  Points     Name");
    expect(html).not.toContain("module-completed");
    expect(html).not.toContain("session-completed");
    expect(html).not.toMatch(/sourceWindowId|window-id|data-window/);
  });

  it("[defect-probing] exposes one fixed Confirm action outside every scroll panel", async () => {
    const Screen = await requireScreen();
    const html = renderToStaticMarkup(createElement(Screen, {
      summary: endgameSummaryFixture(),
      onConfirm: vi.fn(),
    }));
    const confirmIndex = html.indexOf(">Confirm<");
    const lastScrollPanel = html.lastIndexOf(
      'data-end-summary-scroll="true"',
    );

    expect(attributeCount(html, ">Confirm<")).toBe(1);
    expect(html).toContain('data-end-summary-confirm="true"');
    expect(confirmIndex).toBeGreaterThan(lastScrollPanel);
  });
});

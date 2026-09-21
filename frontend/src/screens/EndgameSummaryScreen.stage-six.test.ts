import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EndgameSummary } from "../nethack-bridge";

interface EndgameSummaryScreenProps {
  summary: EndgameSummary;
  onConfirm(): void;
}

const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

interface EndgameTabWheelModule {
  getEndgameTabWheelDelta?: (
    event: Readonly<Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">>,
    pageSize: number,
  ) => number | null;
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

/** Require the pure wheel normalization contract used by the tablist listener. */
async function requireWheelDelta(): Promise<
  NonNullable<EndgameTabWheelModule["getEndgameTabWheelDelta"]>
> {
  const modulePath = "./endgame-tab-wheel";
  const module = await import(
    /* @vite-ignore */ modulePath
  ) as EndgameTabWheelModule;
  expect(module.getEndgameTabWheelDelta).toBeTypeOf("function");
  return module.getEndgameTabWheelDelta as NonNullable<
    EndgameTabWheelModule["getEndgameTabWheelDelta"]
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
        title: "Identified Possessions",
        blocks: [{
          kind: "menu",
          sourceWindowId: 41,
          lines: [{ text: "Inventory:", attribute: 1 }],
          prompt: "Inventory",
          items: [
            {
              glyph: null,
              identifier: null,
              accelerator: 0,
              groupAccelerator: 0,
              attribute: 1,
              color: 7,
              text: "Weapons",
              itemFlags: 0,
            },
            {
              glyph: {
                glyph: 12,
                ttyChar: ")".charCodeAt(0),
                frameColor: 0,
                glyphFlags: 0,
                color: 2,
                symbolIndex: 0,
                customColor: 0,
                color256: 0,
                tileIndex: 0,
              },
              identifier: 1,
              accelerator: "a".charCodeAt(0),
              groupAccelerator: 0,
              attribute: 0,
              color: 7,
              text: "a - a blessed +1 long sword",
              itemFlags: 1,
            },
          ],
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
        title: "Dungeon Overview",
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
  it("[defect-probing] maps only vertical-dominant wheel input to horizontal pixels", async () => {
    const getWheelDelta = await requireWheelDelta();

    expect(getWheelDelta({
      deltaMode: DOM_DELTA_PIXEL,
      deltaX: 0,
      deltaY: 48,
    }, 320)).toBe(48);
    expect(getWheelDelta({
      deltaMode: DOM_DELTA_PIXEL,
      deltaX: 0,
      deltaY: -48,
    }, 320)).toBe(-48);
    expect(getWheelDelta({
      deltaMode: DOM_DELTA_PIXEL,
      deltaX: 49,
      deltaY: 48,
    }, 320)).toBeNull();
    expect(getWheelDelta({
      deltaMode: DOM_DELTA_PIXEL,
      deltaX: -49,
      deltaY: -48,
    }, 320)).toBeNull();
  });

  it("normalizes line and page wheel modes without changing direction", async () => {
    const getWheelDelta = await requireWheelDelta();
    const downLine = getWheelDelta({
      deltaMode: DOM_DELTA_LINE,
      deltaX: 0,
      deltaY: 3,
    }, 320);
    const upLine = getWheelDelta({
      deltaMode: DOM_DELTA_LINE,
      deltaX: 0,
      deltaY: -2,
    }, 320);

    expect(downLine).toBeGreaterThan(3);
    expect(upLine).toBeLessThan(-2);
    expect(getWheelDelta({
      deltaMode: DOM_DELTA_PAGE,
      deltaX: 0,
      deltaY: 1,
    }, 320)).toBe(320);
    expect(getWheelDelta({
      deltaMode: DOM_DELTA_PAGE,
      deltaX: 0,
      deltaY: -1,
    }, 320)).toBe(-320);
  });

  it("[defect-probing] renders Summary first, Ranking last, and no empty disclosure", async () => {
    const Screen = await requireScreen();
    const html = renderToStaticMarkup(createElement(Screen, {
      summary: endgameSummaryFixture(),
      onConfirm: vi.fn(),
    }));

    const summaryIndex = html.indexOf(">Summary<");
    const possessionsIndex = html.indexOf(">Identified Possessions<");
    const overviewIndex = html.indexOf(">Dungeon Overview<");
    const rankingIndex = html.indexOf(">Ranking<");

    expect(summaryIndex).toBeGreaterThan(-1);
    expect(possessionsIndex).toBeGreaterThan(summaryIndex);
    expect(overviewIndex).toBeGreaterThan(possessionsIndex);
    expect(rankingIndex).toBeGreaterThan(overviewIndex);
    expect(html).not.toContain("Empty disclosure");
  });

  it("[defect-probing] reuses permanent-inventory structure for possession rows", async () => {
    const Screen = await requireScreen();
    const html = renderToStaticMarkup(createElement(Screen, {
      summary: endgameSummaryFixture(),
      onConfirm: vi.fn(),
    }));

    expect(html).toContain("nh-menu-items permanent-inventory-items");
    expect(html).toMatch(
      /class="[^"]*nh-menu-heading[^"]*permanent-inventory-heading[^"]*"[^>]*>Weapons<\/div>/,
    );
    expect(html).toMatch(
      /class="[^"]*nh-menu-item[^"]*permanent-inventory-item[^"]*selected[^"]*"/,
    );
    expect(html).toContain('class="nh-menu-glyph">)</span>');
    expect(html).toContain('class="nh-menu-accelerator">a</span>');
    expect(html).toContain(
      'class="nh-menu-text">a - a blessed +1 long sword</span>',
    );
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
    expect(attributeCount(html, 'tabindex="0"')).toBe(2);
    expect(attributeCount(html, 'data-end-summary-scroll="true"')).toBe(4);
    expect(html).toMatch(/role="tab"[^>]+aria-controls="[^"]+"/);
    expect(html).toMatch(/role="tabpanel"[^>]+aria-labelledby="[^"]+"/);
  });

  it("preserves core text attributes and menu colors", async () => {
    const Screen = await requireScreen();
    const summary = endgameSummaryFixture();
    const html = renderToStaticMarkup(createElement(Screen, {
      summary: {
        ...summary,
        sections: summary.sections.map((section) =>
          section.kind !== "summary"
            ? section
            : {
              ...section,
              blocks: [{
                kind: "text" as const,
                sourceWindowId: 52,
                lines: [
                  { text: "Dim", attribute: 2 },
                  { text: "Italic", attribute: 3 },
                  { text: "Underline", attribute: 4 },
                  { text: "Inverse", attribute: 7 },
                ],
              }],
            }),
      },
      onConfirm: vi.fn(),
    }));

    expect(html).toContain("nh-dim");
    expect(html).toContain("nh-italic");
    expect(html).toContain("nh-underline");
    expect(html).toContain("nh-inverse");
    expect(html).toContain("nh-color-gray");
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

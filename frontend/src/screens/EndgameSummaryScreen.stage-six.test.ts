/// <reference types="node" />

import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EndgameSummary } from "../nethack-bridge";

const ENDGAME_SUMMARY_CSS = readFileSync(
  new URL("../styles/endgame-summary.css", import.meta.url),
  "utf8",
);
const EXPECTED_SECTION_TABS = [
  { title: "Summary", iconClass: "lucide-book-open-text" },
  { title: "Identified Possessions", iconClass: "lucide-backpack" },
  { title: "Dungeon Overview", iconClass: "lucide-map" },
  { title: "Final Attributes", iconClass: "lucide-list" },
  { title: "Vanquished Creatures", iconClass: "lucide-skull" },
  { title: "Extinct Species", iconClass: "lucide-list-x" },
  { title: "Conduct and Achievements", iconClass: "lucide-list-checks" },
  { title: "Ranking", iconClass: "lucide-trending-up" },
] as const;
const DISCLOSURE_VARIANT_TABS = [
  { title: "Genocided Species", iconClass: "lucide-list-x" },
  { title: "Genocided and Extinct Species", iconClass: "lucide-list-x" },
  { title: "Unknown disclosure", iconClass: "lucide-circle-question-mark" },
] as const;

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
              visibleEntityToken: null,
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
              visibleEntityToken: null,
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
      {
        kind: "disclosure",
        title: "Final Attributes",
        blocks: [{
          kind: "text",
          sourceWindowId: 53,
          lines: [{ text: "Final Attributes:", attribute: 1 }],
        }],
      },
      {
        kind: "disclosure",
        title: "Vanquished Creatures",
        blocks: [{
          kind: "text",
          sourceWindowId: 49,
          lines: [{ text: "a goblin", attribute: 0 }],
        }],
      },
      {
        kind: "disclosure",
        title: "Extinct Species",
        blocks: [{
          kind: "text",
          sourceWindowId: 50,
          lines: [{ text: "goblins are extinct", attribute: 0 }],
        }],
      },
      {
        kind: "disclosure",
        title: "Conduct and Achievements",
        blocks: [{
          kind: "text",
          sourceWindowId: 51,
          lines: [{ text: "You were foodless.", attribute: 0 }],
        }],
      },
    ],
  };
}

/** Build the alternate disclosure-title cases without the full result data. */
function disclosureVariantFixture(): EndgameSummary {
  return {
    owner: {
      moduleId: "module-variants",
      sessionId: "session-variants",
    },
    sections: DISCLOSURE_VARIANT_TABS.map(({ title }, index) => ({
      kind: "disclosure",
      title,
      blocks: [{
        kind: "text",
        sourceWindowId: 60 + index,
        lines: [{ text: `${title} content`, attribute: 0 }],
      }],
    })),
  };
}

/** Count exact serialized attributes in server-rendered markup. */
function attributeCount(html: string, attribute: string): number {
  return html.match(new RegExp(attribute, "g"))?.length ?? 0;
}

/** Return every endgame tab's opening tag and rendered body. */
function endgameTabs(html: string): Array<{
  body: string;
  openingTag: string;
}> {
  return [...html.matchAll(
    /(<button(?=[^>]*\brole="tab")[^>]*>)([\s\S]*?)<\/button>/g,
  )].map((match) => ({
    openingTag: match[1],
    body: match[2],
  }));
}

/** Return every endgame panel's opening tag and rendered body. */
function endgamePanels(html: string): Array<{
  body: string;
  openingTag: string;
}> {
  return [...html.matchAll(
    /(<div(?=[^>]*\brole="tabpanel")[^>]*>)([\s\S]*?)<\/div>/g,
  )].map((match) => ({
    openingTag: match[1],
    body: match[2],
  }));
}

/** Read one serialized attribute from an opening tag. */
function attributeValue(openingTag: string, attribute: string): string | null {
  return new RegExp(`\\b${attribute}="([^"]*)"`).exec(openingTag)?.[1] ?? null;
}

/** Reduce one markup fragment to its visible text. */
function visibleText(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Return declarations attached to one exact CSS selector. */
function cssFor(selector: string): string {
  return [...ENDGAME_SUMMARY_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) =>
      match[1].split(",").some((candidate) => candidate.trim() === selector)
    )
    .map((match) => match[2])
    .join("\n");
}

describe("alpha-2.2 EndgameSummaryScreen contract", () => {
  it("[defect-probing] renders Summary first, Ranking last, and no empty disclosure", async () => {
    const Screen = await requireScreen();
    const html = renderToStaticMarkup(createElement(Screen, {
      summary: endgameSummaryFixture(),
      onConfirm: vi.fn(),
    }));

    const summaryIndex = html.indexOf("Ada the Wizard...");
    const possessionsIndex = html.indexOf("a - a blessed +1 long sword");
    const overviewIndex = html.indexOf("Dungeon overview line 1");
    const rankingIndex = html.indexOf("No  Points     Name");

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
    expect(attributeCount(html, 'role="tab"')).toBe(8);
    expect(attributeCount(html, 'role="tabpanel"')).toBe(8);
    expect(attributeCount(html, 'aria-selected="true"')).toBe(1);
    expect(attributeCount(html, 'tabindex="0"')).toBe(2);
    expect(attributeCount(html, 'data-end-summary-scroll="true"')).toBe(8);

    const tabs = endgameTabs(html);
    const panels = endgamePanels(html);
    expect(tabs).toHaveLength(EXPECTED_SECTION_TABS.length);
    expect(panels).toHaveLength(EXPECTED_SECTION_TABS.length);
    tabs.forEach((tab, index) => {
      const title = EXPECTED_SECTION_TABS[index].title;
      const tabId = attributeValue(tab.openingTag, "id");
      const panelId = attributeValue(tab.openingTag, "aria-controls");
      const matchingPanels = panels.filter((panel) =>
        attributeValue(panel.openingTag, "id") === panelId
      );

      expect.soft(tabId, `${title} tab id`).not.toBeNull();
      expect.soft(panelId, `${title} controlled panel id`).not.toBeNull();
      expect.soft(matchingPanels, `${title} controlled panel`).toHaveLength(1);
      expect.soft(
        attributeValue(matchingPanels[0]?.openingTag ?? "", "aria-labelledby"),
        `${title} panel label`,
      ).toBe(tabId);
    });
  });

  it("renders every result tab as one labeled lucide icon without visible long text", async () => {
    const Screen = await requireScreen();
    const html = renderToStaticMarkup(createElement(Screen, {
      summary: endgameSummaryFixture(),
      onConfirm: vi.fn(),
    }));
    const tabs = endgameTabs(html);

    expect(tabs).toHaveLength(EXPECTED_SECTION_TABS.length);
    tabs.forEach((tab, index) => {
      const { iconClass, title } = EXPECTED_SECTION_TABS[index];

      expect.soft(tab.openingTag, `${title} accessible label`)
        .toContain(`aria-label="${title}"`);
      expect.soft(tab.openingTag, `${title} native title`)
        .toContain(`title="${title}"`);
      expect.soft(tab.body, `${title} icon`).toMatch(
        /^<svg(?=[^>]*\bclass="[^"]*\blucide\b[^"]*")[^>]*>[\s\S]*<\/svg>$/,
      );
      expect.soft(tab.body, `${title} concrete icon`).toMatch(
        new RegExp(`class="[^"]*\\b${iconClass}\\b[^"]*"`),
      );
      expect.soft(visibleText(tab.body), `${title} visible tab text`).toBe("");
    });
  });

  it("maps disclosure title variants and unknown titles to explicit icons", async () => {
    const Screen = await requireScreen();
    const html = renderToStaticMarkup(createElement(Screen, {
      summary: disclosureVariantFixture(),
      onConfirm: vi.fn(),
    }));
    const tabs = endgameTabs(html);

    expect(tabs).toHaveLength(DISCLOSURE_VARIANT_TABS.length);
    tabs.forEach((tab, index) => {
      const { iconClass, title } = DISCLOSURE_VARIANT_TABS[index];

      expect.soft(tab.openingTag, `${title} accessible label`)
        .toContain(`aria-label="${title}"`);
      expect.soft(tab.body, `${title} concrete icon`).toMatch(
        new RegExp(`class="[^"]*\\b${iconClass}\\b[^"]*"`),
      );
    });
  });

  it("shows the selected section title in a separate bar below the tablist", async () => {
    const Screen = await requireScreen();
    const html = renderToStaticMarkup(createElement(Screen, {
      summary: endgameSummaryFixture(),
      onConfirm: vi.fn(),
    }));
    const tablist = html.match(
      /<div(?=[^>]*\brole="tablist")[^>]*>[\s\S]*?<\/div>/,
    );
    const contentIndex = html.indexOf('<section class="end-summary-content">');

    expect.soft(tablist).not.toBeNull();
    expect.soft(contentIndex).toBeGreaterThan(
      (tablist?.index ?? 0) + (tablist?.[0].length ?? 0),
    );
    const betweenTablistAndContent = html.slice(
      (tablist?.index ?? 0) + (tablist?.[0].length ?? 0),
      contentIndex,
    );
    const selectedTitle = betweenTablistAndContent.match(
      /<([a-z][\w-]*)(?=[^>]*\bclass="[^"]*\bend-summary-section-title\b[^"]*")[^>]*>([\s\S]*?)<\/\1>/,
    );

    expect.soft(selectedTitle).not.toBeNull();
    expect.soft(visibleText(selectedTitle?.[2] ?? "")).toBe("Summary");
  });

  it("keeps the icon tab strip non-scrolling and shrinkable on narrow screens", () => {
    const tablist = cssFor(".end-summary-tabs");
    const tab = cssFor(".end-summary-tab");
    const flex = /\bflex\s*:\s*([^;]+);/.exec(tab)?.[1].trim();
    const flexParts = flex?.split(/\s+/) ?? [];

    expect.soft(tablist).not.toMatch(
      /\boverflow-x\s*:\s*(?:auto|scroll)\s*;/,
    );
    expect.soft(tab).toMatch(/\bmin-width\s*:\s*0\s*;/);
    expect.soft(flexParts).toHaveLength(3);
    expect.soft(Number(flexParts[1])).toBeGreaterThan(0);
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

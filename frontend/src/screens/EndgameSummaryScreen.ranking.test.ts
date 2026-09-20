import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EndgameSummary } from "../nethack-bridge";
import { EndgameSummaryScreen } from "./EndgameSummaryScreen";

const CORE_RANKING_LINES = [
  {
    text: " No  Points     Name".padEnd(71) + "Hp [max]",
    attribute: 1,
  },
  {
    text:
      "  1       2500  TenLetters-Wiz-Hum-Fem-Neu died in The Dungeons of",
    attribute: 0,
  },
  {
    text: "                Doom on level 7.  Killed by a minotaur."
      .padEnd(72) + "-  [42]",
    attribute: 0,
  },
  {
    text:
      "  2       1200  CurrentOne-Val-Hum-Mal-Law died in The Dungeons of"
        .padEnd(79),
    attribute: 1,
  },
  {
    text: "                Doom on level 3.  Killed by a grid bug."
      .padEnd(72) + "3  [18]",
    attribute: 1,
  },
] as const;

/** Render a minimal endgame result containing the supplied ranking lines. */
function renderRanking(
  lines: readonly { text: string; attribute: number }[],
): string {
  const summary: EndgameSummary = {
    owner: {
      moduleId: "ranking-module",
      sessionId: "ranking-session",
    },
    sections: [
      {
        kind: "summary",
        title: "Summary",
        blocks: [{
          kind: "text",
          sourceWindowId: 1,
          lines: [{ text: "TenLetters died.", attribute: 1 }],
        }],
      },
      {
        kind: "ranking",
        title: "Ranking",
        blocks: [{
          kind: "text",
          sourceWindowId: null,
          lines,
        }],
      },
    ],
  };
  return renderToStaticMarkup(createElement(EndgameSummaryScreen, {
    summary,
    onConfirm: vi.fn(),
  }));
}

/** Return every native table row from server-rendered markup. */
function tableRows(html: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)]
    .map((match) => match[0]);
}

/** Reduce one markup fragment to whitespace-normalized visible text. */
function visibleText(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("alpha-2.2 semantic Ranking table", () => {
  it("[defect-probing] renders core headers and entries as an accessible table", () => {
    const html = renderRanking(CORE_RANKING_LINES);

    expect(html).toMatch(/<table\b[^>]*>/);
    for (const label of ["Rank", "Points", "Character", "Outcome", "HP"]) {
      expect(html).toMatch(
        new RegExp(
          `<th(?=[^>]*\\bscope="col")[^>]*>\\s*${label}\\s*</th>`,
        ),
      );
    }

    const normalRow = tableRows(html)
      .find((row) => row.includes("TenLetters"));
    expect(normalRow).toBeDefined();
    expect(visibleText(normalRow ?? "")).toContain(
      "1 2500 TenLetters-Wiz-Hum-Fem-Neu",
    );
  });

  it("[defect-probing] keeps a full ten-character identity and merges its continuation", () => {
    const html = renderRanking(CORE_RANKING_LINES);
    const dataRows = tableRows(html).filter((row) => /<td\b/.test(row));
    const normalRow = dataRows.find((row) => row.includes("TenLetters"));

    expect(dataRows).toHaveLength(2);
    expect(normalRow).toBeDefined();
    expect(visibleText(normalRow ?? "")).toContain(
      "TenLetters-Wiz-Hum-Fem-Neu",
    );
    expect(visibleText(normalRow ?? "")).toContain(
      "died in The Dungeons of Doom on level 7. Killed by a minotaur.",
    );
    expect(visibleText(normalRow ?? "")).toContain("- [42]");
  });

  it("[defect-probing] marks the bold player entry as the current row", () => {
    const html = renderRanking(CORE_RANKING_LINES);
    const currentRow = tableRows(html)
      .find((row) => row.includes("CurrentOne"));

    expect(currentRow).toBeDefined();
    expect(currentRow).toMatch(/^<tr\b[^>]*\baria-current="true"/);
    expect(visibleText(currentRow ?? "")).toContain(
      "CurrentOne-Val-Hum-Mal-Law",
    );
  });

  it("falls back atomically to original text when Ranking cannot be parsed", () => {
    const unparsedLines = [
      CORE_RANKING_LINES[0],
      { text: "not a core ranking entry", attribute: 0 },
      { text: "                orphaned continuation data", attribute: 0 },
    ];
    const html = renderRanking(unparsedLines);

    expect(html).not.toMatch(/<table\b/);
    for (const line of unparsedLines) {
      expect(html).toContain(line.text);
    }
  });
});

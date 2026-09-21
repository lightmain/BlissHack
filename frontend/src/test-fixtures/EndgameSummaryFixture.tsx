import { useState } from "react";
import type { EndgameSummary } from "../nethack-bridge";
import { EndgameSummaryScreen } from "../screens/EndgameSummaryScreen";

const summary: EndgameSummary = {
  owner: {
    moduleId: "fixture-module",
    sessionId: "fixture-session",
  },
  sections: [
    {
      kind: "summary",
      title: "Summary",
      blocks: [{
        kind: "text",
        sourceWindowId: 1,
        lines: [
          { text: "Ada the Wizard...", attribute: 1 },
          { text: "You died in The Dungeons of Doom.", attribute: 0 },
        ],
      }],
    },
    {
      kind: "disclosure",
      title: "Identified Possessions",
      blocks: [{
        kind: "menu",
        sourceWindowId: 2,
        lines: [{ text: "Inventory:", attribute: 1 }],
        prompt: "",
        items: Array.from({ length: 48 }, (_, index) => ({
          glyph: null,
          identifier: index + 1,
          accelerator: 0,
          groupAccelerator: 0,
          attribute: 0,
          color: 7,
          text: `${index + 1} - identified fixture item`,
          itemFlags: 0,
        })),
      }],
    },
    {
      kind: "disclosure",
      title: "Dungeon Overview",
      blocks: [{
        kind: "text",
        sourceWindowId: 3,
        lines: Array.from({ length: 80 }, (_, index) => ({
          text: `Dungeon overview line ${index + 1}`,
          attribute: index === 0 ? 1 : 0,
        })),
      }],
    },
    {
      kind: "disclosure",
      title: "Conduct and Achievements",
      blocks: [{
        kind: "text",
        sourceWindowId: 4,
        lines: [{
          text: "You followed a deliberately long fixture conduct.",
          attribute: 0,
        }],
      }],
    },
    {
      kind: "ranking",
      title: "Ranking",
      blocks: [{
        kind: "text",
        sourceWindowId: null,
        lines: [
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
        ],
      }],
    },
  ],
};

/**
 * Provide deterministic endgame UI data only for the browser test build.
 * @returns a result page exposing its confirmation state and callback count.
 */
export function EndgameSummaryFixture() {
  const [confirmCount, setConfirmCount] = useState(0);
  return (
    <div data-end-summary-confirm-count={confirmCount}>
      {confirmCount > 0
        ? (
          <main className="app-loading" data-end-summary-returned-home="true">
            Home fixture
          </main>
        )
        : (
          <EndgameSummaryScreen
            onConfirm={() => setConfirmCount((count) => count + 1)}
            summary={summary}
          />
        )}
    </div>
  );
}

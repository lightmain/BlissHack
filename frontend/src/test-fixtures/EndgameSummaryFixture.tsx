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
      kind: "ranking",
      title: "Ranking",
      blocks: [{
        kind: "text",
        sourceWindowId: null,
        lines: [
          { text: " No  Points     Name", attribute: 1 },
          { text: "  1       42  Ada-Wiz-Hum-Fem-Neu", attribute: 0 },
        ],
      }],
    },
  ],
};

/**
 * Provide deterministic endgame UI data only for the browser test build.
 * @returns a result page which exposes its one-way confirmation state.
 */
export function EndgameSummaryFixture() {
  const [confirmed, setConfirmed] = useState(false);
  if (confirmed) {
    return (
      <main className="app-loading" data-end-summary-returned-home="true">
        Home fixture
      </main>
    );
  }
  return (
    <EndgameSummaryScreen
      onConfirm={() => setConfirmed(true)}
      summary={summary}
    />
  );
}

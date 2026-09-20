import { describe, expect, it } from "vitest";
import { ATR_BOLD, type TextLine } from "../game-state";
import { parseEndgameRanking } from "./endgame-ranking";

const HEADER: TextLine = {
  text: " No  Points     Name".padEnd(71) + "Hp [max]",
  attribute: ATR_BOLD,
};

/** Build the unwrapped portion of one core-formatted ranking entry. */
function entryStart(
  rank: number | null,
  points: string,
  character: string,
  outcome: string,
): string {
  const rankField = rank === null ? "   " : String(rank).padStart(3);
  return `${rankField} ${points.padStart(10)}  ${character} ${outcome}`;
}

/** Place HP fields at the end of one 79-column core output line. */
function withHitPoints(
  text: string,
  hitPoints: string,
  maximumHitPoints: string,
): string {
  const maximumPadding = maximumHitPoints.length === 1 ? "  " : " ";
  const suffix = `${hitPoints} ${maximumPadding}[${maximumHitPoints}]`;
  return text.padEnd(79 - suffix.length) + suffix;
}

/** Build one fixed-width continuation line. */
function continuation(text: string): string {
  return `${" ".repeat(16)}${text}`;
}

/** Parse one complete Ranking section and require semantic output. */
function parseRows(lines: readonly TextLine[]) {
  const parsed = parseEndgameRanking(lines);
  expect(parsed).not.toBeNull();
  return parsed!;
}

describe("parseEndgameRanking", () => {
  it("preserves a legal name containing an internal space", () => {
    const character = "Ada Lov-Wiz-Hum-Fem-Neu";
    const parsed = parseRows([
      HEADER,
      {
        text: withHitPoints(
          entryStart(1, "2500", character, "quit."),
          "8",
          "12",
        ),
        attribute: 0,
      },
    ]);

    expect(parsed.rows[0]?.character).toBe(character);
  });

  it("accepts a four-digit rank", () => {
    const parsed = parseRows([
      HEADER,
      {
        text: withHitPoints(
          entryStart(1000, "42", "Ada-Wiz-Hum-Fem-Neu", "quit."),
          "4",
          "8",
        ),
        attribute: 0,
      },
    ]);

    expect(parsed.rows[0]?.rank).toBe(1000);
  });

  it("parses an entry contained on one physical line", () => {
    const parsed = parseRows([
      HEADER,
      {
        text: withHitPoints(
          entryStart(7, "900", "Ada-Wiz-Hum-Fem-Neu", "ascended to demigoddess-hood."),
          "30",
          "30",
        ),
        attribute: 0,
      },
    ]);

    expect(parsed.rows).toEqual([{
      rank: 7,
      points: "900",
      character: "Ada-Wiz-Hum-Fem-Neu",
      outcome: "ascended to demigoddess-hood.",
      hitPoints: "30",
      maximumHitPoints: "30",
      current: false,
    }]);
  });

  it("represents a bold current entry with a blank rank", () => {
    const parsed = parseRows([
      HEADER,
      {
        text: withHitPoints(
          entryStart(null, "75", "Ada-Wiz-Hum-Fem-Neu", "quit."),
          "5",
          "9",
        ),
        attribute: ATR_BOLD,
      },
    ]);

    expect(parsed.rows[0]).toMatchObject({
      rank: null,
      current: true,
    });
  });

  it("retains preamble lines before the table header", () => {
    const preamble = [
      { text: "You made the top ten list!", attribute: ATR_BOLD },
      { text: "", attribute: 0 },
    ];
    const parsed = parseRows([
      ...preamble,
      HEADER,
      {
        text: withHitPoints(
          entryStart(1, "2500", "Ada-Wiz-Hum-Fem-Neu", "quit."),
          "5",
          "9",
        ),
        attribute: 0,
      },
    ]);

    expect(parsed.preamble).toEqual(preamble);
  });

  it("accepts blank lines separating top and around entries", () => {
    const parsed = parseRows([
      HEADER,
      {
        text: withHitPoints(
          entryStart(1, "2500", "Top-Wiz-Hum-Fem-Neu", "quit."),
          "5",
          "9",
        ),
        attribute: 0,
      },
      { text: "", attribute: 0 },
      {
        text: withHitPoints(
          entryStart(48, "80", "Around-Val-Hum-Mal-Law", "quit."),
          "6",
          "10",
        ),
        attribute: 0,
      },
    ]);

    expect(parsed.rows.map((row) => row.rank)).toEqual([1, 48]);
  });

  it("merges three continuation lines into one outcome", () => {
    const parsed = parseRows([
      HEADER,
      {
        text: entryStart(
          2,
          "1200",
          "Ada-Wiz-Hum-Fem-Neu",
          "died in The Dungeons of",
        ),
        attribute: 0,
      },
      { text: continuation("Doom on level 7."), attribute: 0 },
      { text: continuation("Killed by a very dangerous"), attribute: 0 },
      {
        text: withHitPoints(
          continuation("minotaur."),
          "-",
          "42",
        ),
        attribute: 0,
      },
    ]);

    expect(parsed.rows[0]?.outcome).toBe(
      "died in The Dungeons of Doom on level 7. "
        + "Killed by a very dangerous minotaur.",
    );
  });
});

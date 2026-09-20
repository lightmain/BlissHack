import { ATR_BOLD, type TextLine } from "../game-state";

const RANKING_CONTINUATION_PREFIX = " ".repeat(16);
const RANKING_HEADER =
  /^\s*No\s+Points\s+Name\s+Hp \[max\]\s*$/;
const RANKING_ENTRY = /^( {3}| {0,2}\d+) +(\d+) {2}(.+)$/;
const RANKING_CHARACTER =
  /^(.{1,10}-[A-Za-z?]{1,3}(?:-[A-Za-z?]{1,3})?-[A-Za-z?]{1,3}(?:-[A-Za-z?]{1,3})?) (.+)$/;
const RANKING_HIT_POINTS =
  /^(.*?)(?:\s+)(-|\d+) +\[(\d+)\]\s*$/;

/** One semantic row reconstructed from NetHack's fixed-width score output. */
export interface EndgameRankingRow {
  rank: number | null;
  points: string;
  character: string;
  outcome: string;
  hitPoints: string;
  maximumHitPoints: string;
  current: boolean;
}

/** Complete display data extracted from one core-generated Ranking section. */
export interface EndgameRankingTable {
  preamble: readonly TextLine[];
  rows: readonly EndgameRankingRow[];
}

interface MutableRankingRow {
  rank: number | null;
  points: string;
  character: string;
  outcomeFragments: string[];
  hitPoints: string | null;
  maximumHitPoints: string | null;
  current: boolean;
}

/**
 * Convert NetHack's COLNO=80 score output into semantic table data.
 * @param lines - ordered raw_print lines captured after the endgame summary.
 * @returns parsed rows, or null when any table content is not recognized.
 */
export function parseEndgameRanking(
  lines: readonly TextLine[],
): EndgameRankingTable | null {
  const headerIndex = lines.findIndex((line) =>
    RANKING_HEADER.test(line.text));
  if (headerIndex < 0) return null;

  const rows: EndgameRankingRow[] = [];
  let pending: MutableRankingRow | null = null;
  for (const line of lines.slice(headerIndex + 1)) {
    if (line.text.trim() === "") {
      if (pending && !commitRankingRow(pending, rows)) return null;
      pending = null;
      continue;
    }

    const entry = parseEntryStart(line);
    if (entry) {
      if (pending && !commitRankingRow(pending, rows)) return null;
      pending = entry;
      continue;
    }

    if (!pending || !line.text.startsWith(RANKING_CONTINUATION_PREFIX)) {
      return null;
    }
    if (
      pending.hitPoints !== null
      || !appendOutcomeFragment(
        pending,
        line.text.slice(RANKING_CONTINUATION_PREFIX.length),
      )
    ) {
      return null;
    }
    pending.current ||= isBold(line.attribute);
  }

  if (pending && !commitRankingRow(pending, rows)) return null;
  if (rows.length === 0) return null;
  return {
    preamble: lines.slice(0, headerIndex).map(copyTextLine),
    rows,
  };
}

/**
 * Parse the first physical line of one score entry.
 * @param line - raw fixed-width line beginning with rank and points.
 * @returns a mutable row waiting for optional continuation lines.
 */
function parseEntryStart(line: TextLine): MutableRankingRow | null {
  const match = RANKING_ENTRY.exec(line.text);
  if (!match) return null;
  const character = RANKING_CHARACTER.exec(match[3].trimEnd());
  if (!character) return null;
  const rankText = match[1].trim();
  const row: MutableRankingRow = {
    rank: rankText ? Number(rankText) : null,
    points: match[2],
    character: character[1],
    outcomeFragments: [],
    hitPoints: null,
    maximumHitPoints: null,
    current: isBold(line.attribute),
  };
  return appendOutcomeFragment(row, character[2]) ? row : null;
}

/**
 * Add one wrapped outcome fragment and detach its trailing HP fields.
 * @param row - entry currently being reconstructed.
 * @param fragment - first-line or continuation text after fixed indentation.
 * @returns whether the fragment contains at most one terminal HP suffix.
 */
function appendOutcomeFragment(
  row: MutableRankingRow,
  fragment: string,
): boolean {
  const hitPoints = RANKING_HIT_POINTS.exec(fragment);
  if (hitPoints && row.hitPoints !== null) return false;
  const outcome = (hitPoints?.[1] ?? fragment).trim();
  if (outcome) row.outcomeFragments.push(outcome);
  if (!hitPoints) return true;
  row.hitPoints = hitPoints[2];
  row.maximumHitPoints = hitPoints[3];
  return true;
}

/**
 * Validate and append one completely reconstructed score row.
 * @param row - mutable row accumulated from physical output lines.
 * @param rows - destination semantic table rows.
 * @returns whether all required fields were present.
 */
function commitRankingRow(
  row: MutableRankingRow,
  rows: EndgameRankingRow[],
): boolean {
  if (
    row.outcomeFragments.length === 0
    || row.hitPoints === null
    || row.maximumHitPoints === null
  ) {
    return false;
  }
  rows.push({
    rank: row.rank,
    points: row.points,
    character: row.character,
    outcome: row.outcomeFragments.join(" "),
    hitPoints: row.hitPoints,
    maximumHitPoints: row.maximumHitPoints,
    current: row.current,
  });
  return true;
}

/** Return whether one NetHack text attribute uses the bold base style. */
function isBold(attribute: number): boolean {
  return (attribute & 0x0f) === ATR_BOLD;
}

/** Detach one retained preamble line from mutable bridge state. */
function copyTextLine(line: TextLine): TextLine {
  return { text: line.text, attribute: line.attribute };
}

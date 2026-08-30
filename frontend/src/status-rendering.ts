const HIT_POINT_BAR_WIDTH = 30;

export type HitPointBarTone =
  | "full"
  | "healthy"
  | "warning"
  | "low"
  | "danger"
  | "critical";

/** Text fragments needed to render NetHack's title-backed hit point bar. */
export interface HitPointBar {
  text: string;
  filled: string;
  empty: string;
  percent: number;
  tone: HitPointBarTone;
}

/**
 * Reproduce tty/curses' 30-character title bar and percentage split.
 * @param title - BL_TITLE text.
 * @param percent - BL_HP percentage supplied by status_update.
 * @returns padded title and filled/unfilled fragments.
 */
export function buildHitPointBar(
  title: string,
  percent: number,
): HitPointBar {
  const normalizedPercent = Math.max(0, Math.min(100, Math.trunc(percent)));
  const text = title.trimEnd().slice(0, HIT_POINT_BAR_WIDTH)
    .padEnd(HIT_POINT_BAR_WIDTH, " ");
  let filledLength = Math.floor(
    (HIT_POINT_BAR_WIDTH * normalizedPercent) / 100,
  );
  if (filledLength < 1 && normalizedPercent > 0) filledLength = 1;
  if (
    filledLength >= HIT_POINT_BAR_WIDTH
    && normalizedPercent < 100
  ) {
    filledLength = HIT_POINT_BAR_WIDTH - 1;
  }

  return {
    text,
    filled: text.slice(0, filledLength),
    empty: text.slice(filledLength),
    percent: normalizedPercent,
    tone: hitPointBarTone(normalizedPercent),
  };
}

/**
 * Map HP percentages to NetHack's documented sample status colors.
 * @param percent - normalized or untrusted HP percentage.
 * @returns semantic background tone.
 */
export function hitPointBarTone(percent: number): HitPointBarTone {
  const normalized = Math.max(0, Math.min(100, Math.trunc(percent)));
  if (normalized < 15) return "critical";
  if (normalized < 33) return "danger";
  if (normalized < 50) return "low";
  if (normalized < 66) return "warning";
  if (normalized < 100) return "healthy";
  return "full";
}

const ENDGAME_WHEEL_LINE_PIXELS = 24;
const ENDGAME_WHEEL_DELTA_LINE = 1;
const ENDGAME_WHEEL_DELTA_PAGE = 2;

/**
 * Convert vertical-dominant wheel input into horizontal scroll pixels.
 * @param event - browser wheel deltas and their unit mode.
 * @param pageSize - visible tablist width used for page-mode input.
 * @returns signed horizontal pixels, or null for native horizontal gestures.
 */
export function getEndgameTabWheelDelta(
  event: Readonly<Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">>,
  pageSize: number,
): number | null {
  if (
    !Number.isFinite(event.deltaX)
    || !Number.isFinite(event.deltaY)
    || Math.abs(event.deltaY) <= Math.abs(event.deltaX)
  ) {
    return null;
  }
  if (event.deltaMode === ENDGAME_WHEEL_DELTA_LINE) {
    return event.deltaY * ENDGAME_WHEEL_LINE_PIXELS;
  }
  if (event.deltaMode === ENDGAME_WHEEL_DELTA_PAGE) {
    return event.deltaY * Math.max(0, pageSize);
  }
  return event.deltaY;
}

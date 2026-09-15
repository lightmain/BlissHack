export interface OverlayPoint {
  x: number;
  y: number;
}

export interface OverlaySize {
  width: number;
  height: number;
}

export interface AnchoredOverlayPosition {
  left: number;
  top: number;
  horizontal: "before" | "after";
  vertical: "before" | "after";
}

interface AnchoredOverlayPlacement {
  anchor: OverlayPoint;
  gap: number;
  margin: number;
  overlay: OverlaySize;
  viewport: OverlaySize;
}

/**
 * Place one measured overlay beside an anchor while keeping it in the viewport.
 * @param placement - anchor, measured sizes, gap, and viewport margin.
 * @returns clamped coordinates and the selected horizontal/vertical sides.
 */
export function placeAnchoredOverlay({
  anchor,
  gap,
  margin,
  overlay,
  viewport,
}: AnchoredOverlayPlacement): AnchoredOverlayPosition {
  const fitsAfterX = anchor.x + gap + overlay.width <= viewport.width - margin;
  const fitsAfterY = anchor.y + gap + overlay.height <= viewport.height - margin;
  const horizontal = fitsAfterX ? "after" : "before";
  const vertical = fitsAfterY ? "after" : "before";
  const preferredLeft = horizontal === "after"
    ? anchor.x + gap
    : anchor.x - gap - overlay.width;
  const preferredTop = vertical === "after"
    ? anchor.y + gap
    : anchor.y - gap - overlay.height;
  const maximumLeft = Math.max(margin, viewport.width - margin - overlay.width);
  const maximumTop = Math.max(margin, viewport.height - margin - overlay.height);

  return {
    left: clamp(preferredLeft, margin, maximumLeft),
    top: clamp(preferredTop, margin, maximumTop),
    horizontal,
    vertical,
  };
}

/** Clamp one coordinate between inclusive bounds. */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

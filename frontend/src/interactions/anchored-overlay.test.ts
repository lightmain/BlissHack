import { describe, expect, it } from "vitest";
import { placeAnchoredOverlay } from "./anchored-overlay";

const overlay = { width: 80, height: 40 };
const viewport = { width: 320, height: 200 };

function place(anchor: { x: number; y: number }) {
  return placeAnchoredOverlay({
    anchor,
    gap: 8,
    margin: 8,
    overlay,
    viewport,
  });
}

describe("placeAnchoredOverlay", () => {
  it("clamps against the left viewport edge", () => {
    expect(place({ x: 0, y: 100 })).toEqual({
      left: 8,
      top: 108,
      horizontal: "after",
      vertical: "after",
    });
  });

  it("flips before an anchor near the right viewport edge", () => {
    expect(place({ x: 318, y: 100 })).toEqual({
      left: 230,
      top: 108,
      horizontal: "before",
      vertical: "after",
    });
  });

  it("clamps against the top viewport edge", () => {
    expect(place({ x: 160, y: 0 })).toEqual({
      left: 168,
      top: 8,
      horizontal: "after",
      vertical: "after",
    });
  });

  it("flips above an anchor near the bottom viewport edge", () => {
    expect(place({ x: 160, y: 198 })).toEqual({
      left: 168,
      top: 150,
      horizontal: "after",
      vertical: "before",
    });
  });
});

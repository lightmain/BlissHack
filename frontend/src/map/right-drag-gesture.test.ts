import { describe, expect, it } from "vitest";
import {
  createRightDragGesture,
  finishRightDragGesture,
  moveRightDragGesture,
  RIGHT_DRAG_THRESHOLD,
} from "./right-drag-gesture";

describe("right drag gesture", () => {
  it("uses a five CSS pixel drag threshold", () => {
    expect(RIGHT_DRAG_THRESHOLD).toBe(5);
  });

  it("keeps horizontal movement below the threshold as a click", () => {
    const state = createRightDragGesture({
      pointerId: 7,
      clientX: 100,
      clientY: 80,
      scrollLeft: 40,
      scrollTop: 30,
    });

    expect(moveRightDragGesture(state, {
      pointerId: 7,
      clientX: 104,
      clientY: 80,
    })).toEqual({
      dragging: false,
      left: 40,
      top: 30,
    });
    expect(finishRightDragGesture(state, 7)).toBe("click");
  });

  it("starts a horizontal drag at exactly the threshold", () => {
    const state = createRightDragGesture({
      pointerId: 8,
      clientX: 100,
      clientY: 80,
      scrollLeft: 40,
      scrollTop: 30,
    });

    expect(moveRightDragGesture(state, {
      pointerId: 8,
      clientX: 105,
      clientY: 80,
    })).toEqual({
      dragging: true,
      left: 35,
      top: 30,
    });
    expect(finishRightDragGesture(state, 8)).toBe("drag");
  });

  it("uses diagonal distance and keeps dragging after promotion", () => {
    const state = createRightDragGesture({
      pointerId: 9,
      clientX: 100,
      clientY: 80,
      scrollLeft: 40,
      scrollTop: 30,
    });

    expect(moveRightDragGesture(state, {
      pointerId: 9,
      clientX: 103,
      clientY: 84,
    })).toEqual({
      dragging: true,
      left: 37,
      top: 26,
    });
    expect(moveRightDragGesture(state, {
      pointerId: 9,
      clientX: 101,
      clientY: 81,
    })).toEqual({
      dragging: true,
      left: 39,
      top: 29,
    });
    expect(finishRightDragGesture(state, 9)).toBe("drag");
  });

  it("ignores movement and completion from another pointer", () => {
    const state = createRightDragGesture({
      pointerId: 10,
      clientX: 100,
      clientY: 80,
      scrollLeft: 40,
      scrollTop: 30,
    });

    expect(moveRightDragGesture(state, {
      pointerId: 11,
      clientX: 120,
      clientY: 100,
    })).toBeNull();
    expect(finishRightDragGesture(state, 11)).toBe("ignore");
    expect(finishRightDragGesture(state, 10)).toBe("click");
  });
});

export const RIGHT_DRAG_THRESHOLD = 5;

interface PointerCoordinates {
  clientX: number;
  clientY: number;
  pointerId: number;
}

interface RightDragStart extends PointerCoordinates {
  scrollLeft: number;
  scrollTop: number;
}

export interface RightDragGesture extends RightDragStart {
  dragging: boolean;
}

export interface RightDragMove {
  dragging: boolean;
  left: number;
  top: number;
}

/**
 * Create the mutable state for one secondary-button pointer gesture.
 * @param start - pointer coordinates and initial viewport offsets.
 * @returns fresh gesture state.
 */
export function createRightDragGesture(
  start: RightDragStart,
): RightDragGesture {
  return { ...start, dragging: false };
}

/**
 * Apply one pointer movement to an active right-button gesture.
 * @param gesture - active gesture state.
 * @param point - latest pointer coordinates.
 * @returns target scroll offsets, or null for another pointer.
 */
export function moveRightDragGesture(
  gesture: RightDragGesture,
  point: PointerCoordinates,
): RightDragMove | null {
  if (gesture.pointerId !== point.pointerId) return null;
  const deltaX = point.clientX - gesture.clientX;
  const deltaY = point.clientY - gesture.clientY;
  if (!gesture.dragging) {
    if (Math.hypot(deltaX, deltaY) < RIGHT_DRAG_THRESHOLD) {
      return {
        dragging: false,
        left: gesture.scrollLeft,
        top: gesture.scrollTop,
      };
    }
    gesture.dragging = true;
  }
  return {
    dragging: gesture.dragging,
    left: gesture.scrollLeft - deltaX,
    top: gesture.scrollTop - deltaY,
  };
}

/**
 * Classify completion of one pointer as a click, drag, or unrelated event.
 * @param gesture - active gesture state.
 * @param pointerId - completing pointer identifier.
 * @returns completion type.
 */
export function finishRightDragGesture(
  gesture: RightDragGesture,
  pointerId: number,
): "click" | "drag" | "ignore" {
  if (gesture.pointerId !== pointerId) return "ignore";
  return gesture.dragging ? "drag" : "click";
}

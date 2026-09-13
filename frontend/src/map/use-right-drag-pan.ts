import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  createRightDragGesture,
  finishRightDragGesture,
  moveRightDragGesture,
  type RightDragGesture,
} from "./right-drag-gesture";

interface PointerPoint {
  clientX: number;
  clientY: number;
}

interface ActiveRightDrag {
  gesture: RightDragGesture;
  target: HTMLDivElement;
}

interface RightDragPanOptions {
  onRightClick(point: PointerPoint, target: HTMLDivElement): void;
  viewportRef: RefObject<HTMLDivElement | null>;
}

interface RightDragPan {
  dragging: boolean;
  onPointerCancel(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void;
  onLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>): void;
}

/**
 * Distinguish a secondary click from a right-button map pan.
 * @param options - viewport ref and completed-click callback.
 * @returns pointer handlers and current dragging state.
 */
export function useRightDragPan({
  onRightClick,
  viewportRef,
}: RightDragPanOptions): RightDragPan {
  const gestureRef = useRef<ActiveRightDrag | null>(null);
  const [dragging, setDragging] = useState(false);

  /** Clear one active gesture and release its pointer capture. */
  const clearGesture = useCallback((
    target: HTMLDivElement,
    pointerId: number,
  ): void => {
    if (target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    gestureRef.current = null;
    setDragging(false);
  }, []);

  /** Begin tracking a secondary-button pointer gesture. */
  const onPointerDown = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (event.button !== 2 || gestureRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      gesture: createRightDragGesture({
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: event.pointerId,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      }),
      target: event.currentTarget,
    };
  }, [viewportRef]);

  /** Promote a pending secondary click to a pan after the movement threshold. */
  const onPointerMove = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    const active = gestureRef.current;
    const viewport = viewportRef.current;
    if (!active || !viewport) return;
    const previousDragging = active.gesture.dragging;
    const move = moveRightDragGesture(active.gesture, {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    });
    if (!move?.dragging) return;
    event.preventDefault();
    if (!previousDragging) setDragging(true);
    viewport.scrollLeft = move.left;
    viewport.scrollTop = move.top;
  }, [viewportRef]);

  /** Finish a pan or dispatch the deferred secondary click. */
  const onPointerUp = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    const active = gestureRef.current;
    if (!active) return;
    const completion = finishRightDragGesture(
      active.gesture,
      event.pointerId,
    );
    if (completion === "ignore") return;
    event.preventDefault();
    const point = {
      clientX: active.gesture.clientX,
      clientY: active.gesture.clientY,
    };
    const target = active.target;
    clearGesture(target, event.pointerId);
    if (completion === "click") onRightClick(point, target);
  }, [clearGesture, onRightClick]);

  /** Cancel an interrupted secondary-button gesture without dispatching a click. */
  const onPointerCancel = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    const active = gestureRef.current;
    if (!active || active.gesture.pointerId !== event.pointerId) return;
    clearGesture(active.target, event.pointerId);
  }, [clearGesture]);

  /** Clear state when the browser revokes pointer capture unexpectedly. */
  const onLostPointerCapture = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    const active = gestureRef.current;
    if (!active || active.gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setDragging(false);
  }, []);

  useEffect(() => () => {
    gestureRef.current = null;
  }, []);

  return {
    dragging,
    onLostPointerCapture,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}

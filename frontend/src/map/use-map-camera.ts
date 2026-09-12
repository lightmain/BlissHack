import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import type { GameSnapshot } from "../game-state";
import {
  mapFollowOffset,
  mapScrollAnchor,
  mapScrollOffsetForAnchor,
} from "../map-rendering";

interface MapCameraOptions {
  clipCenter: GameSnapshot["clipCenter"];
  followPlayer: boolean;
  layoutKey: string;
}

interface MapCamera {
  handleScroll(): void;
  positionViewport(): void;
  scrollRef: RefObject<HTMLDivElement | null>;
}

/**
 * Own map scroll position, Follow behavior, and resize restoration.
 * @param options - current Follow target and layout identity.
 * @returns scroll ref and callbacks used by the map viewport.
 */
export function useMapCamera({
  clipCenter,
  followPlayer,
  layoutKey,
}: MapCameraOptions): MapCamera {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<ReturnType<typeof mapScrollAnchor> | null>(
    null,
  );
  const scrollTrackingFrameRef = useRef<number | null>(null);
  const suppressScrollTrackingRef = useRef(false);
  const previousLayoutKey = useRef(layoutKey);

  /** Remember the logical map position at the viewport center. */
  const rememberScrollAnchor = useCallback((): void => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    scrollAnchorRef.current = mapScrollAnchor(viewport);
  }, []);

  /** Center the player or restore the last normalized manual position. */
  const positionViewport = useCallback((): void => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const offset = followPlayer && clipCenter
      ? mapFollowOffset(clipCenter.x, clipCenter.y, viewport)
      : scrollAnchorRef.current
        ? mapScrollOffsetForAnchor(scrollAnchorRef.current, viewport)
        : null;
    if (!offset) {
      rememberScrollAnchor();
      return;
    }
    const preservesManualAnchor = !followPlayer
      && scrollAnchorRef.current !== null;
    suppressScrollTrackingRef.current = preservesManualAnchor;
    if (scrollTrackingFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollTrackingFrameRef.current);
    }
    viewport.scrollLeft = offset.left;
    viewport.scrollTop = offset.top;
    if (!preservesManualAnchor) rememberScrollAnchor();
    scrollTrackingFrameRef.current = window.requestAnimationFrame(() => {
      suppressScrollTrackingRef.current = false;
      scrollTrackingFrameRef.current = null;
    });
  }, [clipCenter, followPlayer, rememberScrollAnchor]);

  useEffect(() => () => {
    if (scrollTrackingFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollTrackingFrameRef.current);
    }
  }, []);

  /** Record user-driven scrolling while ignoring renderer restoration events. */
  const handleScroll = useCallback((): void => {
    if (!suppressScrollTrackingRef.current) rememberScrollAnchor();
  }, [rememberScrollAnchor]);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const layoutChanged = previousLayoutKey.current !== layoutKey;
    previousLayoutKey.current = layoutKey;
    if (followPlayer || layoutChanged || !scrollAnchorRef.current) {
      positionViewport();
    }
  }, [followPlayer, layoutKey, positionViewport]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || !followPlayer || !clipCenter) return;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(positionViewport);
    observer.observe(viewport);
    const content = viewport.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [clipCenter, followPlayer, positionViewport]);

  return {
    handleScroll,
    positionViewport,
    scrollRef,
  };
}

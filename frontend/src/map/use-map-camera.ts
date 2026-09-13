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
  commandInput: boolean;
  followPlayer: boolean;
  layoutKey: string;
}

interface MapCamera {
  handleScroll(): void;
  positionViewport(): void;
  preserveNextFollow(): void;
  scrollRef: RefObject<HTMLDivElement | null>;
}

/**
 * Own map scroll position, Follow behavior, and resize restoration.
 * @param options - current Follow target and layout identity.
 * @returns scroll ref and callbacks used by the map viewport.
 */
export function useMapCamera({
  clipCenter,
  commandInput,
  followPlayer,
  layoutKey,
}: MapCameraOptions): MapCamera {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<ReturnType<typeof mapScrollAnchor> | null>(
    null,
  );
  const scrollTrackingFrameRef = useRef<number | null>(null);
  const suppressScrollTrackingRef = useRef(false);
  const manualPanRef = useRef(false);
  const preserveNextFollowRef = useRef(false);
  const previousClipCenterRef = useRef<GameSnapshot["clipCenter"]>(null);
  const previousFollowPlayerRef = useRef(false);
  const previousLayoutKey = useRef(layoutKey);

  /** Remember the logical map position currently shown by the viewport. */
  const rememberScrollAnchor = useCallback((): void => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    scrollAnchorRef.current = mapScrollAnchor(viewport);
  }, []);

  /** Apply one programmatic scroll while shielding the saved manual anchor. */
  const applyScrollOffset = useCallback((
    offset: { left: number; top: number },
    preserveAnchor: boolean,
  ): void => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    suppressScrollTrackingRef.current = true;
    if (scrollTrackingFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollTrackingFrameRef.current);
    }
    viewport.scrollLeft = offset.left;
    viewport.scrollTop = offset.top;
    if (!preserveAnchor) rememberScrollAnchor();
    scrollTrackingFrameRef.current = window.requestAnimationFrame(() => {
      suppressScrollTrackingRef.current = false;
      scrollTrackingFrameRef.current = null;
    });
  }, [rememberScrollAnchor]);

  /** Center the current Follow target and end a manual camera excursion. */
  const followTarget = useCallback((): void => {
    const viewport = scrollRef.current;
    if (!viewport || !clipCenter) return;
    manualPanRef.current = false;
    applyScrollOffset(
      mapFollowOffset(clipCenter.x, clipCenter.y, viewport),
      false,
    );
  }, [applyScrollOffset, clipCenter]);

  /** Restore the saved normalized manual camera position. */
  const restoreAnchor = useCallback((): void => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    if (!scrollAnchorRef.current) {
      rememberScrollAnchor();
      return;
    }
    applyScrollOffset(
      mapScrollOffsetForAnchor(scrollAnchorRef.current, viewport),
      true,
    );
  }, [applyScrollOffset, rememberScrollAnchor]);

  /** Position for a renderer or viewport resize without discarding manual pan. */
  const positionViewport = useCallback((): void => {
    if (followPlayer && clipCenter && !manualPanRef.current) {
      followTarget();
      return;
    }
    restoreAnchor();
  }, [clipCenter, followPlayer, followTarget, restoreAnchor]);

  /** Preserve the current viewport through the next Follow target request. */
  const preserveNextFollow = useCallback((): void => {
    rememberScrollAnchor();
    manualPanRef.current = true;
    preserveNextFollowRef.current = true;
  }, [rememberScrollAnchor]);

  useEffect(() => () => {
    if (scrollTrackingFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollTrackingFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (commandInput) preserveNextFollowRef.current = false;
  }, [commandInput]);

  /** Record user-driven scrolling while ignoring renderer restoration events. */
  const handleScroll = useCallback((): void => {
    if (suppressScrollTrackingRef.current) return;
    rememberScrollAnchor();
    manualPanRef.current = true;
  }, [rememberScrollAnchor]);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const layoutChanged = previousLayoutKey.current !== layoutKey;
    const previousClipCenter = previousClipCenterRef.current;
    const targetRequested = clipCenter !== null
      && (previousClipCenter === null
        || previousClipCenter.x !== clipCenter.x
        || previousClipCenter.y !== clipCenter.y);
    const followEnabled = followPlayer && !previousFollowPlayerRef.current;
    previousLayoutKey.current = layoutKey;
    previousClipCenterRef.current = clipCenter;
    previousFollowPlayerRef.current = followPlayer;

    if (followPlayer && clipCenter && (targetRequested || followEnabled)) {
      if (preserveNextFollowRef.current) {
        restoreAnchor();
      } else {
        followTarget();
      }
      return;
    }
    if (layoutChanged || !scrollAnchorRef.current) {
      positionViewport();
    }
  }, [
    clipCenter,
    followPlayer,
    followTarget,
    layoutKey,
    positionViewport,
    restoreAnchor,
  ]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
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
    preserveNextFollow,
    scrollRef,
  };
}

import { memo, type MouseEvent as ReactMouseEvent } from "react";
import {
  getSnapshot,
  type GameSnapshot,
  type MapCell,
} from "../game-state";
import { mapPositionFromPoint } from "../map-rendering";
import { sendPosition } from "../nethack-bridge";
import type { InterfaceSettings } from "../settings/profile";
import { AsciiMapRenderer } from "./AsciiMapRenderer";
import {
  TileMapRenderer,
  type TileRendererFallbackReason,
} from "./TileMapRenderer";
import { useMapCamera } from "./use-map-camera";
import { useRightDragPan } from "./use-right-drag-pan";

interface MapViewportProps {
  clipCenter: GameSnapshot["clipCenter"];
  commandInput: boolean;
  cursor: GameSnapshot["cursor"];
  followPlayer: boolean;
  layoutKey: string;
  map: MapCell[][];
  mapRenderer: InterfaceSettings["mapRenderer"];
  onMapRendererFallback?(reason: TileRendererFallbackReason): void;
}

/**
 * Render one map renderer inside the shared scrolling and input viewport.
 * @param props - map content, camera state, and renderer selection.
 * @returns the interactive map viewport.
 */
export const MapViewport = memo(function MapViewport({
  clipCenter,
  commandInput,
  cursor,
  followPlayer,
  layoutKey,
  map,
  mapRenderer,
  onMapRendererFallback,
}: MapViewportProps) {
  const {
    handleScroll,
    positionViewport,
    preserveNextFollow,
    scrollRef,
  } = useMapCamera({
    clipCenter,
    commandInput,
    followPlayer,
    layoutKey,
  });

  /**
   * Submit one map position with the requested NetHack mouse modifier.
   * @param clientX - pointer viewport x-coordinate.
   * @param clientY - pointer viewport y-coordinate.
   * @param modifier - NetHack primary or secondary click modifier.
   * @param target - complete interactive map surface.
   */
  function submitMapPosition(
    clientX: number,
    clientY: number,
    modifier: 1 | 2,
    target: HTMLDivElement,
  ): void {
    if (getSnapshot().inputRequest?.kind !== "position") return;
    const position = mapPositionFromPoint(
      clientX,
      clientY,
      target.getBoundingClientRect(),
    );
    if (!position) return;
    if (modifier === 2) preserveNextFollow();
    sendPosition(position.x, position.y, modifier);
  }

  const rightDrag = useRightDragPan({
    onRightClick: (point, target) => {
      submitMapPosition(point.clientX, point.clientY, 2, target);
    },
    viewportRef: scrollRef,
  });

  /**
   * Submit a primary map click while nh_poskey is pending.
   * @param event - delegated mouse event from the map surface.
   */
  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.preventDefault();
    submitMapPosition(
      event.clientX,
      event.clientY,
      1,
      event.currentTarget,
    );
  }

  /**
   * Suppress the browser context menu while NetHack accepts map clicks.
   * @param event - browser context-menu event.
   */
  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>): void {
    event.preventDefault();
  }

  return (
    <div
      className="nh-map-scroll"
      onScroll={handleScroll}
      ref={scrollRef}
    >
      <div
        className="nh-map-interaction"
        data-cursor-visible={cursor.visible ? "true" : "false"}
        data-cursor-x={cursor.x}
        data-cursor-y={cursor.y}
        data-dragging={rightDrag.dragging ? "true" : "false"}
        onLostPointerCapture={rightDrag.onLostPointerCapture}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        onPointerCancel={rightDrag.onPointerCancel}
        onPointerDown={rightDrag.onPointerDown}
        onPointerMove={rightDrag.onPointerMove}
        onPointerUp={rightDrag.onPointerUp}
      >
        {mapRenderer === "tiles"
          ? (
            <TileMapRenderer
              cursor={cursor}
              map={map}
              onFallback={onMapRendererFallback}
              onReady={positionViewport}
            />
          )
          : <AsciiMapRenderer cursor={cursor} map={map} />}
      </div>
    </div>
  );
});

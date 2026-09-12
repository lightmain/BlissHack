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

interface MapViewportProps {
  clipCenter: GameSnapshot["clipCenter"];
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
    scrollRef,
  } = useMapCamera({ clipCenter, followPlayer, layoutKey });

  /**
   * Submit a primary or secondary map click while nh_poskey is pending.
   * @param event - delegated mouse event from the map surface.
   */
  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>): void {
    if (getSnapshot().inputRequest?.kind !== "position") return;
    const position = mapPositionFromPoint(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    );
    if (!position) return;
    event.preventDefault();
    sendPosition(position.x, position.y, event.button === 2 ? 2 : 1);
  }

  /**
   * Suppress the browser context menu while NetHack accepts map clicks.
   * @param event - browser context-menu event.
   */
  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>): void {
    if (getSnapshot().inputRequest?.kind === "position") event.preventDefault();
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
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
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

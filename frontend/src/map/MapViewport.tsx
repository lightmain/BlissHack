import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { GameSnapshot, MapCell } from "../game-state";
import type { InteractionOrigin } from "../game-actions/interaction-origin";
import { mapPositionFromPoint } from "../map-rendering";
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
  onContextClick(origin: MapInteractionOrigin): boolean;
  onHoverLeave?(): void;
  onHoverTarget?(origin: MapInteractionOrigin): void;
  onMapRendererFallback?(reason: TileRendererFallbackReason): void;
  onPrimaryClick(origin: MapInteractionOrigin): void;
}

export type MapInteractionOrigin = Extract<
  InteractionOrigin,
  { kind: "map" }
>;

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
  onContextClick,
  onHoverLeave,
  onHoverTarget,
  onMapRendererFallback,
  onPrimaryClick,
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
   * Resolve one browser point into a stable map interaction origin.
   * @param clientX - pointer viewport x-coordinate.
   * @param clientY - pointer viewport y-coordinate.
   * @param target - complete interactive map surface.
   * @returns a serializable interaction origin, or null outside the map.
   */
  function mapOrigin(
    clientX: number,
    clientY: number,
    target: HTMLDivElement,
  ): MapInteractionOrigin | null {
    const position = mapPositionFromPoint(
      clientX,
      clientY,
      target.getBoundingClientRect(),
    );
    return position
      ? {
        kind: "map",
        clientX,
        clientY,
        mapX: position.x,
        mapY: position.y,
      }
      : null;
  }

  const rightDrag = useRightDragPan({
    onRightClick: (point, target) => {
      const origin = mapOrigin(point.clientX, point.clientY, target);
      if (!origin) return;
      if (onContextClick(origin)) preserveNextFollow();
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
    const origin = mapOrigin(
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
    if (origin) onPrimaryClick(origin);
  }

  /**
   * Publish a hover target while allowing the right-drag owner to pan.
   * @param event - delegated pointer movement from the map surface.
   */
  function handlePointerMove(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    rightDrag.onPointerMove(event);
    if ((event.buttons & 2) !== 0 || rightDrag.dragging) {
      onHoverLeave?.();
      return;
    }
    const origin = mapOrigin(
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
    if (origin) onHoverTarget?.(origin);
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
      data-hud-region="map"
      data-overflow-owner="map"
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
        onPointerLeave={onHoverLeave}
        onPointerCancel={rightDrag.onPointerCancel}
        onPointerDown={rightDrag.onPointerDown}
        onPointerMove={handlePointerMove}
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

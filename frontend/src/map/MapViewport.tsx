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
  directionTargeting?: boolean;
  followPlayer: boolean;
  inventoryDropHighlight?: { x: number; y: number } | null;
  layoutKey: string;
  map: MapCell[][];
  mapRenderer: InterfaceSettings["mapRenderer"];
  onContextClick(origin: MapInteractionOrigin): boolean;
  onDragChange?(dragging: boolean): void;
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
  directionTargeting = false,
  followPlayer,
  inventoryDropHighlight,
  layoutKey,
  map,
  mapRenderer,
  onContextClick,
  onDragChange,
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
    onViewportChange: onHoverLeave,
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
    onDragChange,
    onRightClick: (point, target) => {
      const origin = mapOrigin(point.clientX, point.clientY, target);
      if (!origin) return;
      if (onContextClick(origin)) preserveNextFollow();
    },
    viewportRef: scrollRef,
  });
  const directionTargets = directionTargeting && cursor.visible
    ? adjacentMapTargets(cursor.x, cursor.y)
    : [];

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

  /** Clear hover state before a secondary click can become a drag. */
  function handlePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if (event.button === 2) onHoverLeave?.();
    rightDrag.onPointerDown(event);
  }

  /** Clear hover state when the browser cancels the active pointer. */
  function handlePointerCancel(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    onHoverLeave?.();
    rightDrag.onPointerCancel(event);
  }

  /** Clear hover state when pointer capture is revoked unexpectedly. */
  function handleLostPointerCapture(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    onHoverLeave?.();
    rightDrag.onLostPointerCapture(event);
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
      data-inventory-drop-zone="true"
      data-overflow-owner="map"
      data-player-x={cursor.x}
      data-player-y={cursor.y}
      onScroll={handleScroll}
      ref={scrollRef}
    >
      <div
        className="nh-map-interaction"
        data-context-menu-trigger="map"
        data-cursor-visible={cursor.visible ? "true" : "false"}
        data-cursor-x={cursor.x}
        data-cursor-y={cursor.y}
        data-dragging={rightDrag.dragging ? "true" : "false"}
        data-direction-targeting={directionTargeting ? "true" : "false"}
        onLostPointerCapture={handleLostPointerCapture}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        onPointerLeave={() => onHoverLeave?.()}
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={rightDrag.onPointerUp}
        tabIndex={-1}
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
        {inventoryDropHighlight && (
          <div
            aria-hidden="true"
            className="nh-inventory-drop-highlight"
            data-inventory-drop-highlight="true"
            data-map-x={inventoryDropHighlight.x}
            data-map-y={inventoryDropHighlight.y}
            style={{
              left: `${(inventoryDropHighlight.x / 80) * 100}%`,
              top: `${(inventoryDropHighlight.y / 21) * 100}%`,
            }}
          />
        )}
        {directionTargets.map((target) => (
          <div
            aria-hidden="true"
            className="nh-direction-target-highlight"
            data-direction-target-highlight="true"
            data-map-x={target.x}
            data-map-y={target.y}
            key={`${target.x}:${target.y}`}
            style={{
              left: `${(target.x / 80) * 100}%`,
              top: `${(target.y / 21) * 100}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
});

/**
 * Enumerate in-bounds adjacent cells around the visible player cursor.
 * @param x - player map column.
 * @param y - player map row.
 * @returns up to eight adjacent map coordinates.
 */
function adjacentMapTargets(
  x: number,
  y: number,
): Array<{ x: number; y: number }> {
  const targets: Array<{ x: number; y: number }> = [];
  for (let yDelta = -1; yDelta <= 1; yDelta += 1) {
    for (let xDelta = -1; xDelta <= 1; xDelta += 1) {
      if (xDelta === 0 && yDelta === 0) continue;
      const target = { x: x + xDelta, y: y + yDelta };
      if (target.x >= 1 && target.x < 80 && target.y >= 0 && target.y < 21) {
        targets.push(target);
      }
    }
  }
  return targets;
}

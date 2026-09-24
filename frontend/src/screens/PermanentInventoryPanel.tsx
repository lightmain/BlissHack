import {
  useEffect,
  useRef,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { InteractionOrigin } from "../game-actions/interaction-origin";
import type { MenuItem, PermanentInventoryState } from "../game-state";
import type { LocalInspectRequest } from "../interactions/InspectTooltip";
import type {
  InventoryDragController,
  InventoryDropTarget,
} from "../interactions/inventory-drag-controller";
import type { PermanentInventoryPosition } from "../settings/profile";
import { colorClass, textAttributeClass } from "../text-styling";

interface PermanentInventoryPanelProps {
  backgroundInert?: boolean;
  collapsed: boolean;
  dragController?: InventoryDragController;
  dragEnabled?: boolean;
  inventory: PermanentInventoryState;
  onCollapsedChange(collapsed: boolean): void;
  onContextItem?(request: InventoryContextRequest): void;
  onInspect?(request: LocalInspectRequest): void;
  onInspectLeave?(key?: string): void;
  position: PermanentInventoryPosition;
  sessionId?: string;
}

export interface InventoryContextRequest {
  identifier: number;
  origin: Extract<InteractionOrigin, { kind: "inventory" }>;
}

/**
 * Render the shared glyph, marker, accelerator, and text columns for an item.
 * @param props - one decoded core menu item.
 * @returns the reusable visual content for inventory rows.
 */
export function InventoryItemContent({ item }: { item: MenuItem }) {
  const glyph = item.glyph?.ttyChar
    ? String.fromCodePoint(item.glyph.ttyChar)
    : "";
  const accelerator = item.accelerator
    ? String.fromCodePoint(item.accelerator)
    : "";
  return (
    <>
      <span aria-hidden="true" className="nh-menu-glyph">
        {glyph || " "}
      </span>
      <span aria-hidden="true" className="nh-menu-mark">
        {" "}
      </span>
      <span aria-hidden="true" className="nh-menu-accelerator">
        {accelerator || " "}
      </span>
      <span className="nh-menu-text">{item.text}</span>
    </>
  );
}

/**
 * Render NetHack's committed permanent-inventory snapshot without actions.
 */
export function PermanentInventoryPanel({
  backgroundInert = false,
  collapsed,
  dragController,
  dragEnabled = false,
  inventory,
  onCollapsedChange,
  onContextItem,
  onInspect,
  onInspectLeave,
  position,
  sessionId = "",
}: PermanentInventoryPanelProps) {
  const mouseFocusRef = useRef(false);
  const previousRevisionRef = useRef(inventory.revision);
  const itemCount = inventory.items.filter(
    (item) => item.identifier !== null,
  ).length;
  const toggleLabel = collapsed ? "Expand inventory" : "Collapse inventory";

  useEffect(() => {
    if (previousRevisionRef.current === inventory.revision) return;
    previousRevisionRef.current = inventory.revision;
    onInspectLeave?.();
  }, [inventory.revision, onInspectLeave]);

  useEffect(() => () => {
    dragController?.cancel("unmount");
  }, [dragController]);

  useEffect(() => {
    if (collapsed) dragController?.cancel("unmount");
  }, [collapsed, dragController]);

  /**
   * Mark the start of a mouse gesture which may focus the panel container.
   */
  function handleMouseDown(): void {
    mouseFocusRef.current = true;
  }

  /**
   * Clear mouse focus intent after the gesture completes or leaves the panel.
   */
  function handleMouseEnd(): void {
    mouseFocusRef.current = false;
  }

  /**
   * Keep keyboard focus for scrolling, but release incidental mouse focus.
   * @param event - focus event delegated from the inventory panel.
   */
  function handleFocus(event: FocusEvent<HTMLElement>): void {
    if (
      event.target === event.currentTarget
      && mouseFocusRef.current
    ) {
      event.currentTarget.blur();
    }
  }

  return (
    <aside
      aria-label="Inventory"
      className={`permanent-inventory permanent-inventory-${position}${collapsed ? " permanent-inventory-collapsed" : ""}`}
      data-game-content="true"
      data-hud-region="inventory"
      data-inventory-revision={inventory.revision}
      data-overflow-owner="inventory"
      data-position={position}
      data-game-keyboard-pass-through
      inert={backgroundInert}
      onFocus={handleFocus}
      onMouseDown={handleMouseDown}
      onMouseLeave={handleMouseEnd}
      onMouseUp={handleMouseEnd}
      role="region"
      tabIndex={-1}
    >
      <header className="permanent-inventory-header">
        <div>
          <strong>{inventory.prompt || "Inventory"}</strong>
          <span>{itemCount} {itemCount === 1 ? "item" : "items"}</span>
        </div>
        <button
          aria-label={toggleLabel}
          onClick={(event) => {
            event.currentTarget.blur();
            onCollapsedChange(!collapsed);
          }}
          tabIndex={-1}
          title={toggleLabel}
          type="button"
        >
          {collapsed
            ? <ChevronRight aria-hidden="true" size={17} />
            : <ChevronLeft aria-hidden="true" size={17} />}
        </button>
      </header>
      {!collapsed && (
        <div className="nh-menu-items permanent-inventory-items">
          {inventory.items.map((item, index) => {
            const glyph = item.glyph?.ttyChar
              ? String.fromCodePoint(item.glyph.ttyChar)
              : "";
            const identifier = item.identifier;
            return (
              identifier === null
                ? (
                  <div
                    className={`nh-menu-heading permanent-inventory-heading ${textAttributeClass(item.attribute)}`}
                    key={`${inventory.revision}-${index}`}
                  >
                    {item.text || "\u00a0"}
                  </div>
                )
                : (
                  <button
                    aria-haspopup="menu"
                    className={[
                      "nh-menu-item",
                      "permanent-inventory-item",
                      item.itemFlags !== 0 ? "selected" : "",
                      colorClass(item.color),
                      textAttributeClass(item.attribute),
                    ].filter(Boolean).join(" ")}
                    data-inspect-target={`inventory:${inventory.revision}:${item.accelerator}`}
                    data-inventory-dragging={
                      dragController?.getState().payload?.identifier === identifier
                        ? "true"
                        : "false"
                    }
                    key={`${inventory.revision}-${index}`}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.currentTarget.focus();
                      onInspectLeave?.();
                      requestInventoryContext(
                        event,
                        inventory,
                        identifier,
                        item.accelerator,
                        onContextItem,
                      );
                    }}
                    onLostPointerCapture={(event) => {
                      dragController?.cancel(
                        "lost-pointer-capture",
                        event.pointerId,
                      );
                    }}
                    onPointerCancel={(event) => {
                      cancelInventoryDrag(
                        event,
                        dragController,
                        "pointer-cancel",
                      );
                    }}
                    onPointerDown={(event) => {
                      if (!dragController || !dragEnabled) return;
                      const bounds = event.currentTarget.getBoundingClientRect();
                      if (!dragController.pointerDown({
                        button: event.button,
                        clientX: event.clientX,
                        clientY: event.clientY,
                        payload: {
                          kind: "inventory-item",
                          sessionId,
                          inventoryRevision: inventory.revision,
                          identifier,
                          accelerator: item.accelerator,
                          glyph: item.glyph,
                          clientX: bounds.left,
                          clientY: bounds.top + bounds.height / 2,
                          text: item.text,
                        },
                        pointerId: event.pointerId,
                      })) {
                        return;
                      }
                      event.preventDefault();
                      event.currentTarget.focus();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      onInspectLeave?.();
                    }}
                    onPointerEnter={(event) =>
                      requestInventoryInspect(
                        event,
                        inventory,
                        item.accelerator,
                        item.text,
                        glyph,
                        onInspect,
                      )}
                    onPointerLeave={() =>
                      onInspectLeave?.(
                        `inventory:${inventory.revision}:${item.accelerator}`,
                      )}
                    onPointerMove={(event) => {
                      dragController?.pointerMove({
                        clientX: event.clientX,
                        clientY: event.clientY,
                        pointerId: event.pointerId,
                        target: inventoryDropTargetAt(
                          event.clientX,
                          event.clientY,
                        ),
                      });
                    }}
                    onPointerUp={(event) => {
                      if (!dragController) return;
                      dragController.pointerMove({
                        clientX: event.clientX,
                        clientY: event.clientY,
                        pointerId: event.pointerId,
                        target: inventoryDropTargetAt(
                          event.clientX,
                          event.clientY,
                        ),
                      });
                      dragController.pointerUp(event.pointerId);
                      releaseInventoryPointer(event);
                    }}
                    tabIndex={-1}
                    type="button"
                  >
                    <InventoryItemContent item={item} />
                  </button>
                )
            );
          })}
        </div>
      )}
    </aside>
  );
}

/**
 * Cancel a captured inventory drag and release its browser pointer.
 * @param event - interrupted pointer event.
 * @param controller - active pure drag controller.
 * @param reason - stable cancellation reason.
 */
function cancelInventoryDrag(
  event: PointerEvent<HTMLButtonElement>,
  controller: InventoryDragController | undefined,
  reason: "pointer-cancel",
): void {
  controller?.cancel(reason, event.pointerId);
  releaseInventoryPointer(event);
}

/**
 * Release pointer capture after the pure controller has cleared its gesture.
 * @param event - pointer event whose target owns capture.
 */
function releaseInventoryPointer(
  event: PointerEvent<HTMLButtonElement>,
): void {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

/**
 * Resolve a viewport point to the renderer-independent map drop region.
 * @param clientX - horizontal viewport coordinate.
 * @param clientY - vertical viewport coordinate.
 * @returns the player's cell while over the map, otherwise null.
 */
function inventoryDropTargetAt(
  clientX: number,
  clientY: number,
): InventoryDropTarget | null {
  const element = document.elementFromPoint(clientX, clientY);
  const zone = element?.closest<HTMLElement>(
    "[data-inventory-drop-zone='true']",
  );
  if (!zone) return null;
  const playerX = Number(zone.dataset.playerX);
  const playerY = Number(zone.dataset.playerY);
  if (!Number.isInteger(playerX) || !Number.isInteger(playerY)) return null;
  return { kind: "map", playerX, playerY };
}

/**
 * Copy one permanent-inventory row into a serializable context request.
 * @param event - browser context-menu event.
 * @param inventory - committed inventory snapshot which owns the row.
 * @param identifier - snapshot-local core identifier used only for validation.
 * @param accelerator - current core-provided inventory letter.
 * @param onContextItem - optional action callback.
 */
function requestInventoryContext(
  event: MouseEvent<HTMLButtonElement>,
  inventory: PermanentInventoryState,
  identifier: number,
  accelerator: number,
  onContextItem?: (request: InventoryContextRequest) => void,
): void {
  if (!onContextItem) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  onContextItem({
    identifier,
    origin: {
      kind: "inventory",
      clientX: bounds.left,
      clientY: bounds.top + bounds.height / 2,
      inventoryRevision: inventory.revision,
      accelerator,
    },
  });
}

/**
 * Convert one permanent-inventory row into a presentation-only tooltip request.
 * @param event - pointer event used only to copy current viewport geometry.
 * @param inventory - committed inventory snapshot which owns the row.
 * @param accelerator - current core-provided inventory letter.
 * @param text - current core-provided item description.
 * @param glyph - decoded visible item character.
 * @param onInspect - optional shared overlay callback.
 */
function requestInventoryInspect(
  event: PointerEvent<HTMLButtonElement>,
  inventory: PermanentInventoryState,
  accelerator: number,
  text: string,
  glyph: string,
  onInspect?: (request: LocalInspectRequest) => void,
): void {
  if (!onInspect) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  onInspect({
    kind: "inventory",
    key: `inventory:${inventory.revision}:${accelerator}`,
    anchor: {
      clientX: bounds.left,
      clientY: bounds.top + bounds.height / 2,
    },
    content: {
      title: text,
      description: "Inventory item",
      glyph: glyph || undefined,
    },
  });
}

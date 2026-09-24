import type { ReactNode } from "react";
import type {
  ActionBarStyle,
  PermanentInventoryPosition,
} from "../../settings/profile";

interface GameHudLayoutProps {
  allActionsOpen?: boolean;
  actionBarStyle: ActionBarStyle;
  actionSlot?: ReactNode;
  inventory: ReactNode;
  inventoryCollapsed: boolean;
  map: ReactNode;
  messages: ReactNode;
  position: PermanentInventoryPosition;
  status: ReactNode;
}

/**
 * Own the viewport grid containing every in-game HUD region.
 * @param props - complete region content and inventory placement.
 * @returns the stable full-screen HUD grid.
 */
export function GameHudLayout({
  allActionsOpen = false,
  actionBarStyle,
  actionSlot,
  inventory,
  inventoryCollapsed,
  map,
  messages,
  position,
  status,
}: GameHudLayoutProps) {
  return (
    <div
      className={`nh-hud-layout nh-hud-layout-${position}`}
      data-all-actions-open={allActionsOpen ? "true" : "false"}
      data-has-inventory={inventory ? "true" : "false"}
      data-action-bar-style={actionBarStyle}
      data-inventory-collapsed={inventoryCollapsed ? "true" : "false"}
      data-inventory-position={position}
      data-layout-owner="GameHudLayout"
    >
      {messages}
      {map}
      {inventory}
      {status}
      <div
        className="nh-hud-action-slot"
        data-bottom-region="true"
        data-hud-region="actions"
      >
        {actionSlot}
      </div>
    </div>
  );
}

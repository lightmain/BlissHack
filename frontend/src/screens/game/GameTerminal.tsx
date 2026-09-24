import {
  memo,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
} from "react";
import {
  type GameSnapshot,
  type MapCell,
  type TextLine,
} from "../../game-state";
import {
  MapViewport,
  type MapInteractionOrigin,
} from "../../map/MapViewport";
import type { TileRendererFallbackReason } from "../../map/TileMapRenderer";
import type { LocalInspectRequest } from "../../interactions/InspectTooltip";
import type {
  InventoryDragController,
  InventoryDragState,
} from "../../interactions/inventory-drag-controller";
import {
  normalizePlayerNameInput,
  submitLine,
} from "../../nethack-bridge";
import type { InterfaceSettings } from "../../settings/profile";
import type { ActionBarLayout } from "../../action-bar/action-bar-layout";
import type { SessionActionCatalog } from "../../game-actions/action-catalog";
import { buildStatusMetrics } from "../../status-metrics";
import { textAttributeClass } from "../../text-styling";
import {
  PermanentInventoryPanel,
  type InventoryContextRequest,
} from "../PermanentInventoryPanel";
import { GameHudLayout } from "./GameHudLayout";
import { StatusArea } from "./StatusArea";
import { ActionDock } from "./ActionDock";

interface GameTerminalProps {
  activeActionName: string | null;
  actionBarLayout: ActionBarLayout;
  actionBarStyle: InterfaceSettings["actionBarStyle"];
  actionBlocked: boolean;
  actionCatalog: SessionActionCatalog | null;
  clipCenter: GameSnapshot["clipCenter"];
  commandInput: boolean;
  cursor: GameSnapshot["cursor"];
  directionTargeting: boolean;
  followPlayer: boolean;
  historyLines: InterfaceSettings["messageHistoryLines"];
  informationLevel: InterfaceSettings["informationLevel"];
  inert: boolean;
  inputRequest: GameSnapshot["inputRequest"];
  inventoryDragController: InventoryDragController;
  inventoryDragState: InventoryDragState;
  layoutKey: string;
  map: MapCell[][];
  mapRenderer: InterfaceSettings["mapRenderer"];
  messages: TextLine[];
  onContextClick(origin: MapInteractionOrigin): boolean;
  onContextItem?(request: InventoryContextRequest): void;
  onDragChange?(dragging: boolean): void;
  onHoverLeave?(): void;
  onHoverTarget?(origin: MapInteractionOrigin): void;
  onInspect?(request: LocalInspectRequest): void;
  onInspectLeave?(key?: string): void;
  onInventoryCollapsedChange(collapsed: boolean): void;
  onMapRendererFallback?(reason: TileRendererFallbackReason): void;
  onActionRequest(request: {
    name: string;
    sessionCommandId: number;
  }): void;
  onActionBarLayoutChange?(layout: ActionBarLayout): void;
  onPrimaryClick(origin: MapInteractionOrigin): void;
  permanentInventory: GameSnapshot["permanentInventory"];
  permanentInventoryCollapsed: boolean;
  permanentInventoryEnabled: boolean;
  permanentInventoryPosition: InterfaceSettings["permanentInventoryPosition"];
  sessionId: string;
  status: GameSnapshot["status"];
  statusMetadata: GameSnapshot["statusMetadata"];
}

/** Render the active terminal while keeping browser overlays outside its inert tree. */
export function GameTerminal({
  activeActionName,
  actionBarLayout,
  actionBarStyle,
  actionBlocked,
  actionCatalog,
  clipCenter,
  commandInput,
  cursor,
  directionTargeting,
  followPlayer,
  historyLines,
  informationLevel,
  inert,
  inputRequest,
  inventoryDragController,
  inventoryDragState,
  layoutKey,
  map,
  mapRenderer,
  messages,
  onContextClick,
  onContextItem,
  onDragChange,
  onHoverLeave,
  onHoverTarget,
  onInspect,
  onInspectLeave,
  onInventoryCollapsedChange,
  onMapRendererFallback,
  onActionRequest,
  onActionBarLayoutChange,
  onPrimaryClick,
  permanentInventory,
  permanentInventoryCollapsed,
  permanentInventoryEnabled,
  permanentInventoryPosition,
  sessionId,
  status,
  statusMetadata,
}: GameTerminalProps) {
  const statusMetrics = useMemo(
    () => buildStatusMetrics(status, statusMetadata),
    [status, statusMetadata],
  );
  const inventory = permanentInventoryEnabled && permanentInventory
    ? (
      <PermanentInventoryPanel
        collapsed={permanentInventoryCollapsed}
        dragController={inventoryDragController}
        dragEnabled={commandInput && !inert}
        inventory={permanentInventory}
        onContextItem={onContextItem}
        onInspect={onInspect}
        onInspectLeave={onInspectLeave}
        onCollapsedChange={onInventoryCollapsedChange}
        position={permanentInventoryPosition}
        sessionId={sessionId}
      />
    )
    : null;
  const statusArea = (
    <StatusArea
      informationLevel={informationLevel}
      metrics={statusMetrics}
      onInspect={onInspect}
      onInspectLeave={onInspectLeave}
    />
  );
  const inputArea = <InputArea request={inputRequest} />;
  const originalStatus = actionBarStyle === "original"
    ? (
      <div
        className="nh-hud-status-region"
        data-hud-region="status"
        data-overflow-owner="status"
      >
        {statusArea}
        {inputArea}
      </div>
    )
    : null;
  const actionDock = actionBarStyle === "blisshack"
    ? (
      <ActionDock
        activeActionName={activeActionName}
        blocked={actionBlocked}
        catalog={actionCatalog}
        input={inputArea}
        layout={actionBarLayout}
        onActionRequest={onActionRequest}
        onLayoutChange={onActionBarLayoutChange}
        status={statusArea}
      />
    )
    : null;

  return (
    <section
      aria-label="NetHack terminal"
      className="nh-terminal"
      inert={inert}
    >
      <GameHudLayout
        actionBarStyle={actionBarStyle}
        actionSlot={actionDock}
        inventory={inventory}
        inventoryCollapsed={permanentInventoryCollapsed}
        map={(
          <MapViewport
            clipCenter={clipCenter}
            commandInput={commandInput}
            cursor={cursor}
            directionTargeting={directionTargeting}
            followPlayer={followPlayer}
            inventoryDropHighlight={
              inventoryDragState.preview?.highlightedCell ?? null
            }
            layoutKey={layoutKey}
            map={map}
            mapRenderer={mapRenderer}
            onContextClick={onContextClick}
            onDragChange={onDragChange}
            onHoverLeave={onHoverLeave}
            onHoverTarget={onHoverTarget}
            onMapRendererFallback={onMapRendererFallback}
            onPrimaryClick={onPrimaryClick}
          />
        )}
        messages={(
          <MessageArea historyLines={historyLines} messages={messages} />
        )}
        position={permanentInventoryPosition}
        status={originalStatus}
      />
    </section>
  );
}

/**
 * Render the recent NetHack message stream.
 * @param props - current game snapshot.
 * @returns message region.
 */
const MessageArea = memo(function MessageArea({
  historyLines,
  messages: allMessages,
}: {
  historyLines: InterfaceSettings["messageHistoryLines"];
  messages: TextLine[];
}) {
  const messages = allMessages.slice(-historyLines);
  return (
    <section
      className={`nh-messages nh-messages-${historyLines}`}
      aria-live="polite"
      aria-label="Messages"
      data-hud-region="messages"
      data-overflow-owner="messages"
    >
      {messages.length === 0
        ? <div className="nh-message">&nbsp;</div>
        : messages.map((line, index) => (
          <div
            className={textAttributeClass(line.attribute)}
            key={`${index}:${line.text}`}
          >
            {line.text || "\u00a0"}
          </div>
        ))}
    </section>
  );
});

/**
 * Render the active prompt or line editor.
 * @param props - current game snapshot.
 * @returns bottom input region.
 */
const InputArea = memo(function InputArea({
  request,
}: {
  request: GameSnapshot["inputRequest"];
}) {
  if (request?.kind === "line") {
    return (
      <LineInput
        existingSaveNames={request.existingSaveNames ?? []}
        purpose={request.purpose}
        query={request.query}
      />
    );
  }
  if (request?.kind === "yn") {
    const choices = request.choices?.split("\u001b")[0] ?? "";
    const defaultCharacter = request.defaultCode > 0
      ? String.fromCharCode(request.defaultCode)
      : "";
    return (
      <div className="nh-prompt">
        <span>{request.query}</span>
        {choices && <span>[{choices}]</span>}
        {defaultCharacter && <span className="nh-default">{defaultCharacter}</span>}
      </div>
    );
  }
  if (request?.kind === "message") {
    return <div className="nh-prompt">{request.message}</div>;
  }
  return <div className="nh-prompt">&nbsp;</div>;
});

/**
 * Render and submit askname/getlin text input.
 * @param props - prompt purpose and query.
 * @returns a focused terminal input form.
 */
function LineInput({
  existingSaveNames,
  purpose,
  query,
}: {
  existingSaveNames: string[];
  purpose: "name" | "getlin";
  query: string;
}) {
  const [value, setValue] = useState("");
  const continuesExistingSave = purpose === "name"
    && existingSaveNames.includes(normalizePlayerNameInput(value));

  /**
   * Submit the current text value.
   * @param event - form submission event.
   */
  function handleSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    submitLine(value);
  }

  /**
   * Cancel a getlin prompt with Escape.
   * @param event - input key event.
   */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    event.stopPropagation();
    if (event.key === "Escape" && purpose === "getlin") {
      event.preventDefault();
      submitLine(null);
    }
  }

  return (
    <form className="nh-line-input" onSubmit={handleSubmit}>
      <label htmlFor="nh-command-input">{query}</label>
      <div className="nh-line-input-field">
        <input
          aria-describedby={continuesExistingSave
            ? "nh-existing-save-hint"
            : undefined}
          autoComplete="off"
          autoFocus
          id="nh-command-input"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          value={value}
        />
        {continuesExistingSave && (
          <span
            className="nh-existing-save-hint"
            id="nh-existing-save-hint"
            role="status"
          >
            A save with this name already exists. The game will continue from
            that save.
          </span>
        )}
      </div>
    </form>
  );
}

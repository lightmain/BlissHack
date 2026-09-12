import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from "react";
import {
  getSnapshot,
  type GameSnapshot,
  type MapCell,
  type TextLine,
} from "../../game-state";
import {
  mapFollowOffset,
  mapPositionFromPoint,
  mapScrollAnchor,
  mapScrollOffsetForAnchor,
} from "../../map-rendering";
import { AsciiMapRenderer } from "../../map/AsciiMapRenderer";
import {
  TileMapRenderer,
  type TileRendererFallbackReason,
} from "../../map/TileMapRenderer";
import {
  normalizePlayerNameInput,
  sendPosition,
  submitLine,
} from "../../nethack-bridge";
import type { InterfaceSettings } from "../../settings/profile";
import { textAttributeClass } from "../../text-styling";
import { PermanentInventoryPanel } from "../PermanentInventoryPanel";
import { StatusArea } from "./StatusArea";

interface GameTerminalProps {
  clipCenter: GameSnapshot["clipCenter"];
  cursor: GameSnapshot["cursor"];
  followPlayer: boolean;
  historyLines: InterfaceSettings["messageHistoryLines"];
  inert: boolean;
  inputRequest: GameSnapshot["inputRequest"];
  layoutKey: string;
  map: MapCell[][];
  mapRenderer: InterfaceSettings["mapRenderer"];
  messages: TextLine[];
  onInventoryCollapsedChange(collapsed: boolean): void;
  onMapRendererFallback?(reason: TileRendererFallbackReason): void;
  permanentInventory: GameSnapshot["permanentInventory"];
  permanentInventoryCollapsed: boolean;
  permanentInventoryEnabled: boolean;
  permanentInventoryPosition: InterfaceSettings["permanentInventoryPosition"];
  status: GameSnapshot["status"];
}

/** Render the active terminal while keeping browser overlays outside its inert tree. */
export function GameTerminal({
  clipCenter,
  cursor,
  followPlayer,
  historyLines,
  inert,
  inputRequest,
  layoutKey,
  map,
  mapRenderer,
  messages,
  onInventoryCollapsedChange,
  onMapRendererFallback,
  permanentInventory,
  permanentInventoryCollapsed,
  permanentInventoryEnabled,
  permanentInventoryPosition,
  status,
}: GameTerminalProps) {
  return (
    <section
      aria-label="NetHack terminal"
      className="nh-terminal"
      inert={inert}
    >
      <MessageArea historyLines={historyLines} messages={messages} />
      <div className={`nh-playfield nh-playfield-${permanentInventoryPosition}`}>
        <div className="nh-playfield-main">
          <MapGrid
            clipCenter={clipCenter}
            cursor={cursor}
            followPlayer={followPlayer}
            layoutKey={layoutKey}
            map={map}
            mapRenderer={mapRenderer}
            onMapRendererFallback={onMapRendererFallback}
          />
          <StatusArea status={status} />
          <InputArea request={inputRequest} />
        </div>
        {permanentInventoryEnabled && permanentInventory && (
          <PermanentInventoryPanel
            collapsed={permanentInventoryCollapsed}
            inventory={permanentInventory}
            onCollapsedChange={onInventoryCollapsedChange}
            position={permanentInventoryPosition}
          />
        )}
      </div>
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
 * Render the fixed NetHack character map and route mouse clicks to nh_poskey.
 * @param props - current game snapshot.
 * @returns the 80 by 21 map grid.
 */
const MapGrid = memo(function MapGrid({
  clipCenter,
  cursor,
  followPlayer,
  layoutKey,
  map,
  mapRenderer,
  onMapRendererFallback,
}: {
  clipCenter: GameSnapshot["clipCenter"];
  cursor: GameSnapshot["cursor"];
  followPlayer: boolean;
  layoutKey: string;
  map: MapCell[][];
  mapRenderer: InterfaceSettings["mapRenderer"];
  onMapRendererFallback?(reason: TileRendererFallbackReason): void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<ReturnType<typeof mapScrollAnchor> | null>(
    null,
  );
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
    viewport.scrollLeft = offset.left;
    viewport.scrollTop = offset.top;
    rememberScrollAnchor();
  }, [clipCenter, followPlayer, rememberScrollAnchor]);

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

  /**
   * Submit a primary or secondary map click while nh_poskey is pending.
   * @param event - delegated mouse event from a map cell.
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
   * Suppress the browser context menu while NetHack is accepting map clicks.
   * @param event - browser context-menu event.
   */
  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>): void {
    if (getSnapshot().inputRequest?.kind === "position") event.preventDefault();
  }

  return (
    <div
      className="nh-map-scroll"
      onScroll={rememberScrollAnchor}
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

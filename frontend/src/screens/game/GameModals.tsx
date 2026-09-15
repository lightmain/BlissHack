import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  PICK_ANY,
  PICK_NONE,
  PICK_ONE,
  getWindow,
  type GameModal,
  type MenuItem,
  type TextLine,
  type WindowState,
} from "../../game-state";
import { keyboardEventToNetHackKey } from "../../keyboard";
import {
  dismissDisplay,
  submitExtendedCommand,
  submitMenuSelection,
} from "../../nethack-bridge";
import {
  placeAnchoredOverlay,
  type AnchoredOverlayPosition,
} from "../../interactions/anchored-overlay";
import type { ContextMenuPresentation } from "../../game-actions/game-action-controller";
import { colorClass, textAttributeClass } from "../../text-styling";

const AUTO_ACCELERATORS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Select the renderer for the active modal type.
 * @param props - active modal state.
 * @returns the corresponding overlay.
 */
export const GameModalRenderer = memo(function GameModalRenderer({
  contextMenu,
  modal,
}: {
  contextMenu?: ContextMenuPresentation | null;
  modal: GameModal;
}) {
  if (modal.kind === "menu") {
    const window = getWindow(modal.windowId);
    return window
      ? (
        <MenuOverlay
          contextMenu={contextMenu}
          how={modal.how}
          window={window}
        />
      )
      : null;
  }
  if (modal.kind === "extcmd") {
    return <ExtendedCommandOverlay commands={modal.commands} />;
  }
  return (
    <TextOverlay
      lines={modal.lines}
      title={modal.kind === "text" ? modal.title : "Message history"}
    />
  );
});

/**
 * Render a blocking text or history window.
 * @param props - title and styled lines.
 * @returns text overlay.
 */
function TextOverlay({ title, lines }: { title: string; lines: TextLine[] }) {
  return (
    <div className="nh-overlay" role="presentation" onMouseDown={dismissDisplay}>
      <section
        aria-label={title || "Text"}
        className="nh-dialog nh-text-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <strong>{title}</strong>
          <button aria-label="Close" onClick={dismissDisplay} type="button">×</button>
        </header>
        <pre>
          {lines.map((line, index) => (
            <span className={textAttributeClass(line.attribute)} key={`${index}:${line.text}`}>
              {line.text}
              {"\n"}
            </span>
          ))}
        </pre>
      </section>
    </div>
  );
}

/**
 * Render and operate a NetHack PICK_NONE/PICK_ONE/PICK_ANY menu.
 * @param props - menu window and selection mode.
 * @returns menu overlay.
 */
function MenuOverlay({
  contextMenu,
  window,
  how,
}: {
  contextMenu?: ContextMenuPresentation | null;
  window: WindowState;
  how: number;
}) {
  const rows = useMemo(() => assignAccelerators(window.menuItems), [window.menuItems]);
  const selectableIndexes = useMemo(
    () => rows.filter((row) => row.item.identifier !== null).map((row) => row.index),
    [rows],
  );
  const preselectedIndex = rows.find(
    ({ item }) =>
      item.identifier !== null && (item.itemFlags & 1) !== 0,
  )?.index;
  const [focusIndex, setFocusIndex] = useState(
    preselectedIndex ?? selectableIndexes[0] ?? -1,
  );
  const [selected, setSelected] = useState<Map<number, number>>(() => {
    const initial = new Map<number, number>();
    rows.forEach(({ item, index }) => {
      if (item.identifier !== null && (item.itemFlags & 1) !== 0) {
        initial.set(index, -1);
      }
    });
    return initial;
  });
  const [count, setCount] = useState("");
  const menuRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<AnchoredOverlayPosition | null>(null);
  const anchor = contextMenu?.origin.kind === "keyboard"
    ? null
    : contextMenu?.origin ?? null;

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!anchor || !menu) {
      setPosition(null);
      return;
    }

    /** Reposition the measured menu after viewport geometry changes. */
    const update = (): void => {
      const bounds = menu.getBoundingClientRect();
      setPosition(placeAnchoredOverlay({
        anchor: { x: anchor.clientX, y: anchor.clientY },
        gap: 8,
        margin: 8,
        overlay: { width: bounds.width, height: bounds.height },
        viewport: {
          width: globalThis.innerWidth,
          height: globalThis.innerHeight,
        },
      }));
    };

    update();
    globalThis.addEventListener("resize", update);
    return () => globalThis.removeEventListener("resize", update);
  }, [anchor, window.menuItems]);

  useLayoutEffect(() => {
    if (!anchor || position === null || focusIndex < 0) return;
    menuRef.current
      ?.querySelector<HTMLElement>(`[data-menu-index="${focusIndex}"]`)
      ?.focus();
  }, [anchor, focusIndex, position]);

  useEffect(() => {
    if (!contextMenu || !anchor) return undefined;
    returnFocusRef.current = findContextMenuTrigger(contextMenu);
    return () => restoreContextMenuFocus(returnFocusRef.current);
  }, [anchor, contextMenu]);

  useEffect(() => {
    if (!anchor) return undefined;

    /** Suppress the native menu and cancel only secondary clicks outside. */
    function handleContextMenu(event: MouseEvent): void {
      event.preventDefault();
      const menu = menuRef.current;
      if (
        !menu
        || !(event.target instanceof Node)
        || !menu.contains(event.target)
      ) {
        submitMenuSelection(null);
      }
    }

    document.addEventListener("contextmenu", handleContextMenu, {
      capture: true,
    });
    return () => document.removeEventListener(
      "contextmenu",
      handleContextMenu,
      { capture: true },
    );
  }, [anchor]);

  useEffect(() => {
    /**
     * Apply NetHack menu commands and accelerators.
     * @param event - browser keyboard event.
     */
    function handleMenuKey(event: KeyboardEvent): void {
      const encoded = keyboardEventToNetHackKey(event, { numberPad: false });
      if (event.key === "Escape") {
        event.preventDefault();
        submitMenuSelection(null);
        return;
      }
      if (how === PICK_NONE) {
        if (encoded !== null) {
          event.preventDefault();
          dismissDisplay();
        }
        return;
      }
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        setCount((current) => `${current}${event.key}`.slice(0, 9));
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setFocusIndex((current) =>
          moveMenuFocus(selectableIndexes, current, event.key === "ArrowDown" ? 1 : -1),
        );
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (how === PICK_ONE && focusIndex >= 0) {
          submitMenuSelection([{ itemIndex: focusIndex, count: parsedCount(count) }]);
        } else {
          submitMenuSelection(
            Array.from(selected, ([itemIndex, itemCount]) => ({
              itemIndex,
              count: itemCount,
            })),
          );
        }
        return;
      }
      if (event.key === " " && focusIndex >= 0) {
        event.preventDefault();
        chooseMenuItem(focusIndex);
        return;
      }
      if (how === PICK_ANY && encoded !== null && [46, 45, 64].includes(encoded)) {
        event.preventDefault();
        applyBulkMenuCommand(encoded);
        return;
      }
      if (encoded === null) return;
      const accelerated = rows.find(
        (row) =>
          row.item.identifier !== null
          && (row.accelerator === encoded || row.item.groupAccelerator === encoded),
      );
      if (!accelerated) return;
      event.preventDefault();
      if (accelerated.item.groupAccelerator === encoded && how === PICK_ANY) {
        toggleMenuGroup(encoded);
      } else {
        chooseMenuItem(accelerated.index);
      }
    }

    windowThis().addEventListener("keydown", handleMenuKey);
    return () => windowThis().removeEventListener("keydown", handleMenuKey);
  });

  /**
   * Select, toggle, or immediately submit one menu row.
   * @param itemIndex - source row index.
   */
  function chooseMenuItem(itemIndex: number): void {
    if (how === PICK_NONE) {
      dismissDisplay();
      return;
    }
    if (how === PICK_ONE) {
      submitMenuSelection([{ itemIndex, count: parsedCount(count) }]);
      return;
    }
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(itemIndex)) next.delete(itemIndex);
      else next.set(itemIndex, parsedCount(count));
      return next;
    });
    setCount("");
    setFocusIndex(itemIndex);
  }

  /**
   * Apply select-all, unselect-all, or invert-all.
   * @param command - NetHack menu command byte.
   */
  function applyBulkMenuCommand(command: number): void {
    setSelected((current) => {
      if (command === 45) return new Map();
      const next = command === 64 ? new Map(current) : new Map<number, number>();
      for (const row of rows) {
        if (row.item.identifier === null || (row.item.itemFlags & 2) !== 0) continue;
        if (command === 64 && next.has(row.index)) next.delete(row.index);
        else next.set(row.index, -1);
      }
      return next;
    });
  }

  /**
   * Toggle all selectable rows sharing one group accelerator.
   * @param groupCode - group accelerator byte.
   */
  function toggleMenuGroup(groupCode: number): void {
    const indexes = rows
      .filter(
        (row) =>
          row.item.identifier !== null
          && row.item.groupAccelerator === groupCode,
      )
      .map((row) => row.index);
    setSelected((current) => {
      const next = new Map(current);
      const allSelected = indexes.every((index) => next.has(index));
      indexes.forEach((index) => {
        if (allSelected) next.delete(index);
        else next.set(index, -1);
      });
      return next;
    });
  }

  const anchored = anchor !== null;
  const resolvedPosition = position ?? (
    anchor
      ? {
        left: anchor.clientX + 8,
        top: anchor.clientY + 8,
        horizontal: "after" as const,
        vertical: "after" as const,
      }
      : null
  );
  const menu = (
    <section
      aria-hidden={anchored && position === null ? "true" : undefined}
      aria-label={window.menuPrompt || "Menu"}
      className={anchored ? "nh-context-menu" : "nh-dialog nh-menu"}
      data-horizontal={resolvedPosition?.horizontal}
      data-vertical={resolvedPosition?.vertical}
      ref={anchored ? menuRef : undefined}
      role={anchored ? "menu" : "dialog"}
      style={resolvedPosition
        ? {
          "--overlay-left": `${resolvedPosition.left}px`,
          "--overlay-top": `${resolvedPosition.top}px`,
        } as CSSProperties
        : undefined}
    >
        {window.menuPrompt && <header>{window.menuPrompt}</header>}
        <div className="nh-menu-items">
          {rows.map(({ item, index, accelerator }) =>
            item.identifier === null ? (
              <div
                className={`nh-menu-heading ${textAttributeClass(item.attribute)}`}
                key={`${index}:${item.text}`}
              >
                {item.text || "\u00a0"}
              </div>
            ) : (
              <button
                className={[
                  "nh-menu-item",
                  focusIndex === index ? "focused" : "",
                  selected.has(index) ? "selected" : "",
                  colorClass(item.color),
                  textAttributeClass(item.attribute),
                ].filter(Boolean).join(" ")}
                data-core-identifier={item.identifier}
                data-menu-index={index}
                key={`${index}:${item.text}`}
                onClick={() => chooseMenuItem(index)}
                onFocus={() => setFocusIndex(index)}
                onMouseEnter={() => setFocusIndex(index)}
                role={anchored ? "menuitem" : undefined}
                tabIndex={anchored ? (focusIndex === index ? 0 : -1) : undefined}
                type="button"
              >
                <span aria-hidden="true" className="nh-menu-glyph">
                  {item.glyph?.ttyChar
                    ? String.fromCodePoint(item.glyph.ttyChar)
                    : " "}
                </span>
                <span className="nh-menu-mark">
                  {how === PICK_ANY ? (selected.has(index) ? "+" : "-") : " "}
                </span>
                <span className="nh-menu-accelerator">
                  {accelerator ? String.fromCharCode(accelerator) : " "}
                </span>
                <span className="nh-menu-text">{item.text}</span>
              </button>
            ),
          )}
        </div>
        {count && <output className="nh-count">{count}</output>}
    </section>
  );

  return anchored
    ? (
      <div
        className="nh-context-menu-layer"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          submitMenuSelection(null);
        }}
        role="presentation"
      >
        <div
          onPointerDown={(event) => event.stopPropagation()}
        >
          {menu}
        </div>
      </div>
    )
    : (
      <div className="nh-overlay">
        {menu}
      </div>
    );
}

/**
 * Render a searchable extended-command chooser.
 * @param props - parsed extcmdlist entries.
 * @returns extended-command overlay.
 */
function ExtendedCommandOverlay({
  commands,
}: {
  commands: Array<{ sourceIndex: number; name: string; description: string }>;
}) {
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState(0);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? commands.filter((command) => command.name.startsWith(normalized))
      : commands;
  }, [commands, query]);

  /**
   * Submit or cancel the extended-command picker.
   * @param event - input key event.
   */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      submitExtendedCommand(null);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setFocus((current) => wrapIndex(current + delta, filtered.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const exact = filtered.find((command) => command.name === query.trim().toLowerCase());
      const command = exact ?? filtered[focus];
      if (command) submitExtendedCommand(command.sourceIndex);
    }
  }

  return (
    <div className="nh-overlay">
      <section className="nh-dialog nh-extcmd" role="dialog" aria-label="Extended command">
        <input
          autoComplete="off"
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            setFocus(0);
          }}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          value={query}
        />
        <div className="nh-extcmd-list">
          {filtered.slice(0, 100).map((command, index) => (
            <button
              className={index === focus ? "focused" : ""}
              key={command.sourceIndex}
              onClick={() => submitExtendedCommand(command.sourceIndex)}
              onMouseEnter={() => setFocus(index)}
              type="button"
            >
              <strong>{command.name}</strong>
              <span>{command.description}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Assign fallback accelerators when a menu leaves them unspecified.
 * @param items - menu rows in source order.
 * @returns rows paired with stable source indexes and accelerators.
 */
function assignAccelerators(items: MenuItem[]) {
  let automaticIndex = 0;
  return items.map((item, index) => {
    let accelerator = item.accelerator;
    if (item.identifier !== null && accelerator === 0) {
      accelerator = AUTO_ACCELERATORS.charCodeAt(automaticIndex);
      automaticIndex += 1;
    }
    return { item, index, accelerator };
  });
}

/**
 * Move menu focus with wraparound.
 * @param indexes - selectable source indexes.
 * @param current - current source index.
 * @param delta - movement direction.
 * @returns the next source index.
 */
function moveMenuFocus(indexes: number[], current: number, delta: number): number {
  if (indexes.length === 0) return -1;
  const position = indexes.indexOf(current);
  return indexes[wrapIndex(position + delta, indexes.length)];
}

/**
 * Wrap an index into an array length.
 * @param value - unbounded index.
 * @param length - array length.
 * @returns a valid index, or zero for an empty array.
 */
function wrapIndex(value: number, length: number): number {
  return length === 0 ? 0 : (value % length + length) % length;
}

/**
 * Convert a menu count buffer to NetHack's count convention.
 * @param value - decimal count text.
 * @returns a positive count or -1 for all.
 */
function parsedCount(value: string): number {
  if (value === "") return -1;
  const count = Number.parseInt(value, 10);
  return Number.isFinite(count) && count > 0 ? count : -1;
}

/**
 * Resolve the programmatic focus target which opened an anchored menu.
 * @param contextMenu - active serializable menu presentation.
 * @returns the connected map or inventory trigger, when one exists.
 */
function findContextMenuTrigger(
  contextMenu: ContextMenuPresentation,
): HTMLElement | null {
  const origin = contextMenu.origin;
  if (typeof document === "undefined") {
    return null;
  }
  if (origin.kind === "map") {
    return document.querySelector<HTMLElement>(
      '[data-context-menu-trigger="map"]',
    );
  }
  if (origin.kind !== "inventory") return null;
  return document.querySelector<HTMLElement>(
    `[data-inspect-target="inventory:${origin.inventoryRevision}:${origin.accelerator}"]`,
  );
}

/**
 * Restore focus after React removes the menu and clears terminal inertness.
 * @param target - original context-menu trigger.
 */
function restoreContextMenuFocus(target: HTMLElement | null): void {
  if (!target) return;
  globalThis.setTimeout(() => {
    const focus = (): void => {
      if (target.isConnected && !target.closest("[inert]")) target.focus();
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(focus);
    } else {
      focus();
    }
  }, 0);
}

/**
 * Return the browser window through a named helper for effect cleanup.
 * @returns the active Window object.
 */
function windowThis(): Window {
  return window;
}

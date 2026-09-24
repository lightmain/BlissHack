import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type ReactNode,
} from "react";
import {
  Archive,
  ArchiveRestore,
  Armchair,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Backpack,
  BadgeInfo,
  BookCopy,
  BookOpen,
  BookOpenCheck,
  BookOpenText,
  Circle,
  CircleHelp,
  Clock,
  Coins,
  Command,
  Crosshair,
  CupSoda,
  DoorClosed,
  DoorOpen,
  Droplets,
  Ellipsis,
  Eye,
  FastForward,
  FileCog,
  Footprints,
  Gauge,
  Gem,
  GlassWater,
  HandHeart,
  Hash,
  HeartHandshake,
  History,
  Info,
  KeyRound,
  Lamp,
  Layers,
  List,
  ListChecks,
  ListFilter,
  ListMinus,
  ListX,
  Lock,
  LocateFixed,
  LogOut,
  Map,
  MapPin,
  MessageCircle,
  MessageSquareMore,
  Minus,
  Mountain,
  MoveUpRight,
  Navigation,
  PackageMinus,
  PackagePlus,
  PanelRight,
  Pause,
  PenLine,
  Plus,
  RefreshCw,
  Repeat2,
  Route,
  Save,
  ScanEye,
  ScanSearch,
  Search,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  Shirt,
  Skull,
  SlidersHorizontal,
  Sparkles,
  SquareDashed,
  Sun,
  Sword,
  Swords,
  Tag,
  Target,
  Terminal,
  ToggleRight,
  TrendingUp,
  TriangleAlert,
  Unlock,
  UserRound,
  Utensils,
  WandSparkles,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  ACTION_BAR_CATEGORIES,
  ACTION_BAR_SECTION_CATEGORIES,
  ACTION_BAR_SINGLE_CATEGORIES,
  validateActionBarLayout,
  type ActionBarCategory,
  type ActionBarDragSource,
  type ActionBarDropTarget,
  type ActionBarLayout,
  type ActionBarSlotAddress,
} from "../../action-bar/action-bar-layout";
import {
  createActionBarLayoutController,
} from "../../action-bar/action-bar-layout-controller";
import {
  calculateActionGridGeometry,
} from "../../action-bar/action-grid-geometry";
import {
  resolveActionSlotPresentation,
  type ActionPresentation,
} from "../../action-bar/action-catalog-metadata";
import type { SessionActionCatalog } from "../../game-actions/action-catalog";
import { AllActionsPanel } from "./AllActionsPanel";

const CATEGORY_LABELS: Readonly<Record<ActionBarCategory, string>> = {
  all: "All",
  common: "Common",
  gear: "Gear",
  magic: "Magic",
  items: "Items",
  explore: "Explore",
  custom: "Custom",
};

const ACTION_ICONS: Readonly<Record<string, LucideIcon>> = {
  "archive": Archive,
  "archive-restore": ArchiveRestore,
  "armchair": Armchair,
  "arrow-down": ArrowDown,
  "arrow-left-right": ArrowLeftRight,
  "arrow-up": ArrowUp,
  "backpack": Backpack,
  "badge-info": BadgeInfo,
  "book-copy": BookCopy,
  "book-open": BookOpen,
  "book-open-check": BookOpenCheck,
  "book-open-text": BookOpenText,
  "circle": Circle,
  "circle-help": CircleHelp,
  "clock": Clock,
  "coins": Coins,
  "command": Command,
  "crosshair": Crosshair,
  "cup-soda": CupSoda,
  "door-closed": DoorClosed,
  "door-open": DoorOpen,
  "droplets": Droplets,
  "eye": Eye,
  "fast-forward": FastForward,
  "file-cog": FileCog,
  "footprints": Footprints,
  "gauge": Gauge,
  "gem": Gem,
  "glass-water": GlassWater,
  "hand-heart": HandHeart,
  "hash": Hash,
  "heart-handshake": HeartHandshake,
  "history": History,
  "info": Info,
  "key-round": KeyRound,
  "lamp": Lamp,
  "layers": Layers,
  "list": List,
  "list-checks": ListChecks,
  "list-filter": ListFilter,
  "list-minus": ListMinus,
  "list-x": ListX,
  "locate-fixed": LocateFixed,
  "log-out": LogOut,
  "map": Map,
  "map-pin": MapPin,
  "message-circle": MessageCircle,
  "message-square-more": MessageSquareMore,
  "mountain": Mountain,
  "move-up-right": MoveUpRight,
  "navigation": Navigation,
  "package-minus": PackageMinus,
  "package-plus": PackagePlus,
  "panel-right": PanelRight,
  "pause": Pause,
  "pen-line": PenLine,
  "refresh-cw": RefreshCw,
  "repeat-2": Repeat2,
  "route": Route,
  "save": Save,
  "scan-eye": ScanEye,
  "scan-search": ScanSearch,
  "search": Search,
  "send": Send,
  "settings": Settings,
  "shield": Shield,
  "shield-check": ShieldCheck,
  "shirt": Shirt,
  "skull": Skull,
  "sliders-horizontal": SlidersHorizontal,
  "sparkles": Sparkles,
  "sun": Sun,
  "sword": Sword,
  "swords": Swords,
  "tag": Tag,
  "target": Target,
  "terminal": Terminal,
  "toggle-right": ToggleRight,
  "trending-up": TrendingUp,
  "triangle-alert": TriangleAlert,
  "user-round": UserRound,
  "utensils": Utensils,
  "wand-sparkles": WandSparkles,
  "wrench": Wrench,
};

interface ActionDockProps {
  activeActionName?: string | null;
  allActionsOpen: boolean;
  blocked: boolean;
  catalog: SessionActionCatalog | null;
  input: ReactNode;
  layout: ActionBarLayout;
  onAllActionsOpenChange(open: boolean): void;
  onActionRequest?: (request: {
    name: string;
    sessionCommandId: number;
  }) => void;
  onLayoutChange?(layout: ActionBarLayout): Promise<ActionBarLayout>;
  sessionKey?: string;
  status: ReactNode;
}

interface ActionDragPreviewState {
  clientX: number;
  clientY: number;
  name: string;
}

/**
 * Render the combined BlissHack status and action dock.
 * @param props - current layout, catalog, status/input content, and persistence callback.
 * @returns the responsive bottom dock.
 */
export function ActionDock({
  activeActionName = null,
  allActionsOpen,
  blocked,
  catalog,
  input,
  layout,
  onAllActionsOpenChange,
  onActionRequest,
  onLayoutChange,
  sessionKey,
  status,
}: ActionDockProps) {
  const allActionsTriggerRef = useRef<HTMLButtonElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(680);
  const [dragPreview, setDragPreview] =
    useState<ActionDragPreviewState | null>(null);
  const suppressClickRef = useRef(false);
  const controller = useMemo(
    () => createActionBarLayoutController({
      layout,
      onCommit: async (candidate) =>
        onLayoutChange ? onLayoutChange(candidate) : candidate,
    }),
    [layout, onLayoutChange],
  );
  const editState = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const displayedLayout = editState.previewLayout ?? editState.layout;
  const geometry = useMemo(() => calculateActionGridGeometry({
    availableWidth,
    dividerWidth: 17,
    minimumSlotSize: 32,
    rows: displayedLayout.rows,
    sections: displayedLayout.all,
    slotGap: 4,
    targetSlotSize: 48,
  }), [availableWidth, displayedLayout.all, displayedLayout.rows]);
  const categoryGeometry = useMemo(() => calculateActionGridGeometry({
    availableWidth,
    dividerWidth: 0,
    minimumSlotSize: 32,
    rows: displayedLayout.rows,
    sections: [{
      category: "common",
      columns: 1,
      slots: displayedLayout.activeCategory === "all"
        ? []
        : displayedLayout.categories[displayedLayout.activeCategory],
    }],
    slotGap: 4,
    targetSlotSize: 48,
  }), [availableWidth, displayedLayout]);
  const displayedSections = geometry.sections.map((section) => {
    return {
      ...section,
      slots: Array.from(
        { length: section.columns * displayedLayout.rows },
        (_, slotIndex) => section.slots[slotIndex] ?? null,
      ),
    };
  });
  const activeGeometry = displayedLayout.activeCategory === "all"
    ? geometry
    : categoryGeometry;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) {
        setAvailableWidth(entry.contentRect.width);
      }
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    controller.replaceLayout(layout);
  }, [controller, layout]);

  useEffect(() => {
    controller.cancel("session-reset");
  }, [controller, sessionKey]);

  useEffect(() => {
    /** Cancel a transient edit when focus leaves the page. */
    function cancelOnBlur(): void {
      controller.cancel("blur");
    }

    /** Cancel a transient edit when the player presses Escape. */
    function cancelWithEscape(event: KeyboardEvent): void {
      if (
        event.key !== "Escape"
        || !["pending", "dragging"].includes(controller.getState().status)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      controller.cancel("escape");
    }

    window.addEventListener("blur", cancelOnBlur);
    window.addEventListener("keydown", cancelWithEscape, true);
    return () => {
      window.removeEventListener("blur", cancelOnBlur);
      window.removeEventListener("keydown", cancelWithEscape, true);
    };
  }, [controller]);

  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    if (!editState.lockFeedback) return;
    const timeout = globalThis.setTimeout(
      () => controller.clearLockFeedback(),
      520,
    );
    return () => globalThis.clearTimeout(timeout);
  }, [controller, editState.lockFeedback]);

  /**
   * Begin one pointer-owned slot or divider edit.
   * @param event - pointer-down event on the rendered source.
   * @param source - stable source metadata independent of DOM identity.
   * @returns nothing.
   */
  function beginPointerEdit(
    event: ReactPointerEvent<HTMLElement>,
    source: ActionBarDragSource,
  ): void {
    suppressClickRef.current = false;
    if (
      blocked
      || !controller.pointerDown({
        button: event.button,
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: event.pointerId,
        source,
      })
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragPreview(source.kind === "all-actions"
      ? {
        clientX: event.clientX,
        clientY: event.clientY,
        name: source.name,
      }
      : null);
  }

  /**
   * Update one captured pointer edit against the element below the pointer.
   * @param event - pointer-move event from the captured source.
   * @returns nothing.
   */
  function movePointerEdit(event: ReactPointerEvent<HTMLElement>): void {
    controller.pointerMove({
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      target: actionDropTargetAt(event.clientX, event.clientY),
    });
    if (controller.getState().status === "dragging") {
      event.preventDefault();
      setDragPreview((current) => current
        ? {
          ...current,
          clientX: event.clientX,
          clientY: event.clientY,
        }
        : null);
    }
  }

  /**
   * Finish one captured gesture and commit its final preview once.
   * @param event - pointer-up event from the captured source.
   * @returns nothing.
   */
  function finishPointerEdit(event: ReactPointerEvent<HTMLElement>): void {
    movePointerEdit(event);
    if (controller.getState().status === "dragging") {
      suppressClickRef.current = true;
    }
    void controller.pointerUp(event.pointerId);
    setDragPreview(null);
    releaseActionPointer(event);
  }

  /**
   * Cancel one interrupted pointer edit and release capture.
   * @param event - interrupted pointer event.
   * @param reason - stable cancellation reason.
   */
  function cancelPointerEdit(
    event: ReactPointerEvent<HTMLElement>,
    reason: "pointer-cancel" | "lost-pointer-capture",
  ): void {
    const ownedPointer = ["pending", "dragging"].includes(
      controller.getState().status,
    );
    controller.cancel(reason, event.pointerId);
    if (ownedPointer) {
      suppressClickRef.current = true;
    }
    setDragPreview(null);
    releaseActionPointer(event);
  }

  /**
   * Provide keyboard equivalents for moving or removing a focused action.
   * @param event - key event from one occupied slot.
   * @param source - stable address of the focused action.
   */
  function handleSlotKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    source: ActionBarSlotAddress,
  ): void {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      void controller.commit({
        type: "drop",
        source: { kind: "dock-action", slot: source },
        target: { kind: "outside" },
      });
      return;
    }
    if (
      !event.altKey
      || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
        event.key,
      )
    ) {
      return;
    }
    const columns = source.area === "all"
      ? activeGeometry.sections.find(
        (section) => section.category === source.section,
      )?.columns ?? 1
      : categoryGeometry.sections[0]?.columns ?? 1;
    event.preventDefault();
    event.stopPropagation();
    const rows = displayedLayout.rows;
    const row = source.slotIndex % rows;
    if (
      (event.key === "ArrowUp" && row === 0)
      || (event.key === "ArrowDown" && row === rows - 1)
    ) {
      return;
    }
    const delta = {
      ArrowLeft: -rows,
      ArrowRight: rows,
      ArrowUp: -1,
      ArrowDown: 1,
    }[event.key] ?? 0;
    const destinationIndex = source.slotIndex + delta;
    if (
      destinationIndex < 0
      || destinationIndex >= columns * rows
    ) {
      return;
    }
    const destination: ActionBarSlotAddress = source.area === "all"
      ? { ...source, slotIndex: destinationIndex }
      : { ...source, slotIndex: destinationIndex };
    void controller.commit({
      type: "drop",
      source: { kind: "dock-action", slot: source },
      target: { kind: "dock-slot", slot: destination },
    }).then(() => focusActionSlot(destination));
  }

  /**
   * Resize one divider by keyboard in complete-column steps.
   * @param event - key event from a focused separator.
   * @param dividerIndex - divider between adjacent All sections.
   */
  function handleDividerKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
    dividerIndex: number,
  ): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    void controller.commit({
      type: "move-divider",
      columnDelta: event.key === "ArrowLeft" ? -1 : 1,
      dividerIndex,
    });
  }

  const gridStyle = {
    "--action-grid-width": `${activeGeometry.gridWidth}px`,
    "--action-slot-size": `${activeGeometry.slotSize}px`,
    "--action-row-count": displayedLayout.rows,
  } as CSSProperties;
  const layoutEditBlocksActions = [
    "pending",
    "dragging",
    "committing",
  ].includes(editState.status);
  const actionsBlocked = blocked || layoutEditBlocksActions;
  const showInput = Boolean(input) || editState.error !== null;
  const dragPreviewPresentation = dragPreview && catalog
    ? resolveActionSlotPresentation(dragPreview.name, catalog, {
      blocked: false,
    })
    : null;

  /**
   * Forward one action only when no layout edit owns the dock.
   * @param request - current session command identity.
   * @returns nothing.
   */
  function requestAction(request: {
    name: string;
    sessionCommandId: number;
  }): void {
    if (
      blocked
      || ["pending", "dragging", "committing"].includes(
        controller.getState().status,
      )
    ) {
      return;
    }
    onActionRequest?.(request);
  }

  return (
    <>
      {allActionsOpen && catalog && (
        <AllActionsPanel
          blocked={actionsBlocked}
          catalog={catalog}
          layout={editState.layout}
          layoutBusy={editState.status === "committing"}
          onActionRequest={requestAction}
          onClose={() => onAllActionsOpenChange(false)}
          onImportLayout={(incomingLayout) =>
            controller.commitLayout(incomingLayout)}
          onLostPointerCapture={(event) =>
            cancelPointerEdit(event, "lost-pointer-capture")}
          onPointerCancel={(event) =>
            cancelPointerEdit(event, "pointer-cancel")}
          onPointerDown={beginPointerEdit}
          onPointerMove={movePointerEdit}
          onPointerUp={finishPointerEdit}
          renderIcon={(name) => <ActionIcon name={name} />}
          suppressClickRef={suppressClickRef}
          triggerRef={allActionsTriggerRef}
        />
      )}
      {dragPreview
        && dragPreviewPresentation
        && editState.status === "dragging"
        && (
          <div
            aria-hidden="true"
            className="nh-action-drag-preview"
            data-action-drag-preview
            data-action-name={dragPreview.name}
            style={{
              "--action-drag-preview-x": `${dragPreview.clientX}px`,
              "--action-drag-preview-y": `${dragPreview.clientY}px`,
            } as CSSProperties}
          >
            <ActionIcon name={dragPreviewPresentation.icon} />
            <span>{dragPreviewPresentation.name}</span>
          </div>
        )}
      <section
        aria-label="Action bar"
        className="nh-action-dock"
        data-action-dock
        data-browser-keyboard
        data-horizontal-overflow={
          activeGeometry.horizontalOverflow ? "true" : "false"
        }
        data-layout-edit-status={editState.status}
        data-row-count={displayedLayout.rows}
      >
      <div
        className="nh-action-dock-status"
        data-dock-region="status"
        data-hud-region="status"
        data-overflow-owner="status"
      >
        {status}
      </div>
      <div
        className="nh-action-workspace"
        data-has-input={showInput ? "true" : "false"}
      >
        <div className="nh-action-grid-viewport" ref={viewportRef}>
          <div className="nh-action-grid" style={gridStyle}>
            {displayedLayout.activeCategory === "all"
              ? displayedSections.flatMap((section, sectionIndex) => {
                const children: ReactNode[] = [
                  <section
                    className="nh-action-section"
                    data-action-section={section.category}
                    key={section.category}
                    style={{
                      "--action-section-columns": section.columns,
                    } as CSSProperties}
                  >
                    {section.slots.map((name, slotIndex) => (
                      <ActionSlot
                        active={name === activeActionName}
                        blocked={actionsBlocked}
                        catalog={catalog}
                        key={`${section.category}:${slotIndex}`}
                        name={name}
                        onActionRequest={requestAction}
                        onKeyDown={(event) =>
                          handleSlotKeyDown(event, {
                            area: "all",
                            section: section.category,
                            slotIndex,
                          })}
                        onPointerCancel={(event) =>
                          cancelPointerEdit(event, "pointer-cancel")}
                        onPointerDown={(event) =>
                          beginPointerEdit(event, {
                            kind: "dock-action",
                            slot: {
                              area: "all",
                              section: section.category,
                              slotIndex,
                            },
                          })}
                        onPointerMove={movePointerEdit}
                        onPointerUp={finishPointerEdit}
                        onLostPointerCapture={(event) =>
                          cancelPointerEdit(event, "lost-pointer-capture")}
                        slotAddress={{
                          area: "all",
                          section: section.category,
                          slotIndex,
                        }}
                        slotIndex={slotIndex}
                        suppressClickRef={suppressClickRef}
                      />
                    ))}
                  </section>,
                ];
                if (sectionIndex < displayedSections.length - 1) {
                  children.push(
                    <div
                      aria-orientation="vertical"
                      className="nh-action-divider"
                      data-preview-only="true"
                      data-section-divider={sectionIndex}
                      data-snap="column"
                      key={`divider:${sectionIndex}`}
                      onLostPointerCapture={(event) =>
                        cancelPointerEdit(event, "lost-pointer-capture")}
                      onPointerCancel={(event) =>
                        cancelPointerEdit(event, "pointer-cancel")}
                      onPointerDown={(event) => {
                        beginPointerEdit(event, {
                          kind: "divider",
                          dividerIndex: sectionIndex,
                          slotGap: 4,
                          slotSize: activeGeometry.slotSize,
                        });
                      }}
                      onPointerMove={movePointerEdit}
                      onPointerUp={finishPointerEdit}
                      role="separator"
                      tabIndex={0}
                      aria-valuemax={8}
                      aria-valuemin={1}
                      aria-valuenow={section.columns}
                      onKeyDown={(event) =>
                        handleDividerKeyDown(event, sectionIndex)}
                    />,
                  );
                }
                return children;
              })
              : (
                <section
                  className="nh-action-section nh-action-section-single"
                  data-action-section={displayedLayout.activeCategory}
                  style={{
                    "--action-section-columns":
                      categoryGeometry.sections[0].columns,
                  } as CSSProperties}
                >
                  {categoryGeometry.sections[0].slots.map(
                    (name, slotIndex) => (
                      <ActionSlot
                        active={name === activeActionName}
                        blocked={actionsBlocked}
                        catalog={catalog}
                        key={`${displayedLayout.activeCategory}:${slotIndex}`}
                        name={name}
                        onActionRequest={requestAction}
                        onKeyDown={(event) =>
                          handleSlotKeyDown(event, {
                            area: "category",
                            category: displayedLayout.activeCategory === "all"
                              ? "custom"
                              : displayedLayout.activeCategory,
                            slotIndex,
                          })}
                        onPointerCancel={(event) =>
                          cancelPointerEdit(event, "pointer-cancel")}
                        onPointerDown={(event) =>
                          beginPointerEdit(event, {
                            kind: "dock-action",
                            slot: {
                              area: "category",
                              category: displayedLayout.activeCategory === "all"
                                ? "custom"
                                : displayedLayout.activeCategory,
                              slotIndex,
                            },
                          })}
                        onPointerMove={movePointerEdit}
                        onPointerUp={finishPointerEdit}
                        onLostPointerCapture={(event) =>
                          cancelPointerEdit(event, "lost-pointer-capture")}
                        slotAddress={{
                          area: "category",
                          category: displayedLayout.activeCategory === "all"
                            ? "custom"
                            : displayedLayout.activeCategory,
                          slotIndex,
                        }}
                        slotIndex={slotIndex}
                        suppressClickRef={suppressClickRef}
                      />
                    ),
                  )}
                </section>
              )}
          </div>
        </div>
        <nav aria-label="Action categories" className="nh-action-categories">
          {ACTION_BAR_CATEGORIES.map((category) => (
            <button
              aria-pressed={displayedLayout.activeCategory === category}
              data-action-category={category}
              disabled={editState.status === "committing"}
              key={category}
              onClick={() => {
                void controller.commitLayout(validateActionBarLayout({
                  ...editState.layout,
                  activeCategory: category,
                }));
              }}
              type="button"
            >
              {CATEGORY_LABELS[category]}
            </button>
          ))}
        </nav>
        {showInput && (
          <div className="nh-action-dock-input" data-dock-region="input">
            {input}
            {editState.error && (
              <p className="nh-action-layout-error" role="alert">
                {editState.error}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="nh-action-dock-tools">
        <DockTool
          disabled={
            displayedLayout.rows === 1
            || editState.status === "committing"
          }
          icon={Minus}
          label="Decrease rows"
          onClick={() => {
            void controller.commit({
              type: "set-rows",
              rows: Math.max(
                1,
                displayedLayout.rows - 1,
              ) as ActionBarLayout["rows"],
            });
          }}
        />
        <DockTool
          disabled={
            displayedLayout.rows === 4
            || editState.status === "committing"
          }
          icon={Plus}
          label="Increase rows"
          onClick={() => {
            void controller.commit({
              type: "set-rows",
              rows: Math.min(
                4,
                displayedLayout.rows + 1,
              ) as ActionBarLayout["rows"],
            });
          }}
        />
        <DockTool
          icon={displayedLayout.locked ? Lock : Unlock}
          label={layout.locked ? "Unlock action bar" : "Lock action bar"}
          lockRejected={editState.lockFeedback}
          onClick={() => {
            void controller.commitLayout(validateActionBarLayout({
              ...editState.layout,
              locked: !editState.layout.locked,
            }));
          }}
        />
          <DockTool
            buttonRef={allActionsTriggerRef}
            controls="nh-all-actions-panel"
            disabled={!catalog}
            expanded={allActionsOpen}
            hasPopup="dialog"
            icon={Ellipsis}
            label="All Actions"
            onClick={() => onAllActionsOpenChange(!allActionsOpen)}
          />
        </div>
      </section>
    </>
  );
}

/**
 * Render one stable action or empty slot.
 * @param props - slot name, catalog, context state, and stable index.
 * @returns one fixed-format action grid cell.
 */
function ActionSlot({
  active,
  blocked,
  catalog,
  name,
  onActionRequest,
  onKeyDown,
  onLostPointerCapture,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  slotAddress,
  slotIndex,
  suppressClickRef,
}: {
  active: boolean;
  blocked: boolean;
  catalog: SessionActionCatalog | null;
  name: string | null;
  onActionRequest?: (request: {
    name: string;
    sessionCommandId: number;
  }) => void;
  onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void;
  onLostPointerCapture(event: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(event: ReactPointerEvent<HTMLElement>): void;
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
  slotAddress: ActionBarSlotAddress;
  slotIndex: number;
  suppressClickRef: { current: boolean };
}) {
  const slotAddressAttributes = actionSlotAddressAttributes(slotAddress);
  const presentation = name === null
    ? null
    : catalog
    ? resolveActionSlotPresentation(name, catalog, {
      blocked: blocked && !active,
    })
    : unavailablePresentation(name);
  return (
    <button
      aria-disabled={presentation?.state !== "available"}
      aria-hidden={presentation === null ? "true" : undefined}
      aria-keyshortcuts={presentation
        ? "Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown Delete"
        : undefined}
      aria-label={presentation
        ? `${presentation.name} (${presentation.key})`
        : undefined}
      className={`nh-action-slot${
        presentation ? "" : " nh-action-slot-empty"
      }`}
      data-action-icon={presentation?.icon}
      data-action-name={presentation?.name}
      data-action-slot
      data-action-state={presentation?.state ?? "empty"}
      data-empty-action-slot={presentation === null ? "" : undefined}
      data-slot-index={slotIndex}
      {...slotAddressAttributes}
      onClick={(event) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          if (event.detail > 0) return;
        }
        if (!presentation) return;
        if (
          presentation.state === "available"
          && presentation.sessionCommandId !== null
        ) {
          onActionRequest?.({
            name: presentation.name,
            sessionCommandId: presentation.sessionCommandId,
          });
        }
      }}
      onKeyDown={presentation ? onKeyDown : undefined}
      onLostPointerCapture={onLostPointerCapture}
      onPointerCancel={onPointerCancel}
      onPointerDown={presentation ? onPointerDown : undefined}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      tabIndex={presentation === null ? -1 : undefined}
      title={presentation
        ? `${presentation.name} (${presentation.key})`
        : undefined}
      type="button"
    >
      {presentation && (
        <>
          <ActionIcon name={presentation.icon} />
          <span>{presentation.name}</span>
        </>
      )}
    </button>
  );
}

/**
 * Render one fixed-size dock command.
 * @param props - icon, accessible command label, state, and callback.
 * @returns one circular icon button.
 */
function DockTool({
  buttonRef,
  controls,
  disabled = false,
  expanded,
  hasPopup,
  icon: Icon,
  label,
  lockRejected = false,
  onClick,
}: {
  buttonRef?: Ref<HTMLButtonElement>;
  controls?: string;
  disabled?: boolean;
  expanded?: boolean;
  hasPopup?: "dialog";
  icon: LucideIcon;
  label: string;
  lockRejected?: boolean;
  onClick?(): void;
}) {
  return (
    <button
      aria-controls={controls}
      aria-expanded={expanded}
      aria-haspopup={hasPopup}
      aria-label={label}
      className="nh-action-dock-tool"
      data-action-dock-tool
      data-lock-rejected={lockRejected ? "true" : undefined}
      disabled={disabled}
      onClick={onClick}
      ref={buttonRef}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" size={18} />
    </button>
  );
}

/**
 * Encode one stable slot address as DOM data for pointer hit testing.
 * @param address - persisted action-bar slot address.
 * @returns data attributes shared by occupied and empty slots.
 */
function actionSlotAddressAttributes(address: ActionBarSlotAddress) {
  return {
    "data-action-slot-area": address.area,
    "data-action-slot-category": address.area === "all"
      ? address.section
      : address.category,
  };
}

/**
 * Restore keyboard focus to an action after a successful keyboard move.
 * @param address - destination which now contains the moved action.
 */
function focusActionSlot(address: ActionBarSlotAddress): void {
  globalThis.requestAnimationFrame(() => {
    const category = address.area === "all"
      ? address.section
      : address.category;
    document.querySelector<HTMLElement>(
      `[data-action-slot-area="${address.area}"]`
      + `[data-action-slot-category="${category}"]`
      + `[data-slot-index="${address.slotIndex}"]`,
    )?.focus({ preventScroll: true });
  });
}

/**
 * Resolve one viewport point to a dock, panel, or outside drop target.
 * @param clientX - horizontal viewport coordinate.
 * @param clientY - vertical viewport coordinate.
 * @returns serializable target independent of pointer capture.
 */
function actionDropTargetAt(
  clientX: number,
  clientY: number,
): ActionBarDropTarget {
  const element = document.elementFromPoint(clientX, clientY);
  const slot = element?.closest<HTMLElement>("[data-action-slot]");
  if (slot) {
    const slotIndex = Number(slot.dataset.slotIndex);
    const category = slot.dataset.actionSlotCategory;
    if (
      slot.dataset.actionSlotArea === "all"
      && ACTION_BAR_SECTION_CATEGORIES.includes(
        category as (typeof ACTION_BAR_SECTION_CATEGORIES)[number],
      )
    ) {
      return {
        kind: "dock-slot",
        slot: {
          area: "all",
          section: category as (typeof ACTION_BAR_SECTION_CATEGORIES)[number],
          slotIndex,
        },
      };
    }
    if (
      slot.dataset.actionSlotArea === "category"
      && ACTION_BAR_SINGLE_CATEGORIES.includes(
        category as (typeof ACTION_BAR_SINGLE_CATEGORIES)[number],
      )
    ) {
      return {
        kind: "dock-slot",
        slot: {
          area: "category",
          category: category as (typeof ACTION_BAR_SINGLE_CATEGORIES)[number],
          slotIndex,
        },
      };
    }
  }
  if (element?.closest("[data-action-drop-zone=\"all-actions\"]")) {
    return { kind: "all-actions" };
  }
  return { kind: "outside" };
}

/**
 * Release a captured action edit pointer after controller state is cleared.
 * @param event - pointer event whose current target may own capture.
 */
function releaseActionPointer(event: ReactPointerEvent<HTMLElement>): void {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

/**
 * Return a stable unavailable presentation when no catalog is ready.
 * @param name - persisted action name.
 * @returns an unavailable placeholder retaining the slot identity.
 */
function unavailablePresentation(name: string): ActionPresentation {
  return {
    defaultKey: 0,
    flags: 0,
    icon: "square-dashed-x-corner",
    key: `#${name}`,
    name,
    sessionCommandId: null,
    state: "unavailable",
  };
}

/**
 * Render one statically imported Lucide action icon.
 * @param props - canonical icon metadata name.
 * @returns the requested icon or the missing-icon fallback.
 */
function ActionIcon({ name }: { name: string }) {
  if (name === "square-dashed-x-corner") {
    return (
      <span className="nh-action-missing-icon" aria-hidden="true">
        <SquareDashed size={20} strokeWidth={1.8} />
        <X size={8} strokeWidth={2.2} />
      </span>
    );
  }
  return createElement(ACTION_ICONS[name] ?? SquareDashed, {
    "aria-hidden": true,
    size: 20,
    strokeWidth: 1.8,
  });
}

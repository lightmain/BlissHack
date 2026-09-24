import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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
  validateActionBarLayout,
  type ActionBarCategory,
  type ActionBarLayout,
} from "../../action-bar/action-bar-layout";
import {
  calculateActionGridGeometry,
  previewActionDivider,
} from "../../action-bar/action-grid-geometry";
import {
  resolveActionSlotPresentation,
  type ActionPresentation,
} from "../../action-bar/action-catalog-metadata";
import type { SessionActionCatalog } from "../../game-actions/action-catalog";

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
  blocked: boolean;
  catalog: SessionActionCatalog | null;
  input: ReactNode;
  layout: ActionBarLayout;
  onActionRequest?: (request: {
    name: string;
    sessionCommandId: number;
  }) => void;
  onLayoutChange?(layout: ActionBarLayout): void;
  status: ReactNode;
}

interface DividerDrag {
  dividerIndex: number;
  pointerId: number;
  startX: number;
}

/**
 * Render the combined BlissHack status and action dock.
 * @param props - current layout, catalog, status/input content, and persistence callback.
 * @returns the responsive bottom dock.
 */
export function ActionDock({
  activeActionName = null,
  blocked,
  catalog,
  input,
  layout,
  onActionRequest,
  onLayoutChange,
  status,
}: ActionDockProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(680);
  const [previewColumns, setPreviewColumns] = useState<number[] | null>(null);
  const dragRef = useRef<DividerDrag | null>(null);
  const geometry = useMemo(() => calculateActionGridGeometry({
    availableWidth,
    dividerWidth: 17,
    minimumSlotSize: 32,
    rows: layout.rows,
    sections: layout.all,
    slotGap: 4,
    targetSlotSize: 48,
  }), [availableWidth, layout.all, layout.rows]);
  const categoryGeometry = useMemo(() => calculateActionGridGeometry({
    availableWidth,
    dividerWidth: 0,
    minimumSlotSize: 32,
    rows: layout.rows,
    sections: [{
      category: "common",
      columns: 1,
      slots: layout.activeCategory === "all"
        ? []
        : layout.categories[layout.activeCategory],
    }],
    slotGap: 4,
    targetSlotSize: 48,
  }), [availableWidth, layout]);
  const displayedSections = geometry.sections.map((section, index) => {
    const columns = previewColumns?.[index] ?? section.columns;
    return {
      ...section,
      columns,
      slots: Array.from(
        { length: columns * layout.rows },
        (_, slotIndex) => section.slots[slotIndex] ?? null,
      ),
    };
  });
  const activeGeometry = layout.activeCategory === "all"
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
    /** Clear any transient divider preview after focus leaves the page. */
    function clearPreview(): void {
      dragRef.current = null;
      setPreviewColumns(null);
    }

    /** Cancel a divider preview when the player presses Escape. */
    function cancelPreviewWithEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape" || dragRef.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      clearPreview();
    }

    window.addEventListener("blur", clearPreview);
    window.addEventListener("keydown", cancelPreviewWithEscape, true);
    return () => {
      window.removeEventListener("blur", clearPreview);
      window.removeEventListener("keydown", cancelPreviewWithEscape, true);
    };
  }, []);

  /**
   * Persist one validated layout update through the profile owner.
   * @param patch - changed top-level layout fields.
   * @returns nothing.
   */
  function updateLayout(patch: Partial<ActionBarLayout>): void {
    onLayoutChange?.(validateActionBarLayout({ ...layout, ...patch }));
  }

  /**
   * Begin a preview-only divider gesture when editing is unlocked.
   * @param event - divider pointer-down event.
   * @param dividerIndex - divider between the indexed and following section.
   * @returns nothing.
   */
  function beginDivider(
    event: ReactPointerEvent<HTMLDivElement>,
    dividerIndex: number,
  ): void {
    if (layout.locked) return;
    dragRef.current = {
      dividerIndex,
      pointerId: event.pointerId,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  /**
   * Update snapped section widths without persisting the preview.
   * @param event - captured divider pointer-move event.
   * @returns nothing.
   */
  function moveDivider(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPreviewColumns(previewActionDivider({
      dividerIndex: drag.dividerIndex,
      pointerDelta: event.clientX - drag.startX,
      sectionColumns: geometry.sections.map((section) => section.columns),
      slotGap: 4,
      slotSize: geometry.slotSize,
    }));
  }

  /**
   * Discard the stage-three divider preview when its gesture ends.
   * @param event - captured divider completion event.
   * @returns nothing.
   */
  function endDivider(event: ReactPointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setPreviewColumns(null);
  }

  const gridStyle = {
    "--action-grid-width": `${activeGeometry.gridWidth}px`,
    "--action-slot-size": `${activeGeometry.slotSize}px`,
    "--action-row-count": layout.rows,
  } as CSSProperties;

  return (
    <section
      aria-label="Action bar"
      className="nh-action-dock"
      data-action-dock
      data-browser-keyboard
      data-horizontal-overflow={
        activeGeometry.horizontalOverflow ? "true" : "false"
      }
      data-row-count={layout.rows}
    >
      <div
        className="nh-action-dock-status"
        data-dock-region="status"
        data-hud-region="status"
        data-overflow-owner="status"
      >
        {status}
      </div>
      <div className="nh-action-workspace">
        <div className="nh-action-grid-viewport" ref={viewportRef}>
          <div className="nh-action-grid" style={gridStyle}>
            {layout.activeCategory === "all"
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
                        blocked={blocked}
                        catalog={catalog}
                        key={`${section.category}:${slotIndex}`}
                        name={name}
                        onActionRequest={onActionRequest}
                        slotIndex={slotIndex}
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
                      onPointerCancel={endDivider}
                      onPointerDown={(event) => {
                        beginDivider(event, sectionIndex);
                      }}
                      onPointerMove={moveDivider}
                      onPointerUp={endDivider}
                      onLostPointerCapture={endDivider}
                      role="separator"
                    />,
                  );
                }
                return children;
              })
              : (
                <section
                  className="nh-action-section nh-action-section-single"
                  data-action-section={layout.activeCategory}
                  style={{
                    "--action-section-columns":
                      categoryGeometry.sections[0].columns,
                  } as CSSProperties}
                >
                  {categoryGeometry.sections[0].slots.map(
                    (name, slotIndex) => (
                      <ActionSlot
                        active={name === activeActionName}
                        blocked={blocked}
                        catalog={catalog}
                        key={`${layout.activeCategory}:${slotIndex}`}
                        name={name}
                        onActionRequest={onActionRequest}
                        slotIndex={slotIndex}
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
              aria-pressed={layout.activeCategory === category}
              data-action-category={category}
              key={category}
              onClick={() => updateLayout({ activeCategory: category })}
              type="button"
            >
              {CATEGORY_LABELS[category]}
            </button>
          ))}
        </nav>
        <div className="nh-action-dock-input" data-dock-region="input">
          {input}
        </div>
      </div>
      <div className="nh-action-dock-tools">
        <DockTool
          disabled={layout.rows === 1}
          icon={Minus}
          label="Decrease rows"
          onClick={() => updateLayout({
            rows: Math.max(1, layout.rows - 1) as ActionBarLayout["rows"],
          })}
        />
        <DockTool
          disabled={layout.rows === 4}
          icon={Plus}
          label="Increase rows"
          onClick={() => updateLayout({
            rows: Math.min(4, layout.rows + 1) as ActionBarLayout["rows"],
          })}
        />
        <DockTool
          icon={layout.locked ? Lock : Unlock}
          label={layout.locked ? "Unlock action bar" : "Lock action bar"}
          onClick={() => updateLayout({ locked: !layout.locked })}
        />
        <DockTool icon={Ellipsis} label="All Actions" />
      </div>
    </section>
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
  slotIndex,
}: {
  active: boolean;
  blocked: boolean;
  catalog: SessionActionCatalog | null;
  name: string | null;
  onActionRequest?: (request: {
    name: string;
    sessionCommandId: number;
  }) => void;
  slotIndex: number;
}) {
  if (name === null) {
    return (
      <span
        aria-hidden="true"
        className="nh-action-slot nh-action-slot-empty"
        data-action-slot
        data-action-state="empty"
        data-empty-action-slot
        data-slot-index={slotIndex}
      />
    );
  }
  const presentation = catalog
    ? resolveActionSlotPresentation(name, catalog, {
      blocked: blocked && !active,
    })
    : unavailablePresentation(name);
  return (
    <button
      aria-label={`${presentation.name} (${presentation.key})`}
      className="nh-action-slot"
      data-action-icon={presentation.icon}
      data-action-name={presentation.name}
      data-action-slot
      data-action-state={presentation.state}
      data-slot-index={slotIndex}
      disabled={presentation.state !== "available"}
      onClick={() => {
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
      title={`${presentation.name} (${presentation.key})`}
      type="button"
    >
      <ActionIcon name={presentation.icon} />
      <span>{presentation.name}</span>
    </button>
  );
}

/**
 * Render one fixed-size dock command.
 * @param props - icon, accessible command label, state, and callback.
 * @returns one circular icon button.
 */
function DockTool({
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick?(): void;
}) {
  return (
    <button
      aria-label={label}
      className="nh-action-dock-tool"
      data-action-dock-tool
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" size={18} />
    </button>
  );
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

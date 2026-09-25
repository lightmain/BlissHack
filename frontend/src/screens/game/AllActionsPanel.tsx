import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Download, Upload, X } from "lucide-react";
import {
  diffActionBarLayouts,
  parseActionBarLayoutImport,
  serializeActionBarLayoutExport,
  type ActionBarDragSource,
  type ActionBarLayout,
  type ActionBarLayoutDifference,
} from "../../action-bar/action-bar-layout";
import {
  ACTION_CATALOG_CATEGORIES,
  buildActionPresentations,
  type ActionPresentation,
} from "../../action-bar/action-catalog-metadata";
import type { SessionActionCatalog } from "../../game-actions/action-catalog";

const SECTION_LABELS = {
  common: "Common",
  gear: "Gear",
  magic: "Magic",
  items: "Items",
  explore: "Explore",
  info: "Info",
  system: "System",
} as const;

interface AllActionsPanelProps {
  blocked: boolean;
  catalog: SessionActionCatalog;
  layout: ActionBarLayout;
  layoutBusy: boolean;
  onActionRequest?(request: {
    name: string;
    sessionCommandId: number;
  }): void;
  onClose(): void;
  onImportLayout(layout: ActionBarLayout): Promise<boolean>;
  onLostPointerCapture(event: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(event: ReactPointerEvent<HTMLElement>): void;
  onPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    source: ActionBarDragSource,
  ): void;
  onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
  onTooltipHide(
    target: HTMLElement,
    source: "focus" | "pointer",
  ): void;
  onTooltipShow(
    target: HTMLElement,
    presentation: ActionPresentation,
    source: "focus" | "pointer",
  ): void;
  renderIcon(name: string): ReactNode;
  suppressClickRef: RefObject<boolean>;
  tooltipTarget: HTMLElement | null;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

interface LayoutImportPreview {
  differences: ActionBarLayoutDifference[];
  layout: ActionBarLayout;
}

/**
 * Render the nonmodal action catalog and its layout transfer controls.
 * @param props - catalog, committed layout, interaction handlers, and opener.
 * @returns the scrollable panel positioned above the live action dock.
 */
export function AllActionsPanel({
  blocked,
  catalog,
  layout,
  layoutBusy,
  onActionRequest,
  onClose,
  onImportLayout,
  onLostPointerCapture,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onTooltipHide,
  onTooltipShow,
  renderIcon,
  suppressClickRef,
  tooltipTarget,
  triggerRef,
}: AllActionsPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreTriggerFocusRef = useRef(true);
  const [dockOffset, setDockOffset] = useState(12);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPending, setImportPending] = useState(false);
  const [preview, setPreview] = useState<LayoutImportPreview | null>(null);
  const presentations = useMemo(
    () => buildActionPresentations(catalog, { blocked }),
    [blocked, catalog],
  );
  const tooltipActionName = tooltipTarget
      ?.closest("[data-all-actions-panel]")
    ? tooltipTarget.dataset.actionName
    : undefined;

  useEffect(() => {
    const trigger = triggerRef.current;
    closeButtonRef.current?.focus();
    return () => {
      globalThis.setTimeout(() => {
        if (
          restoreTriggerFocusRef.current
          && trigger?.isConnected
          && !document.querySelector("[aria-modal='true']")
        ) {
          trigger.focus({ preventScroll: true });
        }
      }, 0);
    };
  }, [triggerRef]);

  useEffect(() => {
    const dock = document.querySelector<HTMLElement>("[data-action-dock]");
    if (!dock || typeof ResizeObserver === "undefined") return undefined;

    /**
     * Keep the panel clear of the dock as its row count changes.
     * @returns nothing.
     */
    function updateDockOffset(): void {
      setDockOffset(
        Math.max(12, window.innerHeight - dock!.getBoundingClientRect().top + 8),
      );
    }

    const observer = new ResizeObserver(updateDockOffset);
    observer.observe(dock);
    window.addEventListener("resize", updateDockOffset);
    updateDockOffset();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateDockOffset);
    };
  }, []);

  /**
   * Close the current panel layer without leaking Escape to NetHack.
   * @param event - keyboard event from the panel.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (preview) {
        setPreview(null);
      } else {
        onClose();
      }
    }
  }

  /**
   * Parse one selected layout into a review-only preview.
   * @param event - file input change event.
   * @returns completion after the selected bytes have been validated.
   */
  async function readImport(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setImportError(null);
    setPreview(null);
    if (!file.name.toLowerCase().endsWith(".bhactions")) {
      setImportError("Choose a .bhactions file.");
      return;
    }
    try {
      const document = parseActionBarLayoutImport(
        new Uint8Array(await file.arrayBuffer()),
      );
      setPreview({
        differences: diffActionBarLayouts(layout, document.actionBarLayout),
        layout: document.actionBarLayout,
      });
    } catch {
      setPreview(null);
      setImportError(
        "The selected action bar layout is damaged, unsupported, or invalid.",
      );
    }
  }

  /**
   * Persist the reviewed layout through the profile-owned commit path.
   * @returns completion after persistence accepts or rejects the layout.
   */
  async function confirmImport(): Promise<void> {
    if (
      !preview
      || importPending
      || layoutBusy
      || preview.differences.length === 0
    ) {
      return;
    }
    setImportPending(true);
    setImportError(null);
    try {
      if (await onImportLayout(preview.layout)) {
        setPreview(null);
      } else {
        setImportError(
          "The action bar layout could not be imported. "
            + "The previous layout is unchanged.",
        );
      }
    } finally {
      setImportPending(false);
    }
  }

  /**
   * Download the committed layout as a deterministic schema-v1 document.
   * @returns nothing.
   */
  function exportLayout(): void {
    const blob = new Blob([serializeActionBarLayoutExport(layout)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "blisshack-action-bar.bhactions";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /**
   * Close the panel before starting one available catalog command.
   * @param presentation - current session command presentation.
   * @param pointerClick - whether a pointer generated the click.
   * @returns nothing.
   */
  function requestAction(
    presentation: ActionPresentation,
    pointerClick: boolean,
  ): void {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      if (pointerClick) return;
    }
    if (
      presentation.state !== "available"
      || presentation.sessionCommandId === null
    ) {
      return;
    }
    restoreTriggerFocusRef.current = false;
    onClose();
    if (onActionRequest) {
      onActionRequest({
        name: presentation.name,
        sessionCommandId: presentation.sessionCommandId,
      });
    }
  }

  return (
    <section
      aria-label="All Actions"
      className="nh-all-actions-panel"
      data-action-drop-zone="all-actions"
      data-all-actions-panel
      data-browser-keyboard
      data-fullscreen="false"
      data-layout="vertical-sections"
      data-overlap-action-dock="false"
      id="nh-all-actions-panel"
      onKeyDown={handleKeyDown}
      ref={panelRef}
      role="dialog"
      style={{ "--all-actions-bottom": `${dockOffset}px` } as CSSProperties}
    >
      <header className="nh-all-actions-header">
        <h2>All Actions</h2>
        <div className="nh-all-actions-tools">
          <button
            aria-label="Export action bar layout"
            disabled={importPending}
            onClick={exportLayout}
            title="Export layout"
            type="button"
          >
            <Download aria-hidden="true" size={17} />
          </button>
          <button
            aria-label="Import action bar layout"
            disabled={importPending || layoutBusy}
            onClick={() => fileInputRef.current?.click()}
            title="Import layout"
            type="button"
          >
            <Upload aria-hidden="true" size={17} />
          </button>
          <button
            aria-label="Close All Actions"
            onClick={onClose}
            ref={closeButtonRef}
            title="Close"
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
          <input
            accept=".bhactions,application/json"
            hidden
            onChange={(event) => void readImport(event)}
            ref={fileInputRef}
            type="file"
          />
        </div>
      </header>

      {importError && (
        <p className="nh-all-actions-error" role="alert">{importError}</p>
      )}
      {preview && (
        <section
          aria-label="Review action bar layout import"
          className="nh-all-actions-import-preview"
          data-action-layout-import-preview
        >
          <h3>Import layout</h3>
          {preview.differences.length === 0
            ? <p>No layout changes.</p>
            : (
              <div className="nh-all-actions-differences">
                <div className="nh-all-actions-difference-heading">
                  <span>Setting</span>
                  <span>Current</span>
                  <span>Incoming</span>
                </div>
                {preview.differences.map((difference) => (
                  <div key={difference.path}>
                    <strong>{difference.label}</strong>
                    <span>{difference.current}</span>
                    <span>{difference.incoming}</span>
                  </div>
                ))}
              </div>
            )}
          <div className="nh-all-actions-import-actions">
            <button
              disabled={importPending}
              onClick={() => setPreview(null)}
              type="button"
            >
              Cancel
            </button>
            <button
              disabled={
                importPending
                || layoutBusy
                || preview.differences.length === 0
              }
              onClick={() => void confirmImport()}
              type="button"
            >
              Import
            </button>
          </div>
        </section>
      )}

      <div className="nh-all-actions-sections">
        {ACTION_CATALOG_CATEGORIES.map((category) => (
          <section
            className="nh-all-actions-section"
            data-all-actions-section={category}
            key={category}
          >
            <h3>{SECTION_LABELS[category]}</h3>
            <div className="nh-all-actions-grid">
              {presentations
                .filter((presentation) => presentation.category === category)
                .map((presentation) => (
                  <button
                    aria-describedby={
                      tooltipActionName === presentation.name
                        ? "action-hover-tooltip"
                        : undefined
                    }
                    aria-disabled={presentation.state !== "available"}
                    aria-label={`${presentation.name} (${presentation.key})`}
                    className="nh-all-actions-slot"
                    data-action-name={presentation.name}
                    data-action-state={presentation.state}
                    key={presentation.name}
                    onBlur={(event) =>
                      onTooltipHide(event.currentTarget, "focus")}
                    onClick={(event) =>
                      requestAction(presentation, event.detail > 0)}
                    onFocus={(event) =>
                      onTooltipShow(
                        event.currentTarget,
                        presentation,
                        "focus",
                      )}
                    onLostPointerCapture={onLostPointerCapture}
                    onPointerCancel={onPointerCancel}
                    onPointerDown={(event) =>
                      onPointerDown(event, {
                        kind: "all-actions",
                        name: presentation.name,
                      })}
                    onPointerEnter={(event) =>
                      onTooltipShow(
                        event.currentTarget,
                        presentation,
                        "pointer",
                      )}
                    onPointerLeave={(event) =>
                      onTooltipHide(event.currentTarget, "pointer")}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    type="button"
                  >
                    {renderIcon(presentation.icon)}
                    <span>{presentation.name}</span>
                    <kbd>{presentation.key}</kbd>
                  </button>
                ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

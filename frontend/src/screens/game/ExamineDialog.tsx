/* oxlint-disable react/only-export-components */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { X } from "lucide-react";
import type { LoadedEncyclopediaEntity } from "../../encyclopedia/encyclopedia-loader";
import type { ExamineTarget } from "../../encyclopedia/examine-target";
import { loadTileAtlas } from "../../map/tile-assets";
import type { MapRenderer } from "../../settings/profile";
import { ExamineFacts } from "./ExamineFacts";
import { ExamineSourceStrip } from "./ExamineSourceStrip";
import {
  ExamineWikiArticle,
  resolveExamineTabKey,
} from "./ExamineWikiArticle";

export { resolveExamineTabKey };

export type ExamineDialogState =
  | { status: "loading" }
  | { status: "ready"; entity: LoadedEncyclopediaEntity }
  | { status: "core-failure" };

/**
 * Render one session-owned encyclopedia dialog after the core menu handoff.
 * @param props - copied visible target, validated loading state, and lifecycle
 * callbacks owned by GameScreen.
 * @returns a blocking browser-only dialog, or null after a core data failure.
 */
export function ExamineDialog({
  mapRenderer = "ascii",
  nethackVersion,
  onClose,
  onRestoreFocus,
  state,
  target,
}: {
  mapRenderer?: MapRenderer;
  nethackVersion: string;
  onClose(): void;
  onRestoreFocus(): void;
  state: ExamineDialogState;
  target: ExamineTarget;
}) {
  const instanceId = useId().replaceAll(":", "");
  const titleId = `${instanceId}-examine-title`;
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const loading = state.status === "loading";

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    return () => onRestoreFocus();
  }, [onRestoreFocus]);

  if (state.status === "core-failure") return null;

  const core = state.status === "ready" ? state.entity.core : null;
  const wiki = state.status === "ready" ? state.entity.wiki : null;
  const title = core ? displayName(core.names.primary) : "Loading";

  /**
   * Contain browser keys and close without entering the NetHack key router.
   * @param event - key event from any dialog descendant.
   */
  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>): void {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), "
        + "[tabindex]:not([tabindex='-1'])",
    )).filter((element) =>
      element.tabIndex >= 0
      && element.closest("[hidden]") === null
      && !element.closest("[inert]")
    );
    if (focusable.length === 0) return;
    const activeIndex = focusable.indexOf(
      document.activeElement as HTMLElement,
    );
    const destination = activeIndex < 0
      ? (event.shiftKey ? focusable.length - 1 : 0)
      : resolveExamineFocusTrap(
        event.key,
        event.shiftKey,
        activeIndex,
        focusable.length,
      );
    if (destination === null) return;
    event.preventDefault();
    focusable[destination]?.focus();
  }

  /**
   * Close only when the pointer activates the backdrop itself.
   * @param event - click on the backdrop or a bubbling descendant.
   */
  function handleBackdropClick(event: MouseEvent<HTMLDivElement>): void {
    event.stopPropagation();
    if (!isExamineBackdropClick(event.target, event.currentTarget)) return;
    event.preventDefault();
    onClose();
  }

  return (
    <div
      className="examine-backdrop"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={loading ? "true" : undefined}
        className="examine-dialog"
        data-browser-keyboard="true"
        data-entity-id={target.entityId}
        data-examine-state={state.status}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
      >
        <header className="examine-header">
          <ExamineGlyph
            mapRenderer={mapRenderer}
            name={title}
            target={target}
          />
          <div className="examine-heading">
            <h1 id={titleId}>{title}</h1>
            {core
              ? (
                <>
                  <p>{entityCategory(core)}</p>
                  <HeaderBadges core={core} />
                </>
              )
              : <p>Loading local encyclopedia data...</p>}
          </div>
          <button
            aria-label="Close examine window"
            className="examine-close"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }}
            ref={closeRef}
            title="Close"
            type="button"
          >
            <X aria-hidden="true" size={21} />
          </button>
        </header>
        {loading
          ? (
            <div className="examine-loading" role="status">
              Loading local encyclopedia data...
            </div>
          )
          : (
            <>
              {wiki && <ExamineSourceStrip record={wiki} />}
              <div
                className="examine-layout"
                data-facts-only={wiki ? "false" : "true"}
              >
                {wiki && <ExamineWikiArticle record={wiki} />}
                {core && (
                  <ExamineFacts
                    core={core}
                    nethackVersion={nethackVersion}
                  />
                )}
              </div>
            </>
          )}
      </section>
    </div>
  );
}

/**
 * Resolve only the two focus-trap boundary transitions.
 * @param key - browser keyboard key.
 * @param reverse - whether Shift reverses traversal.
 * @param activeIndex - currently focused control.
 * @param count - number of focusable controls.
 * @returns wrapped destination or null for native in-range traversal.
 */
export function resolveExamineFocusTrap(
  key: string,
  reverse: boolean,
  activeIndex: number,
  count: number,
): number | null {
  if (key !== "Tab" || count <= 0) return null;
  if (reverse && activeIndex === 0) return count - 1;
  if (!reverse && activeIndex === count - 1) return 0;
  return null;
}

/**
 * Distinguish a direct backdrop click from a child click.
 * @param target - originating event target.
 * @param backdrop - backdrop current target.
 * @returns whether the backdrop itself was activated.
 */
export function isExamineBackdropClick(
  target: unknown,
  backdrop: unknown,
): boolean {
  return target === backdrop;
}

/**
 * Render supplementary source-backed header traits without replacing full
 * facts below.
 * @param props - validated core entity.
 * @returns a bounded set of header badges.
 */
function HeaderBadges({
  core,
}: {
  core: LoadedEncyclopediaEntity["core"];
}) {
  const facts = core.facts;
  const flags = facts.flags;
  const monsterFlags = flags !== null
      && typeof flags === "object"
      && !Array.isArray(flags)
    ? [
      ...arrayStrings((flags as Record<string, unknown>).m1),
      ...arrayStrings((flags as Record<string, unknown>).m2),
      ...arrayStrings((flags as Record<string, unknown>).m3),
    ]
    : [];
  const values = [
    typeof facts.size === "string" ? facts.size : null,
    ...monsterFlags,
  ].filter((value): value is string => value !== null).slice(0, 4);
  if (values.length === 0) return null;
  return (
    <div aria-label="Entity characteristics" className="examine-badges">
      {values.map((value) => (
        <code className="examine-badge" key={value}>{value}</code>
      ))}
    </div>
  );
}

/**
 * Render the current visible glyph, drawing the authoritative tile when the
 * active map renderer uses tiles and retaining an ASCII fallback.
 * @param props - copied target glyph and current renderer.
 * @returns fixed-size glyph portrait.
 */
function ExamineGlyph({
  mapRenderer,
  name,
  target,
}: {
  mapRenderer: MapRenderer;
  name: string;
  target: ExamineTarget;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tileReady, setTileReady] = useState(false);
  const glyph = target.glyph.ttyChar > 0
    ? String.fromCodePoint(target.glyph.ttyChar)
    : "?";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (mapRenderer !== "tiles" || !canvas) {
      setTileReady(false);
      return undefined;
    }
    let active = true;
    void loadTileAtlas().then((atlas) => {
      if (!active) return;
      const context = canvas.getContext("2d");
      const tileIndex = target.glyph.tileIndex;
      if (
        !context
        || tileIndex < 0
        || tileIndex >= atlas.manifest.atlas.tileCount
      ) {
        setTileReady(false);
        return;
      }
      const { width, height } = atlas.manifest.tile;
      const sourceX = (tileIndex % atlas.manifest.atlas.columns) * width;
      const sourceY = Math.floor(
        tileIndex / atlas.manifest.atlas.columns,
      ) * height;
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, width, height);
      context.drawImage(
        atlas.image,
        sourceX,
        sourceY,
        width,
        height,
        0,
        0,
        width,
        height,
      );
      setTileReady(true);
    }, () => setTileReady(false));
    return () => {
      active = false;
    };
  }, [mapRenderer, target.glyph.tileIndex]);

  return (
    <div
      aria-hidden="true"
      className="examine-portrait"
      data-examine-renderer={mapRenderer}
      data-tile-index={target.glyph.tileIndex}
      title={name}
    >
      <canvas
        className="examine-portrait-tile"
        height={16}
        hidden={!tileReady}
        ref={canvasRef}
        width={16}
      />
      {!tileReady && <span>{glyph}</span>}
    </div>
  );
}

/**
 * Build a concise kind line exclusively from validated core fields.
 * @param core - validated core entity.
 * @returns display category without inferred gameplay state.
 */
function entityCategory(core: LoadedEncyclopediaEntity["core"]): string {
  const className = typeof core.facts.monsterClass === "string"
    ? ` \u00b7 ${core.facts.monsterClass}`
    : "";
  return `${displayName(core.kind)}${className}`;
}

/**
 * Return only string members from a validated flags array.
 * @param value - facts value.
 * @returns string entries in source order.
 */
function arrayStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Capitalize one source display name.
 * @param value - validated entity name or kind.
 * @returns sentence-case display text.
 */
function displayName(value: string): string {
  return value.length === 0
    ? value
    : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

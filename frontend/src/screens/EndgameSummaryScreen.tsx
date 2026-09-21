import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  EndgameContentBlock,
  EndgameSection,
  EndgameSummary,
} from "../nethack-bridge";
import { colorClass, textAttributeClass } from "../text-styling";
import { InventoryItemContent } from "./PermanentInventoryPanel";
import {
  parseEndgameRanking,
  type EndgameRankingTable,
} from "./endgame-ranking";
import { getEndgameTabWheelDelta } from "./endgame-tab-wheel";
import { InterfaceShortcutLabel } from "./InterfaceShortcutLabel";
import { matchesInterfaceShortcut } from "./interface-shortcut";
import "../styles/endgame-summary.css";

interface EndgameSummaryScreenProps {
  summary: EndgameSummary;
  onConfirm(): void;
}

/**
 * Render one detached core-generated endgame result.
 * @param props - immutable result and the single completion action.
 * @returns an accessible tabbed result screen.
 */
export function EndgameSummaryScreen({
  summary,
  onConfirm,
}: EndgameSummaryScreenProps) {
  const instanceId = useId().replaceAll(":", "");
  const sections = useMemo(
    () => orderedSections(summary.sections),
    [summary.sections],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    tabRefs.current[0]?.focus();

    /** Keep forward and reverse Tab navigation inside the result dialog. */
    function containFocus(event: globalThis.KeyboardEvent): void {
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog!.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [tabindex]:not([tabindex='-1'])",
      )).filter((element) =>
        element.tabIndex >= 0 && element.closest("[hidden]") === null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1) as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    dialog.addEventListener("keydown", containFocus);
    return () => dialog.removeEventListener("keydown", containFocus);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    /** Confirm the detached result from any focus target inside its dialog. */
    function confirmWithEnter(event: globalThis.KeyboardEvent): void {
      if (!matchesInterfaceShortcut(event, "Enter")) return;
      event.preventDefault();
      event.stopPropagation();
      onConfirm();
    }

    dialog.addEventListener("keydown", confirmWithEnter);
    return () => dialog.removeEventListener("keydown", confirmWithEnter);
  }, [onConfirm]);

  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return undefined;
    const tablist = tabs;

    /** Map vertical wheel motion only while the tablist can consume it. */
    function scrollTabs(event: WheelEvent): void {
      if (tablist.scrollWidth <= tablist.clientWidth) return;
      const delta = getEndgameTabWheelDelta(event, tablist.clientWidth);
      if (delta === null || delta === 0) return;

      const maximum = tablist.scrollWidth - tablist.clientWidth;
      const next = Math.min(maximum, Math.max(0, tablist.scrollLeft + delta));
      if (next === tablist.scrollLeft) return;
      event.preventDefault();
      tablist.scrollLeft = next;
    }

    tablist.addEventListener("wheel", scrollTabs, { passive: false });
    return () => tablist.removeEventListener("wheel", scrollTabs);
  }, []);

  /**
   * Select and focus one tab after keyboard navigation.
   * @param index - wrapped destination index.
   */
  function focusTab(index: number): void {
    setSelectedIndex(index);
    tabRefs.current[index]?.focus();
  }

  /**
   * Implement the horizontal tabs keyboard contract.
   * @param event - keyboard event from a tab button.
   * @param index - source tab index.
   */
  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % sections.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + sections.length) % sections.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = sections.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    focusTab(nextIndex);
  }

  return (
    <div className="end-summary-backdrop">
      <main
        aria-labelledby={`${instanceId}-end-summary-title`}
        aria-modal="true"
        className="end-summary-screen"
        ref={dialogRef}
        role="dialog"
      >
        <header className="end-summary-header">
          <h1 id={`${instanceId}-end-summary-title`}>Game Over</h1>
        </header>
        <div
          aria-label="Endgame results"
          aria-orientation="horizontal"
          className="end-summary-tabs"
          data-browser-tab-navigation="true"
          ref={tabsRef}
          role="tablist"
        >
          {sections.map((section, index) => {
            const tabId = `${instanceId}-end-tab-${index}`;
            const panelId = `${instanceId}-end-panel-${index}`;
            return (
              <button
                role="tab"
                aria-controls={panelId}
                aria-selected={selectedIndex === index}
                className="end-summary-tab"
                id={tabId}
                key={`${section.kind}-${section.title}-${index}`}
                onClick={() => setSelectedIndex(index)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                tabIndex={selectedIndex === index ? 0 : -1}
                type="button"
              >
                {section.title}
              </button>
            );
          })}
        </div>
        <section className="end-summary-content">
          {sections.map((section, index) => {
            const tabId = `${instanceId}-end-tab-${index}`;
            const panelId = `${instanceId}-end-panel-${index}`;
            const inventory = section.kind === "disclosure"
              && section.title === "Identified Possessions";
            const ranking = parseRankingSection(section);
            return (
              <div
                role="tabpanel"
                aria-labelledby={tabId}
                className="end-summary-panel"
                data-end-summary-scroll="true"
                hidden={selectedIndex !== index}
                id={panelId}
                key={`${section.kind}-${section.title}-${index}`}
                tabIndex={selectedIndex === index ? 0 : -1}
              >
                {ranking
                  ? <EndgameRanking ranking={ranking} />
                  : section.blocks.map((block, blockIndex) => (
                    <EndgameBlock
                      block={block}
                      inventory={inventory}
                      key={`${block.kind}-${blockIndex}`}
                    />
                  ))}
              </div>
            );
          })}
        </section>
        <footer className="end-summary-footer">
          <button
            aria-keyshortcuts="Enter"
            className="end-summary-confirm"
            data-end-summary-confirm="true"
            onClick={onConfirm}
            type="button"
          >
            <InterfaceShortcutLabel shortcut="enter">
              Confirm
            </InterfaceShortcutLabel>
          </button>
        </footer>
      </main>
    </div>
  );
}

/** Sort valid sections into the fixed Summary/disclosure/Ranking order. */
function orderedSections(
  sections: readonly EndgameSection[],
): readonly EndgameSection[] {
  const summary = sections.find((section) =>
    section.kind === "summary" && section.blocks.length > 0);
  const disclosures = sections.filter((section) =>
    section.kind === "disclosure" && section.blocks.length > 0);
  const ranking = sections.find((section) =>
    section.kind === "ranking" && section.blocks.length > 0);
  return [
    ...(summary ? [summary] : []),
    ...disclosures,
    ...(ranking ? [ranking] : []),
  ];
}

/**
 * Parse a Ranking section only when every captured block is raw text.
 * @param section - immutable endgame section selected for display.
 * @returns semantic table data, or null to preserve the original blocks.
 */
function parseRankingSection(
  section: EndgameSection,
): EndgameRankingTable | null {
  if (
    section.kind !== "ranking"
    || section.blocks.some((block) => block.kind !== "text")
  ) {
    return null;
  }
  return parseEndgameRanking(
    section.blocks.flatMap((block) =>
      block.kind === "text" ? block.lines : []),
  );
}

/**
 * Render semantic score rows reconstructed from the core's terminal output.
 * @param props - parsed preamble and complete local ranking rows.
 * @returns a responsive native table with the current game identified.
 */
function EndgameRanking({
  ranking,
}: {
  ranking: EndgameRankingTable;
}) {
  return (
    <div className="end-ranking">
      {ranking.preamble.length > 0 && (
        <EndgameLines lines={ranking.preamble} />
      )}
      <div
        aria-label="Ranking table"
        className="end-ranking-scroll"
        role="region"
        tabIndex={0}
      >
        <table aria-label="Local ranking" className="end-ranking-table">
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Points</th>
              <th scope="col">Character</th>
              <th scope="col">Outcome</th>
              <th scope="col">HP</th>
            </tr>
          </thead>
          <tbody>
            {ranking.rows.map((row, index) => (
              <tr
                aria-current={row.current ? "true" : undefined}
                className={row.current ? "end-ranking-current" : undefined}
                key={`${row.rank ?? "current"}-${row.character}-${index}`}
              >
                <td className="end-ranking-number">
                  {row.rank ?? "\u2014"}
                </td>
                <td className="end-ranking-number">{row.points}</td>
                <td className="end-ranking-character">{row.character}</td>
                <td className="end-ranking-outcome">{row.outcome}</td>
                <td className="end-ranking-hp">
                  {row.hitPoints} [{row.maximumHitPoints}]
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Render one copied block without retaining its retired window identity.
 * @param props - immutable content and whether it uses inventory presentation.
 * @returns one text, generic menu, or inventory block.
 */
function EndgameBlock({
  block,
  inventory,
}: {
  block: EndgameContentBlock;
  inventory: boolean;
}) {
  if (block.kind === "text") {
    return <EndgameLines lines={block.lines} />;
  }
  if (inventory) {
    return (
      <div className="end-summary-block end-summary-inventory">
        <EndgameLines lines={block.lines} />
        {block.prompt && (
          <div className="end-summary-menu-prompt">{block.prompt}</div>
        )}
        <div className="nh-menu-items permanent-inventory-items">
          {block.items.map((item, index) =>
            item.identifier === null
              ? (
                <div
                  className={`nh-menu-heading permanent-inventory-heading ${textAttributeClass(item.attribute)}`}
                  key={`${index}:${item.text}`}
                >
                  {item.text || "\u00a0"}
                </div>
              )
              : (
                <div
                  className={[
                    "nh-menu-item",
                    "permanent-inventory-item",
                    item.itemFlags !== 0 ? "selected" : "",
                    colorClass(item.color),
                    textAttributeClass(item.attribute),
                  ].filter(Boolean).join(" ")}
                  key={`${item.identifier}:${index}`}
                >
                  <InventoryItemContent item={item} />
                </div>
              )
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="end-summary-block">
      <EndgameLines lines={block.lines} />
      {block.prompt && (
        <div className="end-summary-menu-prompt">{block.prompt}</div>
      )}
      {block.items.map((item, index) => (
        <div
          className={[
            "end-summary-line",
            textAttributeClass(item.attribute),
            colorClass(item.color),
          ].filter(Boolean).join(" ")}
          key={`${item.identifier}-${index}`}
        >
          {item.text}
        </div>
      ))}
    </div>
  );
}

/** Render styled core text while preserving whitespace and line order. */
function EndgameLines({
  lines,
}: {
  lines: readonly { text: string; attribute: number }[];
}) {
  return (
    <div className="end-summary-block">
      {lines.map((line, index) => (
        <div
          className={[
            "end-summary-line",
            textAttributeClass(line.attribute),
          ].filter(Boolean).join(" ")}
          key={`${index}-${line.text}`}
        >
          {line.text || "\u00a0"}
        </div>
      ))}
    </div>
  );
}

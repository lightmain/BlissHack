import {
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

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
    <main className="end-summary-screen">
      <header className="end-summary-header">
        <h1>Game Over</h1>
      </header>
      <div
        aria-label="Endgame results"
        aria-orientation="horizontal"
        className="end-summary-tabs"
        data-browser-tab-navigation="true"
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
              {section.blocks.map((block, blockIndex) => (
                <EndgameBlock
                  block={block}
                  key={`${block.kind}-${blockIndex}`}
                />
              ))}
            </div>
          );
        })}
      </section>
      <footer className="end-summary-footer">
        <button
          className="primary-button"
          data-end-summary-confirm="true"
          onClick={onConfirm}
          type="button"
        >
          Confirm
        </button>
      </footer>
    </main>
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

/** Render one copied text or menu block without its retired window identity. */
function EndgameBlock({ block }: { block: EndgameContentBlock }) {
  if (block.kind === "text") {
    return <EndgameLines lines={block.lines} />;
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

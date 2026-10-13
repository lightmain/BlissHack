/* oxlint-disable react/only-export-components */
import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { WikiRecord } from "../../encyclopedia/wiki-schema";

type WikiTab = WikiRecord["sections"][number]["tab"];

const TAB_LABELS: Record<WikiTab, string> = {
  history: "History",
  strategy: "Strategy",
};

/**
 * Resolve horizontal tab navigation without depending on DOM state.
 * @param key - browser keyboard key.
 * @param index - current tab index.
 * @param count - number of available tabs.
 * @returns wrapped destination, or null when the key is unrelated.
 */
export function resolveExamineTabKey(
  key: string,
  index: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/**
 * Render reviewed complete paragraphs grouped by their published Wiki tabs.
 * @param props - validated Wiki record with fixed-revision sections.
 * @returns accessible tabs and text-only article panels.
 */
export function ExamineWikiArticle({ record }: { record: WikiRecord }) {
  const instanceId = useId().replaceAll(":", "");
  const tabs = useMemo(() => orderedTabs(record), [record]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.min(selectedIndex, Math.max(0, tabs.length - 1));

  /**
   * Select and focus one tab after keyboard navigation.
   * @param index - destination in the ordered published-tab list.
   */
  function focusTab(index: number): void {
    setSelectedIndex(index);
    tabRefs.current[index]?.focus();
  }

  /**
   * Apply the WAI-ARIA horizontal tab keyboard contract.
   * @param event - key event from one tab.
   * @param index - source tab index.
   */
  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    const next = resolveExamineTabKey(event.key, index, tabs.length);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    focusTab(next);
  }

  if (tabs.length === 0) return null;

  return (
    <article
      className="examine-article"
      data-content-license={record.license.spdxLikeId}
      data-source-revision={record.page.revisionId}
    >
      <nav
        aria-label={`${record.page.title} information`}
        className="examine-tabs"
        role="tablist"
      >
        {tabs.map((tab, index) => {
          const tabId = `${instanceId}-examine-tab-${tab}`;
          const panelId = `${instanceId}-examine-panel-${tab}`;
          return (
            <button
              role="tab"
              aria-controls={panelId}
              aria-selected={activeIndex === index}
              className="examine-tab"
              data-examine-tab={tab}
              id={tabId}
              key={tab}
              onClick={() => setSelectedIndex(index)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              tabIndex={activeIndex === index ? 0 : -1}
              type="button"
            >
              {TAB_LABELS[tab]}
            </button>
          );
        })}
      </nav>
      {tabs.map((tab, index) => {
        const tabId = `${instanceId}-examine-tab-${tab}`;
        const panelId = `${instanceId}-examine-panel-${tab}`;
        const sections = record.sections.filter((section) =>
          section.tab === tab
        );
        return (
          <section
            role="tabpanel"
            aria-labelledby={tabId}
            className="examine-tab-panel"
            hidden={activeIndex !== index}
            id={panelId}
            key={tab}
            tabIndex={activeIndex === index ? 0 : -1}
          >
            {sections.map((section, sectionIndex) => (
              <div
                className="examine-wiki-section"
                key={`${section.sourceHeading}-${sectionIndex}`}
              >
                <h2>{section.sourceHeading}</h2>
                <p className="examine-excerpt-label">
                  Verbatim Wiki excerpt
                </p>
                <blockquote
                  cite={record.page.sourceUrl}
                  className="examine-wiki-excerpt"
                >
                  {section.paragraphs.map((paragraph, paragraphIndex) => (
                    <p key={`${section.sourceHeading}-${paragraphIndex}`}>
                      {paragraph}
                    </p>
                  ))}
                </blockquote>
              </div>
            ))}
          </section>
        );
      })}
    </article>
  );
}

/**
 * Preserve first-published tab order while collapsing repeated sections.
 * @param record - validated record with one or more selected sections.
 * @returns unique tabs in source order.
 */
function orderedTabs(record: WikiRecord): WikiTab[] {
  const tabs: WikiTab[] = [];
  for (const section of record.sections) {
    if (!tabs.includes(section.tab)) tabs.push(section.tab);
  }
  return tabs;
}

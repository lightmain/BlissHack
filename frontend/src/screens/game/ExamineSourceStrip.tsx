import type { MouseEvent } from "react";
import type { WikiRecord } from "../../encyclopedia/wiki-schema";

/**
 * Render complete attribution for one reviewed NetHackWiki excerpt record.
 * @param props - validated Wiki record whose text appears below the strip.
 * @returns a distinct CC BY-SA source and modification notice.
 */
export function ExamineSourceStrip({
  record,
}: {
  record: WikiRecord;
}) {
  /**
   * Keep link activation inside the browser-owned dialog boundary.
   * @param event - link click bubbling toward the game shell.
   */
  function isolateLink(event: MouseEvent<HTMLAnchorElement>): void {
    event.stopPropagation();
  }

  return (
    <div className="examine-source-strip">
      <span>Verbatim excerpts from</span>
      <a
        href={record.page.sourceUrl}
        onClick={isolateLink}
        rel="noopener noreferrer"
        target="_blank"
      >
        &ldquo;{record.page.title}&rdquo;
      </a>
      <span>by</span>
      <a
        href={record.page.historyUrl}
        onClick={isolateLink}
        rel="noopener noreferrer"
        target="_blank"
      >
        {record.page.authorLabel}
      </a>
      <span className="examine-source-divider" aria-hidden="true">
        {"\u00b7"}
      </span>
      <span>revision {record.page.revisionId}</span>
      <span className="examine-source-divider" aria-hidden="true">
        {"\u00b7"}
      </span>
      <a
        href={record.license.url}
        onClick={isolateLink}
        rel="license noopener noreferrer"
        target="_blank"
      >
        CC BY-SA 3.0
      </a>
      <span className="examine-source-note">
        Selection only. {sentenceList(record.modifications)}
      </span>
    </div>
  );
}

/**
 * Present reviewed modification labels without changing their meaning.
 * @param entries - ordered modification labels from the validated record.
 * @returns one sentence preserving every label.
 */
function sentenceList(entries: readonly string[]): string {
  if (entries.length === 0) return "";
  const sentence = entries.join("; ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

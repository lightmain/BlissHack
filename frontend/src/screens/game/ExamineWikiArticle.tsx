import type { WikiRecord } from "../../encyclopedia/wiki-schema";

/**
 * Render every reviewed Wiki section after the shared core fact document.
 * @param props - validated Wiki record with fixed-revision sections.
 * @returns a static text-only article preserving source section order.
 */
export function ExamineWikiArticle({ record }: { record: WikiRecord }) {
  if (record.sections.length === 0) return null;

  return (
    <article
      className="examine-article"
      data-content-license={record.license.spdxLikeId}
      data-source-revision={record.page.revisionId}
    >
      {record.sections.map((section, sectionIndex) => (
        <section
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
        </section>
      ))}
    </article>
  );
}

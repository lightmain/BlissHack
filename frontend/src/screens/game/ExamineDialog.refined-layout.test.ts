import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CoreEntityRecord } from "../../encyclopedia/core-schema";
import type { LoadedEncyclopediaEntity } from "../../encyclopedia/encyclopedia-loader";
import type { ExamineTarget } from "../../encyclopedia/examine-target";
import { ExamineDialog } from "./ExamineDialog";
import { ExamineFacts } from "./ExamineFacts";
import {
  NEWT_CORE,
  NEWT_ENTITY,
  NEWT_TARGET,
  NEWT_WIKI,
} from "./ExamineDialog.test-fixtures";

interface TrustedWikiPage {
  title: string;
  url: string;
}

type EntityWithWikiPage = LoadedEncyclopediaEntity & {
  wikiPage: TrustedWikiPage | null;
};

/** Render one ready Examine dialog with explicit trusted page metadata. */
function renderDialog(
  entity: LoadedEncyclopediaEntity,
  target: ExamineTarget = NEWT_TARGET,
): string {
  return renderToStaticMarkup(createElement(ExamineDialog, {
    nethackVersion: "5.0.0",
    onClose: vi.fn(),
    onRestoreFocus: vi.fn(),
    state: { status: "ready", entity },
    target,
  }));
}

/** Return the rendered heading without the adjacent close control. */
function headingMarkup(html: string): string {
  const start = html.indexOf('<div class="examine-heading');
  const end = html.indexOf('<button aria-label="Close examine window"', start);
  expect(start, "missing Examine heading").toBeGreaterThan(-1);
  expect(end, "missing Examine close control").toBeGreaterThan(start);
  return html.slice(start, end);
}

/** Create a facts-only catalog entity with one explicit Wiki page decision. */
function catalogEntity(
  core: CoreEntityRecord,
  wikiPage: TrustedWikiPage | null,
): EntityWithWikiPage {
  return {
    core,
    wiki: null,
    wikiPage,
  };
}

/** Escape the characters React encodes inside static href attributes. */
function renderedHref(url: string): string {
  return url.replaceAll("&", "&amp;");
}

describe("refined Examine Wiki page links", () => {
  it("links a safely resolved facts-only entity from the page header", () => {
    const core = structuredClone(NEWT_CORE);
    core.id = "monster:PM_KITTEN";
    core.names = { primary: "kitten" };
    core.sourceRefs = [{
      path: "include/monsters.h",
      symbol: "PM_KITTEN",
    }];
    const target: ExamineTarget = {
      ...NEWT_TARGET,
      entityId: "monster:PM_KITTEN",
    };
    const html = renderDialog(catalogEntity(core, {
      title: "Kitten",
      url: "https://nethackwiki.com/wiki/Kitten",
    }), target);
    const heading = headingMarkup(html);

    expect(heading).toContain(
      'href="https://nethackwiki.com/wiki/Kitten"',
    );
    expect(heading).toContain('aria-label="Open Kitten on NetHackWiki"');
    expect(heading).toMatch(
      /rel="(?=[^"]*noopener)(?=[^"]*noreferrer)[^"]+" target="_blank"/,
    );
  });

  it("uses only an explicit safe category page for a generic appearance", () => {
    const core: CoreEntityRecord = {
      schemaVersion: 1,
      id: "appearance:POTION_CLASS:GENERIC",
      kind: "appearance",
      names: {
        primary: "potion of healing from untrusted visible text",
      },
      symbol: 33,
      color: null,
      facts: { objectClass: "POTION_CLASS" },
      sourceRefs: [{
        path: "include/objects.h",
        symbol: "POTION_CLASS",
      }],
    };
    const target: ExamineTarget = {
      ...NEWT_TARGET,
      entityId: core.id,
    };
    const safeHeading = headingMarkup(renderDialog(catalogEntity(core, {
      title: "Potion",
      url: "https://nethackwiki.com/wiki/Potion",
    }), target));
    const unmappedHeading = headingMarkup(renderDialog(
      catalogEntity(core, null),
      target,
    ));

    expect(safeHeading).toContain(
      'href="https://nethackwiki.com/wiki/Potion"',
    );
    expect(safeHeading).not.toMatch(/Potion_of_healing|potion_of_healing/i);
    expect(unmappedHeading).not.toContain("href=");
    expect(unmappedHeading).not.toMatch(
      /nethackwiki\.com[^"]*(?:healing|untrusted)/i,
    );
  });

  it("retains the existing Wiki attribution and license source strip", () => {
    const html = renderDialog(NEWT_ENTITY);
    const start = html.indexOf('<div class="examine-source-strip">');
    const end = html.indexOf('<div class="examine-layout"', start);
    const strip = html.slice(start, end);

    expect(start, "missing Wiki source strip").toBeGreaterThan(-1);
    expect(strip).toContain(
      `href="${renderedHref(NEWT_WIKI.page.sourceUrl)}"`,
    );
    expect(strip).toContain(
      `href="${renderedHref(NEWT_WIKI.page.historyUrl)}"`,
    );
    expect(strip).toContain("NetHackWiki contributors");
    expect(strip).toContain(`revision ${NEWT_WIKI.page.revisionId}`);
    expect(strip).toContain("CC BY-SA 3.0");
    expect(strip).toContain("Selection only.");
    expect(strip).toMatch(
      /rel="(?=[^"]*license)(?=[^"]*noopener)(?=[^"]*noreferrer)[^"]+"/,
    );
  });
});

describe("refined Examine fact hierarchy", () => {
  it("groups primary and secondary monster facts into distinct columns", () => {
    const html = renderToStaticMarkup(createElement(ExamineFacts, {
      core: NEWT_CORE,
      nethackVersion: "5.0.0",
    }));
    const primary = html.indexOf("examine-facts-primary");
    const secondary = html.indexOf("examine-facts-secondary");
    const provenance = html.indexOf("examine-provenance");

    expect(primary, "missing primary facts column").toBeGreaterThan(-1);
    expect(secondary, "missing secondary facts column").toBeGreaterThan(
      primary,
    );
    expect(provenance, "provenance must follow both fact columns")
      .toBeGreaterThan(secondary);

    for (const heading of ["Core statistics", "Attack", "Generation"]) {
      const index = html.indexOf(`>${heading}</h2>`);
      expect(index, `${heading} must be in the primary column`)
        .toBeGreaterThan(primary);
      expect(index, `${heading} must be in the primary column`)
        .toBeLessThan(secondary);
    }
    for (
      const heading of [
        "HP rule",
        "Traits and resistances",
        "Corpse",
        "Special effects",
      ]
    ) {
      const index = html.indexOf(`>${heading}</h2>`);
      expect(index, `${heading} must be in the secondary column`)
        .toBeGreaterThan(secondary);
      expect(index, `${heading} must be in the secondary column`)
        .toBeLessThan(provenance);
    }
  });

  it("marks the core statistics and key combat fields for emphasis", () => {
    const html = renderToStaticMarkup(createElement(ExamineFacts, {
      core: NEWT_CORE,
      nethackVersion: "5.0.0",
    }));
    const emphasizedLabels = [
      ...html.matchAll(
        /<div class="[^"]*\bexamine-key-fact\b[^"]*"><dt>([^<]+)<\/dt>/g,
      ),
    ].map((match) => match[1]);

    expect(html).toContain("examine-core-statistics");
    expect(emphasizedLabels).toEqual([
      "monsterClass",
      "level",
      "difficulty",
      "speed",
      "armorClass",
      "magicResistance",
      "alignment",
    ]);
    expect(emphasizedLabels).not.toContain("weight");
    expect(emphasizedLabels).not.toContain("nutrition");
  });
});

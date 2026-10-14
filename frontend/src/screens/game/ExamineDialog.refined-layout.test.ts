/// <reference types="node" />

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CoreEntityRecord } from "../../encyclopedia/core-schema";
import type { LoadedEncyclopediaEntity } from "../../encyclopedia/encyclopedia-loader";
import type { ExamineTarget } from "../../encyclopedia/examine-target";
import { resolveWikiPage } from "../../encyclopedia/wiki-page";
import { ExamineDialog } from "./ExamineDialog";
import { ExamineFacts } from "./ExamineFacts";
import {
  ARTIFACT_CORE,
  NEWT_CORE,
  NEWT_ENTITY,
  NEWT_TARGET,
  NEWT_WIKI,
  WEAPON_CORE,
} from "./ExamineDialog.test-fixtures";

interface TrustedWikiPage {
  title: string;
  url: string;
}

type EntityWithWikiPage = LoadedEncyclopediaEntity & {
  wikiPage: TrustedWikiPage | null;
};

const FACTS_SOURCE = readFileSync(
  new URL("./ExamineFacts.tsx", import.meta.url),
  "utf8",
);
const DIALOG_SOURCE = readFileSync(
  new URL("./ExamineDialog.tsx", import.meta.url),
  "utf8",
);
const OBJECT_CLASSES = [
  "ILLOBJ_CLASS",
  "WEAPON_CLASS",
  "ARMOR_CLASS",
  "RING_CLASS",
  "AMULET_CLASS",
  "TOOL_CLASS",
  "FOOD_CLASS",
  "POTION_CLASS",
  "SCROLL_CLASS",
  "SPBOOK_CLASS",
  "WAND_CLASS",
  "COIN_CLASS",
  "GEM_CLASS",
  "ROCK_CLASS",
  "BALL_CLASS",
  "CHAIN_CLASS",
  "VENOM_CLASS",
] as const;
const OBJECT_RECORDS = ["object-002.json", "object-003.json"].flatMap((file) =>
  (JSON.parse(readFileSync(
    new URL(`../../../public/encyclopedia/core/${file}`, import.meta.url),
    "utf8",
  )) as { records: CoreEntityRecord[] }).records
);

/** Return one checked-in object record by its stable source ID. */
function objectRecord(id: string): CoreEntityRecord {
  const record = OBJECT_RECORDS.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`Missing object fixture ${id}`);
  return structuredClone(record);
}

/** Render one ready Examine dialog with explicit trusted page metadata. */
function renderDialog(
  entity: LoadedEncyclopediaEntity,
  target: ExamineTarget = NEWT_TARGET,
): string {
  const renderedEntity = {
    ...entity,
    core: presentationCompatibleCore(entity.core),
  };
  return renderToStaticMarkup(createElement(ExamineDialog, {
    nethackVersion: "5.0.0",
    onClose: vi.fn(),
    onRestoreFocus: vi.fn(),
    state: { status: "ready", entity: renderedEntity },
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

/** Render only the core facts presentation for one schema-v2 fixture. */
function renderFacts(
  core: CoreEntityRecord,
): string {
  return renderToStaticMarkup(createElement(ExamineFacts, {
    core: presentationCompatibleCore(core),
    nethackVersion: "5.0.0",
  }));
}

/**
 * Let the legacy renderer reach the new assertions while schema tests keep
 * v2 records themselves free of the removed kind field.
 */
function presentationCompatibleCore(
  core: CoreEntityRecord,
): CoreEntityRecord {
  const candidate = core as unknown as Record<string, unknown>;
  return "kind" in candidate || typeof candidate.family !== "string"
    ? core
    : { ...candidate, kind: candidate.family } as unknown as CoreEntityRecord;
}

/** Build one schema-v2 object presentation fixture for an exact class. */
function objectClassRecord(objectClass: string): CoreEntityRecord {
  const record = structuredClone(WEAPON_CORE) as unknown as {
    id: string;
    names: { primary: string };
    facts: Record<string, unknown>;
  };
  record.id = `object:TEST_${objectClass}`;
  record.names = { primary: `test ${objectClass.toLowerCase()}` };
  record.facts.objectClass = objectClass;
  record.facts.subtype = {};
  return record as unknown as CoreEntityRecord;
}

/** Return the opening tag for one rendered class. */
function openingTag(html: string, className: string): string {
  const match = html.match(new RegExp(
    `<[^>]+class="[^"]*\\b${className}\\b[^"]*"[^>]*>`,
  ));
  expect(match, `missing ${className} opening tag`).not.toBeNull();
  return match![0];
}

/** Return the complete core facts subtree from static dialog markup. */
function factsMarkup(html: string): string {
  const start = html.indexOf("<aside");
  const end = html.indexOf("</aside>", start);
  expect(start, "missing facts subtree").toBeGreaterThan(-1);
  expect(end, "missing facts subtree end").toBeGreaterThan(start);
  return html.slice(start, end + "</aside>".length);
}

describe("refined Examine Wiki page links", () => {
  it.each([
    [
      "object:POT_HEALING",
      "Potion of healing",
      "https://nethackwiki.com/wiki/Potion_of_healing",
    ],
    [
      "object:WAN_FIRE",
      "Wand of fire",
      "https://nethackwiki.com/wiki/Wand_of_fire",
    ],
  ])("resolves the runtime catalog page for %s", (id, title, url) => {
    expect(resolveWikiPage({
      core: objectRecord(id),
      wiki: null,
    })).toEqual({ title, url });
  });

  it("prefers a reviewed Wiki title over the runtime fallback", () => {
    const wiki = structuredClone(NEWT_WIKI);
    wiki.page.title = "Potion";

    expect(resolveWikiPage({
      core: objectRecord("object:POT_HEALING"),
      wiki,
    })).toEqual({
      title: "Potion",
      url: "https://nethackwiki.com/wiki/Potion",
    });
  });

  it("keeps generic appearances fixed-map and fail-closed", () => {
    const appearance = (objectClass: string): CoreEntityRecord => ({
      schemaVersion: 2,
      id: `appearance:${objectClass}:GENERIC`,
      family: "appearance",
      names: { primary: "wand of fire from visible text" },
      symbol: 33,
      color: null,
      facts: { objectClass },
      sourceRefs: [{ path: "include/objects.h", symbol: objectClass }],
    } as unknown as CoreEntityRecord);

    expect(resolveWikiPage({
      core: appearance("POTION_CLASS"),
      wiki: null,
    })).toEqual({
      title: "Potion",
      url: "https://nethackwiki.com/wiki/Potion",
    });
    expect(resolveWikiPage({
      core: appearance("MYSTERY_CLASS"),
      wiki: null,
    })).toBeNull();
  });

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
    const core = {
      schemaVersion: 2,
      id: "appearance:POTION_CLASS:GENERIC",
      family: "appearance",
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
    } as unknown as CoreEntityRecord;
    const target: ExamineTarget = {
      ...NEWT_TARGET,
      entityId: core.id,
    };
    const safeHeading = headingMarkup(renderDialog(catalogEntity(core, {
      title: "Potion",
      url: "https://nethackwiki.com/wiki/Potion",
    }), target));
    const concreteHeading = headingMarkup(renderDialog(catalogEntity(core, {
      title: "Potion of healing",
      url: "https://nethackwiki.com/wiki/Potion_of_healing",
    }), target));
    const unmappedHeading = headingMarkup(renderDialog(
      catalogEntity(core, null),
      target,
    ));

    expect(safeHeading).toContain(
      'href="https://nethackwiki.com/wiki/Potion"',
    );
    expect(safeHeading).toContain(
      'href="https://nethackwiki.com/wiki/Potion"',
    );
    for (const heading of [concreteHeading, unmappedHeading]) {
      expect(heading).not.toContain("href=");
      expect(heading).not.toMatch(
        /nethackwiki\.com[^"]*(?:healing|untrusted)/i,
      );
    }
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
  it("selects an objectClass template instead of a family-wide object page", () => {
    const html = renderDialog(
      { core: WEAPON_CORE, wiki: null },
      { ...NEWT_TARGET, entityId: WEAPON_CORE.id },
    );

    expect(html).toContain(
      'data-examine-template="object:WEAPON_CLASS"',
    );
    expect(html).not.toContain("data-entity-kind");
    expect(html).not.toContain("examine-facts-primary");
    expect(html).not.toContain("examine-facts-secondary");
  });

  it("groups primary and secondary monster facts into distinct columns", () => {
    const html = renderFacts(NEWT_CORE);
    const primary = html.indexOf("examine-facts-primary");
    const secondary = html.indexOf("examine-facts-secondary");
    const provenance = html.indexOf("examine-provenance");

    expect(primary, "missing primary facts column").toBeGreaterThan(-1);
    expect(secondary, "missing secondary facts column").toBeGreaterThan(
      primary,
    );
    expect(provenance, "provenance must follow both fact columns")
      .toBeGreaterThan(secondary);
    expect(html).toContain('data-examine-template="monster"');

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
    const html = renderFacts(NEWT_CORE);
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

describe("core-class Examine template dispatch", () => {
  it.each(OBJECT_CLASSES)(
    "maps %s through facts.objectClass",
    (objectClass) => {
      const html = renderFacts(objectClassRecord(objectClass));

      expect(html).toContain(
        `data-examine-template="object:${objectClass}"`,
      );
      expect(html).toContain(objectClass);
      expect(html).not.toContain("data-entity-kind");
    },
  );

  it.each([
    [
      "terrain",
      {
        schemaVersion: 2,
        id: "terrain:S_FOUNTAIN",
        family: "terrain",
        names: { primary: "fountain" },
        symbol: 123,
        color: 6,
        facts: { terrainSymbol: "S_FOUNTAIN", category: "feature" },
        sourceRefs: [{
          path: "include/defsym.h",
          symbol: "S_FOUNTAIN",
        }],
      },
      "terrain",
    ],
    [
      "trap",
      {
        schemaVersion: 2,
        id: "trap:ARROW_TRAP",
        family: "trap",
        names: { primary: "arrow trap" },
        symbol: 94,
        color: 7,
        facts: { trapSymbol: "ARROW_TRAP", category: "physical" },
        sourceRefs: [{ path: "include/trap.h", symbol: "ARROW_TRAP" }],
      },
      "trap",
    ],
    [
      "appearance",
      {
        schemaVersion: 2,
        id: "appearance:POTION_CLASS:GENERIC",
        family: "appearance",
        names: { primary: "potion" },
        symbol: 33,
        color: 5,
        facts: { objectClass: "POTION_CLASS" },
        sourceRefs: [{
          path: "include/objects.h",
          symbol: "GENERIC_POTION",
        }],
      },
      "appearance:POTION_CLASS",
    ],
  ])("uses the %s core template", (_label, fixture, template) => {
    const html = renderFacts(fixture as unknown as CoreEntityRecord);
    expect(html).toContain(`data-examine-template="${template}"`);
  });

  it("uses the base object template before adding an artifact overlay", () => {
    const html = renderDialog({
      core: ARTIFACT_CORE,
      wiki: null,
      artifactBaseObject: WEAPON_CORE,
    } as unknown as LoadedEncyclopediaEntity, {
      ...NEWT_TARGET,
      entityId: ARTIFACT_CORE.id,
    });
    const baseTemplate = html.indexOf(
      'data-examine-template="object:WEAPON_CLASS"',
    );
    const artifactOverlay = html.indexOf(
      'data-examine-overlay="artifact"',
    );

    expect(baseTemplate).toBeGreaterThan(-1);
    expect(artifactOverlay).toBeGreaterThan(baseTemplate);
    for (const baseFact of [
      "damageSmall",
      "damageLarge",
      "P_SPEAR",
      "strikeModes",
    ]) {
      expect(html).toContain(baseFact);
    }
    for (const overlayFact of [
      "baseObjectId",
      "SPFX_INTEL",
      "generationEnchantment",
      "giftValue",
    ]) {
      expect(html).toContain(overlayFact);
    }
  });

  it("does not use the loading family as a generic presentation template", () => {
    expect(FACTS_SOURCE).not.toMatch(
      /displayName\(core\.(?:kind|family)\)/,
    );
    expect(DIALOG_SOURCE).not.toMatch(
      /displayName\(core\.(?:kind|family)\)/,
    );
    expect(FACTS_SOURCE).not.toContain("data-entity-kind");
  });
});

describe("appearance and optional Wiki presentation boundaries", () => {
  it("keeps an appearance on its spoiler-safe category view", () => {
    const core = {
      schemaVersion: 2,
      id: "appearance:POTION_CLASS:GENERIC",
      family: "appearance",
      names: { primary: "potion of healing from concrete visible text" },
      symbol: 33,
      color: 5,
      facts: { objectClass: "POTION_CLASS" },
      sourceRefs: [{
        path: "include/objects.h",
        symbol: "GENERIC_POTION",
      }],
    } as unknown as CoreEntityRecord;
    const factsOnly = renderDialog(
      { core, wiki: null } as LoadedEncyclopediaEntity,
      { ...NEWT_TARGET, entityId: core.id },
    );
    const unsafeWiki = structuredClone(NEWT_WIKI);
    unsafeWiki.entityId = core.id;
    unsafeWiki.page.title = "Potion of healing";
    unsafeWiki.sections[0].paragraphs = [
      "This concrete appearance is a potion of healing.",
    ];
    const withUnsafeWiki = renderDialog(
      { core, wiki: unsafeWiki } as LoadedEncyclopediaEntity,
      { ...NEWT_TARGET, entityId: core.id },
    );

    for (const html of [factsOnly, withUnsafeWiki]) {
      expect(html).toContain(">Potion</h1>");
      expect(html).toContain(
        'data-examine-template="appearance:POTION_CLASS"',
      );
      expect(html).not.toMatch(/healing|concrete visible text/i);
      expect(html).not.toContain("examine-article");
      expect(html).not.toContain("examine-source-strip");
    }
  });

  it("keeps the main layout and core facts invariant when Wiki is present", () => {
    const factsOnly = renderDialog({
      core: NEWT_CORE,
      wiki: null,
    });
    const withWiki = renderDialog(NEWT_ENTITY);

    expect(openingTag(factsOnly, "examine-layout"))
      .toBe(openingTag(withWiki, "examine-layout"));
    expect(openingTag(withWiki, "examine-layout"))
      .not.toContain("data-facts-only");
    expect(factsMarkup(factsOnly)).toBe(factsMarkup(withWiki));
    expect(withWiki.indexOf("examine-facts"))
      .toBeLessThan(withWiki.indexOf("examine-article"));
  });

  it("does not special-case Newt in production presentation code", () => {
    expect(`${FACTS_SOURCE}\n${DIALOG_SOURCE}`).not.toMatch(
      /\b(?:PM_NEWT|Newt)\b/,
    );
  });
});

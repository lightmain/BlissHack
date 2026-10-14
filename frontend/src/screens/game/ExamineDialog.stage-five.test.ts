/// <reference types="node" />

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LoadedEncyclopediaEntity } from "../../encyclopedia/encyclopedia-loader";
import {
  ExamineDialog,
  isExamineBackdropClick,
  resolveExamineFocusTrap,
  resolveExamineTabKey,
} from "./ExamineDialog";
import { ExamineFacts } from "./ExamineFacts";
import { ExamineSourceStrip } from "./ExamineSourceStrip";
import { ExamineWikiArticle } from "./ExamineWikiArticle";
import {
  ARTIFACT_CORE,
  NEWT_ACCEPTANCE,
  NEWT_CORE,
  NEWT_ENTITY,
  NEWT_TARGET,
  NEWT_WIKI,
  WEAPON_CORE,
} from "./ExamineDialog.test-fixtures";

const GAME_SCREEN_SOURCE = readFileSync(
  new URL("../GameScreen.tsx", import.meta.url),
  "utf8",
);
const DIALOG_SOURCE = readFileSync(
  new URL("./ExamineDialog.tsx", import.meta.url),
  "utf8",
);

/** Render one stage-five dialog state through the intended component API. */
function renderDialog(
  state:
    | { status: "loading" }
    | { status: "ready"; entity: LoadedEncyclopediaEntity }
    | { status: "core-failure" },
): string {
  return renderToStaticMarkup(createElement(ExamineDialog, {
    nethackVersion: "5.0.0",
    onClose: vi.fn(),
    onRestoreFocus: vi.fn(),
    state,
    target: NEWT_TARGET,
  }));
}

/** Return the index of a required presentation layer. */
function layerIndex(html: string, className: string): number {
  const index = html.indexOf(`class="${className}`);
  expect(index, `missing ${className}`).toBeGreaterThan(-1);
  return index;
}

describe("stage-five Examine presentation", () => {
  it("keeps header, Wiki provenance, article, core facts, and provenance separate", () => {
    const html = renderDialog({ status: "ready", entity: NEWT_ENTITY });
    const header = layerIndex(html, "examine-header");
    const source = layerIndex(html, "examine-source-strip");
    const article = layerIndex(html, "examine-article");
    const facts = layerIndex(html, "examine-facts");
    const provenance = layerIndex(html, "examine-provenance");

    expect(header).toBeLessThan(source);
    expect(source).toBeLessThan(facts);
    expect(facts).toBeLessThan(provenance);
    expect(provenance).toBeLessThan(article);
    expect(html).toContain('data-content-license="CC-BY-SA-3.0"');
    expect(html).toContain('data-content-license="NGPL"');
    expect(html).toContain("NetHack 5.0.0");
    expect(html).toContain("include/monsters.h");
    expect(html).toContain("src/makemon.c");
    expect(html).toContain("dat/license");
    expect(html).toContain(
      "04834a93165482a28257bac282543e3583658622/dat/license",
    );
    expect(html).toMatch(
      /rel="(?=[^"]*license)(?=[^"]*noopener)(?=[^"]*noreferrer)[^"]+" target="_blank"/,
    );
  });

  it("renders only the four approved revision 205110 paragraphs", () => {
    const html = renderDialog({ status: "ready", entity: NEWT_ENTITY });

    expect(NEWT_WIKI.page.revisionId).toBe(NEWT_ACCEPTANCE.revision);
    expect(NEWT_WIKI.sections.map((section) => section.tab))
      .toEqual(["strategy", "history", "history"]);
    expect(NEWT_WIKI.sections.flatMap((section) => section.paragraphs))
      .toEqual(NEWT_ACCEPTANCE.paragraphs);
    for (const paragraph of NEWT_ACCEPTANCE.paragraphs) {
      expect(html).toContain(paragraph.replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#x27;"));
    }
    expect(html.match(/role="tab"/g) ?? []).toHaveLength(2);
    expect(html).toContain(">Strategy</button>");
    expect(html).toContain(">History</button>");
    expect(html).toContain("Dudley&#x27;s dungeon");
    expect(html).not.toMatch(/data-examine-tab="overview"/i);
    expect(html).not.toMatch(/Verbatim Wiki excerpt[^]*Overview/i);
  });

  it("shows loading, Wiki-missing facts-only, partial tabs, and core failure", () => {
    const loading = renderDialog({ status: "loading" });
    const factsOnly = renderDialog({
      status: "ready",
      entity: { core: NEWT_CORE, wiki: null },
    });
    const strategyOnly = renderToStaticMarkup(createElement(
      ExamineWikiArticle,
      {
        record: {
          ...NEWT_WIKI,
          sections: [NEWT_WIKI.sections[0]],
        },
      },
    ));

    expect(loading).toContain('role="dialog"');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("Loading");
    expect(loading).not.toContain("examine-facts");
    expect(factsOnly).toContain("examine-facts");
    expect(factsOnly).not.toContain('role="tablist"');
    expect(factsOnly).not.toContain("CC BY-SA");
    expect(strategyOnly).toContain(">Strategy</button>");
    expect(strategyOnly).not.toContain(">History</button>");
    expect(renderDialog({ status: "core-failure" })).toBe("");
  });

  it("omits unavailable fact groups instead of inventing placeholder values", () => {
    const core = structuredClone(NEWT_CORE);
    delete (core.facts as Record<string, unknown>).specialEffects;
    const html = renderToStaticMarkup(createElement(ExamineFacts, {
      core,
      nethackVersion: "5.0.0",
    }));

    expect(html).toContain("Core statistics");
    expect(html).not.toContain("Special effects");
    expect(html).not.toMatch(/Unknown|N\/A|Not available/i);
  });
});

describe("stage-five lossless facts", () => {
  it("preserves attack order, dice, HP rule, and every generation flag", () => {
    const core = structuredClone(NEWT_CORE);
    const facts = core.facts as Record<string, any>;
    facts.attacks = [
      {
        attackType: "AT_CLAW",
        damageType: "AD_FIRE",
        dice: { count: 2, sides: 4 },
      },
      {
        attackType: "AT_BITE",
        damageType: "AD_PHYS",
        dice: { count: 1, sides: 2 },
      },
    ];
    facts.generation.flags = ["G_HELL", "G_SGROUP", "G_GENO"];
    const html = renderToStaticMarkup(createElement(ExamineFacts, {
      core,
      nethackVersion: "5.0.0",
    }));

    expect(html.indexOf("AT_CLAW")).toBeLessThan(html.indexOf("AT_BITE"));
    expect(html.indexOf("2d4")).toBeLessThan(html.indexOf("1d2"));
    expect(html).toContain("AD_FIRE");
    expect(html).toContain("AD_PHYS");
    for (const value of [
      "baseLevel",
      "zeroLevelDieSides",
      "positiveLevelDieSides",
      "homeMultiplier",
      "minimumRollBoost",
      "G_HELL",
      "G_SGROUP",
      "G_GENO",
    ]) {
      expect(html).toContain(value);
    }
    expect(html).toMatch(/2\s*(?:-|–|to)\s*4/);
  });

  it.each([
    {
      core: WEAPON_CORE,
      expected: [
        "weapon", "damageSmall", "6", "damageLarge", "8", "hitBonus",
        "P_SPEAR", "PIERCE", "SLASH", "notWishable",
      ],
    },
    {
      core: ARTIFACT_CORE,
      expected: [
        "object:TEST_WEAPON", "SPFX_INTEL", "SPFX_ATTK", "SPFX_WARN",
        "AT_WEAP", "AD_FIRE", "2d4", "TAMING", "A_LAWFUL", "4000",
      ],
    },
  ])("renders object and artifact subtype fields without flattening", ({
    core,
    expected,
  }) => {
    const html = renderToStaticMarkup(createElement(ExamineFacts, {
      core,
      nethackVersion: "5.0.0",
    }));

    for (const value of expected) expect(html).toContain(value);
  });
});

describe("stage-five dialog accessibility and event isolation", () => {
  it("exposes modal, tab, panel, close, and browser-keyboard boundaries", () => {
    const html = renderDialog({ status: "ready", entity: NEWT_ENTITY });

    expect(html).toMatch(/role="dialog"[^>]*aria-modal="true"/);
    expect(html).toMatch(/role="dialog"[^>]*aria-labelledby="[^"]+"/);
    expect(html).toMatch(/role="dialog"[^>]*data-browser-keyboard="true"/);
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/role="tab"[^>]*aria-controls="[^"]+"/);
    expect(html).toMatch(/role="tabpanel"[^>]*aria-labelledby="[^"]+"/);
    expect(html).toContain('aria-label="Close examine window"');
  });

  it("supports Arrow, Home, End, and wrapping focus-trap navigation", () => {
    expect(resolveExamineTabKey("ArrowRight", 0, 3)).toBe(1);
    expect(resolveExamineTabKey("ArrowLeft", 0, 3)).toBe(2);
    expect(resolveExamineTabKey("Home", 2, 3)).toBe(0);
    expect(resolveExamineTabKey("End", 0, 3)).toBe(2);
    expect(resolveExamineTabKey("PageDown", 1, 3)).toBeNull();
    expect(resolveExamineFocusTrap("Tab", false, 3, 4)).toBe(0);
    expect(resolveExamineFocusTrap("Tab", true, 0, 4)).toBe(3);
    expect(resolveExamineFocusTrap("Tab", false, 1, 4)).toBe(2);
    expect(resolveExamineFocusTrap("Tab", true, 2, 4)).toBe(1);
    expect(resolveExamineFocusTrap("Enter", false, 1, 4)).toBeNull();
  });

  it("closes only for the backdrop itself and isolates Escape and link clicks", () => {
    const backdrop = {};
    const child = {};
    const html = renderToStaticMarkup(createElement(ExamineSourceStrip, {
      record: NEWT_WIKI,
    }));

    expect(isExamineBackdropClick(backdrop, backdrop)).toBe(true);
    expect(isExamineBackdropClick(child, backdrop)).toBe(false);
    expect(DIALOG_SOURCE).toMatch(/event\.key\s*===\s*["']Escape["']/);
    expect(DIALOG_SOURCE).toContain("stopPropagation");
    expect(DIALOG_SOURCE).toContain("preventDefault");
    expect(DIALOG_SOURCE).toMatch(/return\s*\(\)\s*=>\s*onRestoreFocus\(\)/);
    expect(html.match(/target="_blank"/g) ?? []).toHaveLength(3);
    expect(html.match(/rel="(?=[^"]*noopener)(?=[^"]*noreferrer)[^"]+"/g) ?? [])
      .toHaveLength(3);
    expect(html).toMatch(
      /rel="(?=[^"]*license)(?=[^"]*noopener)(?=[^"]*noreferrer)[^"]+"/,
    );
  });

  it("renders Wiki paragraphs as text without an HTML injection path", () => {
    expect(DIALOG_SOURCE).not.toContain("dangerouslySetInnerHTML");
    expect(readFileSync(
      new URL("./ExamineWikiArticle.tsx", import.meta.url),
      "utf8",
    )).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("stage-five GameScreen ownership", () => {
  it("renders the dialog outside an inert terminal and owns the entity loader", () => {
    expect(GAME_SCREEN_SOURCE).toContain('from "./game/ExamineDialog"');
    expect(GAME_SCREEN_SOURCE).toMatch(/<ExamineDialog\b/);
    expect(GAME_SCREEN_SOURCE).toMatch(
      /inert=\{[^}]*visibleExamineViewTarget[^}]*\}/,
    );
    expect(GAME_SCREEN_SOURCE).toContain("encyclopediaLoader.loadEntity");
    expect(GAME_SCREEN_SOURCE).toContain("new AbortController()");
    expect(GAME_SCREEN_SOURCE).toContain("controller.abort()");
    expect(GAME_SCREEN_SOURCE).toContain("tabIndex={-1}");
  });

  it("clears loader and view state for Original, fatal, session change, and unmount", () => {
    expect(GAME_SCREEN_SOURCE).toMatch(
      /informationLevel\s*!==\s*["']detailed["'][^]*setExamineViewTarget\(null\)/,
    );
    expect(GAME_SCREEN_SOURCE).toMatch(
      /snapshot\.phase\s*===\s*["']error["'][^]*setExamineViewTarget\(null\)/,
    );
    expect(GAME_SCREEN_SOURCE).toMatch(
      /useEffect\([^]*setExamineViewTarget\(null\)[^]*\[moduleId,\s*sessionId\]/,
    );
    expect(GAME_SCREEN_SOURCE).toMatch(
      /return\s*\(\)\s*=>\s*\{[^]*controller\.abort\(\)[^]*setExamineViewTarget\(null\)/,
    );
  });
});

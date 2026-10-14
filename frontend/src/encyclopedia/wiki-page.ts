import type { CoreEntityRecord } from "./core-schema";
import type { WikiRecord } from "./wiki-schema";

export interface TrustedWikiPage {
  title: string;
  url: string;
}

interface WikiPageEntity {
  core: CoreEntityRecord;
  wiki: WikiRecord | null;
  wikiPage?: TrustedWikiPage | null;
}

const GENERIC_APPEARANCE_WIKI_TITLES: Readonly<Record<string, string>> =
  Object.freeze({
    AMULET_CLASS: "Amulet",
    ARMOR_CLASS: "Armor",
    BALL_CLASS: "Heavy iron ball",
    CHAIN_CLASS: "Iron chain",
    COIN_CLASS: "Gold",
    FOOD_CLASS: "Comestible",
    GEM_CLASS: "Gem",
    POTION_CLASS: "Potion",
    RING_CLASS: "Ring",
    ROCK_CLASS: "Rock",
    SCROLL_CLASS: "Scroll",
    SPBOOK_CLASS: "Spellbook",
    TOOL_CLASS: "Tool",
    VENOM_CLASS: "Venom",
    WAND_CLASS: "Wand",
    WEAPON_CLASS: "Weapon",
  });
const OBJECT_CLASS_WIKI_PREFIXES: Readonly<Record<string, string>> =
  Object.freeze({
    POTION_CLASS: "Potion of ",
    RING_CLASS: "Ring of ",
    SCROLL_CLASS: "Scroll of ",
    SPBOOK_CLASS: "Spellbook of ",
    WAND_CLASS: "Wand of ",
  });
const OBJECT_WIKI_TITLE_OVERRIDES: Readonly<Record<string, string>> =
  Object.freeze({
    "object:SPE_BLANK_PAPER": "Blank spellbook",
    "object:SPE_BOOK_OF_THE_DEAD": "Book of the Dead",
    "object:SPE_NOVEL": "Novel",
  });

/**
 * Resolve a Wiki destination exclusively from validated encyclopedia data.
 * @param entity Validated core record, optional reviewed Wiki record, and an
 * optional explicit page decision.
 * @returns A canonical NetHackWiki page or null when no safe mapping exists.
 */
export function resolveWikiPage(entity: WikiPageEntity): TrustedWikiPage | null {
  if (entity.core.family === "appearance") {
    const objectClass = entity.core.facts.objectClass;
    if (typeof objectClass !== "string") return null;
    const title = GENERIC_APPEARANCE_WIKI_TITLES[objectClass];
    const categoryPage = title ? wikiPage(title) : null;
    if (!("wikiPage" in entity)) return categoryPage;
    const explicitPage = validateExplicitWikiPage(entity.wikiPage);
    return explicitPage?.title === categoryPage?.title
      ? explicitPage
      : null;
  }
  if ("wikiPage" in entity) {
    return validateExplicitWikiPage(entity.wikiPage);
  }
  if (entity.wiki) {
    return wikiPage(entity.wiki.page.title);
  }
  const title = sourceBackedWikiTitle(entity.core);
  return title ? wikiPage(title) : null;
}

/**
 * Convert one safely resolved core record into its conventional Wiki title.
 * @param core Strictly validated source-backed entity record.
 * @returns A deterministic page title or null for an empty source name.
 */
function sourceBackedWikiTitle(core: CoreEntityRecord): string | null {
  const primary = core.names.primary.trim();
  if (primary.length === 0) return null;
  const override = OBJECT_WIKI_TITLE_OVERRIDES[core.id];
  if (override) return override;
  if (core.family === "object") {
    const objectClass = core.facts.objectClass;
    if (typeof objectClass !== "string") return null;
    const prefix = OBJECT_CLASS_WIKI_PREFIXES[objectClass];
    if (prefix) return `${prefix}${primary}`;
  }
  return displayName(primary);
}

/**
 * Accept an explicit page decision only when its URL is canonical for its
 * title on the expected HTTPS host.
 * @param page Explicit trusted-page candidate.
 * @returns The page unchanged when valid, otherwise null.
 */
function validateExplicitWikiPage(
  page: TrustedWikiPage | null | undefined,
): TrustedWikiPage | null {
  if (!page || page.url !== canonicalWikiUrl(page.title)) return null;
  return page;
}

/**
 * Build a typed page destination for one validated title.
 * @param title Reviewed or source-backed page title.
 * @returns Canonical page metadata.
 */
function wikiPage(title: string): TrustedWikiPage {
  return {
    title,
    url: canonicalWikiUrl(title),
  };
}

/**
 * Encode a title into the fixed NetHackWiki article namespace.
 * @param title Reviewed or source-backed page title.
 * @returns Canonical HTTPS article URL.
 */
function canonicalWikiUrl(title: string): string {
  const slug = encodeURIComponent(title.trim().replaceAll(" ", "_"));
  return `https://nethackwiki.com/wiki/${slug}`;
}

/**
 * Capitalize one source-backed display name for a conventional Wiki title.
 * @param value Validated entity primary name.
 * @returns Sentence-case title.
 */
function displayName(value: string): string {
  return value.length === 0
    ? value
    : `${value[0].toUpperCase()}${value.slice(1)}`;
}

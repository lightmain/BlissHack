/// <reference types="node" />

import { readFileSync } from "node:fs";
import type { CoreEntityRecord } from "../../encyclopedia/core-schema";
import type { LoadedEncyclopediaEntity } from "../../encyclopedia/encyclopedia-loader";
import type { ExamineTarget } from "../../encyclopedia/examine-target";
import type { WikiRecord } from "../../encyclopedia/wiki-schema";

const NEWT_CORE_CHUNK = JSON.parse(readFileSync(
  new URL("../../../public/encyclopedia/core/monster-003.json", import.meta.url),
  "utf8",
)) as { records: CoreEntityRecord[] };

const NEWT_WIKI_CHUNK = JSON.parse(readFileSync(
  new URL("../../../public/encyclopedia/wiki/wiki-001.json", import.meta.url),
  "utf8",
)) as { records: WikiRecord[] };

export const NEWT_ACCEPTANCE = JSON.parse(readFileSync(
  new URL(
    "../../../test/integration-tests/fixtures/newt-wiki-revision-205110.json",
    import.meta.url,
  ),
  "utf8",
)) as {
  paragraphs: string[];
  revision: number;
};

export const NEWT_CORE = structuredClone(
  NEWT_CORE_CHUNK.records.find((record) => record.id === "monster:PM_NEWT"),
) as CoreEntityRecord;

export const NEWT_WIKI = structuredClone(
  NEWT_WIKI_CHUNK.records.find(
    (record) => record.entityId === "monster:PM_NEWT",
  ),
) as WikiRecord;

export const NEWT_ENTITY: LoadedEncyclopediaEntity = {
  core: NEWT_CORE,
  wiki: NEWT_WIKI,
};

export const NEWT_TARGET: ExamineTarget = {
  surface: "map",
  moduleId: "module-stage-five",
  sessionId: "session-stage-five",
  mapRevision: 17,
  mapX: 22,
  mapY: 8,
  source: "map-foreground",
  entityId: "monster:PM_NEWT",
  glyph: {
    glyph: 401,
    ttyChar: ":".charCodeAt(0),
    frameColor: 0,
    glyphFlags: 0,
    color: 11,
    symbolIndex: 58,
    customColor: 0,
    color256: 0,
    tileIndex: 401,
  },
};

export const WEAPON_CORE: CoreEntityRecord = {
  schemaVersion: 1,
  id: "object:TEST_WEAPON",
  kind: "object",
  names: { primary: "ordered test weapon" },
  symbol: 41,
  color: 7,
  facts: {
    objectClass: "WEAPON_CLASS",
    material: "IRON",
    probability: 7,
    weight: 40,
    baseCost: 23,
    useDelay: 1,
    property: null,
    flags: {
      nameKnown: true,
      merge: false,
      usesKnown: false,
      magic: true,
      charged: false,
      unique: false,
      notWishable: true,
      big: true,
      tough: false,
    },
    subtype: {
      kind: "weapon",
      damageSmall: 6,
      damageLarge: 8,
      hitBonus: 2,
      skill: "P_SPEAR",
      projectile: false,
      strikeModes: ["PIERCE", "SLASH"],
    },
  },
  sourceRefs: [{ path: "include/objects.h", symbol: "TEST_WEAPON" }],
};

export const ARTIFACT_CORE: CoreEntityRecord = {
  schemaVersion: 1,
  id: "artifact:ART_TEST",
  kind: "artifact",
  names: { primary: "The Test Artifact" },
  symbol: null,
  color: null,
  facts: {
    baseObjectId: "object:TEST_WEAPON",
    flags: ["SPFX_INTEL", "SPFX_ATTK"],
    carryFlags: ["SPFX_WARN"],
    target: { kind: "monster", symbol: "PM_NEWT" },
    attack: {
      attackType: "AT_WEAP",
      damageType: "AD_FIRE",
      dice: { count: 2, sides: 4 },
    },
    defense: {
      attackType: "AT_NONE",
      damageType: "AD_COLD",
      dice: { count: 0, sides: 0 },
    },
    carry: {
      attackType: "AT_NONE",
      damageType: "AD_ELEC",
      dice: { count: 0, sides: 0 },
    },
    invoke: { kind: "invoke", symbol: "TAMING" },
    alignment: "A_LAWFUL",
    role: null,
    race: null,
    generationEnchantment: 3,
    giftValue: 7,
    baseCost: 4000,
  },
  sourceRefs: [{ path: "include/artilist.h", symbol: "ART_TEST" }],
};


import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GENERATOR_VERSION = "1.1.0";
const SCHEMA_VERSION = 1;
const NETHACK_VERSION = "5.0.0";
const MAX_CHUNK_BYTES = 256 * 1024;
const TARGET_CHUNK_BYTES = 96 * 1024;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const EXPECTED_COUNTS = {
  appearance: 17,
  monster: 383,
  object: 463,
  artifact: 33,
  terrain: 49,
  trap: 25,
};
const COMPILE_DEFINES = [
  "CROSSCOMPILE",
  "CROSSCOMPILE_TARGET",
  "CROSS_TO_WASM",
  'DEFAULT_WINDOW_SYS="shim"',
  "DLB",
  "GNU_LIBC",
  'HACKDIR="/"',
  "LIBNH",
  "NHUUID",
  "NOMAIL",
  "NOTTYGRAPHICS",
  "NO_SIGNAL",
  "SECURE",
  "SHIM_GRAPHICS",
  "SYSCF",
  'SYSCF_FILE="/sysconf"',
  "TILES_IN_GLYPHMAP",
].sort();
const SOURCE_INPUT_PATHS = [
  "frontend/scripts/encyclopedia/core-assets.mjs",
  "frontend/scripts/encyclopedia/core-exporter.c",
  "include/align.h",
  "include/artifact.h",
  "include/artilist.h",
  "include/config.h",
  "include/defsym.h",
  "include/display.h",
  "include/dungeon.h",
  "include/monattk.h",
  "include/mondata.h",
  "include/monflag.h",
  "include/monsters.h",
  "include/objclass.h",
  "include/objects.h",
  "include/permonst.h",
  "include/prop.h",
  "include/rm.h",
  "include/skills.h",
  "include/sym.h",
  "include/trap.h",
  "src/drawing.c",
  "src/makemon.c",
  "src/monst.c",
  "src/objects.c",
].sort();
const ENTITY_KINDS = [
  "appearance",
  "artifact",
  "monster",
  "object",
  "terrain",
  "trap",
];
const ATTACK_TYPES = new Set([
  "AT_NONE",
  "AT_CLAW",
  "AT_BITE",
  "AT_KICK",
  "AT_BUTT",
  "AT_TUCH",
  "AT_STNG",
  "AT_HUGS",
  "AT_SPIT",
  "AT_ENGL",
  "AT_BREA",
  "AT_EXPL",
  "AT_BOOM",
  "AT_GAZE",
  "AT_TENT",
  "AT_WEAP",
  "AT_MAGC",
]);
const DAMAGE_TYPES = new Set([
  "AD_PHYS",
  "AD_MAGM",
  "AD_FIRE",
  "AD_COLD",
  "AD_SLEE",
  "AD_DISN",
  "AD_ELEC",
  "AD_DRST",
  "AD_ACID",
  "AD_SPC1",
  "AD_SPC2",
  "AD_BLND",
  "AD_STUN",
  "AD_SLOW",
  "AD_PLYS",
  "AD_DRLI",
  "AD_DREN",
  "AD_LEGS",
  "AD_STON",
  "AD_STCK",
  "AD_SGLD",
  "AD_SITM",
  "AD_SEDU",
  "AD_TLPT",
  "AD_RUST",
  "AD_CONF",
  "AD_DGST",
  "AD_HEAL",
  "AD_WRAP",
  "AD_WERE",
  "AD_DRDX",
  "AD_DRCO",
  "AD_DRIN",
  "AD_DISE",
  "AD_DCAY",
  "AD_SSEX",
  "AD_HALU",
  "AD_DETH",
  "AD_PEST",
  "AD_FAMN",
  "AD_SLIM",
  "AD_ENCH",
  "AD_CORR",
  "AD_POLY",
  "AD_CLRC",
  "AD_SPEL",
  "AD_RBRE",
  "AD_SAMU",
  "AD_CURS",
]);
const FLAG_SYMBOLS = new Set([
  "G_UNIQ",
  "G_NOHELL",
  "G_HELL",
  "G_NOGEN",
  "G_SGROUP",
  "G_LGROUP",
  "G_GENO",
  "G_NOCORPSE",
  "MR_FIRE",
  "MR_COLD",
  "MR_SLEEP",
  "MR_DISINT",
  "MR_ELEC",
  "MR_POISON",
  "MR_ACID",
  "MR_STONE",
  "M1_NOLIMBS",
  "M1_OMNIVORE",
  "M1_FLY",
  "M1_SWIM",
  "M1_AMORPHOUS",
  "M1_WALLWALK",
  "M1_CLING",
  "M1_TUNNEL",
  "M1_NEEDPICK",
  "M1_CONCEAL",
  "M1_HIDE",
  "M1_AMPHIBIOUS",
  "M1_BREATHLESS",
  "M1_NOTAKE",
  "M1_NOEYES",
  "M1_NOHANDS",
  "M1_NOHEAD",
  "M1_MINDLESS",
  "M1_HUMANOID",
  "M1_ANIMAL",
  "M1_SLITHY",
  "M1_UNSOLID",
  "M1_THICK_HIDE",
  "M1_OVIPAROUS",
  "M1_REGEN",
  "M1_SEE_INVIS",
  "M1_TPORT",
  "M1_TPORT_CNTRL",
  "M1_ACID",
  "M1_POIS",
  "M1_CARNIVORE",
  "M1_HERBIVORE",
  "M1_METALLIVORE",
  "M2_NOPOLY",
  "M2_UNDEAD",
  "M2_WERE",
  "M2_HUMAN",
  "M2_ELF",
  "M2_DWARF",
  "M2_GNOME",
  "M2_ORC",
  "M2_DEMON",
  "M2_MERC",
  "M2_LORD",
  "M2_PRINCE",
  "M2_MINION",
  "M2_GIANT",
  "M2_SHAPESHIFTER",
  "M2_MALE",
  "M2_FEMALE",
  "M2_NEUTER",
  "M2_PNAME",
  "M2_HOSTILE",
  "M2_PEACEFUL",
  "M2_DOMESTIC",
  "M2_WANDER",
  "M2_STALK",
  "M2_NASTY",
  "M2_STRONG",
  "M2_ROCKTHROW",
  "M2_GREEDY",
  "M2_JEWELS",
  "M2_COLLECT",
  "M2_MAGIC",
  "M3_WANTSAMUL",
  "M3_WANTSBELL",
  "M3_WANTSBOOK",
  "M3_WANTSCAND",
  "M3_WANTSARTI",
  "M3_WAITFORU",
  "M3_CLOSE",
  "M3_INFRAVISION",
  "M3_INFRAVISIBLE",
  "M3_DISPLACES",
  "SPFX_NOGEN",
  "SPFX_RESTR",
  "SPFX_INTEL",
  "SPFX_SPEAK",
  "SPFX_SEEK",
  "SPFX_WARN",
  "SPFX_ATTK",
  "SPFX_DEFN",
  "SPFX_DRLI",
  "SPFX_SEARCH",
  "SPFX_BEHEAD",
  "SPFX_HALRES",
  "SPFX_ESP",
  "SPFX_STLTH",
  "SPFX_REGEN",
  "SPFX_EREGEN",
  "SPFX_HSPDAM",
  "SPFX_HPHDAM",
  "SPFX_TCTRL",
  "SPFX_LUCK",
  "SPFX_DMONS",
  "SPFX_DCLAS",
  "SPFX_DFLAG1",
  "SPFX_DFLAG2",
  "SPFX_DALIGN",
  "SPFX_XRAY",
  "SPFX_REFLECT",
  "SPFX_PROTECT",
]);
const execOptions = {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
};

/**
 * Return a lowercase SHA-256 digest for bytes or text.
 * @param {Uint8Array|string} value Bytes or UTF-8 text.
 * @returns {string} Lowercase hexadecimal digest.
 */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Serialize generated JSON in the compact deterministic asset format.
 * @param {unknown} value JSON-compatible value.
 * @returns {Buffer} UTF-8 bytes with one trailing newline.
 */
function assetBytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

/**
 * Assert that a value is a plain JSON object.
 * @param {unknown} value Candidate value.
 * @param {string} label Diagnostic label.
 * @returns {asserts value is Record<string, unknown>}
 */
function assertObject(value, label) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    throw new Error(`${label} must be an object`);
  }
}

/**
 * Reject missing and unknown object fields.
 * @param {Record<string, unknown>} value Object to inspect.
 * @param {string[]} required Required keys.
 * @param {string[]} optional Optional keys.
 * @param {string} label Diagnostic label.
 */
function assertKeys(value, required, optional, label) {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${label} has unknown field ${key}`);
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      throw new Error(`${label} is missing field ${key}`);
    }
  }
}

/**
 * Assert a bounded integer.
 * @param {unknown} value Candidate number.
 * @param {string} label Diagnostic label.
 * @param {number} [minimum] Inclusive lower bound.
 * @param {number} [maximum] Inclusive upper bound.
 */
function assertInteger(
  value,
  label,
  minimum = Number.MIN_SAFE_INTEGER,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new Error(`${label} must be an integer in [${minimum}, ${maximum}]`);
  }
}

/**
 * Assert a bounded string.
 * @param {unknown} value Candidate string.
 * @param {string} label Diagnostic label.
 * @param {number} [maximumBytes] UTF-8 byte limit.
 */
function assertString(value, label, maximumBytes = 1024) {
  if (
    typeof value !== "string"
    || Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    throw new Error(`${label} must be a bounded string`);
  }
}

/**
 * Assert a stable SHA-256 digest.
 * @param {unknown} value Candidate digest.
 * @param {string} label Diagnostic label.
 */
function assertHash(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

/**
 * Assert an exact stable entity ID.
 * @param {unknown} value Candidate ID.
 * @param {string} label Diagnostic label.
 */
function assertEntityId(value, label) {
  assertString(value, label, 160);
  if (
    !/^(appearance:[A-Z0-9_]+:GENERIC|monster:PM_[A-Z0-9_]+|object:[A-Z0-9_]+|artifact:ART_[A-Z0-9_]+|terrain:S_[A-Z0-9_]+|trap:[A-Z0-9_]+)$/
      .test(value)
  ) {
    throw new Error(`${label} is not a stable entity ID`);
  }
}

/**
 * Assert a manifest-controlled local filename before opening it.
 * @param {unknown} value Candidate path.
 * @param {string} label Diagnostic label.
 * @returns {string} Safe filename.
 */
function assertAssetFilename(value, label) {
  assertString(value, label, 128);
  if (
    value !== basename(value)
    || value === "."
    || value === ".."
    || value.includes("/")
    || value.includes("\\")
    || value.includes("\0")
  ) {
    throw new Error(`${label} contains path traversal or is not relative`);
  }
  return value;
}

/**
 * Parse JSON with a path-specific diagnostic.
 * @param {Buffer} bytes File bytes.
 * @param {string} label File label.
 * @returns {unknown} Parsed value.
 */
function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

/**
 * Validate one source-reference object.
 * @param {unknown} value Candidate source reference.
 * @param {string} label Diagnostic label.
 */
function validateSourceRef(value, label) {
  assertObject(value, label);
  assertKeys(value, ["path", "symbol"], [], label);
  assertString(value.path, `${label}.path`, 256);
  assertString(value.symbol, `${label}.symbol`, 160);
}

/**
 * Validate one attack object and reject future unknown enum symbols.
 * @param {unknown} value Candidate attack.
 * @param {string} label Diagnostic label.
 */
function validateAttack(value, label) {
  assertObject(value, label);
  assertKeys(value, ["attackType", "damageType", "dice"], [], label);
  if (!ATTACK_TYPES.has(value.attackType)) {
    throw new Error(`${label} has unknown attack enum ${value.attackType}`);
  }
  if (!DAMAGE_TYPES.has(value.damageType)) {
    throw new Error(`${label} has unknown damage enum ${value.damageType}`);
  }
  assertObject(value.dice, `${label}.dice`);
  assertKeys(value.dice, ["count", "sides"], [], `${label}.dice`);
  assertInteger(value.dice.count, `${label}.dice.count`, 0, 255);
  assertInteger(value.dice.sides, `${label}.dice.sides`, 0, 255);
}

/**
 * Validate a unique array of known bitmask symbols.
 * @param {unknown} value Candidate symbol array.
 * @param {string} label Diagnostic label.
 */
function validateFlags(value, label) {
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error(`${label} must be a bounded flag array`);
  }
  const seen = new Set();
  for (const symbol of value) {
    if (!FLAG_SYMBOLS.has(symbol)) {
      throw new Error(`${label} has unknown flag symbol ${symbol}`);
    }
    if (seen.has(symbol)) {
      throw new Error(`${label} contains duplicate flag ${symbol}`);
    }
    seen.add(symbol);
  }
}

/**
 * Validate the discriminated initial-HP rule.
 * @param {unknown} value Candidate HP rule.
 * @param {string} label Diagnostic label.
 */
function validateHpRule(value, label) {
  assertObject(value, label);
  assertString(value.kind, `${label}.kind`, 32);
  if (value.kind === "golem-fixed") {
    assertKeys(value, ["kind", "hitPoints"], [], label);
    assertInteger(value.hitPoints, `${label}.hitPoints`, 1, 10000);
  } else if (value.kind === "rider") {
    assertKeys(value, ["kind", "dice", "minimumRollBoost"], [], label);
    validateDice(value.dice, `${label}.dice`);
    if (value.minimumRollBoost !== true) {
      throw new Error(`${label}.minimumRollBoost must be true`);
    }
  } else if (value.kind === "special-fixed") {
    assertKeys(
      value,
      ["kind", "encodedLevel", "hitPoints", "effectiveLevel"],
      [],
      label,
    );
    assertInteger(value.encodedLevel, `${label}.encodedLevel`, 50, 127);
    assertInteger(value.hitPoints, `${label}.hitPoints`, 1, 10000);
    assertInteger(value.effectiveLevel, `${label}.effectiveLevel`, 0, 255);
  } else if (value.kind === "adult-dragon") {
    assertKeys(
      value,
      [
        "kind",
        "baseLevel",
        "normalMultiplier",
        "normalBonusDieSides",
        "endgameMultiplier",
      ],
      [],
      label,
    );
    for (const key of [
      "baseLevel",
      "normalMultiplier",
      "normalBonusDieSides",
      "endgameMultiplier",
    ]) {
      assertInteger(value[key], `${label}.${key}`, 0, 255);
    }
  } else if (value.kind === "ordinary") {
    assertKeys(
      value,
      [
        "kind",
        "baseLevel",
        "zeroLevelDieSides",
        "positiveLevelDieSides",
        "homeMultiplier",
        "minimumRollBoost",
      ],
      [],
      label,
    );
    for (const key of [
      "baseLevel",
      "zeroLevelDieSides",
      "positiveLevelDieSides",
      "homeMultiplier",
    ]) {
      assertInteger(value[key], `${label}.${key}`, 0, 255);
    }
    if (value.minimumRollBoost !== true) {
      throw new Error(`${label}.minimumRollBoost must be true`);
    }
  } else {
    throw new Error(`${label} has unknown HP rule kind ${value.kind}`);
  }
}

/**
 * Validate a dice object.
 * @param {unknown} value Candidate dice.
 * @param {string} label Diagnostic label.
 */
function validateDice(value, label) {
  assertObject(value, label);
  assertKeys(value, ["count", "sides"], [], label);
  assertInteger(value.count, `${label}.count`, 0, 255);
  assertInteger(value.sides, `${label}.sides`, 0, 255);
}

/**
 * Validate the source-faithful Newt corpse energy rule.
 * @param {unknown} value Candidate special effect.
 * @param {string} label Diagnostic label.
 */
function validateSpecialEffect(value, label) {
  assertObject(value, label);
  assertKeys(
    value,
    [
      "kind",
      "chanceNumerator",
      "chanceDenominator",
      "guaranteedWhen",
      "energyDice",
      "overflowCondition",
      "overflowMaximumEnergyChanceNumerator",
      "overflowMaximumEnergyChanceDenominator",
      "sourceRef",
    ],
    [],
    label,
  );
  if (
    value.kind !== "corpse-energy"
    || value.overflowCondition !== "energy-exceeds-maximum"
  ) {
    throw new Error(`${label} has an unknown special effect rule`);
  }
  for (const key of [
    "chanceNumerator",
    "chanceDenominator",
    "overflowMaximumEnergyChanceNumerator",
    "overflowMaximumEnergyChanceDenominator",
  ]) {
    assertInteger(value[key], `${label}.${key}`, 0, 100);
  }
  assertObject(value.guaranteedWhen, `${label}.guaranteedWhen`);
  assertKeys(
    value.guaranteedWhen,
    ["currentEnergyMultiplier", "operator", "maximumEnergyMultiplier"],
    [],
    `${label}.guaranteedWhen`,
  );
  if (value.guaranteedWhen.operator !== "less-than-or-equal") {
    throw new Error(`${label}.guaranteedWhen operator is invalid`);
  }
  assertInteger(
    value.guaranteedWhen.currentEnergyMultiplier,
    `${label}.guaranteedWhen.currentEnergyMultiplier`,
    1,
    100,
  );
  assertInteger(
    value.guaranteedWhen.maximumEnergyMultiplier,
    `${label}.guaranteedWhen.maximumEnergyMultiplier`,
    1,
    100,
  );
  validateDice(value.energyDice, `${label}.energyDice`);
  validateSourceRef(value.sourceRef, `${label}.sourceRef`);
}

/**
 * Validate monster facts used by the runtime.
 * @param {unknown} value Candidate facts.
 * @param {string} label Diagnostic label.
 */
function validateMonsterFacts(value, label) {
  assertObject(value, label);
  assertKeys(
    value,
    [
      "monsterClass",
      "level",
      "difficulty",
      "speed",
      "armorClass",
      "magicResistance",
      "alignment",
      "generation",
      "attacks",
      "hpRule",
      "size",
      "weight",
      "nutrition",
      "sound",
      "resistances",
      "conveys",
      "flags",
      "corpse",
    ],
    ["specialEffects"],
    label,
  );
  for (const key of ["monsterClass", "size", "sound"]) {
    assertString(value[key], `${label}.${key}`, 64);
  }
  for (const key of [
    "level",
    "difficulty",
    "speed",
    "armorClass",
    "magicResistance",
    "alignment",
    "weight",
    "nutrition",
  ]) {
    assertInteger(value[key], `${label}.${key}`, -128, 100000);
  }
  assertObject(value.generation, `${label}.generation`);
  assertKeys(
    value.generation,
    ["frequency", "flags"],
    [],
    `${label}.generation`,
  );
  assertInteger(value.generation.frequency, `${label}.generation.frequency`, 0, 7);
  validateFlags(value.generation.flags, `${label}.generation.flags`);
  if (!Array.isArray(value.attacks) || value.attacks.length > 6) {
    throw new Error(`${label}.attacks must be a bounded array`);
  }
  value.attacks.forEach((attack, index) =>
    validateAttack(attack, `${label}.attacks[${index}]`)
  );
  validateHpRule(value.hpRule, `${label}.hpRule`);
  validateFlags(value.resistances, `${label}.resistances`);
  validateFlags(value.conveys, `${label}.conveys`);
  assertObject(value.flags, `${label}.flags`);
  assertKeys(value.flags, ["m1", "m2", "m3"], [], `${label}.flags`);
  validateFlags(value.flags.m1, `${label}.flags.m1`);
  validateFlags(value.flags.m2, `${label}.flags.m2`);
  validateFlags(value.flags.m3, `${label}.flags.m3`);
  assertObject(value.corpse, `${label}.corpse`);
  assertKeys(
    value.corpse,
    ["exists", "weight", "nutrition"],
    [],
    `${label}.corpse`,
  );
  if (typeof value.corpse.exists !== "boolean") {
    throw new Error(`${label}.corpse.exists must be boolean`);
  }
  if (value.specialEffects !== undefined) {
    if (!Array.isArray(value.specialEffects) || value.specialEffects.length > 8) {
      throw new Error(`${label}.specialEffects must be a bounded array`);
    }
    value.specialEffects.forEach((effect, index) =>
      validateSpecialEffect(effect, `${label}.specialEffects[${index}]`)
    );
  }
}

/**
 * Validate object facts and their discriminated subtype.
 * @param {unknown} value Candidate facts.
 * @param {string} label Diagnostic label.
 */
function validateObjectFacts(value, label) {
  assertObject(value, label);
  assertKeys(
    value,
    [
      "objectClass",
      "material",
      "probability",
      "weight",
      "baseCost",
      "useDelay",
      "property",
      "flags",
      "subtype",
    ],
    [],
    label,
  );
  assertString(value.objectClass, `${label}.objectClass`, 64);
  assertString(value.material, `${label}.material`, 64);
  for (const key of ["probability", "weight", "baseCost", "useDelay"]) {
    assertInteger(value[key], `${label}.${key}`, -128, 100000);
  }
  if (value.property !== null) {
    assertString(value.property, `${label}.property`, 64);
  }
  assertObject(value.flags, `${label}.flags`);
  assertKeys(
    value.flags,
    [
      "nameKnown",
      "merge",
      "usesKnown",
      "magic",
      "charged",
      "unique",
      "notWishable",
      "big",
      "tough",
    ],
    [],
    `${label}.flags`,
  );
  for (const flag of Object.values(value.flags)) {
    if (typeof flag !== "boolean") {
      throw new Error(`${label}.flags values must be boolean`);
    }
  }
  assertObject(value.subtype, `${label}.subtype`);
  assertString(value.subtype.kind, `${label}.subtype.kind`, 32);
}

/**
 * Validate generic appearance facts without accepting concrete object data.
 * @param {unknown} value Candidate facts.
 * @param {string} label Diagnostic label.
 */
function validateAppearanceFacts(value, label) {
  assertObject(value, label);
  assertKeys(value, ["objectClass"], [], label);
  assertString(value.objectClass, `${label}.objectClass`, 64);
  if (!/^[A-Z0-9_]+_CLASS$/.test(value.objectClass)) {
    throw new Error(`${label}.objectClass is invalid`);
  }
}

/**
 * Validate artifact facts and all nested symbolic attacks.
 * @param {unknown} value Candidate facts.
 * @param {string} label Diagnostic label.
 */
function validateArtifactFacts(value, label) {
  assertObject(value, label);
  assertKeys(
    value,
    [
      "baseObjectId",
      "flags",
      "carryFlags",
      "target",
      "attack",
      "defense",
      "carry",
      "invoke",
      "alignment",
      "role",
      "race",
      "generationEnchantment",
      "giftValue",
      "baseCost",
    ],
    [],
    label,
  );
  assertEntityId(value.baseObjectId, `${label}.baseObjectId`);
  validateFlags(value.flags, `${label}.flags`);
  validateFlags(value.carryFlags, `${label}.carryFlags`);
  validateAttack(value.attack, `${label}.attack`);
  validateAttack(value.defense, `${label}.defense`);
  validateAttack(value.carry, `${label}.carry`);
  assertString(value.alignment, `${label}.alignment`, 32);
  for (const key of ["role", "race"]) {
    if (value[key] !== null) {
      assertEntityId(value[key], `${label}.${key}`);
    }
  }
  for (const key of ["generationEnchantment", "giftValue", "baseCost"]) {
    assertInteger(value[key], `${label}.${key}`, -128, 100000);
  }
}

/**
 * Validate terrain or trap facts.
 * @param {unknown} value Candidate facts.
 * @param {"terrain"|"trap"} kind Entity kind.
 * @param {string} label Diagnostic label.
 */
function validateMapFacts(value, kind, label) {
  assertObject(value, label);
  if (kind === "terrain") {
    assertKeys(value, ["terrainSymbol", "category"], [], label);
    assertString(value.terrainSymbol, `${label}.terrainSymbol`, 64);
  } else {
    assertKeys(value, ["trapSymbol", "category"], [], label);
    assertString(value.trapSymbol, `${label}.trapSymbol`, 64);
  }
  assertString(value.category, `${label}.category`, 64);
}

/**
 * Validate one complete entity record.
 * @param {unknown} value Candidate record.
 * @param {string} label Diagnostic label.
 */
function validateEntityRecord(value, label) {
  assertObject(value, label);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_RECORD_BYTES) {
    throw new Error(`${label} exceeds the 64 KiB record size limit`);
  }
  assertKeys(
    value,
    [
      "schemaVersion",
      "id",
      "kind",
      "names",
      "symbol",
      "color",
      "facts",
      "sourceRefs",
    ],
    [],
    label,
  );
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`${label} has unsupported schemaVersion`);
  }
  assertEntityId(value.id, `${label}.id`);
  if (!ENTITY_KINDS.includes(value.kind)) {
    throw new Error(`${label} has unknown entity kind`);
  }
  if (!value.id.startsWith(`${value.kind}:`)) {
    throw new Error(`${label} ID and kind disagree`);
  }
  assertObject(value.names, `${label}.names`);
  assertKeys(
    value.names,
    ["primary"],
    ["female", "neutral", "appearance"],
    `${label}.names`,
  );
  for (const [key, name] of Object.entries(value.names)) {
    assertString(name, `${label}.names.${key}`, 4096);
  }
  if (value.symbol !== null) {
    assertInteger(value.symbol, `${label}.symbol`, 0, 255);
  }
  if (value.color !== null) {
    assertInteger(value.color, `${label}.color`, 0, 255);
  }
  if (value.kind === "appearance") {
    validateAppearanceFacts(value.facts, `${label}.facts`);
    if (value.id !== `appearance:${value.facts.objectClass}:GENERIC`) {
      throw new Error(`${label} appearance ID and object class disagree`);
    }
  } else if (value.kind === "monster") {
    validateMonsterFacts(value.facts, `${label}.facts`);
  } else if (value.kind === "object") {
    validateObjectFacts(value.facts, `${label}.facts`);
  } else if (value.kind === "artifact") {
    validateArtifactFacts(value.facts, `${label}.facts`);
  } else {
    validateMapFacts(value.facts, value.kind, `${label}.facts`);
  }
  if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length > 16) {
    throw new Error(`${label}.sourceRefs must be a bounded array`);
  }
  value.sourceRefs.forEach((sourceRef, index) =>
    validateSourceRef(sourceRef, `${label}.sourceRefs[${index}]`)
  );
}

/**
 * Validate a supported glyph binding and collect referenced entity IDs.
 * @param {unknown} value Candidate binding.
 * @param {string} label Diagnostic label.
 * @param {Set<string>} references Destination reference set.
 */
function validateSupportedBinding(value, label, references) {
  assertObject(value, label);
  assertString(value.kind, `${label}.kind`, 32);
  const schemas = {
    monster: ["kind", "monsterId", "presentation", "gender"],
    corpse: ["kind", "objectId", "monsterId", "pileTop"],
    statue: ["kind", "objectId", "monsterId", "pileTop", "gender"],
    "generic-object": [
      "kind",
      "appearanceId",
      "objectClass",
      "pileTop",
    ],
    object: ["kind", "objectId", "pileTop"],
    terrain: ["kind", "terrainId", "variant"],
    trap: ["kind", "trapId"],
  };
  const keys = schemas[value.kind];
  if (!keys) {
    throw new Error(`${label} has unknown binding kind`);
  }
  assertKeys(value, keys, [], label);
  for (const key of ["monsterId", "objectId", "terrainId", "trapId"]) {
    if (key in value) {
      assertEntityId(value[key], `${label}.${key}`);
      references.add(value[key]);
    }
  }
  if ("appearanceId" in value) {
    assertEntityId(value.appearanceId, `${label}.appearanceId`);
    if (!/^appearance:[A-Z0-9_]+:GENERIC$/.test(value.appearanceId)) {
      throw new Error(`${label}.appearanceId is invalid`);
    }
    assertString(value.objectClass, `${label}.objectClass`, 64);
    if (value.appearanceId !== `appearance:${value.objectClass}:GENERIC`) {
      throw new Error(`${label} appearance ID and object class disagree`);
    }
    references.add(value.appearanceId);
  }
  if ("pileTop" in value && typeof value.pileTop !== "boolean") {
    throw new Error(`${label}.pileTop must be boolean`);
  }
}

/**
 * Validate one total glyph classification result.
 * @param {unknown} value Candidate result.
 * @param {number} expectedGlyph Required glyph index.
 * @param {Set<string>} references Destination reference set.
 */
function validateGlyphResult(value, expectedGlyph, references) {
  const label = `glyph ${expectedGlyph}`;
  assertObject(value, label);
  assertInteger(value.glyph, `${label}.glyph`, 0, 1_000_000);
  if (value.glyph !== expectedGlyph) {
    throw new Error(`glyph coverage is incomplete at ${expectedGlyph}`);
  }
  if (value.status === "supported") {
    assertKeys(value, ["glyph", "status", "binding"], [], label);
    validateSupportedBinding(value.binding, `${label}.binding`, references);
  } else if (value.status === "unsupported") {
    assertKeys(value, ["glyph", "status", "reason"], [], label);
    assertString(value.reason, `${label}.reason`, 64);
    if (!/^[a-z0-9-]+$/.test(value.reason)) {
      throw new Error(`${label}.reason is invalid`);
    }
  } else {
    throw new Error(`${label} has unknown status`);
  }
}

/**
 * Load source bytes and build sorted source-fingerprint metadata.
 * @param {string} repositoryRoot Repository root.
 * @returns {Promise<Array<{path:string,bytes:number,sha256:string}>>}
 * Source metadata.
 */
async function loadSourceInputs(repositoryRoot) {
  return Promise.all(
    SOURCE_INPUT_PATHS.map(async (path) => {
      const bytes = await readFile(join(repositoryRoot, path));
      return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
    }),
  );
}

/**
 * Compile and run the host exporter against the active source tree.
 * @param {string} repositoryRoot Repository root.
 * @returns {Promise<Record<string, unknown>>} Parsed exporter result.
 */
async function runExporter(repositoryRoot) {
  const buildDirectory = await mkdtemp(
    join(tmpdir(), "blisshack-core-exporter-"),
  );
  const executable = join(buildDirectory, "core-exporter");
  const compiler = process.env.CC || "cc";
  const arguments_ = [
    "-std=c11",
    "-O2",
    `-I${join(repositoryRoot, "include")}`,
    `-I${repositoryRoot}`,
    ...COMPILE_DEFINES.map((define) => `-D${define}`),
    join(
      repositoryRoot,
      "frontend/scripts/encyclopedia/core-exporter.c",
    ),
    join(repositoryRoot, "src/monst.c"),
    join(repositoryRoot, "src/objects.c"),
    join(repositoryRoot, "src/drawing.c"),
    "-o",
    executable,
  ];
  try {
    await execFileAsync(compiler, arguments_, {
      ...execOptions,
      cwd: repositoryRoot,
    });
    const { stdout } = await execFileAsync(executable, [], execOptions);
    const exported = JSON.parse(stdout);
    validateExporterResult(exported);
    return exported;
  } catch (error) {
    throw new Error(`Core encyclopedia exporter failed: ${error.message}`, {
      cause: error,
    });
  } finally {
    await rm(buildDirectory, { recursive: true, force: true });
  }
}

/**
 * Validate the trusted-process boundary from the host exporter.
 * @param {unknown} value Parsed exporter result.
 */
function validateExporterResult(value) {
  assertObject(value, "exporter result");
  assertKeys(
    value,
    ["schemaVersion", "maxGlyph", "counts", "records", "glyphBindings"],
    [],
    "exporter result",
  );
  if (value.schemaVersion !== SCHEMA_VERSION || value.maxGlyph !== 9624) {
    throw new Error("Exporter schema or MAX_GLYPH mismatch");
  }
  if (JSON.stringify(value.counts) !== JSON.stringify(EXPECTED_COUNTS)) {
    throw new Error("Exporter entity counts do not match the source contract");
  }
  if (
    !Array.isArray(value.records)
    || value.records.length
      !== Object.values(EXPECTED_COUNTS)
        .reduce((total, count) => total + count, 0)
  ) {
    throw new Error("Exporter record count mismatch");
  }
  value.records.forEach((record, index) =>
    validateEntityRecord(record, `exporter record ${index}`)
  );
  if (
    !Array.isArray(value.glyphBindings)
    || value.glyphBindings.length !== value.maxGlyph
  ) {
    throw new Error("Exporter glyph coverage does not match MAX_GLYPH");
  }
}

/**
 * Split ordered values into compact JSON chunks below the target size.
 * @param {unknown[]} values Ordered values.
 * @param {(slice: unknown[]) => unknown} wrap Chunk envelope factory.
 * @returns {unknown[][]} Ordered value slices.
 */
function splitValues(values, wrap) {
  const slices = [];
  let current = [];
  for (const value of values) {
    const candidate = [...current, value];
    if (
      current.length > 0
      && assetBytes(wrap(candidate)).byteLength > TARGET_CHUNK_BYTES
    ) {
      slices.push(current);
      current = [value];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    slices.push(current);
  }
  return slices;
}

/**
 * Write one asset and return immutable integrity metadata.
 * @param {string} directory Staging directory.
 * @param {string} file Filename.
 * @param {unknown} value JSON value.
 * @returns {Promise<{file:string,bytes:number,sha256:string}>} Metadata.
 */
async function writeAsset(directory, file, value) {
  const bytes = assetBytes(value);
  if (bytes.byteLength > MAX_CHUNK_BYTES) {
    throw new Error(`${file} exceeds the 256 KiB chunk size limit`);
  }
  await writeFile(join(directory, file), bytes);
  return { file, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

/**
 * Build all entity chunks in globally sorted stable-ID order.
 * @param {string} directory Staging directory.
 * @param {Record<string, unknown>[]} records Exported records.
 * @returns {Promise<Record<string, unknown>[]>} Manifest chunk metadata.
 */
async function writeEntityChunks(directory, records) {
  const metadata = [];
  for (const kind of ENTITY_KINDS) {
    const kindRecords = records.filter((record) => record.kind === kind);
    const slices = splitValues(kindRecords, (slice) => ({
      schemaVersion: SCHEMA_VERSION,
      kind,
      records: slice,
    }));
    for (let index = 0; index < slices.length; index += 1) {
      const slice = slices[index];
      const file = `${kind}-${String(index + 1).padStart(3, "0")}.json`;
      const integrity = await writeAsset(directory, file, {
        schemaVersion: SCHEMA_VERSION,
        kind,
        records: slice,
      });
      metadata.push({
        kind,
        ...integrity,
        count: slice.length,
        firstId: slice[0].id,
        lastId: slice.at(-1).id,
      });
    }
  }
  return metadata;
}

/**
 * Build contiguous glyph chunks.
 * @param {string} directory Staging directory.
 * @param {Record<string, unknown>[]} bindings Exported glyph results.
 * @returns {Promise<Record<string, unknown>[]>} Manifest chunk metadata.
 */
async function writeGlyphChunks(directory, bindings) {
  const slices = splitValues(bindings, (slice) => ({
    schemaVersion: SCHEMA_VERSION,
    bindings: slice,
  }));
  const metadata = [];
  let firstGlyph = 0;
  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index];
    const file = `glyph-bindings-${String(index + 1).padStart(3, "0")}.json`;
    const integrity = await writeAsset(directory, file, {
      schemaVersion: SCHEMA_VERSION,
      bindings: slice,
    });
    metadata.push({
      file,
      firstGlyph,
      count: slice.length,
      bytes: integrity.bytes,
      sha256: integrity.sha256,
    });
    firstGlyph += slice.length;
  }
  return metadata;
}

/**
 * Replace a destination directory only after staging is complete.
 * @param {string} stagingDirectory Complete staged directory.
 * @param {string} outputDirectory Caller-owned destination.
 */
async function publishDirectory(stagingDirectory, outputDirectory) {
  const parent = dirname(outputDirectory);
  const backup = `${outputDirectory}.backup`;
  let hadOutput = false;
  await mkdir(parent, { recursive: true });
  await rm(backup, { recursive: true, force: true });
  try {
    const outputStat = await lstat(outputDirectory);
    if (!outputStat.isDirectory()) {
      throw new Error(`${outputDirectory} exists and is not a directory`);
    }
    await rename(outputDirectory, backup);
    hadOutput = true;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  try {
    await rename(stagingDirectory, outputDirectory);
    if (hadOutput) {
      await rm(backup, { recursive: true, force: true });
    }
  } catch (error) {
    if (hadOutput) {
      await rename(backup, outputDirectory);
    }
    throw error;
  }
}

/**
 * Restore a complete prior publication after an interrupted directory swap.
 * @param {string} outputDirectory Published directory.
 */
async function recoverInterruptedPublication(outputDirectory) {
  const backup = `${outputDirectory}.backup`;
  let outputExists = false;
  let backupExists = false;
  try {
    outputExists = (await lstat(outputDirectory)).isDirectory();
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  try {
    backupExists = (await lstat(backup)).isDirectory();
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  if (!outputExists && backupExists) {
    await rename(backup, outputDirectory);
  } else if (outputExists && backupExists) {
    await rm(backup, { recursive: true, force: true });
  }
}

/**
 * Generate the complete core encyclopedia into an atomically published
 * directory.
 * @param {{repositoryRoot:string,outputDirectory:string}} options Paths.
 * @returns {Promise<Record<string, unknown>>} Generated manifest.
 */
export async function generateCoreEncyclopedia(options) {
  const repositoryRoot = resolve(options.repositoryRoot);
  const outputDirectory = resolve(options.outputDirectory);
  const parent = dirname(outputDirectory);
  await mkdir(parent, { recursive: true });
  await recoverInterruptedPublication(outputDirectory);
  const stagingDirectory = await mkdtemp(
    join(parent, `.${basename(outputDirectory)}.stage-`),
  );
  try {
    const [exported, sourceInputs] = await Promise.all([
      runExporter(repositoryRoot),
      loadSourceInputs(repositoryRoot),
    ]);
    const records = [...exported.records].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    );
    const chunks = await writeEntityChunks(stagingDirectory, records);
    const glyphChunks = await writeGlyphChunks(
      stagingDirectory,
      exported.glyphBindings,
    );
    const sourceFingerprint = sha256(assetBytes({
      generatorVersion: GENERATOR_VERSION,
      compileDefines: COMPILE_DEFINES,
      sourceInputs,
    }));
    const manifest = {
      schemaVersion: SCHEMA_VERSION,
      nethackVersion: NETHACK_VERSION,
      generatorVersion: GENERATOR_VERSION,
      compileDefines: COMPILE_DEFINES,
      sourceInputs,
      sourceFingerprint,
      entityCounts: EXPECTED_COUNTS,
      chunks,
      glyphBindings: {
        maxGlyph: exported.maxGlyph,
        chunks: glyphChunks,
      },
    };
    await writeFile(
      join(stagingDirectory, "manifest.json"),
      assetBytes(manifest),
    );
    await validateCoreAssetDirectory(stagingDirectory);
    await publishDirectory(stagingDirectory, outputDirectory);
    return manifest;
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Validate top-level manifest structure without opening controlled paths.
 * @param {unknown} value Parsed manifest.
 */
function validateManifest(value) {
  assertObject(value, "manifest");
  assertKeys(
    value,
    [
      "schemaVersion",
      "nethackVersion",
      "generatorVersion",
      "compileDefines",
      "sourceInputs",
      "sourceFingerprint",
      "entityCounts",
      "chunks",
      "glyphBindings",
    ],
    [],
    "manifest",
  );
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("Manifest schemaVersion is unsupported");
  }
  assertString(value.nethackVersion, "manifest.nethackVersion", 32);
  if (
    typeof value.generatorVersion !== "string"
    || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value.generatorVersion)
  ) {
    throw new Error("Manifest generatorVersion is invalid");
  }
  if (
    !Array.isArray(value.compileDefines)
    || value.compileDefines.some((define) => typeof define !== "string")
  ) {
    throw new Error("Manifest compileDefines are invalid");
  }
  if (
    JSON.stringify(value.compileDefines)
    !== JSON.stringify([...value.compileDefines].sort())
  ) {
    throw new Error("Manifest compileDefines must be sorted");
  }
  if (!Array.isArray(value.sourceInputs)) {
    throw new Error("Manifest sourceInputs must be an array");
  }
  let previousPath = "";
  for (const [index, input] of value.sourceInputs.entries()) {
    const label = `manifest.sourceInputs[${index}]`;
    assertObject(input, label);
    assertKeys(input, ["path", "bytes", "sha256"], [], label);
    assertString(input.path, `${label}.path`, 256);
    if (
      input.path.startsWith("/")
      || input.path.split(/[\\/]/).includes("..")
      || input.path <= previousPath
    ) {
      throw new Error("Manifest source input path order or traversal invalid");
    }
    previousPath = input.path;
    assertInteger(input.bytes, `${label}.bytes`, 0, 64 * 1024 * 1024);
    assertHash(input.sha256, `${label}.sha256`);
  }
  assertHash(value.sourceFingerprint, "manifest.sourceFingerprint");
  assertObject(value.entityCounts, "manifest.entityCounts");
  assertKeys(
    value.entityCounts,
    Object.keys(EXPECTED_COUNTS),
    [],
    "manifest.entityCounts",
  );
  if (JSON.stringify(value.entityCounts) !== JSON.stringify(EXPECTED_COUNTS)) {
    throw new Error("Manifest entity counts mismatch");
  }
  if (!Array.isArray(value.chunks) || value.chunks.length > 128) {
    throw new Error("Manifest chunks must be a bounded array");
  }
  for (const [index, chunk] of value.chunks.entries()) {
    const label = `manifest.chunks[${index}]`;
    assertObject(chunk, label);
    assertKeys(
      chunk,
      ["kind", "file", "bytes", "sha256", "count", "firstId", "lastId"],
      [],
      label,
    );
    if (!ENTITY_KINDS.includes(chunk.kind)) {
      throw new Error(`${label}.kind is invalid`);
    }
    assertAssetFilename(chunk.file, `${label}.file`);
    assertInteger(chunk.bytes, `${label}.bytes`, 1, MAX_CHUNK_BYTES);
    assertHash(chunk.sha256, `${label}.sha256`);
    assertInteger(chunk.count, `${label}.count`, 1, 10000);
    assertEntityId(chunk.firstId, `${label}.firstId`);
    assertEntityId(chunk.lastId, `${label}.lastId`);
  }
  assertObject(value.glyphBindings, "manifest.glyphBindings");
  assertKeys(
    value.glyphBindings,
    ["maxGlyph", "chunks"],
    [],
    "manifest.glyphBindings",
  );
  assertInteger(value.glyphBindings.maxGlyph, "glyph maxGlyph", 1, 100000);
  if (
    !Array.isArray(value.glyphBindings.chunks)
    || value.glyphBindings.chunks.length > 256
  ) {
    throw new Error("Glyph chunks must be a bounded array");
  }
  for (const [index, chunk] of value.glyphBindings.chunks.entries()) {
    const label = `manifest.glyphBindings.chunks[${index}]`;
    assertObject(chunk, label);
    assertKeys(
      chunk,
      ["file", "firstGlyph", "count", "bytes", "sha256"],
      [],
      label,
    );
    assertAssetFilename(chunk.file, `${label}.file`);
    assertInteger(chunk.firstGlyph, `${label}.firstGlyph`, 0, 100000);
    assertInteger(chunk.count, `${label}.count`, 1, 100000);
    assertInteger(chunk.bytes, `${label}.bytes`, 1, MAX_CHUNK_BYTES);
    assertHash(chunk.sha256, `${label}.sha256`);
  }
}

/**
 * Read and integrity-check one manifest-declared JSON asset.
 * @param {string} directory Asset directory.
 * @param {Record<string, unknown>} metadata Manifest metadata.
 * @returns {Promise<unknown>} Parsed JSON.
 */
async function readDeclaredAsset(directory, metadata) {
  const file = assertAssetFilename(metadata.file, "asset file");
  const path = join(directory, file);
  if (relative(directory, path).startsWith(`..${sep}`)) {
    throw new Error(`Asset path escapes directory: ${file}`);
  }
  const bytes = await readFile(path);
  if (bytes.byteLength !== metadata.bytes) {
    throw new Error(`${file} byte length mismatch`);
  }
  if (sha256(bytes) !== metadata.sha256) {
    throw new Error(`${file} SHA-256 mismatch`);
  }
  return parseJson(bytes, file);
}

/**
 * Strictly validate a generated core encyclopedia directory.
 * @param {string} directory Core asset directory.
 * @returns {Promise<Record<string, unknown>>} Validated manifest.
 */
export async function validateCoreAssetDirectory(directory) {
  const root = resolve(directory);
  const manifestBytes = await readFile(join(root, "manifest.json"));
  if (manifestBytes.byteLength > MAX_CHUNK_BYTES) {
    throw new Error("Manifest exceeds the 256 KiB size limit");
  }
  const manifest = parseJson(manifestBytes, "manifest.json");
  validateManifest(manifest);
  const declared = [
    ...manifest.chunks,
    ...manifest.glyphBindings.chunks,
  ];
  const declaredFiles = new Set(["manifest.json"]);
  for (const metadata of declared) {
    if (declaredFiles.has(metadata.file)) {
      throw new Error(`Duplicate manifest asset path ${metadata.file}`);
    }
    declaredFiles.add(metadata.file);
  }
  const actualFiles = (await readdir(root, { withFileTypes: true }))
    .map((entry) => {
      if (!entry.isFile()) {
        throw new Error(`Unexpected non-file asset ${entry.name}`);
      }
      return entry.name;
    })
    .sort();
  if (
    JSON.stringify(actualFiles)
    !== JSON.stringify([...declaredFiles].sort())
  ) {
    throw new Error("Asset directory files do not match manifest paths");
  }

  const ids = new Set();
  const records = [];
  for (const metadata of manifest.chunks) {
    const catalog = await readDeclaredAsset(root, metadata);
    assertObject(catalog, metadata.file);
    assertKeys(
      catalog,
      ["schemaVersion", "kind", "records"],
      [],
      metadata.file,
    );
    if (
      catalog.schemaVersion !== SCHEMA_VERSION
      || catalog.kind !== metadata.kind
      || !Array.isArray(catalog.records)
    ) {
      throw new Error(`${metadata.file} catalog metadata mismatch`);
    }
    for (const [index, record] of catalog.records.entries()) {
      validateEntityRecord(record, `${metadata.file}.records[${index}]`);
      if (record.kind !== metadata.kind) {
        throw new Error(`${metadata.file} contains the wrong entity kind`);
      }
      if (ids.has(record.id)) {
        throw new Error(`Duplicate entity id ${record.id}`);
      }
      ids.add(record.id);
      records.push(record);
    }
    if (
      catalog.records.length !== metadata.count
      || catalog.records[0]?.id !== metadata.firstId
      || catalog.records.at(-1)?.id !== metadata.lastId
    ) {
      throw new Error(`${metadata.file} catalog metadata mismatch`);
    }
  }
  const orderedIds = records.map((record) => record.id);
  if (
    JSON.stringify(orderedIds)
    !== JSON.stringify([...orderedIds].sort())
  ) {
    throw new Error("Entity IDs are not globally sorted");
  }
  const actualCounts = Object.fromEntries(
    Object.keys(EXPECTED_COUNTS).map((kind) => [
      kind,
      records.filter((record) => record.kind === kind).length,
    ]),
  );
  if (JSON.stringify(actualCounts) !== JSON.stringify(EXPECTED_COUNTS)) {
    throw new Error("Entity record counts do not match manifest");
  }

  const references = new Set();
  let nextGlyph = 0;
  for (const metadata of manifest.glyphBindings.chunks) {
    if (metadata.firstGlyph !== nextGlyph) {
      throw new Error(`Glyph coverage gap at ${nextGlyph}`);
    }
    const catalog = await readDeclaredAsset(root, metadata);
    assertObject(catalog, metadata.file);
    assertKeys(
      catalog,
      ["schemaVersion", "bindings"],
      [],
      metadata.file,
    );
    if (
      catalog.schemaVersion !== SCHEMA_VERSION
      || !Array.isArray(catalog.bindings)
      || catalog.bindings.length !== metadata.count
    ) {
      throw new Error(`${metadata.file} glyph metadata mismatch`);
    }
    for (const binding of catalog.bindings) {
      validateGlyphResult(binding, nextGlyph, references);
      nextGlyph += 1;
    }
  }
  if (nextGlyph !== manifest.glyphBindings.maxGlyph) {
    throw new Error("Glyph coverage does not reach MAX_GLYPH");
  }
  for (const reference of references) {
    if (!ids.has(reference)) {
      throw new Error(`Dangling entity reference ${reference}`);
    }
  }
  for (const record of records) {
    if (record.kind === "artifact" && !ids.has(record.facts.baseObjectId)) {
      throw new Error(
        `Dangling artifact reference ${record.facts.baseObjectId}`,
      );
    }
  }
  const totalBytes = manifestBytes.byteLength
    + declared.reduce((total, metadata) => total + metadata.bytes, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error("Core encyclopedia exceeds the 2 MiB total size limit");
  }
  return manifest;
}

/**
 * Collect all files below a flat generated asset directory.
 * @param {string} directory Asset directory.
 * @returns {Promise<Map<string, Buffer>>} Filename-to-bytes map.
 */
async function directoryFiles(directory) {
  const result = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile()) {
      throw new Error(`Unexpected directory entry ${entry.name}`);
    }
    result.set(entry.name, await readFile(join(directory, entry.name)));
  }
  return result;
}

/**
 * Regenerate into caller-owned temporary space and compare byte-for-byte.
 * @param {{
 *   repositoryRoot:string,
 *   assetDirectory:string,
 *   temporaryDirectory:string
 * }} options Verification paths.
 * @returns {Promise<Record<string, unknown>>} Validated checked manifest.
 */
export async function verifyCoreEncyclopedia(options) {
  const assetDirectory = resolve(options.assetDirectory);
  const temporaryDirectory = resolve(options.temporaryDirectory);
  const checkedManifest = await validateCoreAssetDirectory(assetDirectory);
  await generateCoreEncyclopedia({
    repositoryRoot: options.repositoryRoot,
    outputDirectory: temporaryDirectory,
  });
  const [checkedFiles, generatedFiles] = await Promise.all([
    directoryFiles(assetDirectory),
    directoryFiles(temporaryDirectory),
  ]);
  if (
    JSON.stringify([...checkedFiles.keys()].sort())
    !== JSON.stringify([...generatedFiles.keys()].sort())
  ) {
    throw new Error("Checked encyclopedia asset file list is stale");
  }
  for (const [file, checkedBytes] of checkedFiles) {
    if (!checkedBytes.equals(generatedFiles.get(file))) {
      throw new Error(`Checked encyclopedia asset is stale: ${file}`);
    }
  }
  return checkedManifest;
}

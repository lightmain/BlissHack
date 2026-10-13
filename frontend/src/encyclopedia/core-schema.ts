export type CoreEntityKind =
  | "appearance"
  | "artifact"
  | "monster"
  | "object"
  | "terrain"
  | "trap";

export interface CoreAssetMetadata {
  kind: CoreEntityKind;
  file: string;
  bytes: number;
  sha256: string;
  count: number;
  firstId: string;
  lastId: string;
}

export interface GlyphAssetMetadata {
  file: string;
  firstGlyph: number;
  count: number;
  bytes: number;
  sha256: string;
}

export interface CoreEncyclopediaManifest {
  schemaVersion: 1;
  nethackVersion: string;
  generatorVersion: string;
  compileDefines: string[];
  sourceInputs: Array<{
    path: string;
    bytes: number;
    sha256: string;
  }>;
  sourceFingerprint: string;
  entityCounts: Record<CoreEntityKind, number>;
  chunks: CoreAssetMetadata[];
  glyphBindings: {
    maxGlyph: number;
    chunks: GlyphAssetMetadata[];
  };
}

export interface CoreEntityRecord {
  schemaVersion: 1;
  id: string;
  kind: CoreEntityKind;
  names: {
    primary: string;
    female?: string;
    neutral?: string;
    appearance?: string;
  };
  symbol: number | null;
  color: number | null;
  facts: Record<string, unknown>;
  sourceRefs: Array<{
    path: string;
    symbol: string;
  }>;
}

export type GlyphBinding =
  | {
    kind: "monster";
    monsterId: string;
    presentation: "monster" | "pet" | "detected" | "ridden";
    gender: "male" | "female";
  }
  | {
    kind: "corpse";
    objectId: string;
    monsterId: string;
    pileTop: boolean;
  }
  | {
    kind: "statue";
    objectId: string;
    monsterId: string;
    pileTop: boolean;
    gender: "male" | "female";
  }
  | {
    kind: "generic-object";
    appearanceId: string;
    objectClass: string;
    pileTop: boolean;
  }
  | { kind: "object"; objectId: string; pileTop: boolean }
  | { kind: "terrain"; terrainId: string; variant: string }
  | { kind: "trap"; trapId: string };

export type GlyphBindingResult =
  | { glyph: number; status: "supported"; binding: GlyphBinding }
  | { glyph: number; status: "unsupported"; reason: string };

export interface CoreEntityChunk {
  schemaVersion: 1;
  kind: CoreEntityKind;
  records: CoreEntityRecord[];
}

export interface GlyphBindingChunk {
  schemaVersion: 1;
  bindings: GlyphBindingResult[];
}

const ENTITY_KINDS = new Set<CoreEntityKind>([
  "appearance",
  "artifact",
  "monster",
  "object",
  "terrain",
  "trap",
]);
const MANIFEST_KEYS = [
  "schemaVersion",
  "nethackVersion",
  "generatorVersion",
  "compileDefines",
  "sourceInputs",
  "sourceFingerprint",
  "entityCounts",
  "chunks",
  "glyphBindings",
] as const;
const ENTITY_KEYS = [
  "schemaVersion",
  "id",
  "kind",
  "names",
  "symbol",
  "color",
  "facts",
  "sourceRefs",
] as const;
const ATTACK_TYPES = new Set([
  "AT_NONE", "AT_CLAW", "AT_BITE", "AT_KICK", "AT_BUTT", "AT_TUCH",
  "AT_STNG", "AT_HUGS", "AT_SPIT", "AT_ENGL", "AT_BREA", "AT_EXPL",
  "AT_BOOM", "AT_GAZE", "AT_TENT", "AT_WEAP", "AT_MAGC",
]);
const DAMAGE_TYPES = new Set([
  "AD_PHYS", "AD_MAGM", "AD_FIRE", "AD_COLD", "AD_SLEE", "AD_DISN",
  "AD_ELEC", "AD_DRST", "AD_ACID", "AD_SPC1", "AD_SPC2", "AD_BLND",
  "AD_STUN", "AD_SLOW", "AD_PLYS", "AD_DRLI", "AD_DREN", "AD_LEGS",
  "AD_STON", "AD_STCK", "AD_SGLD", "AD_SITM", "AD_SEDU", "AD_TLPT",
  "AD_RUST", "AD_CONF", "AD_DGST", "AD_HEAL", "AD_WRAP", "AD_WERE",
  "AD_DRDX", "AD_DRCO", "AD_DRIN", "AD_DISE", "AD_DCAY", "AD_SSEX",
  "AD_HALU", "AD_DETH", "AD_PEST", "AD_FAMN", "AD_SLIM", "AD_ENCH",
  "AD_CORR", "AD_POLY", "AD_CLRC", "AD_SPEL", "AD_RBRE", "AD_SAMU",
  "AD_CURS",
]);
const FLAG_SYMBOLS = new Set([
  "G_UNIQ", "G_NOHELL", "G_HELL", "G_NOGEN", "G_SGROUP", "G_LGROUP",
  "G_GENO", "G_NOCORPSE", "MR_FIRE", "MR_COLD", "MR_SLEEP", "MR_DISINT",
  "MR_ELEC", "MR_POISON", "MR_ACID", "MR_STONE", "M1_NOLIMBS",
  "M1_OMNIVORE", "M1_FLY", "M1_SWIM", "M1_AMORPHOUS", "M1_WALLWALK",
  "M1_CLING", "M1_TUNNEL", "M1_NEEDPICK", "M1_CONCEAL", "M1_HIDE",
  "M1_AMPHIBIOUS", "M1_BREATHLESS", "M1_NOTAKE", "M1_NOEYES",
  "M1_NOHANDS", "M1_NOHEAD", "M1_MINDLESS", "M1_HUMANOID", "M1_ANIMAL",
  "M1_SLITHY", "M1_UNSOLID", "M1_THICK_HIDE", "M1_OVIPAROUS",
  "M1_REGEN", "M1_SEE_INVIS", "M1_TPORT", "M1_TPORT_CNTRL", "M1_ACID",
  "M1_POIS", "M1_CARNIVORE", "M1_HERBIVORE", "M1_METALLIVORE",
  "M2_NOPOLY", "M2_UNDEAD", "M2_WERE", "M2_HUMAN", "M2_ELF",
  "M2_DWARF", "M2_GNOME", "M2_ORC", "M2_DEMON", "M2_MERC", "M2_LORD",
  "M2_PRINCE", "M2_MINION", "M2_GIANT", "M2_SHAPESHIFTER", "M2_MALE",
  "M2_FEMALE", "M2_NEUTER", "M2_PNAME", "M2_HOSTILE", "M2_PEACEFUL",
  "M2_DOMESTIC", "M2_WANDER", "M2_STALK", "M2_NASTY", "M2_STRONG",
  "M2_ROCKTHROW", "M2_GREEDY", "M2_JEWELS", "M2_COLLECT", "M2_MAGIC",
  "M3_WANTSAMUL", "M3_WANTSBELL", "M3_WANTSBOOK", "M3_WANTSCAND",
  "M3_WANTSARTI", "M3_WAITFORU", "M3_CLOSE", "M3_INFRAVISION",
  "M3_INFRAVISIBLE", "M3_DISPLACES", "SPFX_NOGEN", "SPFX_RESTR",
  "SPFX_INTEL", "SPFX_SPEAK", "SPFX_SEEK", "SPFX_WARN", "SPFX_ATTK",
  "SPFX_DEFN", "SPFX_DRLI", "SPFX_SEARCH", "SPFX_BEHEAD", "SPFX_HALRES",
  "SPFX_ESP", "SPFX_STLTH", "SPFX_REGEN", "SPFX_EREGEN", "SPFX_HSPDAM",
  "SPFX_HPHDAM", "SPFX_TCTRL", "SPFX_LUCK", "SPFX_DMONS", "SPFX_DCLAS",
  "SPFX_DFLAG1", "SPFX_DFLAG2", "SPFX_DALIGN", "SPFX_XRAY",
  "SPFX_REFLECT", "SPFX_PROTECT",
]);

/**
 * Assert that an untrusted value is a plain object.
 * @param value Candidate value.
 * @param label Diagnostic label.
 * @returns The narrowed object.
 */
function objectValue(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Reject missing and unknown object keys.
 * @param value Object to inspect.
 * @param required Required keys.
 * @param optional Optional keys.
 * @param label Diagnostic label.
 */
function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
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
 * Require a bounded string.
 * @param value Candidate value.
 * @param label Diagnostic label.
 * @param maximumLength UTF-16 code-unit limit.
 * @returns The narrowed string.
 */
function stringValue(
  value: unknown,
  label: string,
  maximumLength = 4096,
): string {
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new Error(`${label} must be a bounded string`);
  }
  return value;
}

/**
 * Require a bounded safe integer.
 * @param value Candidate value.
 * @param label Diagnostic label.
 * @param minimum Inclusive lower bound.
 * @param maximum Inclusive upper bound.
 * @returns The narrowed integer.
 */
function integerValue(
  value: unknown,
  label: string,
  minimum = Number.MIN_SAFE_INTEGER,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum
  ) {
    throw new Error(`${label} must be a bounded integer`);
  }
  return value as number;
}

/**
 * Require a lowercase SHA-256 digest.
 * @param value Candidate digest.
 * @param label Diagnostic label.
 * @returns The narrowed digest.
 */
function hashValue(value: unknown, label: string): string {
  const digest = stringValue(value, label, 64);
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
  return digest;
}

/**
 * Require a canonical entity ID.
 * @param value Candidate ID.
 * @param label Diagnostic label.
 * @returns The narrowed ID.
 */
function entityId(value: unknown, label: string): string {
  const id = stringValue(value, label, 160);
  if (
    !/^(appearance:[A-Z0-9_]+:GENERIC|monster:PM_[A-Z0-9_]+|object:[A-Z0-9_]+|artifact:ART_[A-Z0-9_]+|terrain:S_[A-Z0-9_]+|trap:[A-Z0-9_]+)$/
      .test(id)
  ) {
    throw new Error(`${label} is not a stable entity ID`);
  }
  return id;
}

/**
 * Require a flat manifest-controlled filename.
 * @param value Candidate filename.
 * @param label Diagnostic label.
 * @returns The narrowed filename.
 */
function assetFilename(value: unknown, label: string): string {
  const filename = stringValue(value, label, 128);
  if (
    filename === "."
    || filename === ".."
    || filename.includes("/")
    || filename.includes("\\")
    || filename.includes("\0")
  ) {
    throw new Error(`${label} is not a safe asset filename`);
  }
  return filename;
}

/**
 * Require an array with a fixed maximum length.
 * @param value Candidate value.
 * @param label Diagnostic label.
 * @param maximumLength Item-count limit.
 * @returns The narrowed array.
 */
function arrayValue(
  value: unknown,
  label: string,
  maximumLength: number,
): unknown[] {
  if (!Array.isArray(value) || value.length > maximumLength) {
    throw new Error(`${label} must be a bounded array`);
  }
  return value;
}

/**
 * Validate one symbolic attack descriptor.
 * @param value Candidate attack.
 * @param label Diagnostic label.
 */
function validateAttack(value: unknown, label: string): void {
  const attack = objectValue(value, label);
  exactKeys(attack, ["attackType", "damageType", "dice"], [], label);
  if (!ATTACK_TYPES.has(stringValue(attack.attackType, `${label}.attackType`))) {
    throw new Error(`${label} has an unknown attack type`);
  }
  if (!DAMAGE_TYPES.has(stringValue(attack.damageType, `${label}.damageType`))) {
    throw new Error(`${label} has an unknown damage type`);
  }
  const dice = objectValue(attack.dice, `${label}.dice`);
  exactKeys(dice, ["count", "sides"], [], `${label}.dice`);
  integerValue(dice.count, `${label}.dice.count`, 0, 255);
  integerValue(dice.sides, `${label}.dice.sides`, 0, 255);
}

/**
 * Validate a unique array of known source bit symbols.
 * @param value Candidate symbol array.
 * @param label Diagnostic label.
 */
function validateFlags(value: unknown, label: string): void {
  const symbols = arrayValue(value, label, 64);
  const seen = new Set<string>();
  symbols.forEach((candidate, index) => {
    const symbol = stringValue(candidate, `${label}[${index}]`, 64);
    if (!FLAG_SYMBOLS.has(symbol) || seen.has(symbol)) {
      throw new Error(`${label} has an unknown or duplicate flag`);
    }
    seen.add(symbol);
  });
}

/**
 * Validate one exact structured monster HP rule.
 * @param value Candidate HP rule.
 * @param label Diagnostic label.
 */
function validateHpRule(value: unknown, label: string): void {
  const rule = objectValue(value, label);
  const kind = stringValue(rule.kind, `${label}.kind`, 32);
  const schemas: Record<string, readonly string[]> = {
    "golem-fixed": ["kind", "hitPoints"],
    rider: ["kind", "dice", "minimumRollBoost"],
    "special-fixed": ["kind", "encodedLevel", "hitPoints", "effectiveLevel"],
    "adult-dragon": [
      "kind",
      "baseLevel",
      "normalMultiplier",
      "normalBonusDieSides",
      "endgameMultiplier",
    ],
    ordinary: [
      "kind",
      "baseLevel",
      "zeroLevelDieSides",
      "positiveLevelDieSides",
      "homeMultiplier",
      "minimumRollBoost",
    ],
  };
  const keys = schemas[kind];
  if (!keys) {
    throw new Error(`${label}.kind is invalid`);
  }
  exactKeys(rule, keys, [], label);
  for (const [key, candidate] of Object.entries(rule)) {
    if (key === "kind") {
      continue;
    }
    if (key === "dice") {
      const dice = objectValue(candidate, `${label}.dice`);
      exactKeys(dice, ["count", "sides"], [], `${label}.dice`);
      integerValue(dice.count, `${label}.dice.count`, 0, 255);
      integerValue(dice.sides, `${label}.dice.sides`, 0, 255);
    } else if (key === "minimumRollBoost") {
      if (candidate !== true) {
        throw new Error(`${label}.minimumRollBoost must be true`);
      }
    } else {
      integerValue(candidate, `${label}.${key}`, 0, 10000);
    }
  }
}

/**
 * Validate the exact Newt corpse-energy rule.
 * @param value Candidate special effect.
 * @param label Diagnostic label.
 */
function validateSpecialEffect(value: unknown, label: string): void {
  const effect = objectValue(value, label);
  exactKeys(
    effect,
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
  if (effect.kind !== "corpse-energy") {
    throw new Error(`${label}.kind is invalid`);
  }
  for (const key of [
    "chanceNumerator",
    "chanceDenominator",
    "overflowMaximumEnergyChanceNumerator",
    "overflowMaximumEnergyChanceDenominator",
  ]) {
    integerValue(effect[key], `${label}.${key}`, 0, 100);
  }
  const condition = objectValue(effect.guaranteedWhen, `${label}.guaranteedWhen`);
  exactKeys(
    condition,
    ["currentEnergyMultiplier", "operator", "maximumEnergyMultiplier"],
    [],
    `${label}.guaranteedWhen`,
  );
  integerValue(
    condition.currentEnergyMultiplier,
    `${label}.guaranteedWhen.currentEnergyMultiplier`,
    1,
    100,
  );
  if (condition.operator !== "less-than-or-equal") {
    throw new Error(`${label}.guaranteedWhen.operator is invalid`);
  }
  integerValue(
    condition.maximumEnergyMultiplier,
    `${label}.guaranteedWhen.maximumEnergyMultiplier`,
    1,
    100,
  );
  if (effect.overflowCondition !== "energy-exceeds-maximum") {
    throw new Error(`${label}.overflowCondition is invalid`);
  }
  const energyDice = objectValue(effect.energyDice, `${label}.energyDice`);
  exactKeys(energyDice, ["count", "sides"], [], `${label}.energyDice`);
  integerValue(energyDice.count, `${label}.energyDice.count`, 0, 255);
  integerValue(energyDice.sides, `${label}.energyDice.sides`, 0, 255);
  const sourceRef = objectValue(effect.sourceRef, `${label}.sourceRef`);
  exactKeys(sourceRef, ["path", "symbol"], [], `${label}.sourceRef`);
  stringValue(sourceRef.path, `${label}.sourceRef.path`, 256);
  stringValue(sourceRef.symbol, `${label}.sourceRef.symbol`, 160);
}

/**
 * Validate exact monster facts.
 * @param value Candidate facts.
 * @param label Diagnostic label.
 */
function validateMonsterFacts(value: unknown, label: string): void {
  const facts = objectValue(value, label);
  exactKeys(
    facts,
    [
      "monsterClass", "level", "difficulty", "speed", "armorClass",
      "magicResistance", "alignment", "generation", "attacks", "hpRule",
      "size", "weight", "nutrition", "sound", "resistances", "conveys",
      "flags", "corpse",
    ],
    ["specialEffects"],
    label,
  );
  for (const key of ["monsterClass", "size", "sound"]) {
    stringValue(facts[key], `${label}.${key}`, 64);
  }
  for (const key of [
    "level", "difficulty", "speed", "armorClass", "magicResistance",
    "alignment", "weight", "nutrition",
  ]) {
    integerValue(facts[key], `${label}.${key}`, -128, 100000);
  }
  const generation = objectValue(facts.generation, `${label}.generation`);
  exactKeys(generation, ["frequency", "flags"], [], `${label}.generation`);
  integerValue(generation.frequency, `${label}.generation.frequency`, 0, 7);
  validateFlags(generation.flags, `${label}.generation.flags`);
  arrayValue(facts.attacks, `${label}.attacks`, 6).forEach((attack, index) =>
    validateAttack(attack, `${label}.attacks[${index}]`)
  );
  validateHpRule(facts.hpRule, `${label}.hpRule`);
  validateFlags(facts.resistances, `${label}.resistances`);
  validateFlags(facts.conveys, `${label}.conveys`);
  const flags = objectValue(facts.flags, `${label}.flags`);
  exactKeys(flags, ["m1", "m2", "m3"], [], `${label}.flags`);
  validateFlags(flags.m1, `${label}.flags.m1`);
  validateFlags(flags.m2, `${label}.flags.m2`);
  validateFlags(flags.m3, `${label}.flags.m3`);
  const corpse = objectValue(facts.corpse, `${label}.corpse`);
  exactKeys(corpse, ["exists", "weight", "nutrition"], [], `${label}.corpse`);
  if (typeof corpse.exists !== "boolean") {
    throw new Error(`${label}.corpse.exists must be boolean`);
  }
  integerValue(corpse.weight, `${label}.corpse.weight`, 0, 100000);
  integerValue(corpse.nutrition, `${label}.corpse.nutrition`, 0, 100000);
  if (facts.specialEffects !== undefined) {
    arrayValue(facts.specialEffects, `${label}.specialEffects`, 8)
      .forEach((effect, index) =>
        validateSpecialEffect(effect, `${label}.specialEffects[${index}]`)
      );
  }
}

/**
 * Validate exact object facts and subtype.
 * @param value Candidate facts.
 * @param label Diagnostic label.
 */
function validateObjectFacts(value: unknown, label: string): void {
  const facts = objectValue(value, label);
  exactKeys(
    facts,
    [
      "objectClass", "material", "probability", "weight", "baseCost",
      "useDelay", "property", "flags", "subtype",
    ],
    [],
    label,
  );
  stringValue(facts.objectClass, `${label}.objectClass`, 64);
  stringValue(facts.material, `${label}.material`, 64);
  for (const key of ["probability", "weight", "baseCost", "useDelay"]) {
    integerValue(facts[key], `${label}.${key}`, -128, 100000);
  }
  if (facts.property !== null) {
    stringValue(facts.property, `${label}.property`, 64);
  }
  const flags = objectValue(facts.flags, `${label}.flags`);
  exactKeys(
    flags,
    [
      "nameKnown", "merge", "usesKnown", "magic", "charged", "unique",
      "notWishable", "big", "tough",
    ],
    [],
    `${label}.flags`,
  );
  for (const [key, candidate] of Object.entries(flags)) {
    if (typeof candidate !== "boolean") {
      throw new Error(`${label}.flags.${key} must be boolean`);
    }
  }
  const subtype = objectValue(facts.subtype, `${label}.subtype`);
  const kind = stringValue(subtype.kind, `${label}.subtype.kind`, 32);
  const schemas: Record<string, readonly string[]> = {
    weapon: [
      "kind", "damageSmall", "damageLarge", "hitBonus", "skill",
      "projectile", "strikeModes",
    ],
    armor: ["kind", "category", "armorClass", "magicCancellation"],
    food: ["kind", "nutrition"],
    spellbook: ["kind", "skill", "level"],
    other: ["kind"],
  };
  const keys = schemas[kind];
  if (!keys) {
    throw new Error(`${label}.subtype.kind is invalid`);
  }
  exactKeys(subtype, keys, [], `${label}.subtype`);
  if (kind === "weapon") {
    for (const key of ["damageSmall", "damageLarge", "hitBonus"]) {
      integerValue(subtype[key], `${label}.subtype.${key}`, -128, 255);
    }
    stringValue(subtype.skill, `${label}.subtype.skill`, 64);
    if (typeof subtype.projectile !== "boolean") {
      throw new Error(`${label}.subtype.projectile must be boolean`);
    }
    arrayValue(subtype.strikeModes, `${label}.subtype.strikeModes`, 3)
      .forEach((mode, index) => {
        if (!["PIERCE", "SLASH", "WHACK"].includes(String(mode))) {
          throw new Error(`${label}.subtype.strikeModes[${index}] is invalid`);
        }
      });
  } else if (kind === "armor") {
    stringValue(subtype.category, `${label}.subtype.category`, 64);
    integerValue(subtype.armorClass, `${label}.subtype.armorClass`, -128, 255);
    integerValue(
      subtype.magicCancellation,
      `${label}.subtype.magicCancellation`,
      -128,
      255,
    );
  } else if (kind === "food") {
    integerValue(subtype.nutrition, `${label}.subtype.nutrition`, 0, 100000);
  } else if (kind === "spellbook") {
    stringValue(subtype.skill, `${label}.subtype.skill`, 64);
    integerValue(subtype.level, `${label}.subtype.level`, 0, 255);
  }
}

/**
 * Validate generic appearance facts without concrete object identity.
 * @param value Candidate facts.
 * @param label Diagnostic label.
 */
function validateAppearanceFacts(value: unknown, label: string): void {
  const facts = objectValue(value, label);
  exactKeys(facts, ["objectClass"], [], label);
  const objectClass = stringValue(
    facts.objectClass,
    `${label}.objectClass`,
    64,
  );
  if (!/^[A-Z0-9_]+_CLASS$/.test(objectClass)) {
    throw new Error(`${label}.objectClass is invalid`);
  }
}

/**
 * Validate exact artifact facts.
 * @param value Candidate facts.
 * @param label Diagnostic label.
 */
function validateArtifactFacts(value: unknown, label: string): void {
  const facts = objectValue(value, label);
  exactKeys(
    facts,
    [
      "baseObjectId", "flags", "carryFlags", "target", "attack", "defense",
      "carry", "invoke", "alignment", "role", "race",
      "generationEnchantment", "giftValue", "baseCost",
    ],
    [],
    label,
  );
  entityId(facts.baseObjectId, `${label}.baseObjectId`);
  validateFlags(facts.flags, `${label}.flags`);
  validateFlags(facts.carryFlags, `${label}.carryFlags`);
  for (const key of ["attack", "defense", "carry"]) {
    validateAttack(facts[key], `${label}.${key}`);
  }
  stringValue(facts.alignment, `${label}.alignment`, 32);
  for (const key of ["role", "race"]) {
    if (facts[key] !== null) {
      entityId(facts[key], `${label}.${key}`);
    }
  }
  for (const key of ["generationEnchantment", "giftValue", "baseCost"]) {
    integerValue(facts[key], `${label}.${key}`, -128, 100000);
  }
  if (facts.target !== null) {
    const target = objectValue(facts.target, `${label}.target`);
    const targetKind = stringValue(target.kind, `${label}.target.kind`, 32);
    if (targetKind === "monster" || targetKind === "monster-class") {
      exactKeys(target, ["kind", "symbol"], [], `${label}.target`);
      const symbol = stringValue(target.symbol, `${label}.target.symbol`, 64);
      const pattern = targetKind === "monster" ? /^PM_[A-Z0-9_]+$/ : /^S_[A-Z0-9_]+$/;
      if (!pattern.test(symbol)) {
        throw new Error(`${label}.target.symbol is invalid`);
      }
    } else if (targetKind === "mflags1" || targetKind === "mflags2") {
      exactKeys(target, ["kind", "symbols"], [], `${label}.target`);
      validateFlags(target.symbols, `${label}.target.symbols`);
    } else {
      throw new Error(`${label}.target.kind is invalid`);
    }
  }
  if (facts.invoke !== null) {
    const invoke = objectValue(facts.invoke, `${label}.invoke`);
    exactKeys(invoke, ["kind", "symbol"], [], `${label}.invoke`);
    if (invoke.kind !== "property" && invoke.kind !== "invoke") {
      throw new Error(`${label}.invoke.kind is invalid`);
    }
    stringValue(invoke.symbol, `${label}.invoke.symbol`, 64);
  }
}

/**
 * Validate exact terrain or trap facts.
 * @param value Candidate facts.
 * @param kind Entity kind.
 * @param label Diagnostic label.
 */
function validateMapFacts(
  value: unknown,
  kind: "terrain" | "trap",
  label: string,
): void {
  const facts = objectValue(value, label);
  const symbolKey = kind === "terrain" ? "terrainSymbol" : "trapSymbol";
  exactKeys(facts, [symbolKey, "category"], [], label);
  stringValue(facts[symbolKey], `${label}.${symbolKey}`, 64);
  stringValue(facts.category, `${label}.category`, 64);
}

/**
 * Recursively inspect facts for attack descriptors and bounded JSON values.
 * Exact kind-specific facts are additionally checked by required top-level
 * keys, while this walk rejects unsupported runtime value types.
 * @param value Candidate JSON subtree.
 * @param label Diagnostic label.
 * @param depth Current recursion depth.
 */
function validateFactsTree(
  value: unknown,
  label: string,
  depth = 0,
): void {
  if (depth > 12) {
    throw new Error(`${label} exceeds the maximum nesting depth`);
  }
  if (value === null || typeof value === "boolean") {
    return;
  }
  if (typeof value === "string") {
    stringValue(value, label);
    return;
  }
  if (typeof value === "number") {
    integerValue(value, label, -1_000_000, 1_000_000);
    return;
  }
  if (Array.isArray(value)) {
    arrayValue(value, label, 128).forEach((item, index) =>
      validateFactsTree(item, `${label}[${index}]`, depth + 1)
    );
    return;
  }
  const object = objectValue(value, label);
  if (
    "attackType" in object
    || "damageType" in object
  ) {
    validateAttack(object, label);
    return;
  }
  if (Object.keys(object).length > 64) {
    throw new Error(`${label} has too many fields`);
  }
  for (const [key, child] of Object.entries(object)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) {
      throw new Error(`${label} has an invalid field name`);
    }
    validateFactsTree(child, `${label}.${key}`, depth + 1);
  }
}

/**
 * Validate one strict entity record envelope and its bounded facts.
 * @param value Candidate entity.
 * @param label Diagnostic label.
 * @returns Validated entity record.
 */
export function validateCoreEntityRecord(
  value: unknown,
  label = "core entity",
): CoreEntityRecord {
  const record = objectValue(value, label);
  exactKeys(record, ENTITY_KEYS, [], label);
  if (record.schemaVersion !== 1) {
    throw new Error(`${label} has unsupported schemaVersion`);
  }
  const id = entityId(record.id, `${label}.id`);
  const kind = stringValue(record.kind, `${label}.kind`) as CoreEntityKind;
  if (!ENTITY_KINDS.has(kind) || !id.startsWith(`${kind}:`)) {
    throw new Error(`${label} has an invalid kind`);
  }
  const names = objectValue(record.names, `${label}.names`);
  exactKeys(
    names,
    ["primary"],
    ["female", "neutral", "appearance"],
    `${label}.names`,
  );
  Object.entries(names).forEach(([key, name]) =>
    stringValue(name, `${label}.names.${key}`)
  );
  if (record.symbol !== null) {
    integerValue(record.symbol, `${label}.symbol`, 0, 255);
  }
  if (record.color !== null) {
    integerValue(record.color, `${label}.color`, 0, 255);
  }
  const facts = objectValue(record.facts, `${label}.facts`);
  validateFactsTree(facts, `${label}.facts`);
  if (kind === "appearance") {
    validateAppearanceFacts(facts, `${label}.facts`);
    if (id !== `appearance:${String(facts.objectClass)}:GENERIC`) {
      throw new Error(`${label} appearance ID and object class disagree`);
    }
  } else if (kind === "monster") {
    validateMonsterFacts(facts, `${label}.facts`);
  } else if (kind === "object") {
    validateObjectFacts(facts, `${label}.facts`);
  } else if (kind === "artifact") {
    validateArtifactFacts(facts, `${label}.facts`);
  } else {
    validateMapFacts(facts, kind, `${label}.facts`);
  }
  const sourceRefs = arrayValue(record.sourceRefs, `${label}.sourceRefs`, 16);
  sourceRefs.forEach((sourceRef, index) => {
    const ref = objectValue(sourceRef, `${label}.sourceRefs[${index}]`);
    exactKeys(ref, ["path", "symbol"], [], `${label}.sourceRefs[${index}]`);
    stringValue(ref.path, `${label}.sourceRefs[${index}].path`, 256);
    stringValue(ref.symbol, `${label}.sourceRefs[${index}].symbol`, 160);
  });
  return record as unknown as CoreEntityRecord;
}

/**
 * Validate the small core manifest before any manifest-controlled fetch.
 * @param value Candidate manifest.
 * @returns Validated manifest.
 */
export function validateCoreManifest(
  value: unknown,
): CoreEncyclopediaManifest {
  const manifest = objectValue(value, "core manifest");
  exactKeys(manifest, MANIFEST_KEYS, [], "core manifest");
  if (manifest.schemaVersion !== 1) {
    throw new Error("Core manifest has unsupported schemaVersion");
  }
  stringValue(manifest.nethackVersion, "core manifest nethackVersion", 32);
  const generatorVersion = stringValue(
    manifest.generatorVersion,
    "core manifest generatorVersion",
    32,
  );
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(generatorVersion)) {
    throw new Error("Core manifest generatorVersion is invalid");
  }
  hashValue(manifest.sourceFingerprint, "core manifest sourceFingerprint");
  arrayValue(manifest.compileDefines, "core manifest compileDefines", 128)
    .forEach((define, index) =>
      stringValue(define, `core manifest compileDefines[${index}]`, 256)
    );
  arrayValue(manifest.sourceInputs, "core manifest sourceInputs", 128)
    .forEach((input, index) => {
      const source = objectValue(
        input,
        `core manifest sourceInputs[${index}]`,
      );
      exactKeys(
        source,
        ["path", "bytes", "sha256"],
        [],
        `core manifest sourceInputs[${index}]`,
      );
      stringValue(source.path, `core manifest sourceInputs[${index}].path`);
      integerValue(
        source.bytes,
        `core manifest sourceInputs[${index}].bytes`,
        0,
        64 * 1024 * 1024,
      );
      hashValue(
        source.sha256,
        `core manifest sourceInputs[${index}].sha256`,
      );
    });
  const counts = objectValue(manifest.entityCounts, "core manifest counts");
  exactKeys(counts, [...ENTITY_KINDS], [], "core manifest counts");
  for (const kind of ENTITY_KINDS) {
    integerValue(counts[kind], `core manifest count ${kind}`, 0, 10000);
  }
  arrayValue(manifest.chunks, "core manifest chunks", 128)
    .forEach((chunk, index) => validateEntityMetadata(chunk, index));
  const glyphBindings = objectValue(
    manifest.glyphBindings,
    "core manifest glyphBindings",
  );
  exactKeys(
    glyphBindings,
    ["maxGlyph", "chunks"],
    [],
    "core manifest glyphBindings",
  );
  integerValue(glyphBindings.maxGlyph, "core manifest maxGlyph", 1, 100000);
  arrayValue(glyphBindings.chunks, "core manifest glyph chunks", 256)
    .forEach((chunk, index) => validateGlyphMetadata(chunk, index));
  return manifest as unknown as CoreEncyclopediaManifest;
}

/**
 * Validate one entity chunk metadata record.
 * @param value Candidate metadata.
 * @param index Metadata index.
 */
function validateEntityMetadata(value: unknown, index: number): void {
  const label = `core manifest chunks[${index}]`;
  const metadata = objectValue(value, label);
  exactKeys(
    metadata,
    ["kind", "file", "bytes", "sha256", "count", "firstId", "lastId"],
    [],
    label,
  );
  if (!ENTITY_KINDS.has(stringValue(metadata.kind, `${label}.kind`) as CoreEntityKind)) {
    throw new Error(`${label}.kind is invalid`);
  }
  assetFilename(metadata.file, `${label}.file`);
  integerValue(metadata.bytes, `${label}.bytes`, 1, 256 * 1024);
  hashValue(metadata.sha256, `${label}.sha256`);
  integerValue(metadata.count, `${label}.count`, 1, 10000);
  entityId(metadata.firstId, `${label}.firstId`);
  entityId(metadata.lastId, `${label}.lastId`);
}

/**
 * Validate one glyph chunk metadata record.
 * @param value Candidate metadata.
 * @param index Metadata index.
 */
function validateGlyphMetadata(value: unknown, index: number): void {
  const label = `core manifest glyph chunks[${index}]`;
  const metadata = objectValue(value, label);
  exactKeys(
    metadata,
    ["file", "firstGlyph", "count", "bytes", "sha256"],
    [],
    label,
  );
  assetFilename(metadata.file, `${label}.file`);
  integerValue(metadata.firstGlyph, `${label}.firstGlyph`, 0, 100000);
  integerValue(metadata.count, `${label}.count`, 1, 100000);
  integerValue(metadata.bytes, `${label}.bytes`, 1, 256 * 1024);
  hashValue(metadata.sha256, `${label}.sha256`);
}

/**
 * Validate a fetched entity chunk against its manifest metadata.
 * @param value Candidate chunk.
 * @param metadata Trusted validated metadata.
 * @returns Validated entity chunk.
 */
export function validateCoreEntityChunk(
  value: unknown,
  metadata: CoreAssetMetadata,
): CoreEntityChunk {
  const chunk = objectValue(value, metadata.file);
  exactKeys(chunk, ["schemaVersion", "kind", "records"], [], metadata.file);
  if (chunk.schemaVersion !== 1 || chunk.kind !== metadata.kind) {
    throw new Error(`${metadata.file} schema or kind mismatch`);
  }
  const records = arrayValue(chunk.records, `${metadata.file}.records`, 10000);
  if (records.length !== metadata.count) {
    throw new Error(`${metadata.file} record count mismatch`);
  }
  const validated = records.map((record, index) =>
    validateCoreEntityRecord(record, `${metadata.file}.records[${index}]`)
  );
  if (
    validated[0]?.id !== metadata.firstId
    || validated.at(-1)?.id !== metadata.lastId
  ) {
    throw new Error(`${metadata.file} ID range mismatch`);
  }
  return chunk as unknown as CoreEntityChunk;
}

/**
 * Validate a fetched glyph chunk and its contiguous glyph indices.
 * @param value Candidate chunk.
 * @param metadata Trusted validated metadata.
 * @returns Validated glyph chunk.
 */
export function validateGlyphBindingChunk(
  value: unknown,
  metadata: GlyphAssetMetadata,
): GlyphBindingChunk {
  const chunk = objectValue(value, metadata.file);
  exactKeys(chunk, ["schemaVersion", "bindings"], [], metadata.file);
  if (chunk.schemaVersion !== 1) {
    throw new Error(`${metadata.file} schema mismatch`);
  }
  const bindings = arrayValue(
    chunk.bindings,
    `${metadata.file}.bindings`,
    100000,
  );
  if (bindings.length !== metadata.count) {
    throw new Error(`${metadata.file} binding count mismatch`);
  }
  bindings.forEach((binding, index) =>
    validateGlyphResult(
      binding,
      metadata.firstGlyph + index,
      `${metadata.file}.bindings[${index}]`,
    )
  );
  return chunk as unknown as GlyphBindingChunk;
}

/**
 * Validate one supported or unsupported glyph result.
 * @param value Candidate result.
 * @param expectedGlyph Required glyph index.
 * @param label Diagnostic label.
 */
function validateGlyphResult(
  value: unknown,
  expectedGlyph: number,
  label: string,
): void {
  const result = objectValue(value, label);
  if (integerValue(result.glyph, `${label}.glyph`, 0, 100000) !== expectedGlyph) {
    throw new Error(`${label} breaks contiguous glyph coverage`);
  }
  if (result.status === "unsupported") {
    exactKeys(result, ["glyph", "status", "reason"], [], label);
    if (!/^[a-z0-9-]+$/.test(stringValue(result.reason, `${label}.reason`, 64))) {
      throw new Error(`${label}.reason is invalid`);
    }
    return;
  }
  if (result.status !== "supported") {
    throw new Error(`${label}.status is invalid`);
  }
  exactKeys(result, ["glyph", "status", "binding"], [], label);
  validateGlyphBinding(result.binding, `${label}.binding`);
}

/**
 * Validate one discriminated supported glyph binding.
 * @param value Candidate binding.
 * @param label Diagnostic label.
 */
function validateGlyphBinding(value: unknown, label: string): void {
  const binding = objectValue(value, label);
  const kind = stringValue(binding.kind, `${label}.kind`);
  const schemas: Record<string, readonly string[]> = {
    monster: ["kind", "monsterId", "presentation", "gender"],
    corpse: ["kind", "objectId", "monsterId", "pileTop"],
    statue: ["kind", "objectId", "monsterId", "pileTop", "gender"],
    "generic-object": ["kind", "appearanceId", "objectClass", "pileTop"],
    object: ["kind", "objectId", "pileTop"],
    terrain: ["kind", "terrainId", "variant"],
    trap: ["kind", "trapId"],
  };
  const keys = schemas[kind];
  if (!keys) {
    throw new Error(`${label}.kind is invalid`);
  }
  exactKeys(binding, keys, [], label);
  for (const key of ["monsterId", "objectId", "terrainId", "trapId"]) {
    if (key in binding) {
      entityId(binding[key], `${label}.${key}`);
    }
  }
  if ("appearanceId" in binding) {
    const appearanceId = entityId(
      binding.appearanceId,
      `${label}.appearanceId`,
    );
    const objectClass = stringValue(
      binding.objectClass,
      `${label}.objectClass`,
      64,
    );
    if (appearanceId !== `appearance:${objectClass}:GENERIC`) {
      throw new Error(`${label} appearance ID and object class disagree`);
    }
  }
  if ("pileTop" in binding && typeof binding.pileTop !== "boolean") {
    throw new Error(`${label}.pileTop must be boolean`);
  }
}

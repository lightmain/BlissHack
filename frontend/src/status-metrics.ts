import type {
  StatusFieldMetadata,
  StatusValue,
} from "./game-state";

/** Stable semantic groups used by the graphical status HUD. */
export type StatusMetricGroup =
  | "identity"
  | "resource"
  | "attribute"
  | "world"
  | "condition";

/** Static product metadata for one NetHack BL_* field. */
export interface StatusFieldDefinition {
  field: number;
  id: string;
  label: string;
  description: string;
  group: StatusMetricGroup;
}

/** Tooltip content derived only from the visible value and static help. */
export interface StatusTooltip {
  currentValue: string;
  description: string;
}

/** One active condition decoded from BL_CONDITION and cond_hilites. */
export interface StatusCondition {
  id: string;
  bit: number;
  label: string;
  color: number;
  attributes: number;
  tooltip: StatusTooltip;
}

/** One enabled status field ready for rendering. */
export interface StatusMetric extends StatusFieldDefinition {
  text: string;
  percent?: number;
  change: -1 | 0 | 1;
  color: number;
  attributes: number;
  conditions?: StatusCondition[];
  tooltip: StatusTooltip;
}

/** The 27 NetHack 5.0 status fields, in stable BL_* index order. */
export const STATUS_FIELD_DEFINITIONS: readonly StatusFieldDefinition[] = [
  {
    field: 0,
    id: "title",
    label: "Character",
    description: "Your character name and current title.",
    group: "identity",
  },
  {
    field: 1,
    id: "strength",
    label: "Strength",
    description: "Physical strength used for carrying and combat.",
    group: "attribute",
  },
  {
    field: 2,
    id: "dexterity",
    label: "Dexterity",
    description: "Agility used for movement and combat.",
    group: "attribute",
  },
  {
    field: 3,
    id: "constitution",
    label: "Constitution",
    description: "Physical resilience and endurance.",
    group: "attribute",
  },
  {
    field: 4,
    id: "intelligence",
    label: "Intelligence",
    description: "Mental aptitude for learning and spellcasting.",
    group: "attribute",
  },
  {
    field: 5,
    id: "wisdom",
    label: "Wisdom",
    description: "Judgment and spiritual aptitude.",
    group: "attribute",
  },
  {
    field: 6,
    id: "charisma",
    label: "Charisma",
    description: "Personal presence used in social interactions.",
    group: "attribute",
  },
  {
    field: 7,
    id: "alignment",
    label: "Alignment",
    description: "Your character's current alignment.",
    group: "identity",
  },
  {
    field: 8,
    id: "score",
    label: "Score",
    description: "The score accumulated in this game.",
    group: "world",
  },
  {
    field: 9,
    id: "carrying-capacity",
    label: "Encumbrance",
    description: "The effect of carried weight on movement.",
    group: "condition",
  },
  {
    field: 10,
    id: "gold",
    label: "Gold",
    description: "The amount of gold currently carried.",
    group: "world",
  },
  {
    field: 11,
    id: "power",
    label: "Energy",
    description: "Current magical energy.",
    group: "resource",
  },
  {
    field: 12,
    id: "power-max",
    label: "Maximum energy",
    description: "Maximum magical energy.",
    group: "resource",
  },
  {
    field: 13,
    id: "experience-level",
    label: "Experience",
    description: "Current experience level and progress.",
    group: "resource",
  },
  {
    field: 14,
    id: "armor-class",
    label: "Armor class",
    description: "Defensive armor class; lower values are stronger.",
    group: "attribute",
  },
  {
    field: 15,
    id: "HD",
    label: "Hit dice",
    description: "Monster-form level while polymorphed.",
    group: "resource",
  },
  {
    field: 16,
    id: "time",
    label: "Turn",
    description: "The number of game turns elapsed.",
    group: "world",
  },
  {
    field: 17,
    id: "hunger",
    label: "Hunger",
    description: "Your character's current hunger state.",
    group: "condition",
  },
  {
    field: 18,
    id: "hitpoints",
    label: "Hit points",
    description: "Current hit points and health percentage.",
    group: "resource",
  },
  {
    field: 19,
    id: "hitpoints-max",
    label: "Maximum hit points",
    description: "Maximum hit points.",
    group: "resource",
  },
  {
    field: 20,
    id: "dungeon-level",
    label: "Location",
    description: "Your current dungeon level or location.",
    group: "world",
  },
  {
    field: 21,
    id: "experience",
    label: "Experience points",
    description: "Experience points earned toward advancement.",
    group: "resource",
  },
  {
    field: 22,
    id: "condition",
    label: "Conditions",
    description: "Conditions currently affecting the character.",
    group: "condition",
  },
  {
    field: 23,
    id: "weapon",
    label: "Weapon",
    description: "The weapon currently readied for use.",
    group: "world",
  },
  {
    field: 24,
    id: "armor",
    label: "Armor",
    description: "The armor currently being worn.",
    group: "world",
  },
  {
    field: 25,
    id: "terrain",
    label: "Terrain",
    description: "The terrain at the character's location.",
    group: "world",
  },
  {
    field: 26,
    id: "version",
    label: "Version",
    description: "The NetHack version information shown by the core.",
    group: "world",
  },
];

interface ConditionDefinition {
  id: string;
  bit: number;
  label: string;
  description: string;
}

const CONDITION_DEFINITIONS: readonly ConditionDefinition[] = [
  ["bare-handed", "Bare", "No weapon is currently wielded."],
  ["blind", "Blind", "Sight is currently blocked."],
  ["busy", "Busy", "The character is occupied and cannot act normally."],
  ["confused", "Conf", "Direction and actions may be confused."],
  ["deaf", "Deaf", "Sound cannot currently be heard."],
  ["iron-sensitive", "Iron", "Contact with iron is causing harm."],
  ["flying", "Fly", "The character is currently flying."],
  ["food-poisoned", "FoodPois", "Food poisoning is causing illness."],
  ["glowing-hands", "Glow", "The character's hands are glowing."],
  ["grabbed", "Grab", "A monster is grabbing the character."],
  ["hallucinating", "Hallu", "Perception is distorted by hallucination."],
  ["held", "Held", "The character is being held in place."],
  ["icy-terrain", "Icy", "The current terrain is dangerously icy."],
  ["in-lava", "InLava", "The character is standing in lava."],
  ["levitating", "Lev", "The character is currently levitating."],
  ["paralyzed", "Parlyz", "The character is temporarily paralyzed."],
  ["riding", "Ride", "The character is currently riding a steed."],
  ["sleeping", "Zzz", "The character is currently asleep."],
  ["slimed", "Slime", "The character is being transformed by slime."],
  ["slippery", "Slip", "The character's hands are slippery."],
  ["petrifying", "Stone", "The character is turning to stone."],
  ["strangled", "Strngl", "The character is being strangled."],
  ["stun", "Stun", "The character is currently stunned."],
  ["submerged", "Submrg", "The character is currently submerged."],
  ["terminally-ill", "TermIll", "The character is terminally ill."],
  ["tethered", "Teth", "The character is tethered to another object."],
  ["trapped", "Trap", "The character is caught in a trap."],
  ["unconscious", "Out", "The character is currently unconscious."],
  ["wounded-legs", "WLegs", "Injured legs are limiting movement."],
  ["holding", "UHold", "The character is holding another creature."],
].map(([id, label, description], index) => ({
  id,
  bit: (1 << index) >>> 0,
  label,
  description,
}));

const PERCENT_FIELDS = new Set([11, 13, 18]);

/**
 * Convert raw status values and runtime metadata into semantic HUD metrics.
 * @param status - atomically committed values from status_update.
 * @param metadata - current status_enablefield metadata.
 * @returns enabled, non-empty metrics in stable BL_* order.
 */
export function buildStatusMetrics(
  status: Readonly<Record<number, StatusValue>>,
  metadata: Readonly<Record<number, StatusFieldMetadata>>,
): StatusMetric[] {
  return STATUS_FIELD_DEFINITIONS.flatMap((definition) => {
    const fieldMetadata = metadata[definition.field];
    const value = status[definition.field];
    if (!fieldMetadata?.enabled || !value) return [];

    const conditions = definition.field === 22
      ? buildConditions(value)
      : undefined;
    const text = definition.field === 22
      ? conditions?.map(({ label }) => label).join(" ") ?? ""
      : value.text.trim();
    if (!text) return [];
    const percent = metricPercent(definition.field, value.percent);

    return [{
      ...definition,
      text,
      ...(percent === undefined ? {} : { percent }),
      change: value.change < 0 ? -1 : value.change > 0 ? 1 : 0,
      color: value.color,
      attributes: value.attributes,
      ...(conditions ? { conditions } : {}),
      tooltip: {
        currentValue: text,
        description: definition.description,
      },
    }];
  });
}

/**
 * Preserve the shim's unavailable sentinel for maximum-level XP.
 * @param field - NetHack BL_* field index.
 * @param percent - percentage supplied by status_update.
 * @returns a clamped percentage, or undefined when no progress exists.
 */
function metricPercent(field: number, percent: number): number | undefined {
  if (!PERCENT_FIELDS.has(field)) return undefined;
  if (field === 13 && percent < 0) return undefined;
  return clampPercent(percent);
}

/**
 * Clamp one core percentage to the range accepted by progress elements.
 * @param percent - percentage supplied by status_update.
 * @returns an integer from zero through one hundred.
 */
function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.trunc(percent)));
}

/**
 * Decode active condition bits and their independent highlight metadata.
 * @param value - BL_CONDITION status value.
 * @returns active conditions in stable bit order.
 */
function buildConditions(value: StatusValue): StatusCondition[] {
  const mask = (value.conditionMask ?? 0) >>> 0;
  return CONDITION_DEFINITIONS.flatMap((definition) => {
    if ((mask & definition.bit) === 0) return [];
    const { color, attributes } = conditionAppearance(
      definition.bit,
      value.conditionColors,
    );
    return [{
      ...definition,
      color,
      attributes,
      tooltip: {
        currentValue: definition.label,
        description: definition.description,
      },
    }];
  });
}

/**
 * Resolve one condition's color and combinable HL_* attribute bits.
 * @param bit - active BL_MASK_* bit.
 * @param masks - color and attribute masks supplied by the core.
 * @returns the condition's color index and highlight attribute mask.
 */
function conditionAppearance(
  bit: number,
  masks: readonly number[],
): { color: number; attributes: number } {
  let color = 8;
  let attributes = 0;
  for (let index = 0; index < 16; index += 1) {
    if (((masks[index] ?? 0) & bit) !== 0) {
      color = index;
      break;
    }
  }
  for (let index = 18; index < 24; index += 1) {
    if (((masks[index] ?? 0) & bit) !== 0) {
      attributes |= 1 << (index - 17);
    }
  }
  return { color, attributes };
}

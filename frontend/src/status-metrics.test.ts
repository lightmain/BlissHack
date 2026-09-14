import { describe, expect, it } from "vitest";
import type { StatusValue } from "./game-state";
import {
  STATUS_FIELD_DEFINITIONS,
  buildStatusMetrics,
} from "./status-metrics";

const EXPECTED_FIELDS = [
  [0, "title", "identity"],
  [1, "strength", "attribute"],
  [2, "dexterity", "attribute"],
  [3, "constitution", "attribute"],
  [4, "intelligence", "attribute"],
  [5, "wisdom", "attribute"],
  [6, "charisma", "attribute"],
  [7, "alignment", "identity"],
  [8, "score", "world"],
  [9, "carrying-capacity", "condition"],
  [10, "gold", "world"],
  [11, "power", "resource"],
  [12, "power-max", "resource"],
  [13, "experience-level", "resource"],
  [14, "armor-class", "attribute"],
  [15, "HD", "resource"],
  [16, "time", "world"],
  [17, "hunger", "condition"],
  [18, "hitpoints", "resource"],
  [19, "hitpoints-max", "resource"],
  [20, "dungeon-level", "world"],
  [21, "experience", "resource"],
  [22, "condition", "condition"],
  [23, "weapon", "world"],
  [24, "armor", "world"],
  [25, "terrain", "world"],
  [26, "version", "world"],
] as const;

interface RuntimeFieldMetadata {
  name: string;
  format: string;
  enabled: boolean;
}

function statusValue(
  overrides: Partial<StatusValue> = {},
): StatusValue {
  return {
    text: "",
    change: 0,
    percent: 0,
    color: 8,
    attributes: 0,
    conditionColors: [],
    ...overrides,
  };
}

function enabledMetadata(
  fields: readonly number[],
): Record<number, RuntimeFieldMetadata> {
  return Object.fromEntries(fields.map((field) => [
    field,
    {
      name: EXPECTED_FIELDS[field][1],
      format: "%s",
      enabled: true,
    },
  ]));
}

describe("status field definitions", () => {
  it("keeps all 27 BL fields in stable semantic groups", () => {
    expect(
      STATUS_FIELD_DEFINITIONS.map(({ field, id, group }) => [
        field,
        id,
        group,
      ]),
    ).toEqual(EXPECTED_FIELDS);
    expect(new Set(STATUS_FIELD_DEFINITIONS.map(({ field }) => field)).size)
      .toBe(27);
    expect(
      STATUS_FIELD_DEFINITIONS.every(({ label, description }) =>
        label.trim().length > 0 && description.trim().length > 0
      ),
    ).toBe(true);
  });
});

describe("buildStatusMetrics", () => {
  it("only clamps core percentages without deriving them from status text", () => {
    const clampedMetrics = buildStatusMetrics({
      11: statusValue({ text: "Pw:30", percent: 140 }),
      13: statusValue({ text: "Xp:4", percent: 55 }),
      18: statusValue({ text: "HP:1", percent: -20 }),
    }, enabledMetadata([11, 13, 18]));

    expect(clampedMetrics.map(({ id, percent }) => ({ id, percent }))).toEqual([
      { id: "power", percent: 100 },
      { id: "experience-level", percent: 55 },
      { id: "hitpoints", percent: 0 },
    ]);
    const zeroPercentMetrics = buildStatusMetrics({
      11: statusValue({ text: " Pw:18", percent: 0 }),
      12: statusValue({ text: "(40)" }),
      13: statusValue({ text: " Xp:10", percent: 0 }),
      18: statusValue({ text: " HP:9", percent: 0 }),
      19: statusValue({ text: "(12)" }),
      21: statusValue({ text: "/7560" }),
    }, enabledMetadata([11, 12, 13, 18, 19, 21]));

    expect(zeroPercentMetrics.filter(({ percent }) => percent !== undefined).map(
      ({ id, percent }) => ({ id, percent }),
    )).toEqual([
      { id: "power", percent: 0 },
      { id: "experience-level", percent: 0 },
      { id: "hitpoints", percent: 0 },
    ]);
  });

  it("treats a negative BL_XP percent as unavailable at maximum level", () => {
    const metrics = buildStatusMetrics({
      13: statusValue({ text: " Xp:30", percent: -1 }),
      18: statusValue({ text: " HP:1", percent: -1 }),
    }, enabledMetadata([13, 18]));
    const experience = metrics.find(({ field }) => field === 13);
    const hitPoints = metrics.find(({ field }) => field === 18);

    expect(experience).toMatchObject({
      id: "experience-level",
      text: "Xp:30",
      tooltip: {
        currentValue: "Xp:30",
      },
    });
    expect(experience).not.toHaveProperty("percent");
    expect(hitPoints?.percent).toBe(0);
  });

  it("omits empty and dynamically disabled fields without placeholders", () => {
    const status = {
      0: statusValue({ text: "Ada the Tourist" }),
      1: statusValue({ text: "   " }),
      10: statusValue({ text: "$:42" }),
      22: statusValue({ conditionMask: 0 }),
    };
    const metadata = enabledMetadata([0, 1, 10, 22]);
    metadata[0] = { ...metadata[0], enabled: false };

    expect(buildStatusMetrics(status, metadata)).toEqual([
      expect.objectContaining({
        field: 10,
        id: "gold",
        text: "$:42",
      }),
    ]);
  });

  it("preserves the core color and attributes for every active condition bit", () => {
    const blind = 0x00000002;
    const stun = 0x00400000;
    const holding = 0x20000000;
    const conditionColors = Array<number>(24).fill(0);
    conditionColors[1] = blind;
    conditionColors[14] = (stun | holding) >>> 0;
    conditionColors[18] = stun;
    conditionColors[23] = holding;

    const metrics = buildStatusMetrics({
      22: statusValue({
        conditionMask: (blind | stun | holding) >>> 0,
        conditionColors,
      }),
    }, enabledMetadata([22]));

    expect(metrics).toHaveLength(1);
    expect(metrics[0].conditions).toEqual([
      expect.objectContaining({
        id: "blind",
        bit: blind,
        label: "Blind",
        color: 1,
        attributes: 0,
      }),
      expect.objectContaining({
        id: "stun",
        bit: stun,
        label: "Stun",
        color: 14,
        attributes: 0x02,
      }),
      expect.objectContaining({
        id: "holding",
        bit: holding,
        label: "UHold",
        color: 14,
        attributes: 0x40,
      }),
    ]);
  });

  it("uses NetHack's formal abbreviations for environment conditions", () => {
    const inLava = 0x00002000;
    const submerged = 0x00800000;
    const woundedLegs = 0x10000000;
    const metrics = buildStatusMetrics({
      22: statusValue({
        conditionMask: (inLava | submerged | woundedLegs) >>> 0,
      }),
    }, enabledMetadata([22]));

    expect(metrics[0].conditions?.map(({ id, label }) => ({ id, label })))
      .toEqual([
        { id: "in-lava", label: "InLava" },
        { id: "submerged", label: "Submrg" },
        { id: "wounded-legs", label: "WLegs" },
      ]);
  });

  it("normalizes negative, unchanged, and positive change values", () => {
    const metrics = buildStatusMetrics({
      1: statusValue({ text: "St:12", change: -7 }),
      2: statusValue({ text: "Dx:11", change: 0 }),
      3: statusValue({ text: "Co:10", change: 4 }),
    }, enabledMetadata([1, 2, 3]));

    expect(metrics.map(({ id, change }) => ({ id, change }))).toEqual([
      { id: "strength", change: -1 },
      { id: "dexterity", change: 0 },
      { id: "constitution", change: 1 },
    ]);
  });

  it("builds tooltip data from the current value and static description", () => {
    const metrics = buildStatusMetrics({
      18: statusValue({ text: " HP:42", percent: 67 }),
    }, enabledMetadata([18]));
    const definition = STATUS_FIELD_DEFINITIONS.find(
      ({ field }) => field === 18,
    );

    expect(metrics[0].tooltip).toEqual({
      currentValue: "HP:42",
      description: definition?.description,
    });
  });

  it("does not mutate status values or runtime field metadata", () => {
    const status = {
      18: statusValue({
        text: " HP:42",
        percent: 67,
        conditionColors: [1, 2, 3],
      }),
    };
    const metadata = enabledMetadata([18]);
    const statusBefore = structuredClone(status);
    const metadataBefore = structuredClone(metadata);

    buildStatusMetrics(status, metadata);

    expect(status).toEqual(statusBefore);
    expect(metadata).toEqual(metadataBefore);
  });
});

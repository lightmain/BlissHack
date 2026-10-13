import { describe, expect, it, vi } from "vitest";
import type { GlyphInfo, MapCell, MenuItem } from "../game-state";
import type { GlyphBindingResult } from "./core-schema";
import {
  captureInventoryExamineTarget,
  captureMapExamineTarget,
  createEntityResolver,
  isInventoryExamineTargetCurrent,
  isMapExamineTargetCurrent,
} from "./entity-resolution";

const ARTIFACT_BASE_OBJECTS = new Map([
  ["artifact:ART_EXCALIBUR", "object:LONG_SWORD"],
]);
const MODULE_ID = "module-1";
const SESSION_ID = "session-1";
const MAP_REVISION = 17;
const INVENTORY_REVISION = 23;

/**
 * Create one complete displayed glyph value.
 * @param glyph Final core-selected glyph index.
 * @param overrides Optional presentation-only field replacements.
 * @returns Independent glyph information.
 */
function glyphInfo(
  glyph: number,
  overrides: Partial<GlyphInfo> = {},
): GlyphInfo {
  return {
    glyph,
    ttyChar: 64,
    frameColor: -1,
    glyphFlags: 0,
    color: 7,
    symbolIndex: 1,
    customColor: 0,
    color256: 0,
    tileIndex: 300,
    ...overrides,
  };
}

/**
 * Create an inventory row carrying one final displayed glyph.
 * @param glyph Final core-selected glyph index.
 * @returns Inventory menu row.
 */
function inventoryItem(glyph: number): MenuItem {
  return {
    glyph: glyphInfo(glyph),
    identifier: 41,
    accelerator: "a".charCodeAt(0),
    groupAccelerator: 0,
    attribute: 0,
    color: 7,
    text: "visible inventory text must not be parsed",
    itemFlags: 0,
    visibleEntityToken: null,
  };
}

/**
 * Build a resolver and expose its glyph lookup spy.
 * @param bindings Validated binding results indexed by glyph.
 * @param maxGlyph Exclusive upper glyph bound.
 * @returns Resolver and lookup spy.
 */
function resolverFixture(
  bindings: ReadonlyMap<number, GlyphBindingResult>,
  maxGlyph = 100,
) {
  const bindingForGlyph = vi.fn(
    (glyph: number): GlyphBindingResult | null =>
      bindings.get(glyph) ?? null,
  );
  return {
    bindingForGlyph,
    resolver: createEntityResolver({
      maxGlyph,
      bindingForGlyph,
      artifactBaseObjects: ARTIFACT_BASE_OBJECTS,
    }),
  };
}

/**
 * Create the current state used to capture or validate a map target.
 * @param overrides Fields to replace.
 * @returns Current map target state.
 */
function currentMapState(overrides: Record<string, unknown> = {}) {
  return {
    moduleId: MODULE_ID,
    sessionId: SESSION_ID,
    mapRevision: MAP_REVISION,
    mapX: 12,
    mapY: 8,
    cell: {
      foreground: glyphInfo(41, { glyphFlags: 2 }),
      background: glyphInfo(91),
    } satisfies MapCell,
    ...overrides,
  };
}

/**
 * Create the current state used to capture or validate an inventory target.
 * @param overrides Fields to replace.
 * @returns Current inventory target state.
 */
function currentInventoryState(overrides: Record<string, unknown> = {}) {
  return {
    moduleId: MODULE_ID,
    sessionId: SESSION_ID,
    inventoryRevision: INVENTORY_REVISION,
    item: inventoryItem(41),
    visibleEntityToken: "artifact:ART_EXCALIBUR",
    ...overrides,
  };
}

describe("visible entity resolution", () => {
  it("prefers a supported foreground without consulting the background", () => {
    const bindings = new Map<number, GlyphBindingResult>([
      [5, {
        glyph: 5,
        status: "supported",
        binding: {
          kind: "monster",
          monsterId: "monster:PM_NEWT",
          presentation: "monster",
          gender: "male",
        },
      }],
      [6, {
        glyph: 6,
        status: "supported",
        binding: {
          kind: "terrain",
          terrainId: "terrain:S_FLOOR",
          variant: "room",
        },
      }],
    ]);
    const { bindingForGlyph, resolver } = resolverFixture(bindings);
    const cell: MapCell = {
      foreground: glyphInfo(5),
      background: glyphInfo(6),
    };

    expect(resolver.resolveMapCell(cell)).toMatchObject({
      entityId: "monster:PM_NEWT",
      glyph: 5,
      source: "map-foreground",
    });
    expect(bindingForGlyph).toHaveBeenCalledTimes(1);
    expect(bindingForGlyph).toHaveBeenCalledWith(5);
  });

  it("uses the background only when the foreground is absent", () => {
    const bindings = new Map<number, GlyphBindingResult>([
      [6, {
        glyph: 6,
        status: "supported",
        binding: {
          kind: "terrain",
          terrainId: "terrain:S_FLOOR",
          variant: "room",
        },
      }],
    ]);
    const { resolver } = resolverFixture(bindings);

    expect(resolver.resolveMapCell({
      foreground: null,
      background: glyphInfo(6),
    })).toMatchObject({
      entityId: "terrain:S_FLOOR",
      glyph: 6,
      source: "map-background",
      binding: {
        kind: "terrain",
        variant: "room",
      },
    });
  });

  it.each([
    {
      label: "unsupported foreground",
      foreground: glyphInfo(7),
      maxGlyph: 100,
      binding: {
        glyph: 7,
        status: "unsupported",
        reason: "warning",
      } satisfies GlyphBindingResult,
      expectedLookup: [7],
    },
    {
      label: "NO_GLYPH foreground",
      foreground: glyphInfo(-1),
      maxGlyph: 100,
      binding: null,
      expectedLookup: [],
    },
    {
      label: "out-of-range foreground",
      foreground: glyphInfo(100),
      maxGlyph: 100,
      binding: null,
      expectedLookup: [],
    },
  ])("does not fall back past a $label", ({
    foreground,
    maxGlyph,
    binding,
    expectedLookup,
  }) => {
    const background: GlyphBindingResult = {
      glyph: 6,
      status: "supported",
      binding: {
        kind: "terrain",
        terrainId: "terrain:S_FLOOR",
        variant: "room",
      },
    };
    const bindings = new Map<number, GlyphBindingResult>([[6, background]]);
    if (binding) {
      bindings.set(binding.glyph, binding);
    }
    const { bindingForGlyph, resolver } = resolverFixture(bindings, maxGlyph);

    expect(resolver.resolveMapCell({
      foreground,
      background: glyphInfo(6),
    })).toBeNull();
    expect(bindingForGlyph.mock.calls.map(([glyph]) => glyph))
      .toEqual(expectedLookup);
  });

  it("resolves only the final hallucinated or disguised display glyph", () => {
    const displayed: GlyphBindingResult = {
      glyph: 12,
      status: "supported",
      binding: {
        kind: "monster",
        monsterId: "monster:PM_RED_DRAGON",
        presentation: "detected",
        gender: "female",
      },
    };
    const { bindingForGlyph, resolver } = resolverFixture(
      new Map([[12, displayed]]),
    );
    const cell = {
      foreground: glyphInfo(12, {
        glyphFlags: 0xffff,
        symbolIndex: 88,
        tileIndex: 9001,
      }),
      background: null,
    };

    expect(resolver.resolveMapCell(cell)).toMatchObject({
      entityId: "monster:PM_RED_DRAGON",
      glyph: 12,
      binding: {
        presentation: "detected",
      },
    });
    expect(bindingForGlyph).toHaveBeenCalledOnce();
    expect(bindingForGlyph).toHaveBeenCalledWith(12);
  });

  it.each([
    {
      label: "corpse species and pile-top",
      binding: {
        kind: "corpse",
        objectId: "object:CORPSE",
        monsterId: "monster:PM_NEWT",
        pileTop: true,
      },
      entityId: "monster:PM_NEWT",
    },
    {
      label: "statue species and gender",
      binding: {
        kind: "statue",
        objectId: "object:STATUE",
        monsterId: "monster:PM_MEDUSA",
        pileTop: false,
        gender: "female",
      },
      entityId: "monster:PM_MEDUSA",
    },
    {
      label: "ordinary object pile-top",
      binding: {
        kind: "object",
        objectId: "object:LONG_SWORD",
        pileTop: true,
      },
      entityId: "object:LONG_SWORD",
    },
    {
      label: "themed wall variant",
      binding: {
        kind: "terrain",
        terrainId: "terrain:S_VWALL",
        variant: "gehennom",
      },
      entityId: "terrain:S_VWALL",
    },
  ] as const)("preserves $label semantics", ({ binding, entityId }) => {
    const result: GlyphBindingResult = {
      glyph: 20,
      status: "supported",
      binding,
    };
    const { resolver } = resolverFixture(new Map([[20, result]]));

    expect(resolver.resolveMapCell({
      foreground: glyphInfo(20),
      background: null,
    })).toMatchObject({
      entityId,
      binding,
    });
  });

  it("prefers a validated artifact token over its ordinary object glyph", () => {
    const objectBinding: GlyphBindingResult = {
      glyph: 30,
      status: "supported",
      binding: {
        kind: "object",
        objectId: "object:LONG_SWORD",
        pileTop: false,
      },
    };
    const { resolver } = resolverFixture(new Map([[30, objectBinding]]));

    expect(
      resolver.resolveInventoryItem(
        inventoryItem(30),
        "artifact:ART_EXCALIBUR",
      ),
    ).toMatchObject({
      entityId: "artifact:ART_EXCALIBUR",
      glyph: 30,
      source: "inventory",
      binding: {
        kind: "object",
        objectId: "object:LONG_SWORD",
      },
    });
  });

  it.each([
    ["null", null],
    ["malformed", "artifact:../../save"],
    ["unknown", "artifact:ART_NOT_IN_BUILD"],
    ["base-object mismatch", "artifact:ART_EXCALIBUR"],
  ])("fails closed for a %s artifact token", (_label, token) => {
    const objectId = token === "artifact:ART_EXCALIBUR"
      ? "object:DAGGER"
      : "object:LONG_SWORD";
    const objectBinding: GlyphBindingResult = {
      glyph: 30,
      status: "supported",
      binding: {
        kind: "object",
        objectId,
        pileTop: false,
      },
    };
    const { resolver } = resolverFixture(new Map([[30, objectBinding]]));

    expect(resolver.resolveInventoryItem(inventoryItem(30), token))
      .toMatchObject({
        entityId: objectId,
        glyph: 30,
        source: "inventory",
      });
  });
});

describe("examine target capture", () => {
  it("value-copies the foreground map glyph with background fallback", () => {
    const foregroundState = currentMapState();
    const foregroundCapture = captureMapExamineTarget(foregroundState);
    expect(foregroundCapture).not.toBeNull();
    foregroundState.cell.foreground!.glyph = 99;

    expect(foregroundCapture).toMatchObject({
      mapRevision: MAP_REVISION,
      mapX: 12,
      mapY: 8,
      glyph: { glyph: 41, glyphFlags: 2 },
    });
    expect(captureMapExamineTarget(currentMapState({
      cell: {
        foreground: null,
        background: glyphInfo(91),
      } satisfies MapCell,
    }))).toMatchObject({
      glyph: { glyph: 91 },
    });
  });

  it.each([
    ["module", { moduleId: "module-2" }],
    ["session", { sessionId: "session-2" }],
    ["map revision", { mapRevision: MAP_REVISION + 1 }],
    [
      "glyph",
      {
        cell: {
          foreground: glyphInfo(42, { glyphFlags: 2 }),
          background: null,
        },
      },
    ],
  ])("rejects a map capture after the %s changes", (_label, overrides) => {
    const capture = captureMapExamineTarget(currentMapState());
    expect(capture).not.toBeNull();
    expect(isMapExamineTargetCurrent(
      capture!,
      currentMapState(overrides),
    )).toBe(false);
  });

  it("value-copies the complete inventory identity", () => {
    const state = currentInventoryState();
    const capture = captureInventoryExamineTarget(state);
    expect(capture).not.toBeNull();
    state.item.identifier = 999;
    state.item.accelerator = "z".charCodeAt(0);
    state.item.glyph!.glyph = 99;

    expect(capture).toMatchObject({
      inventoryRevision: INVENTORY_REVISION,
      identifier: 41,
      accelerator: "a".charCodeAt(0),
      glyph: { glyph: 41 },
      visibleEntityToken: "artifact:ART_EXCALIBUR",
    });
  });

  it.each([
    ["module", { moduleId: "module-2" }],
    ["session", { sessionId: "session-2" }],
    [
      "inventory revision",
      { inventoryRevision: INVENTORY_REVISION + 1 },
    ],
    [
      "identifier",
      { item: { ...inventoryItem(41), identifier: 42 } },
    ],
    [
      "accelerator",
      {
        item: {
          ...inventoryItem(41),
          accelerator: "b".charCodeAt(0),
        },
      },
    ],
    ["glyph", { item: inventoryItem(42) }],
    ["visible token", { visibleEntityToken: null }],
  ])("rejects an inventory capture after the %s changes", (
    _label,
    overrides,
  ) => {
    const capture = captureInventoryExamineTarget(currentInventoryState());
    expect(capture).not.toBeNull();
    expect(isInventoryExamineTargetCurrent(
      capture!,
      currentInventoryState(overrides),
    )).toBe(false);
  });

  it("accepts captures only while every bound field remains current", () => {
    const mapCapture = captureMapExamineTarget(currentMapState());
    const inventoryCapture = captureInventoryExamineTarget(
      currentInventoryState(),
    );

    expect(isMapExamineTargetCurrent(
      mapCapture!,
      currentMapState(),
    )).toBe(true);
    expect(isInventoryExamineTargetCurrent(
      inventoryCapture!,
      currentInventoryState(),
    )).toBe(true);
  });
});

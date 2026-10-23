/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { GlyphInfo, MapCell, MenuItem } from "../game-state";
import type { GlyphBinding, GlyphBindingResult } from "./core-schema";
import type { EncyclopediaLoader } from "./encyclopedia-loader";
import {
  captureInventoryExamineTarget,
  captureMapExamineTarget,
  createEntityResolver,
  isInventoryExamineTargetCurrent,
  isMapExamineTargetCurrent,
} from "./entity-resolution";
import {
  cloneExamineTarget,
  examineTargetsEqual,
  resolveExamineCapture,
  type InventoryExamineCapture,
} from "./examine-target";

const ARTIFACT_BASE_OBJECTS = new Map([
  ["artifact:ART_EXCALIBUR", "object:LONG_SWORD"],
]);
const KNOWN_OBJECT_IDS = new Set([
  "object:DAGGER",
  "object:KATANA",
  "object:LONG_SWORD",
]);
const MODULE_ID = "module-1";
const SESSION_ID = "session-1";
const MAP_REVISION = 17;
const INVENTORY_REVISION = 23;
const EXAMINE_TARGET_SOURCE = readFileSync(
  new URL("./examine-target.ts", import.meta.url),
  "utf8",
);

interface MapTargetFixture {
  moduleId: string;
  sessionId: string;
  mapRevision: number;
  mapX: number;
  mapY: number;
  cell: MapCell;
  volatileDisplayIdentity: boolean;
}

interface InventoryTargetFixture {
  moduleId: string;
  sessionId: string;
  inventoryRevision: number;
  item: MenuItem;
  visibleEntityToken: string | null;
  volatileDisplayIdentity: boolean;
}

interface VolatileDisplayCapture {
  volatileDisplayIdentity: boolean;
}

/** Read the future volatility marker without requiring its production type. */
function volatileDisplayIdentityOf(capture: unknown): unknown {
  return (capture as Partial<VolatileDisplayCapture> | null)
    ?.volatileDisplayIdentity;
}

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
  objectIdsByGlyph: ReadonlyMap<number, string> = new Map(),
) {
  const bindingForGlyph = vi.fn(
    (glyph: number): GlyphBindingResult | null =>
      bindings.get(glyph) ?? null,
  );
  const objectIdForGlyph = vi.fn(
    (glyph: number): string | null =>
      objectIdsByGlyph.get(glyph) ?? null,
  );
  const createResolver = createEntityResolver as unknown as (
    options: Parameters<typeof createEntityResolver>[0] & {
      knownObjectIds: ReadonlySet<string>;
      objectIdForGlyph: (glyph: number) => string | null;
    },
  ) => ReturnType<typeof createEntityResolver>;
  return {
    bindingForGlyph,
    objectIdForGlyph,
    resolver: createResolver({
      maxGlyph,
      bindingForGlyph,
      artifactBaseObjects: ARTIFACT_BASE_OBJECTS,
      knownObjectIds: KNOWN_OBJECT_IDS,
      objectIdForGlyph,
    }),
  };
}

/**
 * Build a loader exposing the generated exact object identity for each glyph.
 * @param binding Static public glyph binding.
 * @param objectId Exact object represented by the glyph, when available.
 * @returns Loader fixture accepted by asynchronous examine resolution.
 */
function examineLoader(
  binding: GlyphBindingResult,
  objectId: string | null,
): EncyclopediaLoader {
  return {
    preload: vi.fn(),
    loadGlyphBinding: vi.fn().mockResolvedValue(binding),
    loadEntity: vi.fn(),
    loadArtifactBaseObjects: vi.fn().mockResolvedValue(
      ARTIFACT_BASE_OBJECTS,
    ),
    loadObjectIdForGlyph: vi.fn().mockResolvedValue(objectId),
  } as unknown as EncyclopediaLoader;
}

/**
 * Create a copied permanent-inventory target for asynchronous resolution.
 * @param token Row-local visible entity token.
 * @returns Immutable inventory capture.
 */
function inventoryCapture(token: string | null): InventoryExamineCapture {
  return {
    surface: "inventory",
    moduleId: MODULE_ID,
    sessionId: SESSION_ID,
    inventoryRevision: INVENTORY_REVISION,
    identifier: 41,
    accelerator: "a".charCodeAt(0),
    source: "inventory",
    glyph: glyphInfo(30),
    visibleEntityToken: token,
  };
}

/**
 * Create the current state used to capture or validate a map target.
 * @param overrides Fields to replace.
 * @returns Current map target state.
 */
function currentMapState(
  overrides: Partial<MapTargetFixture> = {},
): MapTargetFixture {
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
    volatileDisplayIdentity: false,
    ...overrides,
  };
}

/**
 * Create the current state used to capture or validate an inventory target.
 * @param overrides Fields to replace.
 * @returns Current inventory target state.
 */
function currentInventoryState(
  overrides: Partial<InventoryTargetFixture> = {},
): InventoryTargetFixture {
  return {
    moduleId: MODULE_ID,
    sessionId: SESSION_ID,
    inventoryRevision: INVENTORY_REVISION,
    item: inventoryItem(41),
    visibleEntityToken: "artifact:ART_EXCALIBUR",
    volatileDisplayIdentity: false,
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

  it("upgrades a generic weapon only for its exact ordinary object token", () => {
    const genericWeapon: GlyphBindingResult = {
      glyph: 30,
      status: "supported",
      binding: {
        kind: "generic-object",
        appearanceId: "appearance:WEAPON_CLASS:GENERIC",
        objectClass: "WEAPON_CLASS",
        pileTop: false,
      },
    };
    const { resolver } = resolverFixture(
      new Map([[30, genericWeapon]]),
      100,
      new Map([[30, "object:KATANA"]]),
    );

    expect(
      resolver.resolveInventoryItem(inventoryItem(30), "object:KATANA"),
    ).toMatchObject({
      entityId: "object:KATANA",
      glyph: 30,
      source: "inventory",
      binding: {
        kind: "generic-object",
        appearanceId: "appearance:WEAPON_CLASS:GENERIC",
      },
    });
  });

  it.each([
    ["missing", null],
    ["malformed", "object:../KATANA"],
    ["unknown", "object:NOT_IN_BUILD"],
    ["same-class mismatch", "object:DAGGER"],
  ])("keeps a generic weapon for a %s object token", (_label, token) => {
    const genericWeapon: GlyphBindingResult = {
      glyph: 30,
      status: "supported",
      binding: {
        kind: "generic-object",
        appearanceId: "appearance:WEAPON_CLASS:GENERIC",
        objectClass: "WEAPON_CLASS",
        pileTop: false,
      },
    };
    const { resolver } = resolverFixture(
      new Map([[30, genericWeapon]]),
      100,
      new Map([
        [30, "object:KATANA"],
        [31, "object:DAGGER"],
      ]),
    );

    expect(resolver.resolveInventoryItem(inventoryItem(30), token))
      .toMatchObject({
        entityId: "appearance:WEAPON_CLASS:GENERIC",
        glyph: 30,
        source: "inventory",
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

describe("asynchronous examine target resolution", () => {
  const genericWeapon: GlyphBindingResult = {
    glyph: 30,
    status: "supported",
    binding: {
      kind: "generic-object",
      appearanceId: "appearance:WEAPON_CLASS:GENERIC",
      objectClass: "WEAPON_CLASS",
      pileTop: false,
    },
  };

  it("upgrades a generic weapon for a matching ordinary object token", async () => {
    const loader = examineLoader(genericWeapon, "object:KATANA");

    await expect(resolveExamineCapture(
      loader,
      inventoryCapture("object:KATANA"),
    )).resolves.toMatchObject({
      entityId: "object:KATANA",
      visibleEntityToken: "object:KATANA",
    });
  });

  it.each([
    ["missing", null],
    ["malformed", "object:../KATANA"],
    ["same-class mismatch", "object:DAGGER"],
  ])("keeps a generic weapon for a %s token", async (_label, token) => {
    const loader = examineLoader(genericWeapon, "object:KATANA");

    await expect(resolveExamineCapture(
      loader,
      inventoryCapture(token),
    )).resolves.toMatchObject({
      entityId: "appearance:WEAPON_CLASS:GENERIC",
    });
  });

  it("retains artifact upgrades for an exact ordinary object binding", async () => {
    const loader = examineLoader({
      glyph: 30,
      status: "supported",
      binding: {
        kind: "object",
        objectId: "object:LONG_SWORD",
        pileTop: false,
      },
    }, "object:LONG_SWORD");

    await expect(resolveExamineCapture(
      loader,
      inventoryCapture("artifact:ART_EXCALIBUR"),
    )).resolves.toMatchObject({
      entityId: "artifact:ART_EXCALIBUR",
      visibleEntityToken: "artifact:ART_EXCALIBUR",
    });
  });

  it.each([
    {
      label: "ordinary monster",
      binding: {
        kind: "monster",
        monsterId: "monster:PM_NEWT",
        presentation: "monster",
        gender: "male",
      } satisfies GlyphBinding,
    },
    {
      label: "newt corpse",
      binding: {
        kind: "corpse",
        objectId: "object:CORPSE",
        monsterId: "monster:PM_NEWT",
        pileTop: false,
      } satisfies GlyphBinding,
    },
    {
      label: "statue of a newt",
      binding: {
        kind: "statue",
        objectId: "object:STATUE",
        monsterId: "monster:PM_NEWT",
        pileTop: true,
        gender: "male",
      } satisfies GlyphBinding,
    },
  ])("preserves the validated binding for a $label target", async ({
    binding,
  }) => {
    const capture = captureMapExamineTarget(currentMapState({
      cell: {
        foreground: glyphInfo(30),
        background: null,
      },
    }));
    const loader = examineLoader({
      glyph: 30,
      status: "supported",
      binding,
    }, null);

    await expect(resolveExamineCapture(loader, capture!)).resolves
      .toMatchObject({
        entityId: "monster:PM_NEWT",
        binding,
      });
  });
});

describe("resolved examine target binding contract", () => {
  const maleBinding = {
    kind: "monster",
    monsterId: "monster:PM_NEWT",
    presentation: "monster",
    gender: "male",
  } satisfies GlyphBinding;

  it("requires a validated binding on both resolved target variants", () => {
    expect(EXAMINE_TARGET_SOURCE).toMatch(
      /export interface MapExamineTarget extends MapExamineCapture \{\s*entityId: string;\s*binding: GlyphBinding;\s*\}/,
    );
    expect(EXAMINE_TARGET_SOURCE).toMatch(
      /export interface InventoryExamineTarget extends InventoryExamineCapture \{\s*entityId: string;\s*binding: GlyphBinding;\s*\}/,
    );
  });

  it("deep-copies the binding when a resolved target crosses a boundary", async () => {
    const capture = captureMapExamineTarget(currentMapState({
      cell: {
        foreground: glyphInfo(30),
        background: null,
      },
    }))!;
    const resolved = await resolveExamineCapture(examineLoader({
      glyph: 30,
      status: "supported",
      binding: maleBinding,
    }, null), capture);

    expect(resolved).not.toBeNull();
    const cloned = cloneExamineTarget(resolved!);
    expect(cloned).toEqual(resolved);
    expect(cloned.binding).not.toBe(resolved!.binding);

    if (resolved!.binding?.kind !== "monster") {
      throw new Error("Expected a monster binding");
    }
    resolved!.binding.gender = "female";
    expect(cloned.binding).toEqual(maleBinding);
  });

  it("treats the validated binding as part of resolved target equality", async () => {
    const capture = captureMapExamineTarget(currentMapState({
      cell: {
        foreground: glyphInfo(30),
        background: null,
      },
    }))!;
    const male = await resolveExamineCapture(examineLoader({
      glyph: 30,
      status: "supported",
      binding: maleBinding,
    }, null), capture);
    const female = await resolveExamineCapture(examineLoader({
      glyph: 30,
      status: "supported",
      binding: {
        ...maleBinding,
        gender: "female",
      },
    }, null), capture);

    expect(male).not.toBeNull();
    expect(female).not.toBeNull();
    expect(examineTargetsEqual(male, female)).toBe(false);
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

  it("marks stable and hallucinated display identities explicitly", () => {
    const stableMap = captureMapExamineTarget(currentMapState());
    const volatileMap = captureMapExamineTarget(currentMapState({
      volatileDisplayIdentity: true,
    }));
    const stableInventory = captureInventoryExamineTarget(
      currentInventoryState(),
    );
    const volatileInventory = captureInventoryExamineTarget(
      currentInventoryState({ volatileDisplayIdentity: true }),
    );

    expect(volatileDisplayIdentityOf(stableMap)).toBe(false);
    expect(volatileDisplayIdentityOf(volatileMap)).toBe(true);
    expect(volatileDisplayIdentityOf(stableInventory)).toBe(false);
    expect(volatileDisplayIdentityOf(volatileInventory)).toBe(true);
  });

  it("keeps a hallucinated map capture current across display rerolls", () => {
    const capture = captureMapExamineTarget(currentMapState({
      volatileDisplayIdentity: true,
    }))!;

    expect(isMapExamineTargetCurrent(
      capture,
      currentMapState({
        mapRevision: MAP_REVISION + 3,
        cell: {
          foreground: glyphInfo(73, {
            glyphFlags: 0x40,
            symbolIndex: 19,
            tileIndex: 812,
          }),
          background: glyphInfo(91),
        },
        volatileDisplayIdentity: true,
      }),
    )).toBe(true);
  });

  it.each([
    ["module", { moduleId: "module-2" }],
    ["session", { sessionId: "session-2" }],
    ["map x coordinate", { mapX: 13 }],
    ["map y coordinate", { mapY: 9 }],
  ] satisfies Array<[string, Partial<MapTargetFixture>]>)(
    "rejects a hallucinated map capture after the %s changes",
    (_label, overrides) => {
      const capture = captureMapExamineTarget(currentMapState({
        volatileDisplayIdentity: true,
      }))!;

      expect(isMapExamineTargetCurrent(
        capture,
        currentMapState({
          ...overrides,
          mapRevision: MAP_REVISION + 1,
          cell: {
            foreground: glyphInfo(73),
            background: null,
          },
          volatileDisplayIdentity: true,
        }),
      )).toBe(false);
    },
  );

  it("keeps a hallucinated inventory capture current across row rerolls", () => {
    const capture = captureInventoryExamineTarget(currentInventoryState({
      volatileDisplayIdentity: true,
    }))!;

    expect(isInventoryExamineTargetCurrent(
      capture,
      currentInventoryState({
        inventoryRevision: INVENTORY_REVISION + 2,
        item: inventoryItem(84),
        visibleEntityToken: null,
        volatileDisplayIdentity: true,
      }),
    )).toBe(true);
  });

  it.each([
    ["module", { moduleId: "module-2" }],
    ["session", { sessionId: "session-2" }],
    [
      "identifier",
      { item: { ...inventoryItem(84), identifier: 42 } },
    ],
    [
      "accelerator",
      {
        item: {
          ...inventoryItem(84),
          accelerator: "b".charCodeAt(0),
        },
      },
    ],
  ] satisfies Array<[string, Partial<InventoryTargetFixture>]>)(
    "rejects a hallucinated inventory capture after the %s changes",
    (_label, overrides: Partial<InventoryTargetFixture>) => {
      const capture = captureInventoryExamineTarget(currentInventoryState({
        volatileDisplayIdentity: true,
      }))!;

      expect(isInventoryExamineTargetCurrent(
        capture,
        currentInventoryState({
          ...overrides,
          inventoryRevision: INVENTORY_REVISION + 1,
          item: overrides.item ?? inventoryItem(84),
          visibleEntityToken: null,
          volatileDisplayIdentity: true,
        }),
      )).toBe(false);
    },
  );
});

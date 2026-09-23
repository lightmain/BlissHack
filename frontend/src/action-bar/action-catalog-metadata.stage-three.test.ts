/// <reference types="node" />

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decodeActionCatalog,
  type ActionCatalogEntry,
  type SessionActionCatalog,
} from "../game-actions/action-catalog";

type ActionCategory =
  | "common"
  | "gear"
  | "magic"
  | "items"
  | "explore"
  | "info"
  | "system";

type ActionState = "available" | "blocked" | "unavailable";

interface ActionPresentation {
  category?: ActionCategory;
  icon: string;
  key: string;
  name: string;
  state: ActionState;
}

interface ActionCatalogMetadataApi {
  buildActionPresentations(
    catalog: SessionActionCatalog,
    options: { blocked: boolean },
  ): ActionPresentation[];
  resolveActionSlotPresentation(
    name: string,
    catalog: SessionActionCatalog,
    options: { blocked: boolean },
  ): ActionPresentation;
}

interface BaselineAction {
  category: ActionCategory;
  icon?: string;
  iconState?: "missing";
  key: string;
  name: string;
}

const MODULE_PATH = "./action-catalog-metadata";
const CMD_PARAM = 0x4000;
const FALLBACK_ICON = "square-dashed-x-corner";
let api: ActionCatalogMetadataApi | null = null;

beforeAll(async () => {
  try {
    api = await import(
      /* @vite-ignore */ MODULE_PATH
    ) as ActionCatalogMetadataApi;
  } catch {
    api = null;
  }
});

/**
 * Load the reviewed prototype metadata used to define alpha-2.3 presentation.
 * @returns all 104 non-directional actions in current WASM catalog order.
 */
function readBaselineActions(): BaselineAction[] {
  const html = readFileSync(
    new URL(
      "../../../doc/BlissHack/prototypes/alpha-2.3-action-bar.html",
      import.meta.url,
    ),
    "utf8",
  );
  const match = html.match(
    /<script type="application\/json" id="action-bar-config">\s*([\s\S]*?)\s*<\/script>/,
  );
  if (!match) throw new Error("Missing reviewed action-bar-config baseline");
  const parsed = JSON.parse(match[1]) as { catalog?: unknown };
  if (!Array.isArray(parsed.catalog)) {
    throw new Error("Invalid reviewed action-bar-config baseline");
  }
  return parsed.catalog as BaselineAction[];
}

/**
 * Reconstruct the WASM byte represented by one reviewed display key.
 * @param action - reviewed presentation metadata.
 * @returns the default extcmd key byte, or zero for an extended command.
 */
function defaultKeyFor(action: BaselineAction): number {
  const { key, name } = action;
  if (key === `#${name}`) return 0;
  if (key === "Del") return 0x7f;
  if (key.startsWith("Ctrl+")) {
    return key.slice(5).charCodeAt(0) & 0x1f;
  }
  if (key.startsWith("Alt+Shift+")) {
    return key.slice(10).charCodeAt(0) | 0x80;
  }
  if (key.startsWith("Alt+")) {
    const character = key.slice(4);
    const unshifted = /^[A-Z]$/.test(character)
      ? character.toLowerCase()
      : character;
    return unshifted.charCodeAt(0) | 0x80;
  }
  if ([...key].length !== 1) {
    throw new Error(`Unsupported baseline key: ${key}`);
  }
  return key.charCodeAt(0);
}

/** Build a validated catalog carrying real names and representative key bytes. */
function catalogFixture(actions: readonly BaselineAction[]): SessionActionCatalog {
  const commands: ActionCatalogEntry[] = actions.map((action, index) => ({
    sessionCommandId: index,
    name: action.name,
    defaultKey: defaultKeyFor(action),
    flags: action.name === "toggle" ? CMD_PARAM : 0x0008,
  }));
  return decodeActionCatalog(
    { schemaVersion: 1, commands },
    { moduleId: "module-stage-three", sessionId: "session-stage-three" },
  );
}

function requireApi(): ActionCatalogMetadataApi {
  expect(
    api,
    "stage three requires exhaustive action presentation metadata",
  ).not.toBeNull();
  return api as ActionCatalogMetadataApi;
}

describe("stage-three action catalog presentation metadata", () => {
  it("exhaustively classifies, icons, labels, and states all 104 catalog names", () => {
    const baseline = readBaselineActions();
    const catalog = catalogFixture(baseline);
    const presentations = requireApi().buildActionPresentations(
      catalog,
      { blocked: false },
    );

    expect(baseline).toHaveLength(104);
    expect(presentations.map(({ name }) => name))
      .toEqual(baseline.map(({ name }) => name));
    expect(new Set(presentations.map(({ name }) => name))).toHaveProperty(
      "size",
      104,
    );

    const categoryCounts = new Map<ActionCategory, number>();
    for (const [index, expected] of baseline.entries()) {
      const presentation = presentations[index];
      expect(presentation, expected.name).toMatchObject({
        category: expected.category,
        icon: expected.icon ?? FALLBACK_ICON,
        key: expected.key,
        name: expected.name,
        state: expected.name === "toggle" ? "unavailable" : "available",
      });
      expect(presentation, expected.name).not.toHaveProperty("description");
      categoryCounts.set(
        expected.category,
        (categoryCounts.get(expected.category) ?? 0) + 1,
      );
    }
    expect(Object.fromEntries(categoryCounts)).toEqual({
      system: 18,
      gear: 19,
      explore: 21,
      items: 11,
      info: 14,
      magic: 10,
      common: 11,
    });
    expect(
      presentations
        .filter(({ icon }) => icon === FALLBACK_ICON)
        .map(({ name }) => name),
    ).toEqual([
      "conduct",
      "herecmdmenu",
      "knownclass",
      "monster",
      "showtrap",
      "therecmdmenu",
      "twoweapon",
    ]);

    expect(
      requireApi().resolveActionSlotPresentation(
        "search",
        catalog,
        { blocked: true },
      ),
    ).toMatchObject({ name: "search", key: "s", state: "blocked" });
    expect(
      requireApi().resolveActionSlotPresentation(
        "toggle",
        catalog,
        { blocked: true },
      ),
    ).toMatchObject({
      name: "toggle",
      key: "#toggle",
      state: "unavailable",
    });
    expect(
      requireApi().resolveActionSlotPresentation(
        "future-command",
        catalog,
        { blocked: false },
      ),
    ).toMatchObject({
      icon: FALLBACK_ICON,
      key: "#future-command",
      name: "future-command",
      state: "unavailable",
    });
  });
});

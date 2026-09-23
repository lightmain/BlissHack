import { beforeAll, describe, expect, it } from "vitest";

interface ActionCatalogOwner {
  moduleId: string;
  sessionId: string;
}

interface ActionCatalogEntry {
  sessionCommandId: number;
  name: string;
  defaultKey: number;
  flags: number;
}

interface SessionActionCatalog extends ActionCatalogOwner {
  schemaVersion: 1;
  commands: ActionCatalogEntry[];
}

interface ActionCatalogApi {
  decodeActionCatalog(
    value: unknown,
    owner: ActionCatalogOwner,
  ): SessionActionCatalog;
  resolveActionCatalogCommand(
    catalog: SessionActionCatalog,
    sessionCommandId: number,
    owner: ActionCatalogOwner,
  ): ActionCatalogEntry;
}

const MODULE_PATH = "./action-catalog";
const CURRENT_OWNER = {
  moduleId: "module-current",
  sessionId: "session-current",
} as const;
const STALE_MODULE = {
  moduleId: "module-stale",
  sessionId: CURRENT_OWNER.sessionId,
} as const;
const STALE_SESSION = {
  moduleId: CURRENT_OWNER.moduleId,
  sessionId: "session-stale",
} as const;
const GENERALCMD = 0x0008;
const WIZMODECMD = 0x0004;
const CMD_NOT_AVAILABLE = 0x0010;
const INTERNALCMD = 0x0040;
const MOVEMENTCMD = 0x0400;
const CMD_PARAM = 0x4000;
const KNOWN_FLAGS_MASK = 0x7fff;
let api: ActionCatalogApi | null = null;

beforeAll(async () => {
  try {
    api = await import(
      /* @vite-ignore */ MODULE_PATH
    ) as ActionCatalogApi;
  } catch {
    api = null;
  }
});

function requireApi(): ActionCatalogApi {
  expect(
    api,
    "stage one requires a validated, session-owned action catalog",
  ).not.toBeNull();
  return api as ActionCatalogApi;
}

function catalogFixture(): {
  schemaVersion: number;
  commands: ActionCatalogEntry[];
} {
  return {
    schemaVersion: 1,
    commands: Array.from({ length: 104 }, (_, sessionCommandId) => ({
      sessionCommandId,
      name: sessionCommandId === 73
        ? "toggle"
        : `command-${sessionCommandId}`,
      defaultKey: sessionCommandId === 73 ? 0 : sessionCommandId % 256,
      flags: sessionCommandId === 73 ? CMD_PARAM : GENERALCMD,
    })),
  };
}

describe("stage-one action catalog", () => {
  it("accepts exactly 104 unique copied entries and retains toggle metadata", () => {
    const catalog = requireApi().decodeActionCatalog(
      catalogFixture(),
      CURRENT_OWNER,
    );

    expect(catalog).toMatchObject({
      schemaVersion: 1,
      ...CURRENT_OWNER,
    });
    expect(catalog.commands).toHaveLength(104);
    expect(new Set(catalog.commands.map(({ name }) => name)).size).toBe(104);
    expect(
      new Set(catalog.commands.map(({ sessionCommandId }) => sessionCommandId)),
    ).toHaveProperty("size", 104);
    expect(catalog.commands.every(
      ({ defaultKey, flags }) =>
        Number.isInteger(defaultKey)
        && defaultKey >= 0
        && defaultKey <= 0xff
        && (flags & ~KNOWN_FLAGS_MASK) === 0,
    )).toBe(true);
    expect(catalog.commands.find(({ name }) => name === "toggle")).toMatchObject({
      defaultKey: 0,
      flags: CMD_PARAM,
    });
  });

  it("rejects invalid versions, counts, identities, keys, and flags", () => {
    const catalogApi = requireApi();
    const invalidCases: Array<[
      string,
      (source: ReturnType<typeof catalogFixture>) => void,
    ]> = [
      ["schema version", (source) => {
        source.schemaVersion = 2;
      }],
      ["catalog size", (source) => {
        source.commands.pop();
      }],
      ["duplicate name", (source) => {
        source.commands[1].name = source.commands[0].name;
      }],
      ["duplicate ID", (source) => {
        source.commands[1].sessionCommandId = source.commands[0].sessionCommandId;
      }],
      ["out-of-range ID", (source) => {
        source.commands[0].sessionCommandId = 1024;
      }],
      ["out-of-range key", (source) => {
        source.commands[0].defaultKey = 256;
      }],
      ["unknown flags", (source) => {
        source.commands[0].flags = 0x8000;
      }],
      ["wizard command", (source) => {
        source.commands[0].flags = WIZMODECMD;
      }],
      ["internal command", (source) => {
        source.commands[0].flags = INTERNALCMD;
      }],
      ["unavailable command", (source) => {
        source.commands[0].flags = CMD_NOT_AVAILABLE;
      }],
      ["movement command", (source) => {
        source.commands[0].flags = MOVEMENTCMD;
      }],
    ];

    for (const [label, mutate] of invalidCases) {
      const source = catalogFixture();
      mutate(source);
      expect(
        () => catalogApi.decodeActionCatalog(source, CURRENT_OWNER),
        label,
      ).toThrow();
    }
  });

  it("resolves a session command ID only for its module and session owner", () => {
    const catalog = requireApi().decodeActionCatalog(
      catalogFixture(),
      CURRENT_OWNER,
    );

    expect(
      requireApi().resolveActionCatalogCommand(catalog, 73, CURRENT_OWNER),
    ).toMatchObject({
      sessionCommandId: 73,
      name: "toggle",
    });
    expect(() =>
      requireApi().resolveActionCatalogCommand(catalog, 73, STALE_MODULE)
    ).toThrow();
    expect(() =>
      requireApi().resolveActionCatalogCommand(catalog, 73, STALE_SESSION)
    ).toThrow();
    expect(() =>
      requireApi().resolveActionCatalogCommand(catalog, 104, CURRENT_OWNER)
    ).toThrow();
  });
});

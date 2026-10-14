import { describe, expect, it } from "vitest";
import * as visibleEntityTokens from "./visible-entity-token";

const {
  createVisibleIdentityTokenChannel,
  validateVisibleArtifactToken,
} = visibleEntityTokens;

const ARTIFACT_BASE_OBJECTS = new Map([
  ["artifact:ART_EXCALIBUR", "object:LONG_SWORD"],
  ["artifact:ART_CLEAVER", "object:BATTLE_AXE"],
]);
const KNOWN_OBJECT_IDS = new Set([
  "object:DAGGER",
  "object:KATANA",
  "object:LONG_SWORD",
]);

interface VisibleEntityTokenApi {
  parseVisibleEntityToken?: (token: unknown) => string | null;
  validateVisibleEntityToken?: (
    token: unknown,
    options: {
      displayedObjectId: string;
      knownObjectIds: ReadonlySet<string>;
      artifactBaseObjects: ReadonlyMap<string, string>;
    },
  ) => string | null;
}

/**
 * Require the generalized token API while keeping this red test loadable.
 * @returns The expected parser and validator.
 */
function visibleEntityTokenApi() {
  const api = visibleEntityTokens as VisibleEntityTokenApi;
  expect(api.parseVisibleEntityToken).toBeTypeOf("function");
  expect(api.validateVisibleEntityToken).toBeTypeOf("function");
  return {
    parse: api.parseVisibleEntityToken!,
    validate: api.validateVisibleEntityToken!,
  };
}

describe("visible entity identity token", () => {
  it("parses canonical ordinary object and artifact tokens", () => {
    const { parse } = visibleEntityTokenApi();

    expect(parse("object:KATANA")).toBe("object:KATANA");
    expect(parse("artifact:ART_EXCALIBUR"))
      .toBe("artifact:ART_EXCALIBUR");
  });

  it("rejects malformed token shapes", () => {
    const { parse } = visibleEntityTokenApi();
    const malformed = [
      null,
      "",
      "object:katana",
      "object:",
      "object:../KATANA",
      "object:KATANA ",
      "monster:PM_SAMURAI",
      `object:${"A".repeat(160)}`,
    ];

    for (const token of malformed) {
      expect(parse(token)).toBeNull();
    }
  });

  it("accepts a known object matching the exact displayed glyph identity", () => {
    const { validate } = visibleEntityTokenApi();

    expect(validate("object:KATANA", {
      displayedObjectId: "object:KATANA",
      knownObjectIds: KNOWN_OBJECT_IDS,
      artifactBaseObjects: ARTIFACT_BASE_OBJECTS,
    })).toBe("object:KATANA");
  });

  it("rejects malformed, unknown, and same-class mismatched objects", () => {
    const { validate } = visibleEntityTokenApi();
    const rejected = [
      "object:../KATANA",
      "object:NOT_IN_BUILD",
      "object:DAGGER",
    ];

    for (const token of rejected) {
      expect(validate(token, {
        displayedObjectId: "object:KATANA",
        knownObjectIds: KNOWN_OBJECT_IDS,
        artifactBaseObjects: ARTIFACT_BASE_OBJECTS,
      })).toBeNull();
    }
  });

  it("retains artifact validation through the generalized API", () => {
    const { validate } = visibleEntityTokenApi();

    expect(validate("artifact:ART_EXCALIBUR", {
      displayedObjectId: "object:LONG_SWORD",
      knownObjectIds: KNOWN_OBJECT_IDS,
      artifactBaseObjects: ARTIFACT_BASE_OBJECTS,
    })).toBe("artifact:ART_EXCALIBUR");
  });
});

describe("visible artifact identity token", () => {
  it("accepts only a catalog artifact token matching the displayed base object", () => {
    expect(validateVisibleArtifactToken(
      "artifact:ART_EXCALIBUR",
      "object:LONG_SWORD",
      ARTIFACT_BASE_OBJECTS,
    )).toBe("artifact:ART_EXCALIBUR");
  });

  it.each([
    ["undisclosed null", null],
    ["non-string", 17],
    ["empty", ""],
    ["object token", "object:LONG_SWORD"],
    ["lowercase symbol", "artifact:art_excalibur"],
    ["path punctuation", "artifact:ART_../EXCALIBUR"],
    ["embedded whitespace", "artifact:ART_EXCALIBUR "],
    ["non-ASCII", "artifact:ART_EXCALIBUR\u00e9"],
    ["overlong", `artifact:ART_${"A".repeat(160)}`],
    ["unknown artifact", "artifact:ART_NOT_IN_BUILD"],
  ])("rejects a %s token", (_label, token) => {
    expect(validateVisibleArtifactToken(
      token,
      "object:LONG_SWORD",
      ARTIFACT_BASE_OBJECTS,
    )).toBeNull();
  });

  it("rejects a valid artifact token for a different base object", () => {
    expect(validateVisibleArtifactToken(
      "artifact:ART_EXCALIBUR",
      "object:DAGGER",
      ARTIFACT_BASE_OBJECTS,
    )).toBeNull();
  });

  it("publishes a validated row token exactly once", () => {
    const channel = createVisibleIdentityTokenChannel({
      artifactBaseObjects: ARTIFACT_BASE_OBJECTS,
    });
    channel.publishRow({
      sessionId: "session-1",
      rowId: 4,
      baseObjectId: "object:LONG_SWORD",
      token: "artifact:ART_EXCALIBUR",
    });

    expect(channel.consumeRow({
      sessionId: "session-1",
      rowId: 4,
      baseObjectId: "object:LONG_SWORD",
    })).toBe("artifact:ART_EXCALIBUR");
    expect(channel.consumeRow({
      sessionId: "session-1",
      rowId: 4,
      baseObjectId: "object:LONG_SWORD",
    })).toBeNull();
  });

  it("publishes a validated ordinary object row token exactly once", () => {
    const createChannel = createVisibleIdentityTokenChannel as unknown as (
      options: {
        artifactBaseObjects: ReadonlyMap<string, string>;
        knownObjectIds: ReadonlySet<string>;
      },
    ) => ReturnType<typeof createVisibleIdentityTokenChannel>;
    const channel = createChannel({
      artifactBaseObjects: ARTIFACT_BASE_OBJECTS,
      knownObjectIds: KNOWN_OBJECT_IDS,
    });
    channel.publishRow({
      sessionId: "session-1",
      rowId: 5,
      baseObjectId: "object:KATANA",
      token: "object:KATANA",
    });

    expect(channel.consumeRow({
      sessionId: "session-1",
      rowId: 5,
      baseObjectId: "object:KATANA",
    })).toBe("object:KATANA");
    expect(channel.consumeRow({
      sessionId: "session-1",
      rowId: 5,
      baseObjectId: "object:KATANA",
    })).toBeNull();
  });

  it("does not expose null, malformed, unknown, or mismatched publications", () => {
    const channel = createVisibleIdentityTokenChannel({
      artifactBaseObjects: ARTIFACT_BASE_OBJECTS,
    });
    const candidates = [
      {
        rowId: 1,
        baseObjectId: "object:LONG_SWORD",
        token: null,
      },
      {
        rowId: 2,
        baseObjectId: "object:LONG_SWORD",
        token: "artifact:../../save",
      },
      {
        rowId: 3,
        baseObjectId: "object:LONG_SWORD",
        token: "artifact:ART_NOT_IN_BUILD",
      },
      {
        rowId: 4,
        baseObjectId: "object:DAGGER",
        token: "artifact:ART_EXCALIBUR",
      },
    ];

    for (const candidate of candidates) {
      channel.publishRow({
        sessionId: "session-1",
        ...candidate,
      });
      expect(channel.consumeRow({
        sessionId: "session-1",
        rowId: candidate.rowId,
        baseObjectId: candidate.baseObjectId,
      })).toBeNull();
    }
  });

  it("keeps tokens scoped to their exact row and session", () => {
    const channel = createVisibleIdentityTokenChannel({
      artifactBaseObjects: ARTIFACT_BASE_OBJECTS,
    });
    channel.publishRow({
      sessionId: "session-1",
      rowId: 7,
      baseObjectId: "object:LONG_SWORD",
      token: "artifact:ART_EXCALIBUR",
    });

    expect(channel.consumeRow({
      sessionId: "session-1",
      rowId: 8,
      baseObjectId: "object:LONG_SWORD",
    })).toBeNull();
    expect(channel.consumeRow({
      sessionId: "session-2",
      rowId: 7,
      baseObjectId: "object:LONG_SWORD",
    })).toBeNull();
    expect(channel.consumeRow({
      sessionId: "session-1",
      rowId: 7,
      baseObjectId: "object:DAGGER",
    })).toBeNull();
  });

  it("clears row metadata at the end of shim_add_menu processing", () => {
    const channel = createVisibleIdentityTokenChannel({
      artifactBaseObjects: ARTIFACT_BASE_OBJECTS,
    });
    channel.publishRow({
      sessionId: "session-1",
      rowId: 10,
      baseObjectId: "object:LONG_SWORD",
      token: "artifact:ART_EXCALIBUR",
    });
    channel.clearRow("session-1", 10);

    expect(channel.consumeRow({
      sessionId: "session-1",
      rowId: 10,
      baseObjectId: "object:LONG_SWORD",
    })).toBeNull();
  });

  it("clears every pending row owned by a reset session", () => {
    const channel = createVisibleIdentityTokenChannel({
      artifactBaseObjects: ARTIFACT_BASE_OBJECTS,
    });
    channel.publishRow({
      sessionId: "session-1",
      rowId: 1,
      baseObjectId: "object:LONG_SWORD",
      token: "artifact:ART_EXCALIBUR",
    });
    channel.publishRow({
      sessionId: "session-1",
      rowId: 2,
      baseObjectId: "object:BATTLE_AXE",
      token: "artifact:ART_CLEAVER",
    });
    channel.publishRow({
      sessionId: "session-2",
      rowId: 1,
      baseObjectId: "object:BATTLE_AXE",
      token: "artifact:ART_CLEAVER",
    });

    channel.clearSession("session-1");

    expect(channel.consumeRow({
      sessionId: "session-1",
      rowId: 1,
      baseObjectId: "object:LONG_SWORD",
    })).toBeNull();
    expect(channel.consumeRow({
      sessionId: "session-1",
      rowId: 2,
      baseObjectId: "object:BATTLE_AXE",
    })).toBeNull();
    expect(channel.consumeRow({
      sessionId: "session-2",
      rowId: 1,
      baseObjectId: "object:BATTLE_AXE",
    })).toBe("artifact:ART_CLEAVER");
  });
});

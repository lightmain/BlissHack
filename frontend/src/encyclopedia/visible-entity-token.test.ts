import { describe, expect, it } from "vitest";
import {
  createVisibleIdentityTokenChannel,
  validateVisibleArtifactToken,
} from "./visible-entity-token";

const ARTIFACT_BASE_OBJECTS = new Map([
  ["artifact:ART_EXCALIBUR", "object:LONG_SWORD"],
  ["artifact:ART_CLEAVER", "object:BATTLE_AXE"],
]);

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

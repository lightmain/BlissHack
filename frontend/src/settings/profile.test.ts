import { describe, expect, it } from "vitest";
import {
  createDefaultProfile,
  createProfileExport,
  MESSAGE_HISTORY_LINES,
  migrateProfileDocument,
  NUMBER_PAD_MODES,
  parseProfileImport,
  parseStoredProfile,
  PICKUP_CLASS_SYMBOLS,
  PROFILE_IMPORT_MAX_BYTES,
  ProfileFormatError,
  serializeProfileExport,
  TERMINAL_FONT_SIZES,
  validateProfile,
} from "./profile";

const encoder = new TextEncoder();

function setMapRenderer(
  profile: ReturnType<typeof createDefaultProfile>,
  mapRenderer: "tiles" | "ascii",
): void {
  (profile.interface as unknown as Record<string, unknown>).mapRenderer =
    mapRenderer;
}

function createLegacyProfile(): Record<string, unknown> {
  const profile = createDefaultProfile() as unknown as {
    schemaVersion: number;
    interface: Record<string, unknown>;
    nethack: Record<string, unknown>;
  };
  profile.schemaVersion = 1;
  delete profile.interface.mapRenderer;
  return profile as unknown as Record<string, unknown>;
}

function expectProfileError(
  action: () => unknown,
  code: ProfileFormatError["code"],
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ProfileFormatError);
    expect((error as ProfileFormatError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ProfileFormatError with code ${code}`);
}

describe("profile document migration", () => {
  it("strictly migrates schema v1 to current v2 with ASCII display", () => {
    const legacy = createLegacyProfile();
    const expected = createDefaultProfile();
    expected.interface.mapRenderer = "ascii";

    expect(migrateProfileDocument(legacy)).toEqual(expected);

    (legacy.interface as Record<string, unknown>).mapRenderer = "tiles";
    expectProfileError(
      () => migrateProfileDocument(legacy),
      "invalid-profile",
    );
  });

  it("strictly validates schema v2 and returns a detached value", () => {
    const current = createDefaultProfile();
    const migrated = migrateProfileDocument(current);

    expect(migrated).toEqual(current);
    expect(migrated).not.toBe(current);
    expect(migrated.interface).not.toBe(current.interface);
    expect(migrated.nethack).not.toBe(current.nethack);
    expect(migrated.nethack.pickupTypes)
      .not.toBe(current.nethack.pickupTypes);

    (current.interface as unknown as Record<string, unknown>).legacy = true;
    expectProfileError(
      () => migrateProfileDocument(current),
      "invalid-profile",
    );
  });

  it("rejects unknown versions before reading migration fields", () => {
    let migrationFieldReads = 0;
    const unknownVersion = {
      schemaVersion: 3,
      get interface(): unknown {
        migrationFieldReads += 1;
        return {};
      },
      get nethack(): unknown {
        migrationFieldReads += 1;
        return {};
      },
    };

    expectProfileError(
      () => migrateProfileDocument(unknownVersion),
      "unsupported-schema",
    );
    expect(migrationFieldReads).toBe(0);
  });
});

describe("profile defaults and validation", () => {
  it("returns the reviewed defaults as independent objects", () => {
    const first = createDefaultProfile();
    const second = createDefaultProfile();

    expect(first).toEqual({
      schemaVersion: 2,
      interface: {
        mapRenderer: "tiles",
        terminalFontSize: "medium",
        messageHistoryLines: 5,
        followPlayer: true,
        permanentInventoryPosition: "right",
        permanentInventoryCollapsed: false,
      },
      nethack: {
        tutorial: true,
        autopickup: true,
        pickupTypes: { mode: "all" },
        numberPad: 0,
        safePet: true,
        sortpack: true,
        showExperience: false,
        showTime: false,
        permInvent: false,
        perminvMode: "all",
      },
    });
    first.interface.terminalFontSize = "large";
    expect(second.interface.terminalFontSize).toBe("medium");
  });

  it.each(["tiles", "ascii"] as const)(
    "accepts map renderer %s in a strict v2 profile",
    (mapRenderer) => {
      const profile = createDefaultProfile();
      setMapRenderer(profile, mapRenderer);

      expect(validateProfile(profile).interface).toMatchObject({
        mapRenderer,
      });
    },
  );

  it.each(TERMINAL_FONT_SIZES)(
    "accepts terminal font size %s",
    (terminalFontSize) => {
      const profile = createDefaultProfile();
      profile.interface.terminalFontSize = terminalFontSize;

      expect(validateProfile(profile).interface.terminalFontSize)
        .toBe(terminalFontSize);
    },
  );

  it.each(MESSAGE_HISTORY_LINES)(
    "accepts message history height %s",
    (messageHistoryLines) => {
      const profile = createDefaultProfile();
      profile.interface.messageHistoryLines = messageHistoryLines;

      expect(validateProfile(profile).interface.messageHistoryLines)
        .toBe(messageHistoryLines);
    },
  );

  it.each(NUMBER_PAD_MODES)(
    "accepts number_pad mode %s",
    (numberPad) => {
      const profile = createDefaultProfile();
      profile.nethack.numberPad = numberPad;

      expect(validateProfile(profile).nethack.numberPad).toBe(numberPad);
    },
  );

  it.each([
    ["right", true],
    ["below", false],
  ] as const)(
    "accepts permanent inventory position %s with collapsed=%s",
    (permanentInventoryPosition, permanentInventoryCollapsed) => {
      const profile = createDefaultProfile();
      profile.interface.permanentInventoryPosition = permanentInventoryPosition;
      profile.interface.permanentInventoryCollapsed = permanentInventoryCollapsed;

      expect(validateProfile(profile).interface).toMatchObject({
        permanentInventoryPosition,
        permanentInventoryCollapsed,
      });
    },
  );

  it.each(["all", "full", "in-use"] as const)(
    "accepts permanent inventory mode %s",
    (perminvMode) => {
      const profile = createDefaultProfile();
      profile.nethack.permInvent = true;
      profile.nethack.perminvMode = perminvMode;

      expect(validateProfile(profile).nethack).toMatchObject({
        permInvent: true,
        perminvMode,
      });
    },
  );

  it("canonicalizes selected pickup classes into inventory order", () => {
    const profile = createDefaultProfile();
    profile.nethack.pickupTypes = {
      mode: "selected",
      classes: ["_", "$", ")", "\""],
    };

    expect(validateProfile(profile).nethack.pickupTypes).toEqual({
      mode: "selected",
      classes: ["$", "\"", ")", "_"],
    });
  });

  it.each([
    ["missing field", (profile: Record<string, unknown>) => {
      delete (profile.interface as Record<string, unknown>).followPlayer;
    }],
    ["missing map renderer", (profile: Record<string, unknown>) => {
      delete (profile.interface as Record<string, unknown>).mapRenderer;
    }],
    ["unknown field", (profile: Record<string, unknown>) => {
      (profile.nethack as Record<string, unknown>).unknown = true;
    }],
    ["wrong boolean type", (profile: Record<string, unknown>) => {
      (profile.nethack as Record<string, unknown>).safePet = "yes";
    }],
    ["invalid font enum", (profile: Record<string, unknown>) => {
      (profile.interface as Record<string, unknown>).terminalFontSize = "huge";
    }],
    ["invalid map renderer", (profile: Record<string, unknown>) => {
      (profile.interface as Record<string, unknown>).mapRenderer = "unicode";
    }],
    ["invalid number_pad mode", (profile: Record<string, unknown>) => {
      (profile.nethack as Record<string, unknown>).numberPad = 5;
    }],
    ["invalid inventory position", (profile: Record<string, unknown>) => {
      (profile.interface as Record<string, unknown>).permanentInventoryPosition = "left";
    }],
    ["obsolete inventory width", (profile: Record<string, unknown>) => {
      (profile.interface as Record<string, unknown>).permanentInventoryWidth = "wide";
    }],
    ["invalid collapsed type", (profile: Record<string, unknown>) => {
      (profile.interface as Record<string, unknown>).permanentInventoryCollapsed = "no";
    }],
    ["invalid permanent inventory toggle", (profile: Record<string, unknown>) => {
      (profile.nethack as Record<string, unknown>).permInvent = 1;
    }],
    ["invalid permanent inventory mode", (profile: Record<string, unknown>) => {
      (profile.nethack as Record<string, unknown>).perminvMode = "gold";
    }],
    ["empty selected pickup classes", (profile: Record<string, unknown>) => {
      (profile.nethack as Record<string, unknown>).pickupTypes = {
        mode: "selected",
        classes: [],
      };
    }],
    ["duplicate pickup class", (profile: Record<string, unknown>) => {
      (profile.nethack as Record<string, unknown>).pickupTypes = {
        mode: "selected",
        classes: ["$", "$"],
      };
    }],
    ["unknown pickup class", (profile: Record<string, unknown>) => {
      (profile.nethack as Record<string, unknown>).pickupTypes = {
        mode: "selected",
        classes: [":"],
      };
    }],
  ])("rejects a profile with %s", (_name, mutate) => {
    const profile = createDefaultProfile() as unknown as Record<string, unknown>;
    mutate(profile);

    expect(() => validateProfile(profile)).toThrow(ProfileFormatError);
  });

  it("rejects malformed JSON and unsupported schema versions distinctly", () => {
    expectProfileError(() => parseStoredProfile("{bad"), "invalid-json");
    expectProfileError(() => parseStoredProfile(JSON.stringify({
      ...createDefaultProfile(),
      schemaVersion: 3,
    })), "unsupported-schema");
  });

  it("strictly rejects the pre-permanent-inventory schema 1 shape", () => {
    const oldProfile = createLegacyProfile() as unknown as {
      interface: Record<string, unknown>;
      nethack: Record<string, unknown>;
    };
    delete oldProfile.interface.permanentInventoryPosition;
    delete oldProfile.interface.permanentInventoryCollapsed;
    delete oldProfile.nethack.permInvent;
    delete oldProfile.nethack.perminvMode;

    expect(() => validateProfile(oldProfile)).toThrow(ProfileFormatError);
  });

  it("validates every supported pickup class", () => {
    const profile = createDefaultProfile();
    profile.nethack.pickupTypes = {
      mode: "selected",
      classes: [...PICKUP_CLASS_SYMBOLS],
    };

    expect(validateProfile(profile).nethack.pickupTypes).toEqual(
      profile.nethack.pickupTypes,
    );
  });
});

describe("profile import and export", () => {
  it("serializes deterministic metadata and round-trips strict UTF-8", () => {
    const profile = createDefaultProfile();
    const exportedAt = new Date("2026-09-06T12:34:56.789Z");
    const json = serializeProfileExport(profile, "prealpha-3", exportedAt);

    expect(json.endsWith("\n")).toBe(true);
    expect(json).not.toContain("\r");
    expect(JSON.parse(json)).toMatchObject({
      schemaVersion: 2,
      interface: {
        mapRenderer: "tiles",
      },
    });
    expect(parseProfileImport(encoder.encode(json))).toEqual({
      schemaVersion: 2,
      productVersion: "prealpha-3",
      exportedAt: "2026-09-06T12:34:56.789Z",
      interface: profile.interface,
      nethack: profile.nethack,
    });
  });

  it("imports a strict v1 export as an in-memory v2 ASCII profile", () => {
    const document = {
      ...createLegacyProfile(),
      productVersion: "prealpha-3",
      exportedAt: "2026-09-06T12:34:56.789Z",
    };

    expect(parseProfileImport(
      encoder.encode(JSON.stringify(document)),
    )).toMatchObject({
      schemaVersion: 2,
      productVersion: "prealpha-3",
      interface: {
        mapRenderer: "ascii",
      },
    });
  });

  it("rejects unknown export fields and non-canonical timestamps", () => {
    const document = createProfileExport(
      createDefaultProfile(),
      "prealpha-3",
      new Date("2026-09-06T12:34:56.789Z"),
    ) as unknown as Record<string, unknown>;
    document.extra = true;
    expectProfileError(() => parseProfileImport(
      encoder.encode(JSON.stringify(document)),
    ), "invalid-profile");

    delete document.extra;
    document.exportedAt = "2026-09-06";
    expectProfileError(() => parseProfileImport(
      encoder.encode(JSON.stringify(document)),
    ), "invalid-profile");
  });

  it("rejects a schema 1 profile export using the old field set", () => {
    const document = createProfileExport(
      createDefaultProfile(),
      "prealpha-3",
      new Date("2026-09-06T12:34:56.789Z"),
    ) as unknown as {
      schemaVersion: number;
      interface: Record<string, unknown>;
      nethack: Record<string, unknown>;
    };
    document.schemaVersion = 1;
    delete document.interface.mapRenderer;
    delete document.interface.permanentInventoryPosition;
    delete document.interface.permanentInventoryCollapsed;
    delete document.nethack.permInvent;
    delete document.nethack.perminvMode;

    expectProfileError(
      () => parseProfileImport(encoder.encode(JSON.stringify(document))),
      "invalid-profile",
    );
  });

  it("rejects oversized, BOM-prefixed, NUL, and invalid UTF-8 documents", () => {
    expectProfileError(() => parseProfileImport(
      new Uint8Array(PROFILE_IMPORT_MAX_BYTES + 1),
    ), "file-too-large");
    expectProfileError(() => parseProfileImport(
      encoder.encode("\uFEFF{}"),
    ), "invalid-encoding");
    expectProfileError(() => parseProfileImport(
      encoder.encode("{\0}"),
    ), "invalid-encoding");
    expectProfileError(() => parseProfileImport(
      Uint8Array.of(0xff),
    ), "invalid-encoding");
  });
});

import { describe, expect, it, vi } from "vitest";
import { createDefaultProfile } from "./profile";
import {
  createProfileStore,
  PROFILE_STORAGE_KEY,
  ProfileStaleError,
  type ProfileStorage,
} from "./profile-store";

const V4_PROFILE_STORAGE_KEY = "blisshack.profile.v4";
const V3_PROFILE_STORAGE_KEY = "blisshack.profile.v3";
const V2_PROFILE_STORAGE_KEY = "blisshack.profile.v2";
const V1_PROFILE_STORAGE_KEY = "blisshack.profile.v1";

function profileDocument(schemaVersion: 1 | 2 | 3 | 4): Record<string, unknown> {
  const profile = createDefaultProfile() as unknown as {
    schemaVersion: number;
    interface: Record<string, unknown>;
  };
  profile.schemaVersion = schemaVersion;
  if (schemaVersion === 1) delete profile.interface.mapRenderer;
  if (schemaVersion <= 2) {
    delete profile.interface.informationLevel;
    delete profile.interface.endgameStyle;
    delete profile.interface.characterSetupStyle;
  } else if (schemaVersion === 3) {
    profile.interface.informationLevel = "original";
    profile.interface.endgameStyle = "original";
    profile.interface.characterSetupStyle = "original";
  }
  if (schemaVersion <= 3) {
    delete profile.interface.actionBarStyle;
    delete profile.interface.actionBarLayout;
  }
  return profile as unknown as Record<string, unknown>;
}

function memoryStorage(
  initial: Readonly<Record<string, string>> = {},
): ProfileStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe("profile store loading", () => {
  it("uses the v4 profile key", () => {
    expect(PROFILE_STORAGE_KEY).toBe(V4_PROFILE_STORAGE_KEY);
  });

  it("returns fresh defaults without writing when the key is missing", () => {
    const storage = memoryStorage();
    const store = createProfileStore(storage);

    const result = store.load();

    expect(result).toEqual({
      profile: createDefaultProfile(),
      status: "missing",
    });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("loads and detaches a valid persisted profile", () => {
    const persisted = profileDocument(4);
    (persisted.interface as Record<string, unknown>).terminalFontSize = "large";
    const storage = memoryStorage({
      [PROFILE_STORAGE_KEY]: JSON.stringify(persisted),
    });
    const store = createProfileStore(storage);

    const first = store.load();
    first.profile.interface.terminalFontSize = "small";
    const second = store.load();

    expect(first.status).toBe("loaded");
    expect(second.profile.interface.terminalFontSize).toBe("large");
  });

  it("prefers v4 and does not inspect older keys when all keys exist", () => {
    const current = profileDocument(4);
    (current.interface as Record<string, unknown>).terminalFontSize = "large";
    const v2 = profileDocument(2);
    (v2.interface as Record<string, unknown>).terminalFontSize = "medium";
    const v1 = profileDocument(1);
    (v1.interface as Record<string, unknown>).terminalFontSize = "small";
    const storage = memoryStorage({
      [V4_PROFILE_STORAGE_KEY]: JSON.stringify(current),
      [V3_PROFILE_STORAGE_KEY]: JSON.stringify(profileDocument(3)),
      [V2_PROFILE_STORAGE_KEY]: JSON.stringify(v2),
      [V1_PROFILE_STORAGE_KEY]: JSON.stringify(v1),
    });

    const result = createProfileStore(storage).load();

    expect(result.status).toBe("loaded");
    expect(result.profile).toMatchObject({
      schemaVersion: 4,
      interface: {
        mapRenderer: "tiles",
        terminalFontSize: "large",
      },
    });
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(storage.getItem).toHaveBeenCalledWith(V4_PROFILE_STORAGE_KEY);
  });

  it("loads and migrates the v3 fallback before consulting v2 or v1", () => {
    const v3 = profileDocument(3);
    (v3.interface as Record<string, unknown>).terminalFontSize = "large";
    const storage = memoryStorage({
      [V3_PROFILE_STORAGE_KEY]: JSON.stringify(v3),
      [V2_PROFILE_STORAGE_KEY]: JSON.stringify(profileDocument(2)),
      [V1_PROFILE_STORAGE_KEY]: JSON.stringify(profileDocument(1)),
    });

    expect(createProfileStore(storage).load()).toMatchObject({
      status: "loaded",
      profile: {
        schemaVersion: 4,
        interface: {
          terminalFontSize: "large",
          actionBarStyle: "original",
          actionBarLayout: {
            rows: 2,
            locked: true,
            activeCategory: "all",
          },
        },
      },
    });
    expect(storage.getItem).toHaveBeenNthCalledWith(1, V4_PROFILE_STORAGE_KEY);
    expect(storage.getItem).toHaveBeenNthCalledWith(2, V3_PROFILE_STORAGE_KEY);
    expect(storage.getItem).toHaveBeenCalledTimes(2);
  });

  it("loads and migrates the v2 fallback before consulting v1", () => {
    const v2 = profileDocument(2);
    (v2.interface as Record<string, unknown>).terminalFontSize = "large";
    const storage = memoryStorage({
      [V2_PROFILE_STORAGE_KEY]: JSON.stringify(v2),
      [V1_PROFILE_STORAGE_KEY]: JSON.stringify(profileDocument(1)),
    });

    expect(createProfileStore(storage).load()).toMatchObject({
      status: "loaded",
      profile: {
        schemaVersion: 4,
        interface: {
          mapRenderer: "tiles",
          terminalFontSize: "large",
          informationLevel: "original",
          endgameStyle: "original",
          characterSetupStyle: "original",
          actionBarStyle: "original",
        },
      },
    });
    expect(storage.getItem).toHaveBeenNthCalledWith(1, V4_PROFILE_STORAGE_KEY);
    expect(storage.getItem).toHaveBeenNthCalledWith(2, V3_PROFILE_STORAGE_KEY);
    expect(storage.getItem).toHaveBeenNthCalledWith(3, V2_PROFILE_STORAGE_KEY);
    expect(storage.getItem).toHaveBeenCalledTimes(3);
  });

  it("loads and migrates the v1 fallback only when v4-v2 are absent", () => {
    const storage = memoryStorage({
      [V1_PROFILE_STORAGE_KEY]: JSON.stringify(profileDocument(1)),
    });

    expect(createProfileStore(storage).load()).toMatchObject({
      status: "loaded",
      profile: {
        schemaVersion: 4,
        interface: {
          mapRenderer: "ascii",
          informationLevel: "original",
          endgameStyle: "original",
          characterSetupStyle: "original",
          actionBarStyle: "original",
        },
      },
    });
    expect(storage.getItem).toHaveBeenNthCalledWith(1, V4_PROFILE_STORAGE_KEY);
    expect(storage.getItem).toHaveBeenNthCalledWith(2, V3_PROFILE_STORAGE_KEY);
    expect(storage.getItem).toHaveBeenNthCalledWith(3, V2_PROFILE_STORAGE_KEY);
    expect(storage.getItem).toHaveBeenNthCalledWith(4, V1_PROFILE_STORAGE_KEY);
  });

  it("does not fall back when the v4 key exists but is invalid", () => {
    const storage = memoryStorage({
      [V4_PROFILE_STORAGE_KEY]: "{bad",
      [V3_PROFILE_STORAGE_KEY]: JSON.stringify(profileDocument(3)),
      [V2_PROFILE_STORAGE_KEY]: JSON.stringify(profileDocument(2)),
      [V1_PROFILE_STORAGE_KEY]: JSON.stringify(profileDocument(1)),
    });

    expect(createProfileStore(storage).load().status).toBe("invalid");
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });

  it("falls back only while a newer key is absent, never when it is invalid", () => {
    const storage = memoryStorage({
      [V3_PROFILE_STORAGE_KEY]: "{bad",
      [V2_PROFILE_STORAGE_KEY]: JSON.stringify(profileDocument(2)),
      [V1_PROFILE_STORAGE_KEY]: JSON.stringify(profileDocument(1)),
    });

    expect(createProfileStore(storage).load().status).toBe("invalid");
    expect(storage.getItem).toHaveBeenNthCalledWith(1, V4_PROFILE_STORAGE_KEY);
    expect(storage.getItem).toHaveBeenNthCalledWith(2, V3_PROFILE_STORAGE_KEY);
    expect(storage.getItem).toHaveBeenCalledTimes(2);
  });

  it("falls back without overwriting malformed or unsupported data", () => {
    const malformed = memoryStorage({
      [PROFILE_STORAGE_KEY]: "{bad",
    });
    const unsupported = memoryStorage({
      [PROFILE_STORAGE_KEY]: JSON.stringify({
        ...createDefaultProfile(),
        schemaVersion: 5,
      }),
    });

    expect(createProfileStore(malformed).load().status).toBe("invalid");
    expect(createProfileStore(unsupported).load().status)
      .toBe("unsupported-schema");
    expect(malformed.setItem).not.toHaveBeenCalled();
    expect(unsupported.setItem).not.toHaveBeenCalled();
  });

  it("reports unavailable storage for a null adapter or read failure", () => {
    const throwingStorage: ProfileStorage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(),
    };

    expect(createProfileStore(null).load().status).toBe("unavailable");
    expect(createProfileStore(throwingStorage).load().status)
      .toBe("unavailable");
  });
});

describe("profile store replacement", () => {
  it("clears all profile version keys and returns fresh defaults", () => {
    const storage = memoryStorage({
      [V4_PROFILE_STORAGE_KEY]: JSON.stringify(profileDocument(4)),
      [V3_PROFILE_STORAGE_KEY]: JSON.stringify(profileDocument(3)),
      [V2_PROFILE_STORAGE_KEY]: JSON.stringify(profileDocument(2)),
      [V1_PROFILE_STORAGE_KEY]: JSON.stringify(profileDocument(1)),
    });
    storage.values.set("unrelated", "keep");
    const store = createProfileStore(storage);

    expect(store.clear()).toEqual(createDefaultProfile());
    expect(storage.values.has(V4_PROFILE_STORAGE_KEY)).toBe(false);
    expect(storage.values.has(V3_PROFILE_STORAGE_KEY)).toBe(false);
    expect(storage.values.has(V2_PROFILE_STORAGE_KEY)).toBe(false);
    expect(storage.values.has(V1_PROFILE_STORAGE_KEY)).toBe(false);
    expect(storage.values.get("unrelated")).toBe("keep");
  });

  it("validates and saves a complete v4 record with one setItem", () => {
    const storage = memoryStorage();
    const store = createProfileStore(storage);
    const profile = createDefaultProfile();
    const profileRecord = profile as unknown as {
      schemaVersion: number;
      interface: Record<string, unknown>;
    };
    profileRecord.schemaVersion = 4;
    profileRecord.interface.informationLevel = "detailed";
    profileRecord.interface.endgameStyle = "blisshack";
    profileRecord.interface.characterSetupStyle = "blisshack";
    profileRecord.interface.actionBarStyle = "blisshack";
    profile.nethack.showTime = true;

    const saved = store.replace(profile);

    expect(saved).toEqual(profile);
    expect(saved).not.toBe(profile);
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(storage.setItem).toHaveBeenCalledWith(
      PROFILE_STORAGE_KEY,
      JSON.stringify(profile),
    );
    expect(JSON.parse(storage.values.get(PROFILE_STORAGE_KEY) ?? "{}"))
      .toMatchObject({
        schemaVersion: 4,
        interface: {
          informationLevel: "detailed",
          endgameStyle: "blisshack",
          characterSetupStyle: "blisshack",
          actionBarStyle: "blisshack",
        },
      });
  });

  it("rejects an invalid record before touching storage", () => {
    const storage = memoryStorage();
    const store = createProfileStore(storage);
    const profile = createDefaultProfile() as unknown as Record<string, unknown>;
    (profile.interface as Record<string, unknown>).messageHistoryLines = 4;

    expect(() => store.replace(profile as never)).toThrow(/messageHistoryLines/);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("propagates write failures and refuses an unavailable adapter", () => {
    const profile = createDefaultProfile();
    const persisted = JSON.stringify(profile);
    const values = new Map([[V4_PROFILE_STORAGE_KEY, persisted]]);
    const throwingStorage: ProfileStorage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn(() => {
        throw new Error("quota exceeded");
      }),
    };

    expect(() => createProfileStore(throwingStorage).replace(profile))
      .toThrow("quota exceeded");
    expect(() => createProfileStore(null).replace(profile))
      .toThrow("unavailable");
    expect(values.get(V4_PROFILE_STORAGE_KEY)).toBe(persisted);
  });
});

describe("ProfileStaleError", () => {
  it("retains the authoritative profile for an explicit retry", () => {
    const latest = createDefaultProfile();
    latest.interface.terminalFontSize = "large";

    const error = new ProfileStaleError(latest);

    expect(error.latestProfile).toBe(latest);
    expect(error.message).toBe(
      "The saved profile changed after Settings was opened",
    );
  });
});

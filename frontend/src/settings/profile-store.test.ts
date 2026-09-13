import { describe, expect, it, vi } from "vitest";
import { createDefaultProfile } from "./profile";
import {
  createProfileStore,
  PROFILE_STORAGE_KEY,
  ProfileStaleError,
  type ProfileStorage,
} from "./profile-store";

const LEGACY_PROFILE_STORAGE_KEY = "blisshack.profile.v1";

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
  it("uses the v2 profile key", () => {
    expect(PROFILE_STORAGE_KEY).toBe("blisshack.profile.v2");
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
    const persisted = createDefaultProfile();
    persisted.interface.terminalFontSize = "large";
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

  it("prefers the v2 key when both profile versions are present", () => {
    const current = createDefaultProfile() as unknown as {
      schemaVersion: number;
      interface: Record<string, unknown>;
    };
    current.schemaVersion = 2;
    current.interface.mapRenderer = "tiles";
    current.interface.terminalFontSize = "large";
    const legacy = createDefaultProfile() as unknown as {
      schemaVersion: number;
      interface: Record<string, unknown>;
    };
    legacy.schemaVersion = 1;
    delete legacy.interface.mapRenderer;
    legacy.interface.terminalFontSize = "small";
    const storage = memoryStorage({
      "blisshack.profile.v2": JSON.stringify(current),
      [LEGACY_PROFILE_STORAGE_KEY]: JSON.stringify(legacy),
    });

    const result = createProfileStore(storage).load();

    expect(result.status).toBe("loaded");
    expect(result.profile).toMatchObject({
      schemaVersion: 2,
      interface: {
        mapRenderer: "tiles",
        terminalFontSize: "large",
      },
    });
  });

  it("loads and migrates the v1 fallback as a v2 ASCII profile", () => {
    const legacy = createDefaultProfile() as unknown as {
      schemaVersion: number;
      interface: Record<string, unknown>;
    };
    legacy.schemaVersion = 1;
    delete legacy.interface.mapRenderer;
    const storage = memoryStorage({
      [LEGACY_PROFILE_STORAGE_KEY]: JSON.stringify(legacy),
    });

    expect(createProfileStore(storage).load()).toMatchObject({
      status: "loaded",
      profile: {
        schemaVersion: 2,
        interface: {
          mapRenderer: "ascii",
        },
      },
    });
  });

  it("falls back without overwriting malformed or unsupported data", () => {
    const malformed = memoryStorage({
      [PROFILE_STORAGE_KEY]: "{bad",
    });
    const unsupported = memoryStorage({
      [PROFILE_STORAGE_KEY]: JSON.stringify({
        ...createDefaultProfile(),
        schemaVersion: 3,
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
  it("clears both profile keys and returns fresh defaults", () => {
    const storage = memoryStorage({
      "blisshack.profile.v2": JSON.stringify(createDefaultProfile()),
      [LEGACY_PROFILE_STORAGE_KEY]: JSON.stringify(createDefaultProfile()),
    });
    storage.values.set("unrelated", "keep");
    const store = createProfileStore(storage);

    expect(store.clear()).toEqual(createDefaultProfile());
    expect(storage.values.has("blisshack.profile.v2")).toBe(false);
    expect(storage.values.has(LEGACY_PROFILE_STORAGE_KEY)).toBe(false);
    expect(storage.values.get("unrelated")).toBe("keep");
  });

  it("validates and replaces the complete record with one setItem", () => {
    const storage = memoryStorage();
    const store = createProfileStore(storage);
    const profile = createDefaultProfile();
    profile.nethack.showTime = true;

    const saved = store.replace(profile);

    expect(saved).toEqual(profile);
    expect(saved).not.toBe(profile);
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(storage.setItem).toHaveBeenCalledWith(
      PROFILE_STORAGE_KEY,
      JSON.stringify(profile),
    );
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
    const throwingStorage: ProfileStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new Error("quota exceeded");
      }),
    };

    expect(() => createProfileStore(throwingStorage).replace(profile))
      .toThrow("quota exceeded");
    expect(() => createProfileStore(null).replace(profile))
      .toThrow("unavailable");
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

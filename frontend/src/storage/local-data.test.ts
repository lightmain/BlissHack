import { describe, expect, it, vi } from "vitest";
import { DIAGNOSTIC_STORAGE_KEY } from "../diagnostics/diagnostic-log";
import { PROFILE_STORAGE_KEY } from "../settings/profile-store";
import { createLocalDataStore } from "./local-data";

describe("managed local data", () => {
  it("clears and restores every BlissHack-owned profile key and diagnostics", () => {
    const values = new Map<string, string>([
      ["blisshack.profile.v3", "profile-v3"],
      ["blisshack.profile.v2", "profile-v2"],
      ["blisshack.profile.v1", "profile-v1"],
      [DIAGNOSTIC_STORAGE_KEY, "diagnostics"],
      ["unrelated", "keep"],
    ]);
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };
    const localData = createLocalDataStore(storage);
    const snapshot = localData.snapshot();

    localData.clear();
    expect(values).toEqual(new Map([["unrelated", "keep"]]));

    localData.restore(snapshot);
    expect(values).toEqual(new Map([
      ["unrelated", "keep"],
      ["blisshack.profile.v3", "profile-v3"],
      ["blisshack.profile.v2", "profile-v2"],
      ["blisshack.profile.v1", "profile-v1"],
      [DIAGNOSTIC_STORAGE_KEY, "diagnostics"],
    ]));
    expect(storage.removeItem).not.toHaveBeenCalledWith("unrelated");
    expect(PROFILE_STORAGE_KEY).toBe("blisshack.profile.v3");
  });

  it("restores absence instead of inventing missing values", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const localData = createLocalDataStore(storage);
    const snapshot = localData.snapshot();
    values.set(PROFILE_STORAGE_KEY, "later");

    localData.restore(snapshot);

    expect(values.has(PROFILE_STORAGE_KEY)).toBe(false);
    expect(values.has(DIAGNOSTIC_STORAGE_KEY)).toBe(false);
  });
});

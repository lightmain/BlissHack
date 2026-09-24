/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createDefaultProfile } from "../../settings/profile";
import {
  createProfileStore,
  PROFILE_STORAGE_KEY,
  type ProfileStorage,
} from "../../settings/profile-store";

const ACTION_DOCK_SOURCE = readFileSync(
  new URL("./ActionDock.tsx", import.meta.url),
  "utf8",
);
const GAME_SCREEN_SOURCE = readFileSync(
  new URL("../GameScreen.tsx", import.meta.url),
  "utf8",
);
const GAME_CSS_SOURCE = readFileSync(
  new URL("../../styles/game.css", import.meta.url),
  "utf8",
);
const LAYOUT_PERSISTENCE_SOURCE = GAME_SCREEN_SOURCE.slice(
  GAME_SCREEN_SOURCE.indexOf("function setActionBarLayout"),
  GAME_SCREEN_SOURCE.indexOf(
    "const onActionRequest",
    GAME_SCREEN_SOURCE.indexOf("function setActionBarLayout"),
  ),
);

/** Create observable browser storage without introducing an action-bar key. */
function memoryStorage(): ProfileStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
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

describe("stage-five ActionDock editing contract", () => {
  it("[defect-probing] delegates Pointer Events gestures to the pure layout controller", () => {
    expect(ACTION_DOCK_SOURCE).toMatch(
      /from\s+"..\/..\/action-bar\/action-bar-layout-controller"/,
    );
    expect(ACTION_DOCK_SOURCE).toMatch(
      /\bcreateActionBarLayoutController\s*\(/,
    );
    expect(ACTION_DOCK_SOURCE).toMatch(
      /\bonPointerDown\b[\s\S]*?\bonPointerMove\b[\s\S]*?\bonPointerUp\b/,
    );
    expect(ACTION_DOCK_SOURCE).toContain('"pointer-cancel"');
    expect(ACTION_DOCK_SOURCE).toContain('"lost-pointer-capture"');
    expect(ACTION_DOCK_SOURCE).toContain('"escape"');
    expect(ACTION_DOCK_SOURCE).toContain('"blur"');
    expect(ACTION_DOCK_SOURCE).toContain('"session-reset"');
    expect(ACTION_DOCK_SOURCE).toMatch(/\bdispose\s*\(\s*\)/);

    expect(ACTION_DOCK_SOURCE).not.toMatch(/\bdraggable\s*=/);
    expect(ACTION_DOCK_SOURCE).not.toMatch(/\bonDragStart\s*=/);
    expect(ACTION_DOCK_SOURCE).not.toMatch(/\bonDrop\s*=/);
  });

  it("[defect-probing] marks only the lock tool for rejected-edit feedback", () => {
    const lockLabelIndex = ACTION_DOCK_SOURCE.indexOf(
      'label={layout.locked ? "Unlock action bar" : "Lock action bar"}',
    );
    const lockTool = ACTION_DOCK_SOURCE.slice(
      ACTION_DOCK_SOURCE.lastIndexOf("<DockTool", lockLabelIndex),
      ACTION_DOCK_SOURCE.indexOf("/>", lockLabelIndex) + 2,
    );
    expect(lockTool).toMatch(/\b(?:lockRejected|rejected)=\{/);
    expect(
      ACTION_DOCK_SOURCE.match(/\b(?:lockRejected|rejected)=\{/g) ?? [],
    ).toHaveLength(1);
    expect(ACTION_DOCK_SOURCE).toContain("data-lock-rejected");
    expect(GAME_CSS_SOURCE).toMatch(
      /\.nh-action-dock-tool\[data-lock-rejected="true"\]/,
    );
  });

  it("[defect-probing] returns profile persistence results to the dock instead of swallowing failures", () => {
    expect(ACTION_DOCK_SOURCE).toMatch(
      /\bonLayoutChange(?:\?\s*\(\s*layout:\s*ActionBarLayout\s*\)\s*:\s*Promise<ActionBarLayout>|\?\s*:\s*\(\s*layout:\s*ActionBarLayout\s*\)\s*=>\s*Promise<ActionBarLayout>)/,
    );
    expect(LAYOUT_PERSISTENCE_SOURCE).toMatch(
      /async function setActionBarLayout/,
    );
    expect(LAYOUT_PERSISTENCE_SOURCE).toMatch(/\bawait onApplyProfile\s*\(/);
    expect(LAYOUT_PERSISTENCE_SOURCE).toMatch(
      /\breturn\s+saved\.interface\.actionBarLayout\b/,
    );
    expect(LAYOUT_PERSISTENCE_SOURCE).not.toMatch(/\.catch\s*\(/);
  });
});

describe("stage-five action bar profile persistence", () => {
  it("round-trips one committed layout through the sole profile v4 key", () => {
    const storage = memoryStorage();
    const profile = createDefaultProfile();
    profile.interface.actionBarStyle = "blisshack";
    profile.interface.actionBarLayout.rows = 4;
    profile.interface.actionBarLayout.locked = false;
    profile.interface.actionBarLayout.activeCategory = "custom";
    profile.interface.actionBarLayout.all[0].columns = 3;
    profile.interface.actionBarLayout.all[0].slots = [
      "search",
      null,
      "future-action",
    ];
    profile.interface.actionBarLayout.categories.custom = [
      null,
      "kick",
      "wait",
    ];

    const saved = createProfileStore(storage).replace(profile);

    expect(storage.setItem).toHaveBeenCalledOnce();
    expect([...storage.values.keys()]).toEqual([PROFILE_STORAGE_KEY]);
    for (const lifecycle of [
      "refresh",
      "save-and-exit",
      "continue",
      "new-game",
    ]) {
      const loaded = createProfileStore(storage).load();
      expect(loaded.status, lifecycle).toBe("loaded");
      expect(loaded.profile.interface.actionBarLayout, lifecycle)
        .toEqual(saved.interface.actionBarLayout);
      expect(
        loaded.profile.interface.actionBarLayout.all[0].slots,
        lifecycle,
      ).toEqual(["search", null, "future-action"]);
      expect(
        loaded.profile.interface.actionBarLayout.categories.custom,
        lifecycle,
      ).toEqual([null, "kick", "wait"]);
    }
  });

  it("does not introduce a layout-specific storage side channel", () => {
    expect(ACTION_DOCK_SOURCE).not.toMatch(/\blocalStorage\b/);
    expect(GAME_SCREEN_SOURCE).not.toMatch(
      /blisshack\.profile\.v4\.actionBar|blisshack\.actions/,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  appReducer,
  type AppAction,
  type AppState,
} from "./app-state";

type StageTwoState =
  | {
    phase: "booting";
    moduleId: string;
    status: "loading-module" | "loading-storage";
  }
  | {
    phase: "home";
    moduleId: string;
    storageAvailable: boolean;
  }
  | {
    phase: "save-picker";
    moduleId: string;
    storageAvailable: true;
  }
  | {
    phase: "session";
    moduleId: string;
    sessionId: string;
    status: "starting" | "running" | "saving" | "exiting";
  }
  | {
    phase: "fatal";
    moduleId: string | null;
    sessionId: string | null;
    errorId: string;
  };

type StageTwoAction =
  | { type: "MODULE_LOADING"; moduleId: string }
  | { type: "STORAGE_LOADING"; moduleId: string }
  | {
    type: "HOME_READY";
    moduleId: string;
    storageAvailable: boolean;
  }
  | { type: "SAVE_PICKER_OPENED"; moduleId: string }
  | { type: "SAVE_PICKER_CLOSED"; moduleId: string }
  | {
    type: "NEW_GAME";
    moduleId: string;
    sessionId: string;
  }
  | {
    type: "CONTINUE_GAME";
    moduleId: string;
    sessionId: string;
  };

/**
 * Exercise the documented stage-two state contract before production adopts it.
 * @param state - current stage-two state.
 * @param action - lifecycle event to apply.
 * @returns reducer output interpreted through the future state contract.
 */
function reduce(
  state: StageTwoState,
  action: StageTwoAction,
): StageTwoState {
  return appReducer(
    state as unknown as AppState,
    action as unknown as AppAction,
  ) as unknown as StageTwoState;
}

describe("stage-two module lifecycle state", () => {
  it("creates, mounts, populates, and lists one module before entering home", () => {
    const loadingModule: StageTwoState = {
      phase: "booting",
      moduleId: "module-1",
      status: "loading-module",
    };

    const loadingStorage = reduce(loadingModule, {
      type: "STORAGE_LOADING",
      moduleId: "module-1",
    });
    expect(loadingStorage).toEqual({
      phase: "booting",
      moduleId: "module-1",
      status: "loading-storage",
    });

    expect(reduce(loadingStorage, {
      type: "HOME_READY",
      moduleId: "module-1",
      storageAvailable: true,
    })).toEqual({
      phase: "home",
      moduleId: "module-1",
      storageAvailable: true,
    });
  });

  it("keeps the same moduleId while opening and closing SavePicker", () => {
    const home: StageTwoState = {
      phase: "home",
      moduleId: "module-1",
      storageAvailable: true,
    };
    const picker = reduce(home, {
      type: "SAVE_PICKER_OPENED",
      moduleId: "module-1",
    });

    expect(picker).toEqual({
      phase: "save-picker",
      moduleId: "module-1",
      storageAvailable: true,
    });
    expect(reduce(picker, {
      type: "SAVE_PICKER_CLOSED",
      moduleId: "module-1",
    })).toEqual(home);
  });

  it.each([
    { type: "NEW_GAME", sessionId: "new-session" },
    { type: "CONTINUE_GAME", sessionId: "continue-session" },
  ] as const)("lets $type claim the ready module without changing moduleId", (event) => {
    const home: StageTwoState = {
      phase: "home",
      moduleId: "module-1",
      storageAvailable: true,
    };

    expect(reduce(home, {
      ...event,
      moduleId: "module-1",
    })).toEqual({
      phase: "session",
      moduleId: "module-1",
      sessionId: event.sessionId,
      status: "starting",
    });
  });

  it("rejects stale storage and picker events from another module", () => {
    const home: StageTwoState = {
      phase: "home",
      moduleId: "module-2",
      storageAvailable: true,
    };

    expect(reduce(home, {
      type: "SAVE_PICKER_OPENED",
      moduleId: "module-1",
    })).toBe(home);
    expect(reduce(home, {
      type: "HOME_READY",
      moduleId: "module-1",
      storageAvailable: false,
    })).toBe(home);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppAction } from "./app-state";
import {
  dispatchWithScreenMotion,
  screenMotionDirection,
  type ScreenMotionOptions,
} from "./ui-motion";

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

/** Create a promise whose completion order is controlled by the test. */
function deferred(): Deferred {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

/** Expose a deterministic clock without waiting for wall-clock time. */
function clockOptions(
  now: () => number,
): ScreenMotionOptions & { now(): number } {
  return { now };
}

/** Install the minimum document surface used by screen motion dispatch. */
function installDocument(startViewTransition?: (update: () => void) => {
  finished: Promise<void>;
  ready: Promise<void>;
}): {
  dataset: Record<string, string>;
} {
  const root = { dataset: {} as Record<string, string> };
  vi.stubGlobal("document", {
    documentElement: root,
    startViewTransition,
  });
  return root;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("screenMotionDirection", () => {
  it("maps lifecycle actions to their presentation direction", () => {
    expect(screenMotionDirection({
      type: "SETTINGS_OPENED",
      moduleId: "module-1",
    })).toBe("forward");
    expect(screenMotionDirection({
      type: "SESSION_CREATED",
      moduleId: "module-1",
      sessionId: "session-1",
    })).toBe("forward");
    expect(screenMotionDirection({
      type: "SESSION_RUNNING",
      sessionId: "session-1",
    })).toBeNull();
    expect(screenMotionDirection({
      type: "SETTINGS_CLOSED",
      moduleId: "module-1",
    })).toBeNull();
    expect(screenMotionDirection({
      type: "SAVE_PICKER_OPENED",
      moduleId: "module-1",
    })).toBeNull();
    expect(screenMotionDirection({
      type: "SESSION_CLEANUP_COMPLETED",
      sessionId: "session-1",
      nextModuleId: "module-2",
    })).toBeNull();
    expect(screenMotionDirection({
      type: "END_SUMMARY_CONFIRMED",
      completedSessionId: "session-1",
      storageAvailable: true,
    })).toBeNull();
    expect(screenMotionDirection({
      type: "RETURN_HOME",
      moduleId: "module-2",
    })).toBeNull();
  });

  it("maps eligible Home readiness to forward motion", () => {
    expect(screenMotionDirection({
      type: "HOME_READY",
      moduleId: "module-1",
      storageAvailable: true,
    })).toBe("forward");
  });
});

describe("dispatchWithScreenMotion", () => {
  const action = {
    type: "SETTINGS_OPENED",
    moduleId: "module-1",
  } satisfies AppAction;

  it("dispatches directly when the View Transition API is unavailable", () => {
    installDocument();
    const dispatch = vi.fn();

    dispatchWithScreenMotion(dispatch, action);

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(action);
  });

  it("dispatches directly when reduced motion is requested", () => {
    const startViewTransition = vi.fn();
    installDocument(startViewTransition);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const dispatch = vi.fn();

    dispatchWithScreenMotion(dispatch, action);

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(action);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it("dispatches HOME_READY directly when loading takes 499ms", () => {
    let now = 1_000;
    const options = clockOptions(() => now);
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
      };
    });
    const root = installDocument(startViewTransition);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const dispatch = vi.fn();
    const moduleLoading = {
      type: "MODULE_LOADING",
      moduleId: "module-fast",
    } satisfies AppAction;
    const homeReady = {
      type: "HOME_READY",
      moduleId: "module-fast",
      storageAvailable: true,
    } satisfies AppAction;

    dispatchWithScreenMotion(dispatch, moduleLoading, options);
    now += 499;
    dispatchWithScreenMotion(dispatch, homeReady, options);

    expect(dispatch).toHaveBeenNthCalledWith(1, moduleLoading);
    expect(dispatch).toHaveBeenNthCalledWith(2, homeReady);
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(root.dataset.uiMotion).toBeUndefined();
    expect(root.dataset.uiMotionShared).toBeUndefined();
  });

  it("does not transition HOME_READY for a different module", () => {
    let now = 2_000;
    const options = clockOptions(() => now);
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
      };
    });
    installDocument(startViewTransition);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const dispatch = vi.fn();
    const moduleLoading = {
      type: "MODULE_LOADING",
      moduleId: "module-old",
    } satisfies AppAction;
    const homeReady = {
      type: "HOME_READY",
      moduleId: "module-new",
      storageAvailable: true,
    } satisfies AppAction;

    dispatchWithScreenMotion(dispatch, moduleLoading, options);
    now += 500;
    dispatchWithScreenMotion(dispatch, homeReady, options);

    expect(dispatch).toHaveBeenNthCalledWith(1, moduleLoading);
    expect(dispatch).toHaveBeenNthCalledWith(2, homeReady);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it("does not transition HOME_READY without a MODULE_LOADING start", () => {
    const options = clockOptions(() => 2_500);
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
      };
    });
    installDocument(startViewTransition);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const dispatch = vi.fn();
    const homeReady = {
      type: "HOME_READY",
      moduleId: "module-untracked",
      storageAvailable: true,
    } satisfies AppAction;

    dispatchWithScreenMotion(dispatch, homeReady, options);

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(homeReady);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it("uses and clears a shared transition at the 500ms boundary", async () => {
    let now = 3_000;
    const options = clockOptions(() => now);
    const transition = deferred();
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {
        finished: transition.promise,
        ready: Promise.resolve(),
      };
    });
    const root = installDocument(startViewTransition);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const dispatch = vi.fn();
    const moduleLoading = {
      type: "MODULE_LOADING",
      moduleId: "module-boundary",
    } satisfies AppAction;
    const homeReady = {
      type: "HOME_READY",
      moduleId: "module-boundary",
      storageAvailable: true,
    } satisfies AppAction;

    dispatchWithScreenMotion(dispatch, moduleLoading, options);
    now += 500;
    dispatchWithScreenMotion(dispatch, homeReady, options);

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenNthCalledWith(1, moduleLoading);
    expect(dispatch).toHaveBeenNthCalledWith(2, homeReady);
    expect(root.dataset.uiMotion).toBe("forward");
    expect(root.dataset.uiMotionCapable).toBe("true");
    expect(root.dataset.uiMotionShared).toBe("home-dungeon");

    transition.resolve();
    await transition.promise;
    await Promise.resolve();

    expect(root.dataset.uiMotion).toBeUndefined();
    expect(root.dataset.uiMotionShared).toBeUndefined();
  });

  it("clears the shared marker when native transition startup throws", () => {
    let now = 4_000;
    const options = clockOptions(() => now);
    const startViewTransition = vi.fn(() => {
      throw new Error("transition unavailable");
    });
    const root = installDocument(startViewTransition);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const dispatch = vi.fn();
    const moduleLoading = {
      type: "MODULE_LOADING",
      moduleId: "module-throw",
    } satisfies AppAction;
    const homeReady = {
      type: "HOME_READY",
      moduleId: "module-throw",
      storageAvailable: true,
    } satisfies AppAction;

    dispatchWithScreenMotion(dispatch, moduleLoading, options);
    now += 500;
    dispatchWithScreenMotion(dispatch, homeReady, options);

    expect(dispatch).toHaveBeenNthCalledWith(1, moduleLoading);
    expect(dispatch).toHaveBeenNthCalledWith(2, homeReady);
    expect(root.dataset.uiMotion).toBeUndefined();
    expect(root.dataset.uiMotionShared).toBeUndefined();
  });

  it("does not transition HOME_READY when reduced motion is requested", () => {
    let now = 5_000;
    const options = clockOptions(() => now);
    const startViewTransition = vi.fn();
    installDocument(startViewTransition);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const dispatch = vi.fn();
    const moduleLoading = {
      type: "MODULE_LOADING",
      moduleId: "module-reduced",
    } satisfies AppAction;
    const homeReady = {
      type: "HOME_READY",
      moduleId: "module-reduced",
      storageAvailable: true,
    } satisfies AppAction;

    dispatchWithScreenMotion(dispatch, moduleLoading, options);
    now += 500;
    dispatchWithScreenMotion(dispatch, homeReady, options);

    expect(dispatch).toHaveBeenNthCalledWith(1, moduleLoading);
    expect(dispatch).toHaveBeenNthCalledWith(2, homeReady);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "Settings",
      action: {
        type: "SETTINGS_CLOSED",
        moduleId: "module-settings",
      } satisfies AppAction,
    },
    {
      name: "end summary",
      action: {
        type: "END_SUMMARY_CONFIRMED",
        completedSessionId: "session-completed",
        storageAvailable: true,
      } satisfies AppAction,
    },
  ])("dispatches a $name return to Home without a transition", ({ action }) => {
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
      };
    });
    installDocument(startViewTransition);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const dispatch = vi.fn();

    dispatchWithScreenMotion(dispatch, action);

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(action);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "Settings cleanup",
      moduleId: "module-after-settings",
      actions: [{
        type: "LOCAL_DATA_CLEARED",
        moduleId: "module-settings",
        nextModuleId: "module-after-settings",
      }] satisfies AppAction[],
    },
    {
      name: "session cleanup",
      moduleId: "module-after-session",
      actions: [{
        type: "SESSION_CLEANUP_COMPLETED",
        sessionId: "session-exited",
        nextModuleId: "module-after-session",
      }] satisfies AppAction[],
    },
    {
      name: "fatal recovery",
      moduleId: "module-after-fatal",
      actions: [
        {
          type: "MODULE_FATAL_ERROR",
          moduleId: "module-failed",
          errorId: "error-1",
        },
        {
          type: "RETURN_HOME",
          moduleId: "module-after-fatal",
        },
      ] satisfies AppAction[],
    },
  ])(
    "keeps the $name booting path direct before Home",
    ({ actions, moduleId }) => {
      let now = 6_000;
      const options = clockOptions(() => now);
      const startViewTransition = vi.fn((update: () => void) => {
        update();
        return {
          finished: Promise.resolve(),
          ready: Promise.resolve(),
        };
      });
      installDocument(startViewTransition);
      vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
      const dispatch = vi.fn();
      const moduleLoading = {
        type: "MODULE_LOADING",
        moduleId,
      } satisfies AppAction;
      const homeReady = {
        type: "HOME_READY",
        moduleId,
        storageAvailable: true,
      } satisfies AppAction;

      for (const pathAction of actions) {
        dispatchWithScreenMotion(dispatch, pathAction, options);
      }
      dispatchWithScreenMotion(dispatch, moduleLoading, options);
      now += 500;
      dispatchWithScreenMotion(dispatch, homeReady, options);

      expect(dispatch.mock.calls.map(([dispatched]) => dispatched)).toEqual([
        ...actions,
        moduleLoading,
        homeReady,
      ]);
      expect(startViewTransition).not.toHaveBeenCalled();
    },
  );

  it("consumes an overlapping transition abort without reporting it", async () => {
    const ready = Promise.reject<void>(
      new DOMException("A newer transition started", "AbortError"),
    );
    void ready.catch(() => undefined);
    const readyCatch = vi.spyOn(ready, "catch");
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {
        finished: Promise.resolve(),
        ready,
      };
    });
    installDocument(startViewTransition);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const dispatch = vi.fn();
    const onFailure = vi.fn();

    dispatchWithScreenMotion(dispatch, action, { onFailure });
    await Promise.resolve();

    expect(readyCatch).toHaveBeenCalledOnce();
    expect(readyCatch).toHaveBeenCalledWith(expect.any(Function));
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("reports and consumes a non-abort ready failure", async () => {
    const error = new Error("transition preparation failed");
    const ready = Promise.reject<void>(error);
    void ready.catch(() => undefined);
    const readyCatch = vi.spyOn(ready, "catch");
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {
        finished: Promise.resolve(),
        ready,
      };
    });
    installDocument(startViewTransition);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const dispatch = vi.fn();
    const onFailure = vi.fn();

    dispatchWithScreenMotion(dispatch, action, { onFailure });
    await Promise.resolve();

    expect(readyCatch).toHaveBeenCalledOnce();
    expect(readyCatch).toHaveBeenCalledWith(expect.any(Function));
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith({
      phase: "ready",
      error,
    });
  });

  it("consumes a non-abort ready failure when reporting throws", async () => {
    const error = new Error("transition preparation failed");
    const reportingError = new Error("failure reporting failed");
    const ready = Promise.reject<void>(error);
    const readyCatch = vi.spyOn(ready, "catch");
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {
        finished: Promise.resolve(),
        ready,
      };
    });
    installDocument(startViewTransition);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const dispatch = vi.fn();
    const onFailure = vi.fn(() => {
      throw reportingError;
    });

    dispatchWithScreenMotion(dispatch, action, { onFailure });
    await Promise.resolve();

    expect(readyCatch).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith({
      phase: "ready",
      error,
    });
  });

  it("uses one transition for session creation and the running update", async () => {
    const transition = deferred();
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {
        finished: transition.promise,
        ready: Promise.resolve(),
      };
    });
    const root = installDocument(startViewTransition);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const dispatch = vi.fn();
    const created = {
      type: "SESSION_CREATED",
      moduleId: "module-1",
      sessionId: "session-1",
    } satisfies AppAction;
    const running = {
      type: "SESSION_RUNNING",
      sessionId: "session-1",
    } satisfies AppAction;

    dispatchWithScreenMotion(dispatch, created);
    dispatchWithScreenMotion(dispatch, running);

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenNthCalledWith(1, created);
    expect(dispatch).toHaveBeenNthCalledWith(2, running);
    expect(root.dataset.uiMotion).toBe("forward");
    expect(root.dataset.uiMotionCapable).toBe("true");

    transition.resolve();
    await transition.promise;
    await Promise.resolve();

    expect(root.dataset.uiMotion).toBeUndefined();
  });

  it("preserves session event order while the transition update is pending", () => {
    let updateCallback: (() => void) | undefined;
    const startViewTransition = vi.fn((update: () => void) => {
      updateCallback = update;
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
      };
    });
    installDocument(startViewTransition);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const dispatch = vi.fn();
    const created = {
      type: "SESSION_CREATED",
      moduleId: "module-1",
      sessionId: "session-1",
    } satisfies AppAction;
    const running = {
      type: "SESSION_RUNNING",
      sessionId: "session-1",
    } satisfies AppAction;

    dispatchWithScreenMotion(dispatch, created);
    dispatchWithScreenMotion(dispatch, running);

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledTimes(0);

    updateCallback?.();

    expect(dispatch).toHaveBeenNthCalledWith(1, created);
    expect(dispatch).toHaveBeenNthCalledWith(2, running);
    expect(startViewTransition).toHaveBeenCalledOnce();
  });

  it("isolates pending lifecycle events for separate App dispatchers", () => {
    const updateCallbacks: Array<() => void> = [];
    const startViewTransition = vi.fn((update: () => void) => {
      updateCallbacks.push(update);
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
      };
    });
    installDocument(startViewTransition);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const firstDispatch = vi.fn();
    const secondDispatch = vi.fn();
    const firstCreated = {
      type: "SESSION_CREATED",
      moduleId: "module-1",
      sessionId: "session-1",
    } satisfies AppAction;
    const firstRunning = {
      type: "SESSION_RUNNING",
      sessionId: "session-1",
    } satisfies AppAction;
    const secondCreated = {
      type: "SESSION_CREATED",
      moduleId: "module-2",
      sessionId: "session-2",
    } satisfies AppAction;

    dispatchWithScreenMotion(firstDispatch, firstCreated);
    dispatchWithScreenMotion(secondDispatch, secondCreated);
    dispatchWithScreenMotion(firstDispatch, firstRunning);

    expect(startViewTransition).toHaveBeenCalledTimes(2);
    expect(firstDispatch).not.toHaveBeenCalled();
    expect(secondDispatch).not.toHaveBeenCalled();

    updateCallbacks[1]?.();
    updateCallbacks[0]?.();

    expect(secondDispatch).toHaveBeenCalledOnce();
    expect(secondDispatch).toHaveBeenCalledWith(secondCreated);
    expect(firstDispatch).toHaveBeenNthCalledWith(1, firstCreated);
    expect(firstDispatch).toHaveBeenNthCalledWith(2, firstRunning);
  });
});

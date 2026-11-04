import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppAction } from "./app-state";
import {
  dispatchWithScreenMotion,
  screenMotionDirection,
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
    })).toBe("reverse");
    expect(screenMotionDirection({
      type: "SAVE_PICKER_OPENED",
      moduleId: "module-1",
    })).toBeNull();
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
});

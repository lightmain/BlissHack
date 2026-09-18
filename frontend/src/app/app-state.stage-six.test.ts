import { describe, expect, it } from "vitest";
import {
  appReducer,
  initialAppState,
  type AppAction,
  type AppState,
} from "./app-state";
import type { EndgameSummary } from "../nethack-bridge";

type StageSixAction =
  | AppAction
  | {
    type: "SESSION_COMPLETED";
    sessionId: string;
    nextModuleId: string | null;
    summary: EndgameSummary;
  }
  | {
    type: "END_SUMMARY_CONFIRMED";
    completedSessionId: string;
    storageAvailable: boolean;
  };

interface StageSixEndSummaryState {
  phase: "end-summary";
  completedSessionId: string;
  nextModuleId: string | null;
  summary: EndgameSummary;
}

type StageSixState = AppState | StageSixEndSummaryState;

/** Build the immutable result accepted by the stage-six reducer contract. */
function endgameSummaryFixture(): EndgameSummary {
  const lines = Object.freeze([
    Object.freeze({ text: "Ada the Wizard...", attribute: 1 }),
  ]);
  const blocks = Object.freeze([
    Object.freeze({
      kind: "text" as const,
      sourceWindowId: 12,
      lines,
    }),
  ]);
  const sections = Object.freeze([
    Object.freeze({
      kind: "summary" as const,
      title: "Summary",
      blocks,
    }),
  ]);
  return Object.freeze({
    owner: Object.freeze({
      moduleId: "module-completed",
      sessionId: "session-completed",
    }),
    sections,
  });
}

/** Reduce a future stage-six action through the current production reducer. */
function reduce(
  state: StageSixState,
  action: StageSixAction,
): StageSixState {
  return appReducer(
    state as AppState,
    action as AppAction,
  ) as StageSixState;
}

/** Create one running session through existing legal lifecycle actions. */
function runningSession(sessionId = "session-completed"): AppState {
  return [
    {
      type: "MODULE_LOADING",
      moduleId: "module-completed",
    },
    {
      type: "STORAGE_LOADING",
      moduleId: "module-completed",
    },
    {
      type: "HOME_READY",
      moduleId: "module-completed",
      storageAvailable: true,
    },
    {
      type: "SESSION_CREATED",
      moduleId: "module-completed",
      sessionId,
    },
    {
      type: "SESSION_RUNNING",
      sessionId,
    },
  ].reduce(
    (state, action) => appReducer(state, action as AppAction),
    initialAppState,
  );
}

describe("alpha-2.2 stage-six app state", () => {
  it("[defect-probing] retains one immutable result after its session completes", () => {
    const summary = endgameSummaryFixture();

    const state = reduce(runningSession(), {
      type: "SESSION_COMPLETED",
      sessionId: "session-completed",
      nextModuleId: "module-next",
      summary,
    });

    expect(state).toEqual({
      phase: "end-summary",
      completedSessionId: "session-completed",
      nextModuleId: "module-next",
      summary,
    });
    expect((state as StageSixEndSummaryState).summary).toBe(summary);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.sections)).toBe(true);
  });

  it.each([
    {
      name: "a mutable result",
      createSummary: () => ({
        ...endgameSummaryFixture(),
      }),
    },
    {
      name: "a result owned by another session",
      createSummary: () => Object.freeze({
        ...endgameSummaryFixture(),
        owner: Object.freeze({
          moduleId: "module-completed",
          sessionId: "session-stale",
        }),
      }),
    },
    {
      name: "a result without a Summary section",
      createSummary: () => Object.freeze({
        ...endgameSummaryFixture(),
        sections: Object.freeze(
          endgameSummaryFixture().sections.filter(
            (section) => section.kind !== "summary",
          ),
        ),
      }),
    },
  ])("rejects $name", ({ createSummary }) => {
    const state = runningSession();

    expect(reduce(state, {
      type: "SESSION_COMPLETED",
      sessionId: "session-completed",
      nextModuleId: "module-next",
      summary: createSummary(),
    })).toBe(state);
  });

  it("ignores completion from an expired session", () => {
    const state = runningSession("session-current");

    expect(reduce(state, {
      type: "SESSION_COMPLETED",
      sessionId: "session-stale",
      nextModuleId: "module-next",
      summary: endgameSummaryFixture(),
    })).toBe(state);
  });

  it.each([
    "original mode completion",
    "ordinary quit",
    "restore failure",
  ])("does not infer a result page from %s cleanup", () => {
    const state = reduce(runningSession(), {
      type: "SESSION_EXITING",
      sessionId: "session-completed",
    });
    const cleaned = reduce(state, {
      type: "SESSION_CLEANUP_COMPLETED",
      sessionId: "session-completed",
      nextModuleId: "module-next",
    });

    expect(cleaned).toEqual({
      phase: "booting",
      moduleId: "module-next",
      status: "loading-module",
    });
    expect(cleaned.phase).not.toBe("end-summary");
  });

  it("keeps fatal completion out of the result page", () => {
    const fatal = reduce(runningSession(), {
      type: "SESSION_FATAL_ERROR",
      sessionId: "session-completed",
      errorId: "BH-STAGE6001",
    });

    expect(fatal).toEqual({
      phase: "fatal",
      moduleId: "module-completed",
      sessionId: "session-completed",
      errorId: "BH-STAGE6001",
    });
    expect(fatal.phase).not.toBe("end-summary");
  });

  it("[defect-probing] releases the result and returns Home exactly once", () => {
    const summaryState: StageSixEndSummaryState = {
      phase: "end-summary",
      completedSessionId: "session-completed",
      nextModuleId: "module-next",
      summary: endgameSummaryFixture(),
    };
    const confirmed = reduce(summaryState, {
      type: "END_SUMMARY_CONFIRMED",
      completedSessionId: "session-completed",
      storageAvailable: true,
    });

    expect(confirmed).toEqual({
      phase: "home",
      moduleId: "module-next",
      savePickerOpen: false,
      storageAvailable: true,
    });
    expect("summary" in confirmed).toBe(false);

    const duplicate = reduce(confirmed, {
      type: "END_SUMMARY_CONFIRMED",
      completedSessionId: "session-completed",
      storageAvailable: true,
    });
    expect(duplicate).toBe(confirmed);
  });

  it("ignores confirmation from an expired result", () => {
    const state: StageSixEndSummaryState = {
      phase: "end-summary",
      completedSessionId: "session-current",
      nextModuleId: "module-next",
      summary: endgameSummaryFixture(),
    };

    expect(reduce(state, {
      type: "END_SUMMARY_CONFIRMED",
      completedSessionId: "session-stale",
      storageAvailable: true,
    })).toBe(state);
  });
});

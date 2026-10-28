import { describe, expect, it, vi } from "vitest";
import type {
  AppState,
  SessionStatus,
} from "../app/app-state";
import type { GameSnapshot } from "../game-state";
import { createDesktopCloseCoordinator } from "./desktop-close";

type CloseSnapshot = Pick<
  GameSnapshot,
  "phase" | "commandInput" | "runtimeSettingsStatus"
>;

const WINDOW_CLOSE_REQUEST = Object.freeze({
  reason: "window" as const,
  requestId: 41,
});

const READY_SNAPSHOT: CloseSnapshot = Object.freeze({
  phase: "running",
  commandInput: true,
  runtimeSettingsStatus: "idle",
});

/** Build one active application session with a selectable lifecycle status. */
function sessionState(
  status: SessionStatus = "running",
  sessionId = "session-1",
): Extract<AppState, { phase: "session" }> {
  return {
    phase: "session",
    moduleId: "module-1",
    sessionId,
    status,
  };
}

/** Build a Home state representing an application with no active session. */
function homeState(): Extract<AppState, { phase: "home" }> {
  return {
    phase: "home",
    moduleId: "module-2",
    savePickerOpen: false,
    storageAvailable: true,
  };
}

/** Create a coordinator and expose its observable side-effect fakes. */
function createHarness(
  appState: AppState = sessionState(),
  gameSnapshot: CloseSnapshot | null = READY_SNAPSHOT,
) {
  const requestSaveAndExit = vi.fn(() => true);
  const respondToClose = vi.fn().mockResolvedValue(undefined);
  const coordinator = createDesktopCloseCoordinator({
    requestSaveAndExit,
    respondToClose,
  });
  coordinator.observe({ appState, gameSnapshot });
  return {
    coordinator,
    requestSaveAndExit,
    respondToClose,
  };
}

describe("desktop close coordinator", () => {
  it.each([
    {
      label: "booting",
      state: {
        phase: "booting",
        moduleId: null,
        status: "loading-module",
      } satisfies AppState,
    },
    {
      label: "home",
      state: homeState(),
    },
    {
      label: "settings",
      state: {
        phase: "settings",
        moduleId: "module-1",
        storageAvailable: true,
      } satisfies AppState,
    },
    {
      label: "end summary",
      state: {
        phase: "end-summary",
        completedSessionId: "session-1",
        nextModuleId: "module-2",
        summary: null as never,
      } satisfies AppState,
    },
    {
      label: "fatal",
      state: {
        phase: "fatal",
        moduleId: "module-1",
        sessionId: null,
        errorId: "error-1",
      } satisfies AppState,
    },
  ])("automatically approves a close while $label", ({ state }) => {
    const { coordinator, requestSaveAndExit, respondToClose } = createHarness(
      state,
      null,
    );

    coordinator.handleRequest(WINDOW_CLOSE_REQUEST);

    expect(respondToClose).toHaveBeenCalledOnce();
    expect(respondToClose).toHaveBeenCalledWith(41, "approve");
    expect(requestSaveAndExit).not.toHaveBeenCalled();
    expect(coordinator.getPrompt()).toBeNull();
  });

  it("opens one owned prompt and treats a repeated request as idempotent", () => {
    const { coordinator, requestSaveAndExit, respondToClose } = createHarness();

    coordinator.handleRequest(WINDOW_CLOSE_REQUEST);
    const firstPrompt = coordinator.getPrompt();
    coordinator.handleRequest(WINDOW_CLOSE_REQUEST);

    expect(coordinator.getPrompt()).toBe(firstPrompt);
    expect(coordinator.getPrompt()).toEqual({
      requestId: 41,
      reason: "window",
      status: "confirm",
      canSaveAndExit: true,
    });
    expect(requestSaveAndExit).not.toHaveBeenCalled();
    expect(respondToClose).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "all readiness conditions hold with idle settings",
      appState: sessionState("running"),
      gameSnapshot: READY_SNAPSHOT,
      expected: true,
    },
    {
      label: "all readiness conditions hold with applied settings",
      appState: sessionState("running"),
      gameSnapshot: {
        ...READY_SNAPSHOT,
        runtimeSettingsStatus: "applied",
      } satisfies CloseSnapshot,
      expected: true,
    },
    {
      label: "the app session is still starting",
      appState: sessionState("starting"),
      gameSnapshot: READY_SNAPSHOT,
      expected: false,
    },
    {
      label: "the app session is already saving",
      appState: sessionState("saving"),
      gameSnapshot: READY_SNAPSHOT,
      expected: false,
    },
    {
      label: "the game snapshot is not running",
      appState: sessionState("running"),
      gameSnapshot: {
        ...READY_SNAPSHOT,
        phase: "loading",
      } satisfies CloseSnapshot,
      expected: false,
    },
    {
      label: "the core is not at command input",
      appState: sessionState("running"),
      gameSnapshot: {
        ...READY_SNAPSHOT,
        commandInput: false,
      } satisfies CloseSnapshot,
      expected: false,
    },
    {
      label: "runtime settings are pending",
      appState: sessionState("running"),
      gameSnapshot: {
        ...READY_SNAPSHOT,
        runtimeSettingsStatus: "pending",
      } satisfies CloseSnapshot,
      expected: false,
    },
    {
      label: "there is no game snapshot",
      appState: sessionState("running"),
      gameSnapshot: null,
      expected: false,
    },
  ])(
    "sets Save and Exit availability when $label",
    ({ appState, gameSnapshot, expected }) => {
      const { coordinator } = createHarness(appState, gameSnapshot);

      coordinator.handleRequest(WINDOW_CLOSE_REQUEST);

      expect(coordinator.getPrompt()?.canSaveAndExit).toBe(expected);
    },
  );

  it("requests one save and approves only after that session is gone", () => {
    const { coordinator, requestSaveAndExit, respondToClose } = createHarness();
    coordinator.handleRequest(WINDOW_CLOSE_REQUEST);

    coordinator.choose(41, "save-and-exit");
    coordinator.choose(41, "save-and-exit");

    expect(requestSaveAndExit).toHaveBeenCalledOnce();
    expect(coordinator.getPrompt()).toEqual({
      requestId: 41,
      reason: "window",
      status: "saving",
      canSaveAndExit: false,
    });

    coordinator.observe({
      appState: sessionState("saving"),
      gameSnapshot: {
        ...READY_SNAPSHOT,
        commandInput: false,
      },
    });
    coordinator.observe({
      appState: sessionState("exiting"),
      gameSnapshot: {
        ...READY_SNAPSHOT,
        phase: "exited",
        commandInput: false,
      },
    });
    expect(respondToClose).not.toHaveBeenCalled();

    coordinator.observe({ appState: homeState(), gameSnapshot: null });
    coordinator.observe({ appState: homeState(), gameSnapshot: null });

    expect(respondToClose).toHaveBeenCalledOnce();
    expect(respondToClose).toHaveBeenCalledWith(41, "approve");
    expect(coordinator.getPrompt()).toBeNull();
  });

  it("keeps the confirmation open when the command boundary changed", () => {
    const { coordinator, requestSaveAndExit, respondToClose } = createHarness();
    requestSaveAndExit.mockReturnValue(false);
    coordinator.handleRequest(WINDOW_CLOSE_REQUEST);

    coordinator.choose(41, "save-and-exit");

    expect(requestSaveAndExit).toHaveBeenCalledOnce();
    expect(respondToClose).not.toHaveBeenCalled();
    expect(coordinator.getPrompt()?.status).toBe("confirm");
  });

  it("restores a prompt when the native close response fails", async () => {
    const { coordinator, respondToClose } = createHarness();
    respondToClose.mockRejectedValueOnce(new Error("IPC failed"));
    coordinator.handleRequest(WINDOW_CLOSE_REQUEST);

    coordinator.choose(41, "cancel");
    await Promise.resolve();
    await Promise.resolve();

    expect(coordinator.getPrompt()).toMatchObject({
      requestId: 41,
      status: "confirm",
    });
  });

  it("answers Cancel with cancel without sending game input", () => {
    const { coordinator, requestSaveAndExit, respondToClose } = createHarness();
    coordinator.handleRequest(WINDOW_CLOSE_REQUEST);

    coordinator.choose(41, "cancel");

    expect(respondToClose).toHaveBeenCalledOnce();
    expect(respondToClose).toHaveBeenCalledWith(41, "cancel");
    expect(requestSaveAndExit).not.toHaveBeenCalled();
    expect(coordinator.getPrompt()).toBeNull();
  });

  it("answers Discard with approve without sending game input", () => {
    const { coordinator, requestSaveAndExit, respondToClose } = createHarness();
    coordinator.handleRequest(WINDOW_CLOSE_REQUEST);

    coordinator.choose(41, "discard");

    expect(respondToClose).toHaveBeenCalledOnce();
    expect(respondToClose).toHaveBeenCalledWith(41, "approve");
    expect(requestSaveAndExit).not.toHaveBeenCalled();
    expect(coordinator.getPrompt()).toBeNull();
  });

  it("never reports approval when a save attempt enters fatal", () => {
    const { coordinator, requestSaveAndExit, respondToClose } = createHarness();
    coordinator.handleRequest(WINDOW_CLOSE_REQUEST);
    coordinator.choose(41, "save-and-exit");

    coordinator.observe({
      appState: {
        phase: "fatal",
        moduleId: "module-1",
        sessionId: "session-1",
        errorId: "save-failed",
      },
      gameSnapshot: {
        ...READY_SNAPSHOT,
        phase: "error",
        commandInput: false,
      },
    });

    expect(requestSaveAndExit).toHaveBeenCalledOnce();
    expect(respondToClose).not.toHaveBeenCalledWith(41, "approve");
  });

  it("makes a failed save recoverable when the same session becomes save-ready", () => {
    const { coordinator, respondToClose } = createHarness();
    coordinator.handleRequest(WINDOW_CLOSE_REQUEST);
    coordinator.choose(41, "save-and-exit");

    coordinator.observe({
      appState: sessionState("saving"),
      gameSnapshot: {
        ...READY_SNAPSHOT,
        commandInput: false,
      },
    });
    coordinator.observe({
      appState: sessionState("running"),
      gameSnapshot: READY_SNAPSHOT,
    });

    expect.soft(coordinator.getPrompt()?.status).toBe("save-failed");
    coordinator.choose(41, "cancel");
    expect(respondToClose).toHaveBeenCalledWith(41, "cancel");
  });

  it("ignores stale requests and choices after a newer prompt owns closing", () => {
    const { coordinator, respondToClose } = createHarness();
    coordinator.handleRequest(WINDOW_CLOSE_REQUEST);
    coordinator.choose(41, "cancel");
    coordinator.handleRequest({ reason: "quit", requestId: 42 });
    respondToClose.mockClear();

    coordinator.handleRequest(WINDOW_CLOSE_REQUEST);
    coordinator.choose(41, "discard");

    expect(respondToClose).not.toHaveBeenCalled();
    expect(coordinator.getPrompt()).toEqual({
      requestId: 42,
      reason: "quit",
      status: "confirm",
      canSaveAndExit: true,
    });
  });
});

import type { AppState } from "../app/app-state";
import type { GameSnapshot } from "../game-state";
import type {
  DesktopCloseDecision,
  DesktopCloseRequest,
} from "./desktop-api";

type CloseSnapshot = Pick<
  GameSnapshot,
  "phase" | "commandInput" | "runtimeSettingsStatus"
>;

export type DesktopCloseChoice = "cancel" | "discard" | "save-and-exit";

export interface DesktopClosePrompt extends DesktopCloseRequest {
  readonly canSaveAndExit: boolean;
  readonly status: "confirm" | "save-failed" | "saving";
}

interface DesktopCloseObservation {
  readonly appState: AppState;
  readonly gameSnapshot: CloseSnapshot | null;
}

interface DesktopCloseDependencies {
  requestSaveAndExit(): boolean;
  respondToClose(
    requestId: number,
    decision: DesktopCloseDecision,
  ): Promise<void> | void;
}

export interface DesktopCloseCoordinator {
  choose(requestId: number, choice: DesktopCloseChoice): void;
  getPrompt(): DesktopClosePrompt | null;
  handleRequest(request: DesktopCloseRequest): void;
  observe(observation: DesktopCloseObservation): void;
  subscribe(listener: () => void): () => void;
}

/** Coordinate one native close request with the authoritative game lifecycle. */
export function createDesktopCloseCoordinator(
  dependencies: DesktopCloseDependencies,
): DesktopCloseCoordinator {
  let observation: DesktopCloseObservation | null = null;
  let prompt: DesktopClosePrompt | null = null;
  let promptSessionId: string | null = null;
  let highestRequestId = 0;
  const listeners = new Set<() => void>();

  function publish(next: DesktopClosePrompt | null): void {
    if (prompt === next) return;
    prompt = next;
    for (const listener of listeners) listener();
  }

  function respond(
    requestId: number,
    decision: DesktopCloseDecision,
  ): void {
    const previousPrompt = prompt;
    const previousSessionId = promptSessionId;
    publish(null);
    promptSessionId = null;
    void Promise.resolve(
      dependencies.respondToClose(requestId, decision),
    ).catch(() => {
      highestRequestId = Math.min(highestRequestId, requestId - 1);
      if (
        previousPrompt
        && observation?.appState.phase === "session"
        && observation.appState.sessionId === previousSessionId
      ) {
        promptSessionId = previousSessionId;
        publish({
          ...previousPrompt,
          canSaveAndExit: canSave(observation),
          status: previousPrompt.status === "save-failed"
            ? "save-failed"
            : "confirm",
        });
      }
    });
  }

  function observe(next: DesktopCloseObservation): void {
    observation = next;
    if (!prompt) return;
    if (prompt.status === "saving") {
      if (
        next.appState.phase === "fatal"
        && next.appState.sessionId === promptSessionId
      ) {
        publish({
          ...prompt,
          canSaveAndExit: false,
          status: "save-failed",
        });
        return;
      }
      if (
        next.appState.phase === "session"
        && next.appState.sessionId === promptSessionId
        && canSave(next)
      ) {
        publish({
          ...prompt,
          canSaveAndExit: false,
          status: "save-failed",
        });
        return;
      }
      if (
        next.appState.phase !== "session"
        || next.appState.sessionId !== promptSessionId
      ) {
        respond(prompt.requestId, "approve");
      }
      return;
    }

    if (prompt.status === "confirm") {
      const canSaveAndExit = canSave(next);
      if (canSaveAndExit !== prompt.canSaveAndExit) {
        publish({ ...prompt, canSaveAndExit });
      }
    }
  }

  function handleRequest(request: DesktopCloseRequest): void {
    if (!Number.isSafeInteger(request.requestId) || request.requestId <= 0) {
      return;
    }
    if (prompt?.requestId === request.requestId) return;
    if (request.requestId <= highestRequestId) return;
    highestRequestId = request.requestId;

    if (!observation || observation.appState.phase !== "session") {
      respond(request.requestId, "approve");
      return;
    }
    promptSessionId = observation.appState.sessionId;
    publish({
      ...request,
      canSaveAndExit: canSave(observation),
      status: "confirm",
    });
  }

  function choose(requestId: number, choice: DesktopCloseChoice): void {
    if (!prompt || prompt.requestId !== requestId) return;
    if (choice === "cancel") {
      if (prompt.status !== "saving") respond(requestId, "cancel");
      return;
    }
    if (choice === "discard") {
      if (prompt.status !== "saving") respond(requestId, "approve");
      return;
    }
    if (
      prompt.status !== "confirm"
      || !prompt.canSaveAndExit
      || !observation
      || !canSave(observation)
    ) {
      return;
    }
    if (!dependencies.requestSaveAndExit()) {
      publish({
        ...prompt,
        canSaveAndExit: canSave(observation),
        status: "confirm",
      });
      return;
    }
    publish({ ...prompt, canSaveAndExit: false, status: "saving" });
  }

  return {
    choose,
    getPrompt: () => prompt,
    handleRequest,
    observe,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Require both the app lifecycle and core input boundary to be save-ready. */
function canSave(observation: DesktopCloseObservation): boolean {
  return observation.appState.phase === "session"
    && observation.appState.status === "running"
    && observation.gameSnapshot?.phase === "running"
    && observation.gameSnapshot.commandInput
    && observation.gameSnapshot.runtimeSettingsStatus !== "pending";
}

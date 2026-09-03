import {
  useEffect,
  useMemo,
  useReducer,
} from "react";
import "./App.css";
import {
  appReducer,
  initialAppState,
} from "./app/app-state";
import { HomeScreen } from "./screens/HomeScreen";
import { GameScreen } from "./screens/GameScreen";
import { createSessionManager } from "./session/session-manager";
import type { SaveListEntry } from "./storage/storage-service";

/**
 * Render the top-level BlissHack state machine and active screen.
 * @returns the current application screen.
 */
function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const sessionManager = useMemo(
    () => createSessionManager({
      dispatch,
    }),
    [dispatch],
  );

  useEffect(() => {
    void sessionManager.initialize().catch(() => undefined);
    return () => {
      void sessionManager.dispose();
    };
  }, [sessionManager]);

  /**
   * Start one session and leave startup failures to the reducer event.
   */
  function startNewGame(): void {
    void sessionManager.startSession({ kind: "new" }).catch(() => undefined);
  }

  /** Open the save list owned by the current home module. */
  function openSavePicker(): void {
    if (state.phase !== "home") return;
    dispatch({ type: "SAVE_PICKER_OPENED", moduleId: state.moduleId });
  }

  /** Return from the save list without replacing its prepared module. */
  function closeSavePicker(): void {
    if (state.phase !== "home" || !state.savePickerOpen) return;
    dispatch({ type: "SAVE_PICKER_CLOSED", moduleId: state.moduleId });
  }

  /** Continue one validated save with the module which enumerated it. */
  function continueGame(save: SaveListEntry): void {
    void sessionManager.startSession({
      kind: "continue",
      save,
    }).catch(() => undefined);
  }

  /** Delete one save through the module which supplied the Home list. */
  async function deleteSave(save: SaveListEntry): Promise<void> {
    if (state.phase !== "home") {
      throw new Error("Save deletion is only available from Home");
    }
    await sessionManager.deleteSave(state.moduleId, save.path);
  }

  if (state.phase === "booting") {
    return (
      <main className="app-loading" aria-label="BlissHack loading">
        <span className="app-loading-mark" aria-hidden="true">@</span>
        <span>Preparing BlissHack</span>
      </main>
    );
  }

  if (state.phase === "home") {
    const preparation = sessionManager.getHomePreparation();
    const saves = preparation?.moduleId === state.moduleId
      ? preparation.saves
      : [];
    return (
      <HomeScreen
        hasSaves={saves.some((save) => save.status === "ready")}
        moduleId={state.moduleId}
        onContinue={openSavePicker}
        onContinueSave={continueGame}
        onDeleteSave={deleteSave}
        onDismissSavePicker={closeSavePicker}
        onNewGame={startNewGame}
        savePickerOpen={state.savePickerOpen}
        saves={saves}
        storageAvailable={state.storageAvailable}
      />
    );
  }

  if (state.phase === "fatal") {
    return (
      <main className="fatal-screen" aria-labelledby="fatal-title">
        <section>
          <p className="screen-kicker">Session failure</p>
          <h1 id="fatal-title">BlissHack could not continue</h1>
          <p>Error ID: <code>{state.errorId}</code></p>
          <button onClick={() => globalThis.location.reload()} type="button">
            Reload Application
          </button>
        </section>
      </main>
    );
  }

  if (state.status === "starting") {
    return (
      <main className="session-loading" aria-live="polite">
        <div className="session-loading-mark" aria-hidden="true">
          <span>┌──────────┐</span>
          <span>│ @ · · &gt; │</span>
          <span>└──────────┘</span>
        </div>
        <h1>BlissHack</h1>
        <p>Entering the dungeon</p>
      </main>
    );
  }

  return <GameScreen />;
}

export default App;

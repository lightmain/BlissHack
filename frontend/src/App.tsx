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

/**
 * Render the top-level BlissHack state machine and active screen.
 * @returns the current application screen.
 */
function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const sessionManager = useMemo(
    () => createSessionManager({
      dispatch,
      storageAvailable: () => "indexedDB" in globalThis,
    }),
    [dispatch],
  );

  useEffect(() => {
    dispatch({
      type: "BOOT_COMPLETED",
      storageAvailable: "indexedDB" in globalThis,
    });
    return () => {
      void sessionManager.dispose();
    };
  }, [sessionManager]);

  /**
   * Start one session and leave startup failures to the reducer event.
   */
  function startNewGame(): void {
    void sessionManager.startSession().catch(() => undefined);
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
    return <HomeScreen onNewGame={startNewGame} />;
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

  if (state.status === "creating"
    || state.status === "loading"
    || state.status === "ready") {
    return (
      <main className="session-loading" aria-live="polite">
        <div className="session-loading-mark" aria-hidden="true">
          <span>┌──────────┐</span>
          <span>│ @ · · &gt; │</span>
          <span>└──────────┘</span>
        </div>
        <h1>BlissHack</h1>
        <p>{loadingLabel(state.status)}</p>
      </main>
    );
  }

  return <GameScreen />;
}

/**
 * Convert a session startup state into concise interface text.
 * @param status - current session lifecycle status.
 * @returns user-facing loading label.
 */
function loadingLabel(status: "creating" | "loading" | "ready"): string {
  if (status === "creating") return "Creating session";
  if (status === "loading") return "Loading NetHack";
  return "Entering the dungeon";
}

export default App;

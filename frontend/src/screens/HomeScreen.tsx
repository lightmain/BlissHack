/** Properties for the application home screen. */
interface HomeScreenProps {
  hasSaves?: boolean;
  onContinue?: () => void;
  onNewGame: () => void;
  storageAvailable?: boolean;
}

/**
 * Render the BlissHack command screen without creating a WASM session.
 * @param props - home-screen command handlers.
 * @returns the application home screen.
 */
export function HomeScreen({
  hasSaves = false,
  onContinue = () => undefined,
  onNewGame,
  storageAvailable = true,
}: HomeScreenProps) {
  return (
    <main className="home-screen" aria-labelledby="home-title">
      <header className="home-header">
        <span className="home-version">prealpha-2</span>
        <span className="home-runtime">NetHack 5.0</span>
      </header>

      <section className="home-main">
        <div className="home-identity">
          <div aria-hidden="true" className="home-mark">
            <span>@</span>
            <span>·</span>
            <span>&gt;</span>
          </div>
          <h1 id="home-title">BlissHack</h1>
          <p>An unofficial NetHack 5.0 port</p>
        </div>

        <nav aria-label="Main commands" className="home-commands">
          <button onClick={onNewGame} type="button">New Game</button>
          <button
            disabled={!storageAvailable || !hasSaves}
            onClick={onContinue}
            type="button"
          >
            Continue
          </button>
          <button disabled type="button">Settings</button>
        </nav>
        {!storageAvailable && (
          <p className="home-storage-warning" role="status">
            Persistent storage is unavailable. New games are temporary.
          </p>
        )}
      </section>

      <footer className="home-footer">
        <span>BlissHack prealpha-2</span>
        <span>NetHack copyright 1985-2026</span>
        <a
          href="https://www.nethack.org/common/license.html"
          rel="noreferrer"
          target="_blank"
        >
          License
        </a>
      </footer>
    </main>
  );
}

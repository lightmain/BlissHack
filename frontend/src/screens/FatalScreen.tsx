/** Properties for an unrecoverable application failure. */
interface FatalScreenProps {
  errorId: string;
  hasFailedSession: boolean;
  onExportDiagnostics: () => void;
  onReload: () => void;
  onReturnHome: () => void;
}

/**
 * Render safe recovery actions for one fatal module or session failure.
 * @param props - correlation ID, ownership state, and explicit actions.
 * @returns the fatal application screen.
 */
export function FatalScreen({
  errorId,
  hasFailedSession,
  onExportDiagnostics,
  onReload,
  onReturnHome,
}: FatalScreenProps) {
  return (
    <main className="fatal-screen" aria-labelledby="fatal-title">
      <section>
        <p className="screen-kicker">Application failure</p>
        <h1 id="fatal-title">BlissHack could not continue</h1>
        <p>
          The current operation stopped to avoid using an invalid game state.
        </p>
        <p>Error ID: <code>{errorId}</code></p>
        <div className="fatal-actions">
          <button onClick={onExportDiagnostics} type="button">
            Export Diagnostic Log
          </button>
          {hasFailedSession
            ? (
              <button onClick={onReload} type="button">
                Reload Application
              </button>
            )
            : (
              <button onClick={onReturnHome} type="button">
                Return Home
              </button>
            )}
        </div>
      </section>
    </main>
  );
}

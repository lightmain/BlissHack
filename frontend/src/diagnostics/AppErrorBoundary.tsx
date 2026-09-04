import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";
import type { DiagnosticLog } from "./diagnostic-log";
import { downloadDiagnosticLog } from "./download-diagnostics";

interface AppErrorBoundaryProps {
  children: ReactNode;
  diagnostics: DiagnosticLog;
}

interface AppErrorBoundaryState {
  errorId: string | null;
  failed: boolean;
}

/** Last-resort renderer used when the normal React application cannot render. */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    errorId: null,
    failed: false,
  };

  static getDerivedStateFromError(): Partial<AppErrorBoundaryState> {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    const fatal = this.props.diagnostics.recordFatal({
      area: "app",
      event: "app.render_failed",
    }, error);
    this.setState({ errorId: fatal.errorId });
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-screen" aria-labelledby="root-fatal-title">
        <section>
          <p className="screen-kicker">Application failure</p>
          <h1 id="root-fatal-title">BlissHack could not render</h1>
          <p>
            Error ID: <code>{this.state.errorId ?? "BH-PENDING"}</code>
          </p>
          <div className="fatal-actions">
            <button
              onClick={() => downloadDiagnosticLog(this.props.diagnostics)}
              type="button"
            >
              Export Diagnostic Log
            </button>
            <button
              onClick={() => globalThis.location.reload()}
              type="button"
            >
              Reload Application
            </button>
          </div>
        </section>
      </main>
    );
  }
}

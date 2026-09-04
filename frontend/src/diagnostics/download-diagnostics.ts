import type { DiagnosticLog } from "./diagnostic-log";

/**
 * Record an export action and download the current diagnostic JSON.
 * @param diagnostics - application diagnostic log.
 */
export function downloadDiagnosticLog(diagnostics: DiagnosticLog): void {
  diagnostics.record({
    level: "info",
    area: "app",
    event: "diagnostics.exported",
  });
  const blob = new Blob([diagnostics.exportJson()], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "blisshack-diagnostics.json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

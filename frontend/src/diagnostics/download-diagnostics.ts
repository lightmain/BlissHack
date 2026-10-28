import type { DiagnosticLog } from "./diagnostic-log";
import {
  saveUserFile,
  type SaveUserFileResult,
} from "../desktop/save-user-file";

/**
 * Record an export action and download the current diagnostic JSON.
 * @param diagnostics - application diagnostic log.
 */
export function downloadDiagnosticLog(
  diagnostics: DiagnosticLog,
): Promise<SaveUserFileResult> {
  diagnostics.record({
    level: "info",
    area: "app",
    event: "diagnostics.exported",
  });
  return saveUserFile({
    data: diagnostics.exportJson(),
    fileName: "blisshack-diagnostics.json",
    mimeType: "application/json;charset=utf-8",
  });
}

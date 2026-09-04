import { readFile } from "node:fs/promises";
import {
  expect,
  type Page,
  type TestInfo,
} from "@playwright/test";

const DIAGNOSTIC_STORAGE_KEY = "blisshack.diagnostics.v1";

/** One event parsed from the player-visible diagnostic export. */
export interface BrowserDiagnosticEvent {
  detail?: { buildId?: string };
  errorId: string | null;
  event: string;
  level: string;
  moduleId: string | null;
  sessionId: string | null;
}

/** Diagnostic document downloaded through the real application button. */
export interface BrowserDiagnosticExport {
  schemaVersion: number;
  buildId: string;
  events: BrowserDiagnosticEvent[];
}

/** Download and parse the diagnostic JSON exposed by the current screen. */
export async function exportDiagnosticLog(
  page: Page,
): Promise<{ diagnostic: BrowserDiagnosticExport; text: string }> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Diagnostic Log" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("blisshack-diagnostics.json");
  const path = await download.path();
  expect(path).not.toBeNull();
  const text = await readFile(path!, "utf8");
  return {
    diagnostic: JSON.parse(text) as BrowserDiagnosticExport,
    text,
  };
}

/**
 * Attach browser-local diagnostics when a Playwright test fails.
 * This reads test evidence only and never mutates application state.
 */
export async function attachFailureDiagnostics(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus || page.isClosed()) return;
  try {
    const stored = await page.evaluate(
      (key) => globalThis.localStorage.getItem(key),
      DIAGNOSTIC_STORAGE_KEY,
    );
    await testInfo.attach("blisshack-diagnostic-storage", {
      body: stored ?? JSON.stringify({
        schemaVersion: 1,
        unavailable: true,
      }),
      contentType: "application/json",
    });
  } catch (error) {
    await testInfo.attach("blisshack-diagnostic-storage-error", {
      body: error instanceof Error ? error.message : String(error),
      contentType: "text/plain",
    });
  }
}

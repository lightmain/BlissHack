import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import { exportDiagnosticLog } from "./helpers/diagnostic-artifact";
import {
  quitAndReturnHome,
  saveAndReturnHome,
  startNewGame,
  startNewGameFromHome,
} from "./helpers/game-flow";

test("quits an active game and starts a clean second session", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startNewGame(page, "E2E_ActiveQuit");
  await quitAndReturnHome(page);

  await expect(page.locator(".nh-shell")).toHaveCount(0);
  await startNewGameFromHome(page, "E2E_AfterQuit");
  await expect(page.getByLabel(/E2E_AfterQuit the .+, 100% HP/)).toBeVisible();
  await saveAndReturnHome(page);

  const { diagnostic } = await exportDiagnosticLog(page);
  const sessionIds = diagnostic.events
    .filter(({ event }) => event === "session.created")
    .map(({ sessionId }) => sessionId);
  const moduleIds = diagnostic.events
    .filter(({ event }) => event === "module.loading")
    .map(({ moduleId }) => moduleId);
  expect(sessionIds).toHaveLength(2);
  expect(sessionIds.every(Boolean)).toBe(true);
  expect(new Set(sessionIds).size).toBe(2);
  expect(moduleIds.length).toBeGreaterThanOrEqual(3);
  expect(moduleIds.every(Boolean)).toBe(true);
  expect(new Set(moduleIds).size).toBe(moduleIds.length);
  expect(errors).toEqual({ console: [], page: [] });
});

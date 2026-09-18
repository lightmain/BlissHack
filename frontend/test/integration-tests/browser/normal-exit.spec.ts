import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import { exportDiagnosticLog } from "./helpers/diagnostic-artifact";
import {
  quitAndReturnHome,
  openHome,
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
  await expect(
    page.getByRole("region", { name: "Character status" })
      .locator(".nh-status-value")
      .filter({ hasText: /^E2E_AfterQuit the .+$/ }),
  ).toBeVisible();
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

test("retains the last permanent inventory through end-game disclosure", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await openHome(page, "inventory-at-gameover");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("checkbox", {
    name: "Enable Permanent Inventory",
    exact: true,
  }).check();
  await page.getByRole("button", { name: "Apply" }).click();
  await startNewGameFromHome(page, "InventoryGameover");

  const inventory = page.getByRole("region", { name: "Inventory" });
  await expect(inventory).toBeVisible();
  const lastItem = inventory.locator(".permanent-inventory-item").last();
  const lastItemText = await lastItem.textContent();
  expect(lastItemText?.trim()).not.toBe("");

  await page.keyboard.press("#");
  const commandDialog = page.getByRole("dialog", { name: "Extended command" });
  await expect(commandDialog).toBeVisible();
  await commandDialog.locator("input").fill("quit");
  await commandDialog.locator("input").press("Enter");
  await expect(page.getByText(/Really quit without saving/)).toBeVisible();
  await page.keyboard.press("y");
  await expect(page.getByText(
    /Do you want (your possessions identified|to see)/,
  )).toBeVisible();
  await expect(inventory).toBeVisible();
  await expect(inventory).toContainText(lastItemText ?? "");
  expect(errors).toEqual({ console: [], page: [] });
});

test("keeps original end-game disclosures serial and returns after summary", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "E2EEnd";
  await startNewGame(page, name);

  await page.keyboard.press("#");
  const commandDialog = page.getByRole("dialog", { name: "Extended command" });
  await expect(commandDialog).toBeVisible();
  await commandDialog.locator("input").fill("quit");
  await commandDialog.locator("input").press("Enter");
  await expect(page.locator(".nh-prompt")).toContainText(
    "Really quit without saving?",
  );
  await page.keyboard.press("y");

  const prompt = page.locator(".nh-prompt");
  await expect(prompt).toContainText("Do you want your possessions identified?");
  await page.keyboard.press("y");
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu).toBeVisible();
  await expect(menu.locator(".nh-menu-item")).not.toHaveCount(0);
  await page.keyboard.press("Enter");

  await expect(prompt).toContainText("Do you want to see your attributes?");
  await page.keyboard.press("y");
  const textWindow = page.locator(".nh-text-dialog");
  await expect(textWindow).toContainText(`${name} the`);
  await expect(textWindow).toContainText("Final Attributes:");
  await page.keyboard.press("Enter");

  await expect(prompt).toContainText(
    /Do you want to see your conduct(?: and achievements)?/,
  );
  await expect(prompt).not.toContainText(/vanquished|genocided|extinct/i);
  await page.keyboard.press("y");
  await expect(textWindow).toContainText("Voluntary challenges:");
  await page.keyboard.press("Enter");

  await expect(prompt).toContainText("Do you want to see the dungeon overview?");
  await page.keyboard.press("y");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("The Dungeons of Doom");
  await page.keyboard.press("Enter");

  const more = page.getByText("--More--", { exact: true });
  if (await more.isVisible()) await page.keyboard.press("Space");

  await expect(textWindow).toContainText(
    new RegExp(`${name} the .+\\.\\.\\.`),
  );
  await expect(textWindow).toContainText(
    /You quit in The Dungeons of Doom on dungeon level 1 with \d+ points?/,
  );
  await page.evaluate(() => {
    const host = globalThis as typeof globalThis & Record<string, unknown>;
    const callbackName = Object.keys(host).find((name) =>
      name.startsWith("blissCallback_session_")
    );
    const callback = callbackName ? host[callbackName] : null;
    if (!callbackName || typeof callback !== "function") {
      throw new Error("Active session callback was not found");
    }
    const rankingOutput: string[] = [];
    host.__blisshackEndgameRanking = rankingOutput;
    host[callbackName] = async (...args: unknown[]) => {
      if (
        (args[0] === "shim_raw_print" || args[0] === "shim_raw_print_bold")
        && typeof args[1] === "string"
      ) {
        rankingOutput.push(args[1]);
      }
      return callback(...args);
    };
  });
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(textWindow).toHaveCount(0);
  await expect(page.locator(".nh-shell")).toHaveCount(0);
  const rankingOutput = await page.evaluate(() => {
    const host = globalThis as typeof globalThis & {
      __blisshackEndgameRanking?: string[];
    };
    return host.__blisshackEndgameRanking ?? [];
  });
  expect(rankingOutput.join("\n")).toMatch(/\bNo\s+Points\s+Name\b/);
  expect(rankingOutput.join("\n")).toContain(name);

  const { diagnostic } = await exportDiagnosticLog(page);
  const sessionId = diagnostic.events.findLast(
    ({ event }) => event === "session.created",
  )?.sessionId;
  expect(sessionId).toBeTruthy();
  const flushIndex = diagnostic.events.findIndex((event) =>
    event.event === "storage.flush_completed"
      && event.sessionId === sessionId);
  const cleanupIndex = diagnostic.events.findIndex((event) =>
    event.event === "session.cleaned"
      && event.sessionId === sessionId);
  const nextModuleIndex = diagnostic.events.findIndex((event, index) =>
    index > cleanupIndex
      && event.event === "module.loading"
      && event.sessionId === null);
  expect(flushIndex).toBeGreaterThan(-1);
  expect(cleanupIndex).toBeGreaterThan(flushIndex);
  expect(nextModuleIndex).toBeGreaterThan(cleanupIndex);
  expect(errors).toEqual({ console: [], page: [] });
});

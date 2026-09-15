import {
  type Locator,
  type Page,
} from "@playwright/test";
import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import {
  openHome,
  startNewGame,
  startNewGameFromHome,
} from "./helpers/game-flow";
import {
  readCursorPosition,
  readShellRevision,
} from "./helpers/map-viewport-state";

const COLNO = 80;
const ROWNO = 21;

interface NewGameSettings {
  permanentInventory?: boolean;
  showTime?: boolean;
}

/**
 * Return the single shared inspection layer used by map, inventory, and status.
 * @param page - running game page.
 * @returns locator for the unified tooltip.
 */
function inspectTooltip(page: Page): Locator {
  return page.locator(".nh-overlay-root > .nh-inspect-tooltip");
}

/**
 * Wait for the real WASM main-command boundary.
 * @param page - running game page.
 * @returns locator for the ready game shell.
 */
async function expectCommandReady(page: Page): Promise<Locator> {
  const shell = page.locator(".nh-shell");
  await expect(shell).toHaveAttribute("data-command-input", "ready");
  return shell;
}

/**
 * Configure selected runtime options before starting a real new game.
 * @param page - page allocated by the browser fixture.
 * @param marker - unique navigation marker and player name.
 * @param settings - runtime options required by the scenario.
 */
async function startConfiguredGame(
  page: Page,
  marker: string,
  settings: NewGameSettings,
): Promise<void> {
  await openHome(page, marker);
  await page.getByRole("button", { name: "Settings" }).click();
  if (settings.permanentInventory) {
    await page.getByRole("checkbox", {
      name: "Enable Permanent Inventory",
      exact: true,
    }).check();
  }
  if (settings.showTime) {
    await page.getByRole("checkbox", { name: "Show turn count" }).check();
  }
  await page.getByRole("button", { name: "Apply" }).click();
  await startNewGameFromHome(page, marker);
  await expectCommandReady(page);
}

/**
 * Assert that a visible tooltip is fully contained by the browser viewport.
 * @param page - running game page.
 * @param tooltip - visible inspection tooltip.
 */
async function expectInsideViewport(
  page: Page,
  tooltip: Locator,
): Promise<void> {
  const [bounds, viewport] = await Promise.all([
    tooltip.boundingBox(),
    Promise.resolve(page.viewportSize()),
  ]);
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);
}

/**
 * Move the browser pointer to the center of one renderer-independent map cell.
 * @param page - running game page.
 * @param mapX - NetHack map column.
 * @param mapY - NetHack map row.
 */
async function hoverMapCell(
  page: Page,
  mapX: number,
  mapY: number,
): Promise<void> {
  const map = page.locator(".nh-map-interaction");
  const viewport = page.locator(".nh-map-scroll");
  await expect(map).toBeVisible();
  const [mapBounds, viewportBounds] = await Promise.all([
    map.boundingBox(),
    viewport.boundingBox(),
  ]);
  expect(mapBounds).not.toBeNull();
  expect(viewportBounds).not.toBeNull();
  const point = {
    x: mapBounds!.x + ((mapX + 0.5) / COLNO) * mapBounds!.width,
    y: mapBounds!.y + ((mapY + 0.5) / ROWNO) * mapBounds!.height,
  };
  expect(point.x).toBeGreaterThanOrEqual(viewportBounds!.x);
  expect(point.y).toBeGreaterThanOrEqual(viewportBounds!.y);
  expect(point.x).toBeLessThanOrEqual(
    viewportBounds!.x + viewportBounds!.width,
  );
  expect(point.y).toBeLessThanOrEqual(
    viewportBounds!.y + viewportBounds!.height,
  );
  await page.mouse.move(point.x, point.y);
}

test("delays status inspection and keeps pointer and focus tooltips in the shared viewport layer", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await startNewGame(page, "StatusHover");
  const shell = await expectCommandReady(page);
  const tooltip = inspectTooltip(page);
  const statusTargets = page.locator(".nh-status [data-inspect-target]");
  expect(await statusTargets.count()).toBeGreaterThanOrEqual(2);
  const edgeTarget = statusTargets.last();
  await expect(edgeTarget).toBeVisible();
  const revisionBeforeInspect = await readShellRevision(page);

  await edgeTarget.hover();
  await page.waitForTimeout(150);
  await expect(tooltip).toHaveCount(0);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveAttribute("id", "inspect-status-tooltip");
  await expect(tooltip.locator("strong")).toHaveText(/\S/);
  await expectInsideViewport(page, tooltip);

  await page.mouse.move(1, 1);
  await expect(tooltip).toHaveCount(0);
  const firstStatusTarget = statusTargets.first();
  const secondStatusTarget = statusTargets.nth(1);
  await firstStatusTarget.focus();
  await expect(firstStatusTarget).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(secondStatusTarget).toBeFocused();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveAttribute("id", "inspect-status-tooltip");
  await expectInsideViewport(page, tooltip);

  expect(await readShellRevision(page)).toBe(revisionBeforeInspect);
  await expect(shell).toHaveAttribute("data-command-input", "ready");
  expect(errors).toEqual({ console: [], page: [] });
});

test("shows the core permanent-inventory item text without sending game input", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startConfiguredGame(page, "InventoryHover", {
    permanentInventory: true,
  });
  const shell = await expectCommandReady(page);
  const inventory = page.getByRole("region", { name: "Inventory" });
  await expect(inventory).toBeVisible();

  await page.getByRole("button", { name: "Collapse inventory" }).click();
  await expect(
    page.getByRole("button", { name: "Expand inventory" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand inventory" }).click();
  const item = inventory.locator(
    ".permanent-inventory-item:not(.permanent-inventory-heading)",
  ).first();
  await expect(item).toBeVisible();
  const itemText = (await item.locator(".nh-menu-text").textContent())?.trim();
  expect(itemText).toBeTruthy();
  const revisionBeforeInspect = await readShellRevision(page);
  const messagesBeforeInspect = await page.locator(".nh-messages").textContent();

  await item.hover();
  const tooltip = inspectTooltip(page);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveAttribute("id", "inspect-inventory-tooltip");
  await expect(tooltip.locator("strong")).toHaveText(itemText!);

  expect(await readShellRevision(page)).toBe(revisionBeforeInspect);
  expect(await page.locator(".nh-messages").textContent())
    .toBe(messagesBeforeInspect);
  await expect(shell).toHaveAttribute("data-command-input", "ready");
  await expect(page.locator(".nh-dialog")).toHaveCount(0);
  expect(errors).toEqual({ console: [], page: [] });
});

test("inspects the player cell without changing visible messages or turn count", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startConfiguredGame(page, "PlayerClicklook", { showTime: true });
  const shell = await expectCommandReady(page);
  const messages = page.locator(".nh-messages");
  const turn = page.locator(
    "[data-inspect-target='status:time'] .nh-status-value",
  );
  await expect(turn).toBeVisible();
  await expect(
    page.locator(".nh-map-interaction [data-map-renderer-state]:visible"),
  ).toHaveCount(1);
  const messagesBeforeInspect = await messages.textContent();
  const turnBeforeInspect = await turn.textContent();
  const cursor = await readCursorPosition(page);

  await hoverMapCell(page, cursor.x, cursor.y);
  const tooltip = inspectTooltip(page);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveAttribute("id", "map-inspect-tooltip");
  await expect(tooltip.locator("strong")).toHaveText(/\S/);
  await expect(shell).toHaveAttribute("data-command-input", "ready");

  expect.soft(await messages.textContent()).toBe(messagesBeforeInspect);
  expect.soft(await turn.textContent()).toBe(turnBeforeInspect);
  expect.soft(errors).toEqual({ console: [], page: [] });
});

test("clears inspection tooltips on leave, game key input, and pause", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startNewGame(page, "HoverCleanup");
  const shell = await expectCommandReady(page);
  const statusTarget = page.locator(
    "[data-inspect-target='status:hitpoints']",
  );
  const tooltip = inspectTooltip(page);

  await statusTarget.hover();
  await expect(tooltip).toBeVisible();
  await page.mouse.move(1, 1);
  await expect(tooltip).toHaveCount(0);

  await statusTarget.hover();
  await expect(tooltip).toBeVisible();
  const revisionBeforeKey = await readShellRevision(page);
  await page.keyboard.press(".");
  await page.waitForFunction((revision) => {
    const game = document.querySelector<HTMLElement>(".nh-shell");
    return game?.dataset.commandInput === "ready"
      && Number(game.dataset.snapshotRevision) > revision;
  }, revisionBeforeKey, { timeout: 10_000 });
  await expect(tooltip).toHaveCount(0);

  await page.mouse.move(1, 1);
  await statusTarget.hover();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Game paused" })).toBeVisible();
  await expect(tooltip).toHaveCount(0);
  await expect(shell).toHaveAttribute("data-command-input", "ready");
  expect(errors).toEqual({ console: [], page: [] });
});

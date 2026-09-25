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
  statusField,
} from "./helpers/game-flow";
import {
  readCursorPosition,
  readShellRevision,
} from "./helpers/map-viewport-state";

const COLNO = 80;
const ROWNO = 21;

interface NewGameSettings {
  informationLevel?: "original" | "detailed";
  permanentInventory?: boolean;
  showExperience?: boolean;
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
 * Wait long enough for the shared hover dwell timer to fire if it was not cleared.
 */
async function waitPastHoverDelay(page: Page): Promise<void> {
  await page.waitForTimeout(700);
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
  if (settings.informationLevel) {
    await page.getByRole("group", { name: "Information level" })
      .getByRole("radio", {
        name: settings.informationLevel === "detailed"
          ? "Detailed"
          : "Original",
      })
      .check();
  }
  if (settings.permanentInventory) {
    await page.getByRole("checkbox", {
      name: "Enable Permanent Inventory",
      exact: true,
    }).check();
  }
  if (settings.showExperience) {
    await page.getByRole("checkbox", { name: "Show experience" }).check();
  }
  if (settings.showTime) {
    await page.getByRole("checkbox", { name: "Show turn count" }).check();
  }
  const apply = page.getByRole("button", { name: "Apply", exact: true });
  if (await apply.isEnabled()) {
    await apply.click();
  } else {
    await page.getByRole("button", { name: "Back to Home" }).click();
  }
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

/**
 * Move to a point safely inside the currently visible map viewport.
 * @param page - running game page.
 */
async function hoverVisibleMapPoint(page: Page): Promise<void> {
  const viewportBounds = await page.locator(".nh-map-scroll").boundingBox();
  expect(viewportBounds).not.toBeNull();
  await page.mouse.move(
    viewportBounds!.x + viewportBounds!.width * 0.6,
    viewportBounds!.y + viewportBounds!.height * 0.5,
  );
}

/**
 * Move the map viewport to the opposite horizontal edge.
 * @param viewport - map scroll container.
 * @returns previous and resulting offsets plus the full scroll range.
 */
async function setOppositeHorizontalScroll(
  viewport: Locator,
): Promise<{ left: number; maxLeft: number; previousLeft: number }> {
  return viewport.evaluate(async (element) => {
    const maxLeft = element.scrollWidth - element.clientWidth;
    const previousLeft = element.scrollLeft;
    element.scrollLeft = previousLeft < maxLeft / 2 ? maxLeft : 0;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return {
      left: element.scrollLeft,
      maxLeft,
      previousLeft,
    };
  });
}

/**
 * Place the camera at the center so a viewport resize must restore its anchor.
 * @param viewport - map scroll container.
 * @returns centered offset and the full scroll range.
 */
async function setCenteredHorizontalScroll(
  viewport: Locator,
): Promise<{ left: number; maxLeft: number }> {
  return viewport.evaluate(async (element) => {
    const maxLeft = element.scrollWidth - element.clientWidth;
    element.scrollLeft = maxLeft / 2;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return { left: element.scrollLeft, maxLeft };
  });
}

/**
 * Assert that a pending hover target was cleared before the dwell timer could inspect.
 * @param page - running game page.
 */
async function expectPendingHoverCleared(
  page: Page,
): Promise<void> {
  await waitPastHoverDelay(page);
  expect(await inspectTooltip(page).count()).toBe(0);
  await expectCommandReady(page);
}

test("delays status inspection and keeps pointer and focus tooltips in the shared viewport layer", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await startConfiguredGame(page, "StatusHover", {
    informationLevel: "detailed",
  });
  const shell = await expectCommandReady(page);
  const tooltip = inspectTooltip(page);
  const statusTargets = page.getByRole("region", {
    name: "Character status",
  }).locator("[data-inspect-target]");
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

test("applies status information level immediately without changing other inspection or XP", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startConfiguredGame(page, "StatusInformationLevel", {
    informationLevel: "original",
    permanentInventory: true,
    showExperience: true,
  });
  const shell = await expectCommandReady(page);
  const tooltip = inspectTooltip(page);
  const status = page.getByRole("region", { name: "Character status" });
  const experiencePoints = statusField(page, "experience");
  const hitPoints = statusField(page, "hitpoints");

  await expect(experiencePoints).toBeVisible();
  await hitPoints.hover();
  await waitPastHoverDelay(page);
  expect.soft(await tooltip.count()).toBe(0);
  expect.soft(await status.locator("[data-inspect-target]").count()).toBe(0);

  const inventoryItem = page.getByRole("region", { name: "Inventory" })
    .locator(
      ".permanent-inventory-item:not(.permanent-inventory-heading)",
    )
    .first();
  await inventoryItem.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveAttribute("id", "inspect-inventory-tooltip");
  await page.mouse.move(1, 1);
  await expect(tooltip).toHaveCount(0);

  const revisionBeforeSwitch = await readShellRevision(page);
  await page.keyboard.press("Escape");
  const pause = page.getByRole("dialog", { name: "Game paused" });
  await expect(pause).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("group", { name: "Information level" })
    .getByRole("radio", { name: "Detailed" })
    .check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(pause).toBeVisible();
  expect.soft(await readShellRevision(page)).toBe(revisionBeforeSwitch);
  await page.getByRole("button", { name: "Resume" }).click();

  const detailedHitPoints = page.locator(
    "[data-inspect-target='status:hitpoints']",
  );
  await detailedHitPoints.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveAttribute("id", "inspect-status-tooltip");
  await expect(tooltip.locator("strong")).toHaveText(/\S/);
  await expect(experiencePoints).toBeVisible();
  expect.soft(await readShellRevision(page)).toBe(revisionBeforeSwitch);
  await expect(shell).toHaveAttribute("data-command-input", "ready");
  expect.soft(errors).toEqual({ console: [], page: [] });
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
  await startConfiguredGame(page, "PlayerClicklook", {
    informationLevel: "detailed",
    showTime: true,
  });
  const shell = await expectCommandReady(page);
  const messages = page.locator(".nh-messages");
  const turn = statusField(page, "time");
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

test("clears pending and visible map inspection when the pointer leaves", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startNewGame(page, "HoverCleanupLeave");
  await expectCommandReady(page);
  const cursor = await readCursorPosition(page);
  const tooltip = inspectTooltip(page);

  await hoverMapCell(page, cursor.x, cursor.y);
  await page.waitForTimeout(120);
  await page.mouse.move(1, 1);
  await expectPendingHoverCleared(page);

  await hoverMapCell(page, cursor.x, cursor.y);
  await expect(tooltip).toBeVisible();
  await page.mouse.move(1, 1);
  await expect(tooltip).toHaveCount(0);
  expect(errors).toEqual({ console: [], page: [] });
});

test("clears inspection tooltips on leave, game key input, and pause", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startConfiguredGame(page, "HoverCleanup", {
    informationLevel: "detailed",
  });
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

test("clears a pending map hover when the viewport scrolls", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await startNewGame(page, "HoverCleanupScroll");
  await expectCommandReady(page);
  const viewport = page.locator(".nh-map-scroll");
  const cursor = await readCursorPosition(page);

  await hoverMapCell(page, cursor.x, cursor.y);
  await page.waitForTimeout(120);

  const scroll = await setOppositeHorizontalScroll(viewport);
  expect(scroll.maxLeft).toBeGreaterThan(0);
  expect(scroll.left).not.toBe(scroll.previousLeft);

  await expectPendingHoverCleared(page);
  expect(errors).toEqual({ console: [], page: [] });
});

test("clears a pending map hover when camera reposition changes the viewport", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await startNewGame(page, "HoverCleanupCamera");
  await expectCommandReady(page);
  const viewport = page.locator(".nh-map-scroll");
  const manualScroll = await setCenteredHorizontalScroll(viewport);
  expect(manualScroll.maxLeft).toBeGreaterThan(0);

  await hoverVisibleMapPoint(page);
  await page.waitForTimeout(120);

  await page.setViewportSize({ width: 960, height: 700 });
  await expect.poll(async () =>
    viewport.evaluate((element) => element.scrollLeft))
    .not.toBe(manualScroll.left);

  await expectPendingHoverCleared(page);
  expect(errors).toEqual({ console: [], page: [] });
});

test("clears a pending hover on right-button pointerdown", async ({ page }) => {
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await startNewGame(page, "HoverCleanupRightDown");
  await expectCommandReady(page);
  const cursor = await readCursorPosition(page);

  await hoverMapCell(page, cursor.x, cursor.y);
  await page.waitForTimeout(120);
  await page.mouse.down({ button: "right" });

  await expectPendingHoverCleared(page);
  await page.mouse.up({ button: "right" });
  expect(errors).toEqual({ console: [], page: [] });
});

test("clears a pending hover on right-button pointercancel", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await startNewGame(page, "HoverCleanupPointerCancel");
  await expectCommandReady(page);
  const map = page.locator(".nh-map-interaction");
  const cursor = await readCursorPosition(page);

  await hoverMapCell(page, cursor.x, cursor.y);
  await page.waitForTimeout(120);
  await map.dispatchEvent("pointercancel", {
    button: 2,
    buttons: 0,
    pointerId: 1,
  });

  await expectPendingHoverCleared(page);
  expect(errors).toEqual({ console: [], page: [] });
});

test("clears a pending hover on lost right-button pointer capture", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await startNewGame(page, "HoverCleanupLostCapture");
  await expectCommandReady(page);
  const map = page.locator(".nh-map-interaction");
  const cursor = await readCursorPosition(page);

  await hoverMapCell(page, cursor.x, cursor.y);
  await page.waitForTimeout(120);
  await map.dispatchEvent("lostpointercapture", { pointerId: 1 });

  await expectPendingHoverCleared(page);
  expect(errors).toEqual({ console: [], page: [] });
});

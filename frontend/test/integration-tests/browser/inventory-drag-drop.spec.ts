import {
  type Locator,
  type Page,
} from "@playwright/test";
import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import {
  openHome,
  startNewGameFromHome,
  statusField,
} from "./helpers/game-flow";
import {
  readCursorPosition,
  readShellRevision,
} from "./helpers/map-viewport-state";

/** Enable permanent inventory and enter a real WASM game at command input. */
async function startInventoryDragGame(
  page: Page,
  name: string,
): Promise<Locator> {
  await openHome(page, name);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("checkbox", {
    name: "Enable Permanent Inventory",
    exact: true,
  }).check();
  await page.getByRole("checkbox", { name: "Show turn count" }).check();
  await page.getByRole("button", { name: "Apply" }).click();
  await startNewGameFromHome(page, `${name}-A`);

  const inventory = page.getByRole("region", { name: "Inventory" });
  await expect(inventory).toBeVisible();
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-command-input",
    "ready",
  );
  return inventory;
}

/** Return concrete permanent-inventory rows, excluding category headings. */
function inventoryRows(inventory: Locator): Locator {
  return inventory.locator(
    ".permanent-inventory-item:not(.permanent-inventory-heading)",
  );
}

/** Return a starter item which is not visibly equipped. */
function droppableItem(inventory: Locator): Locator {
  return inventoryRows(inventory)
    .filter({ hasNotText: /being worn|weapon in hand|wielded/i })
    .last();
}

/** Return the Archeologist food-ration stack after race extras merge. */
function droppableStack(inventory: Locator): Locator {
  return inventoryRows(inventory)
    .filter({ hasText: /[2-9]\d* (?:uncursed )?food rations/i })
    .first();
}

/** Return one worn item which the core must refuse to drop. */
function wornItem(inventory: Locator): Locator {
  return inventoryRows(inventory).filter({ hasText: /being worn/i }).first();
}

/** Return the core-owned turn counter. */
function turnCounter(page: Page): Locator {
  return statusField(page, "time");
}

/** Read the numeric core turn counter from its status value. */
async function readTurn(page: Page): Promise<number> {
  const text = await turnCounter(page).textContent();
  const match = text?.match(/\d+/);
  expect(match).not.toBeNull();
  return Number(match![0]);
}

/** Return the session-owned drag preview. */
function dragPreview(page: Page): Locator {
  return page.getByRole("status", { name: "Inventory drag preview" });
}

/** Return the renderer-independent player-cell drop highlight. */
function playerDropHighlight(page: Page): Locator {
  return page.locator("[data-inventory-drop-highlight='true']");
}

/** Press the primary pointer at the center of an inventory row. */
async function pointerDownOnItem(
  page: Page,
  item: Locator,
): Promise<{ pointerId: number; x: number; y: number }> {
  const bounds = await item.boundingBox();
  expect(bounds).not.toBeNull();
  const point = {
    x: bounds!.x + bounds!.width / 2,
    y: bounds!.y + bounds!.height / 2,
  };
  await item.evaluate((element) => {
    element.addEventListener("pointerdown", (event) => {
      if (event instanceof PointerEvent) {
        (element as HTMLElement).dataset.testPointerId = String(
          event.pointerId,
        );
      }
    }, { once: true });
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  const pointerId = Number(await item.getAttribute("data-test-pointer-id"));
  expect(Number.isInteger(pointerId)).toBe(true);
  return { ...point, pointerId };
}

/** Return one visible point inside the map drop region. */
async function visibleMapPoint(
  page: Page,
): Promise<{ x: number; y: number }> {
  const bounds = await page.locator(".nh-map-scroll").boundingBox();
  expect(bounds).not.toBeNull();
  return {
    x: bounds!.x + Math.min(24, bounds!.width / 4),
    y: bounds!.y + Math.min(24, bounds!.height / 4),
  };
}

test("uses a five-pixel threshold and rejects non-map drop targets", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const inventory = await startInventoryDragGame(
    page,
    "InventoryDragThreshold",
  );
  const rows = inventoryRows(inventory);
  const item = droppableItem(inventory);
  await expect(item).toBeVisible();
  const countBefore = await rows.count();

  const belowThreshold = await pointerDownOnItem(page, item);
  await page.mouse.move(belowThreshold.x + 4, belowThreshold.y);
  await expect(dragPreview(page)).toHaveCount(0);
  await page.mouse.up();
  await expect(rows).toHaveCount(countBefore);
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-command-input",
    "ready",
  );

  const threshold = await pointerDownOnItem(page, item);
  await page.mouse.move(threshold.x + 3, threshold.y + 4);
  await expect(dragPreview(page)).toBeVisible();

  const messages = await page.getByRole("region", {
    name: "Messages",
  }).boundingBox();
  expect(messages).not.toBeNull();
  await page.mouse.move(
    messages!.x + messages!.width / 2,
    messages!.y + messages!.height / 2,
  );
  await expect(dragPreview(page)).toBeVisible();
  await expect(dragPreview(page)).not.toContainText("Drop at your feet");
  await expect(playerDropHighlight(page)).toHaveCount(0);
  await page.mouse.up();

  await expect(dragPreview(page)).toHaveCount(0);
  await expect(rows).toHaveCount(countBefore);
  await expect(page.locator(".nh-dialog.nh-menu")).toHaveCount(0);
  expect(errors).toEqual({ console: [], page: [] });
});

test("highlights the player cell and cancels interrupted drags without commands", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const inventory = await startInventoryDragGame(
    page,
    "InventoryDragCancel",
  );
  const rows = inventoryRows(inventory);
  const item = droppableItem(inventory);
  const countBefore = await rows.count();
  const player = await readCursorPosition(page);
  const mapPoint = await visibleMapPoint(page);

  for (const reason of ["pointercancel", "lostpointercapture"] as const) {
    const pointer = await pointerDownOnItem(page, item);
    await page.mouse.move(mapPoint.x, mapPoint.y, { steps: 2 });

    await expect(dragPreview(page)).toContainText("Drop at your feet");
    await expect(playerDropHighlight(page)).toHaveAttribute(
      "data-map-x",
      String(player.x),
    );
    await expect(playerDropHighlight(page)).toHaveAttribute(
      "data-map-y",
      String(player.y),
    );
    await item.dispatchEvent(reason, {
      pointerId: pointer.pointerId,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: mapPoint.x,
      clientY: mapPoint.y,
    });
    await page.mouse.up();

    await expect(dragPreview(page)).toHaveCount(0);
    await expect(playerDropHighlight(page)).toHaveCount(0);
    await expect(rows).toHaveCount(countBefore);
    await expect(page.locator(".nh-shell")).toHaveAttribute(
      "data-command-input",
      "ready",
    );
  }

  await pointerDownOnItem(page, item);
  await page.mouse.move(mapPoint.x, mapPoint.y, { steps: 2 });
  await expect(dragPreview(page)).toContainText("Drop at your feet");
  await page.keyboard.press("Escape");
  await page.mouse.up();

  await expect(dragPreview(page)).toHaveCount(0);
  await expect(playerDropHighlight(page)).toHaveCount(0);
  await expect(rows).toHaveCount(countBefore);
  await expect(page.locator(".nh-dialog.nh-menu")).toHaveCount(0);
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-command-input",
    "ready",
  );
  expect(errors).toEqual({ console: [], page: [] });
});

test("drops one stack once and waits for a new permanent-inventory revision", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const inventory = await startInventoryDragGame(
    page,
    "InventoryDragDrop",
  );
  const rows = inventoryRows(inventory);
  const item = droppableStack(inventory);
  await expect(item).toBeVisible();
  const countBefore = await rows.count();
  const targetText = (await item.textContent())?.trim() ?? "";
  const retainedItem = wornItem(inventory);
  const retainedText = (await retainedItem.textContent())?.trim() ?? "";
  const turnBefore = await readTurn(page);
  const revisionBefore = await readShellRevision(page);
  const inventoryRevisionBefore = Number(
    await inventory.getAttribute("data-inventory-revision"),
  );

  await page.evaluate(() => {
    const initialCount = document.querySelectorAll(
      ".permanent-inventory-item:not(.permanent-inventory-heading)",
    ).length;
    document.documentElement.dataset.testRemovalInventoryRevision = "";
    const observer = new MutationObserver(() => {
      const currentCount = document.querySelectorAll(
        ".permanent-inventory-item:not(.permanent-inventory-heading)",
      ).length;
      if (currentCount >= initialCount) return;
      document.documentElement.dataset.testRemovalInventoryRevision =
        document.querySelector<HTMLElement>("[data-inventory-revision]")
          ?.dataset.inventoryRevision
          ?? "";
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

  const mapPoint = await visibleMapPoint(page);
  await pointerDownOnItem(page, item);
  await page.mouse.move(mapPoint.x, mapPoint.y, { steps: 2 });
  await expect(dragPreview(page)).toContainText("Drop at your feet");
  await page.mouse.up();

  await expect(rows).toHaveCount(countBefore - 1);
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-command-input",
    "ready",
  );
  await expect(page.locator(".nh-dialog.nh-menu")).toHaveCount(0);
  const remainingTexts = (await rows.allTextContents())
    .map((text) => text.trim());
  expect(remainingTexts).not.toContain(targetText);
  expect(remainingTexts).toContain(retainedText);
  expect(await readTurn(page)).toBeGreaterThan(turnBefore);
  const revisionAfter = await readShellRevision(page);
  const removalInventoryRevision = Number(
    await page.locator("html").getAttribute(
      "data-test-removal-inventory-revision",
    ),
  );
  expect(revisionAfter).toBeGreaterThan(revisionBefore);
  expect(removalInventoryRevision).toBeGreaterThan(inventoryRevisionBefore);
  expect(errors).toEqual({ console: [], page: [] });
});

test("keeps worn items and shows the core drop rejection without a turn", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const inventory = await startInventoryDragGame(
    page,
    "InventoryDragRejected",
  );
  const rows = inventoryRows(inventory);
  const item = wornItem(inventory);
  await expect(item).toBeVisible();
  const countBefore = await rows.count();
  const itemText = (await item.textContent())?.trim() ?? "";
  const turnBefore = await readTurn(page);

  const mapPoint = await visibleMapPoint(page);
  await pointerDownOnItem(page, item);
  await page.mouse.move(mapPoint.x, mapPoint.y, { steps: 2 });
  await expect(dragPreview(page)).toContainText("Drop at your feet");
  await page.mouse.up();

  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    "You cannot drop something you are wearing.",
  );
  await expect(rows).toHaveCount(countBefore);
  expect((await rows.allTextContents()).map((text) => text.trim()))
    .toContain(itemText);
  expect(await readTurn(page)).toBe(turnBefore);
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-command-input",
    "ready",
  );
  expect(errors).toEqual({ console: [], page: [] });
});

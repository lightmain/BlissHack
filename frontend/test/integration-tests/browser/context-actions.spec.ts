import {
  type Locator,
  type Page,
} from "@playwright/test";
import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import {
  openHome,
  startNewGameFromHome,
} from "./helpers/game-flow";
import { readCursorPosition } from "./helpers/map-viewport-state";

const COLNO = 80;
const ROWNO = 21;

/** Return the anchored menu reserved for a UI-owned core action intent. */
function contextMenu(page: Page): Locator {
  return page.locator(".nh-overlay-root .nh-context-menu[role='menu']");
}

/** Enable the requested runtime UI and start a real random game. */
async function startContextGame(
  page: Page,
  name: string,
  options: { permanentInventory?: boolean; showTime?: boolean },
): Promise<void> {
  await openHome(page, name);
  await page.getByRole("button", { name: "Settings" }).click();
  if (options.permanentInventory) {
    await page.getByRole("checkbox", {
      name: "Enable Permanent Inventory",
      exact: true,
    }).check();
  }
  if (options.showTime) {
    await page.getByRole("checkbox", { name: "Show turn count" }).check();
  }
  await page.getByRole("button", { name: "Apply" }).click();
  await startNewGameFromHome(page, name);
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-command-input",
    "ready",
  );
}

/** Resolve the center of a renderer-independent map cell in page coordinates. */
async function mapCellPoint(
  page: Page,
  mapX: number,
  mapY: number,
): Promise<{ x: number; y: number }> {
  const bounds = await page.locator(".nh-map-interaction").boundingBox();
  expect(bounds).not.toBeNull();
  return {
    x: bounds!.x + ((mapX + 0.5) / COLNO) * bounds!.width,
    y: bounds!.y + ((mapY + 0.5) / ROWNO) * bounds!.height,
  };
}

/** Assert that every selectable row preserves a numeric core identifier. */
async function expectCoreIdentifiers(menu: Locator): Promise<void> {
  const identifiers = await menu.locator(
    "[data-core-identifier]",
  ).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-core-identifier")));
  expect(identifiers.length).toBeGreaterThan(0);
  expect(identifiers.every(
    (identifier) => identifier !== null && /^\d+$/.test(identifier),
  )).toBe(true);
}

test("opens an anchored core map menu and cancels it without a turn", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startContextGame(page, "MapContext", { showTime: true });
  const cursor = await readCursorPosition(page);
  const anchor = await mapCellPoint(page, cursor.x, cursor.y);
  const turn = page.locator(
    "[data-inspect-target='status:time'] .nh-status-value",
  );
  const turnBefore = await turn.textContent();

  await page.mouse.click(anchor.x, anchor.y, { button: "right" });

  const menu = contextMenu(page);
  await expect(menu).toBeVisible();
  await expect(page.locator(".nh-dialog.nh-menu")).toHaveCount(0);
  await expectCoreIdentifiers(menu);
  const menuBounds = await menu.boundingBox();
  expect(menuBounds).not.toBeNull();
  expect(Math.abs(menuBounds!.x - anchor.x)).toBeLessThanOrEqual(32);
  expect(Math.abs(menuBounds!.y - anchor.y)).toBeLessThanOrEqual(32);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-command-input",
    "ready",
  );
  expect(await turn.textContent()).toBe(turnBefore);

  await page.keyboard.press("i");
  await expect(page.locator(".nh-dialog.nh-menu")).toBeVisible();
  await expect(contextMenu(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(errors).toEqual({ console: [], page: [] });
});

test("opens itemactions from permanent inventory without flashing its selector", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startContextGame(page, "InventoryContext", {
    permanentInventory: true,
  });
  const inventory = page.getByRole("region", { name: "Inventory" });
  const item = inventory.locator(
    ".permanent-inventory-item:not(.permanent-inventory-heading)",
  ).first();
  await expect(item).toBeVisible();
  const itemBounds = await item.boundingBox();
  expect(itemBounds).not.toBeNull();

  await page.evaluate(() => {
    document.documentElement.dataset.testTransientMenuCount = "0";
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const containsModal = node.matches(".nh-dialog.nh-menu")
            || node.querySelector(".nh-dialog.nh-menu") !== null;
          if (!containsModal) continue;
          const current = Number(
            document.documentElement.dataset.testTransientMenuCount,
          );
          document.documentElement.dataset.testTransientMenuCount =
            String(current + 1);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

  await item.click({ button: "right" });

  const menu = contextMenu(page);
  await expect(menu).toBeVisible();
  await expectCoreIdentifiers(menu);
  await expect(page.locator("html")).toHaveAttribute(
    "data-test-transient-menu-count",
    "0",
  );
  const menuBounds = await menu.boundingBox();
  expect(menuBounds).not.toBeNull();
  expect(Math.abs(menuBounds!.x - itemBounds!.x)).toBeLessThanOrEqual(32);
  expect(
    Math.abs(
      menuBounds!.y - (itemBounds!.y + itemBounds!.height / 2),
    ),
  ).toBeLessThanOrEqual(32);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-command-input",
    "ready",
  );
  expect(errors).toEqual({ console: [], page: [] });
});

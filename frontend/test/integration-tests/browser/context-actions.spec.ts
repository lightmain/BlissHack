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
  await page.getByRole("group", { name: "Action bar" })
    .getByRole("radio", { name: "Original" })
    .check();
  if (options.permanentInventory) {
    await page.getByRole("checkbox", {
      name: "Enable Permanent Inventory",
      exact: true,
    }).check();
  }
  if (options.showTime) {
    await page.getByRole("checkbox", { name: "Show turn count" }).check();
  }
  await page.getByRole("button", { name: "Apply", exact: true }).click();
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

/** Start a permanent-inventory game and return its first actionable row. */
async function startInventoryContextGame(
  page: Page,
  name: string,
): Promise<Locator> {
  await startContextGame(page, name, { permanentInventory: true });
  const item = page.getByRole("region", { name: "Inventory" }).locator(
    ".permanent-inventory-item:not(.permanent-inventory-heading)",
  ).first();
  await expect(item).toBeVisible();
  return item;
}

/** Open one item's anchored core menu and wait for its final presentation. */
async function openInventoryContextMenu(
  page: Page,
  item: Locator,
): Promise<Locator> {
  await item.click({ button: "right" });
  const menu = contextMenu(page);
  await expect(menu).toBeVisible();
  return menu;
}

/** Open the player's anchored core map menu and return its trigger and menu. */
async function openMapContextMenu(
  page: Page,
): Promise<{ map: Locator; menu: Locator }> {
  const cursor = await readCursorPosition(page);
  const anchor = await mapCellPoint(page, cursor.x, cursor.y);
  const map = page.locator("[data-context-menu-trigger='map']");
  await page.mouse.click(anchor.x, anchor.y, { button: "right" });
  const menu = contextMenu(page);
  await expect(menu).toBeVisible();
  return { map, menu };
}

test("opens an anchored core map menu and cancels it without a turn", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startContextGame(page, "MapContext", { showTime: true });
  const cursor = await readCursorPosition(page);
  const anchor = await mapCellPoint(page, cursor.x, cursor.y);
  const turn = statusField(page, "time");
  const turnBefore = await turn.textContent();

  await page.mouse.click(anchor.x, anchor.y, { button: "right" });

  const menu = contextMenu(page);
  await expect(menu).toBeVisible();
  await expect(page.locator(".nh-dialog.nh-menu")).toHaveCount(0);
  await expectCoreIdentifiers(menu);
  const menuBounds = await menu.boundingBox();
  expect(menuBounds).not.toBeNull();
  expect(Math.min(
    Math.abs(menuBounds!.x - anchor.x),
    Math.abs(menuBounds!.x + menuBounds!.width - anchor.x),
  )).toBeLessThanOrEqual(32);
  expect(Math.min(
    Math.abs(menuBounds!.y - anchor.y),
    Math.abs(menuBounds!.y + menuBounds!.height - anchor.y),
  )).toBeLessThanOrEqual(32);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-command-input",
    "ready",
  );
  const map = page.locator("[data-context-menu-trigger='map']");
  await expect(map).toBeFocused();
  await expect(map).toHaveCSS("outline-style", "none");
  expect(await turn.textContent()).toBe(turnBefore);

  await page.keyboard.press("i");
  await expect(page.locator(".nh-dialog.nh-menu")).toBeVisible();
  await expect(contextMenu(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(errors).toEqual({ console: [], page: [] });
});

test("[defect-probing] restores the map trigger after every anchored-menu dismissal", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startContextGame(page, "MapMenuFocus", { showTime: true });

  let opened = await openMapContextMenu(page);
  await expect(opened.menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(opened.menu).toHaveCount(0);
  await expect(opened.map).toBeFocused();

  opened = await openMapContextMenu(page);
  await page.mouse.click(4, 4);
  await expect(opened.menu).toHaveCount(0);
  await expect(opened.map).toBeFocused();

  opened = await openMapContextMenu(page);
  await page.mouse.click(4, 4, { button: "right" });
  await expect(opened.menu).toHaveCount(0);
  await expect(opened.map).toBeFocused();
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-command-input",
    "ready",
  );
  expect(errors).toEqual({ console: [], page: [] });
});

test("opens itemactions from permanent inventory without flashing its selector", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const item = await startInventoryContextGame(page, "InventoryContext");
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

  const menu = await openInventoryContextMenu(page, item);
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

test("uses two-column anchored actions without changing four-column menus", async ({
  page,
}) => {
  const permanentItem = await startInventoryContextGame(
    page,
    "ContextActionColumns",
  );
  const permanentStructure = await permanentItem.evaluate((row) => ({
    childClasses: Array.from(row.children, (child) => child.className),
    columnCount: getComputedStyle(row).gridTemplateColumns
      .trim()
      .split(/\s+/)
      .length,
  }));

  const anchoredMenu = await openInventoryContextMenu(page, permanentItem);
  const anchoredAction = anchoredMenu.locator("[data-core-identifier]").first();
  const anchoredStructure = await anchoredAction.evaluate((row) => ({
    childClasses: Array.from(row.children, (child) => child.className),
    columnCount: getComputedStyle(row).gridTemplateColumns
      .trim()
      .split(/\s+/)
      .length,
    glyphCount: row.querySelectorAll(".nh-menu-glyph").length,
    markCount: row.querySelectorAll(".nh-menu-mark").length,
  }));
  await page.keyboard.press("Escape");

  await page.keyboard.press("i");
  const inventoryMenu = page.locator(".nh-dialog.nh-menu");
  await expect(inventoryMenu).toBeVisible();
  const inventoryStructure = await inventoryMenu
    .locator("[data-core-identifier]")
    .first()
    .evaluate((row) => ({
      childClasses: Array.from(row.children, (child) => child.className),
      columnCount: getComputedStyle(row).gridTemplateColumns
        .trim()
        .split(/\s+/)
        .length,
    }));

  expect({
    anchored: anchoredStructure,
    inventory: inventoryStructure,
    permanent: permanentStructure,
  }).toEqual({
    anchored: {
      childClasses: ["nh-menu-accelerator", "nh-menu-text"],
      columnCount: 2,
      glyphCount: 0,
      markCount: 0,
    },
    inventory: {
      childClasses: [
        "nh-menu-glyph",
        "nh-menu-mark",
        "nh-menu-accelerator",
        "nh-menu-text",
      ],
      columnCount: 4,
    },
    permanent: {
      childClasses: [
        "nh-menu-glyph",
        "nh-menu-mark",
        "nh-menu-accelerator",
        "nh-menu-text",
      ],
      columnCount: 4,
    },
  });
});

test("[defect-probing] moves real menu focus and restores the inventory trigger after Escape", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const item = await startInventoryContextGame(page, "InventoryMenuFocus");
  const menu = await openInventoryContextMenu(page, item);
  const menuItems = menu.getByRole("menuitem");

  expect(await menuItems.count()).toBeGreaterThan(1);
  await expect(menuItems.first()).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(menuItems.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menuItems.first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(item).toBeFocused();
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-command-input",
    "ready",
  );
  expect(errors).toEqual({ console: [], page: [] });
});

test("[defect-probing] closes on left click outside and restores the inventory trigger", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const item = await startInventoryContextGame(page, "InventoryMenuLeftClose");
  const menu = await openInventoryContextMenu(page, item);

  await page.mouse.click(4, 4);

  await expect(menu).toHaveCount(0);
  await expect(item).toBeFocused();
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-command-input",
    "ready",
  );
  expect(errors).toEqual({ console: [], page: [] });
});

test("[defect-probing] prevents the native menu on right click outside and restores the inventory trigger", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const item = await startInventoryContextGame(page, "InventoryMenuRightClose");
  const menu = await openInventoryContextMenu(page, item);

  await page.evaluate(() => {
    delete document.documentElement.dataset.testContextMenuPrevented;
    document.addEventListener("contextmenu", (event) => {
      queueMicrotask(() => {
        document.documentElement.dataset.testContextMenuPrevented =
          String(event.defaultPrevented);
      });
    }, { capture: true, once: true });
  });
  await page.mouse.click(4, 4, { button: "right" });

  await expect(menu).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute(
    "data-test-context-menu-prevented",
    "true",
  );
  await expect(item).toBeFocused();
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-command-input",
    "ready",
  );
  expect(errors).toEqual({ console: [], page: [] });
});

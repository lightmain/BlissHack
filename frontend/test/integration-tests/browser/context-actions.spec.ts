import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
const PUBLIC_ROOT = new URL("../../../public/", import.meta.url);
const NEWT_ACCEPTANCE = JSON.parse(readFileSync(
  new URL("../fixtures/newt-wiki-revision-205110.json", import.meta.url),
  "utf8",
)) as { paragraphs: string[]; revision: number };

interface AssetChunk {
  bytes: number;
  file: string;
  sha256: string;
}

/** Encode one routed JSON asset exactly like the checked-in compact assets. */
function assetBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

/** Return a lowercase SHA-256 digest for routed asset bytes. */
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Route a self-consistent local asset graph which maps displayed monsters to
 * Newt while retaining production runtime validation and component loading.
 */
async function installNewtAssetRoute(page: Page): Promise<void> {
  const coreManifest = JSON.parse(readFileSync(
    new URL("encyclopedia/core/manifest.json", PUBLIC_ROOT),
    "utf8",
  )) as {
    glyphBindings: { chunks: AssetChunk[] };
  };
  const routedGlyphChunks = new Map<string, Buffer>();
  for (const metadata of coreManifest.glyphBindings.chunks) {
    const chunk = JSON.parse(readFileSync(
      new URL(`encyclopedia/core/${metadata.file}`, PUBLIC_ROOT),
      "utf8",
    )) as {
      bindings: Array<{
        status: string;
        binding?: { kind?: string; monsterId?: string };
      }>;
    };
    for (const result of chunk.bindings) {
      if (
        result.status === "supported"
        && result.binding?.kind === "monster"
      ) {
        result.binding.monsterId = "monster:PM_NEWT";
      }
    }
    const bytes = assetBytes(chunk);
    metadata.bytes = bytes.byteLength;
    metadata.sha256 = sha256(bytes);
    routedGlyphChunks.set(metadata.file, bytes);
  }

  const coreManifestBytes = assetBytes(coreManifest);
  const runtime = JSON.parse(readFileSync(
    new URL("nethack-runtime.json", PUBLIC_ROOT),
    "utf8",
  )) as {
    encyclopedia: {
      core: { manifest: { bytes: number; sha256: string } };
    };
  };
  runtime.encyclopedia.core.manifest = {
    bytes: coreManifestBytes.byteLength,
    sha256: sha256(coreManifestBytes),
  };
  const runtimeBytes = assetBytes(runtime);

  await page.route("**/nethack-runtime.json", async (route) => {
    await route.fulfill({
      body: runtimeBytes,
      contentType: "application/json",
    });
  });
  await page.route("**/encyclopedia/core/manifest.json", async (route) => {
    await route.fulfill({
      body: coreManifestBytes,
      contentType: "application/json",
    });
  });
  for (const [file, bytes] of routedGlyphChunks) {
    await page.route(`**/encyclopedia/core/${file}`, async (route) => {
      await route.fulfill({ body: bytes, contentType: "application/json" });
    });
  }
}

/** Return the anchored menu reserved for a UI-owned core action intent. */
function contextMenu(page: Page): Locator {
  return page.locator(".nh-overlay-root .nh-context-menu[role='menu']");
}

/** Enable the requested runtime UI and start a real random game. */
async function startContextGame(
  page: Page,
  name: string,
  options: {
    informationLevel?: "Original" | "Detailed";
    inventoryPosition?: "Right" | "Below";
    mapRenderer?: "Tiles" | "ASCII";
    permanentInventory?: boolean;
    showTime?: boolean;
  },
): Promise<void> {
  await openHome(page, name);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("group", { name: "Action bar" })
    .getByRole("radio", { name: "Original" })
    .check();
  await page.getByRole("group", { name: "Information level" })
    .getByRole("radio", { name: options.informationLevel ?? "Original" })
    .check();
  if (options.mapRenderer) {
    await page.getByRole("radio", { name: options.mapRenderer }).check();
  }
  if (options.permanentInventory) {
    await page.getByRole("checkbox", {
      name: "Enable Permanent Inventory",
      exact: true,
    }).check();
    if (options.inventoryPosition) {
      await page.getByRole("radio", {
        name: options.inventoryPosition === "Right"
          ? /^Right(?: \(Long\))?$/
          : "Below",
      }).check();
    }
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

/** Keep core rows unchanged while Detailed adds one semantic Examine row. */
for (const informationLevel of ["Original", "Detailed"] as const) {
  test(
    `keeps current map and inventory context contracts in ${informationLevel} mode`,
    async ({ page }) => {
    const errors = captureErrors(page);
    await startContextGame(page, `Context${informationLevel}`, {
      informationLevel,
      permanentInventory: true,
      showTime: true,
    });
    const turn = statusField(page, "time");
    const turnBefore = await turn.textContent();

    const mapContext = await openMapContextMenu(page);
    await expectCoreIdentifiers(mapContext.menu);
    expect(await mapContext.menu.getByRole("menuitem").count())
      .toBeGreaterThan(0);
    await expect(
      mapContext.menu.getByRole("menuitem", { name: /Examine/i }),
    ).toHaveCount(informationLevel === "Detailed" ? 1 : 0);
    await page.keyboard.press("Escape");
    await expect(mapContext.menu).toHaveCount(0);
    await expect(
      page.locator(".nh-shell[data-command-input='ready']"),
    ).toBeVisible();

    const item = page.getByRole("region", { name: "Inventory" }).locator(
      ".permanent-inventory-item:not(.permanent-inventory-heading)",
    ).first();
    await expect(item).toBeVisible();
    const inventoryMenu = await openInventoryContextMenu(page, item);
    await expectCoreIdentifiers(inventoryMenu);
    expect(await inventoryMenu.getByRole("menuitem").count())
      .toBeGreaterThan(0);
    await expect(
      inventoryMenu.getByRole("menuitem", { name: /Examine/i }),
    ).toHaveCount(informationLevel === "Detailed" ? 1 : 0);
    await page.keyboard.press("Escape");

    await expect(inventoryMenu).toHaveCount(0);
    await expect(page.locator(".nh-shell")).toHaveAttribute(
      "data-command-input",
      "ready",
    );
    expect(await turn.textContent()).toBe(turnBefore);
    expect(errors).toEqual({ console: [], page: [] });
    },
  );
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

test("Examine browser lifecycle: contains keys and restores an inventory trigger", async ({
  page,
}) => {
  const localRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/encyclopedia/")) {
      localRequests.push(new URL(request.url()).pathname);
    }
  });
  await startContextGame(page, "ExamineLifecycle-Arc-Hum-Mal-Law", {
    informationLevel: "Detailed",
    permanentInventory: true,
    showTime: true,
  });
  const turn = statusField(page, "time");
  const turnBefore = await turn.textContent();
  const item = page.getByRole("region", { name: "Inventory" }).locator(
    ".permanent-inventory-item:not(.permanent-inventory-heading)",
  ).first();
  const inventoryMenu = await openInventoryContextMenu(page, item);

  await page.evaluate(() => {
    const events: string[] = [];
    document.documentElement.dataset.examineHandoffEvents = "[]";
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (
            node instanceof Element
            && (
              node.matches(".nh-context-menu")
              || node.querySelector(".nh-context-menu")
            )
          ) {
            events.push("core-menu-removed");
          }
        }
        for (const node of record.addedNodes) {
          if (
            node instanceof Element
            && (
              node.matches(".examine-dialog")
              || node.querySelector(".examine-dialog")
            )
          ) {
            events.push("dialog-added");
          }
        }
      }
      document.documentElement.dataset.examineHandoffEvents =
        JSON.stringify(events);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

  await inventoryMenu.getByRole("menuitem", { name: "Examine" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(inventoryMenu).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute(
    "data-examine-handoff-events",
    '["core-menu-removed","dialog-added"]',
  );
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAttribute("data-browser-keyboard", "true");
  await expect(page.locator(".nh-terminal")).toHaveAttribute("inert", "");
  await expect(dialog.locator(".examine-facts")).toBeVisible();

  const close = dialog.getByRole("button", { name: "Close examine window" });
  const wikiPage = dialog.getByRole("link", { name: /on NetHackWiki/ });
  const license = dialog.getByRole("link", { name: /NGPL/ });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(wikiPage).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(license).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(wikiPage).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();

  const revisionBeforeLink = await page.locator(".nh-shell")
    .getAttribute("data-snapshot-revision");
  await dialog.getByRole("link").first().evaluate((link) => {
    document.addEventListener("click", (event) => event.preventDefault(), {
      capture: true,
      once: true,
    });
    (link as HTMLElement).click();
  });
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-snapshot-revision",
    revisionBeforeLink ?? "",
  );
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-command-input",
    "ready",
  );
  expect(await turn.textContent()).toBe(turnBefore);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(item).toBeFocused();

  const reopened = await openInventoryContextMenu(page, item);
  await reopened.getByRole("menuitem", { name: "Examine" }).click();
  const inventoryDialog = page.getByRole("dialog");
  await expect(inventoryDialog).toBeVisible();
  await inventoryDialog.getByRole("button", {
    name: "Close examine window",
  }).click();
  await expect(inventoryDialog).toHaveCount(0);
  await expect(item).toBeFocused();

  const backdropMenu = await openInventoryContextMenu(page, item);
  await backdropMenu.getByRole("menuitem", { name: "Examine" }).click();
  await expect(dialog).toBeVisible();
  await page.locator(".examine-backdrop").click({ position: { x: 2, y: 2 } });
  await expect(dialog).toHaveCount(0);
  await expect(item).toBeFocused();
  expect(await turn.textContent()).toBe(turnBefore);
  expect(localRequests.filter((url) => /\/object-\d+\.json$/.test(url)))
    .toHaveLength(1);
  expect(localRequests.filter((url) => url.endsWith("/wiki-001.json")))
    .toHaveLength(0);
  expect(localRequests.some((url) => url.includes("nethackwiki.com")))
    .toBe(false);
});

test("Examine map handoff: opens the supported player target after the core menu", async ({
  page,
}) => {
  await startContextGame(page, "ExamineMap-Arc-Hum-Mal-Law", {
    informationLevel: "Detailed",
    showTime: true,
  });
  const turn = statusField(page, "time");
  const turnBefore = await turn.textContent();
  const opened = await openMapContextMenu(page);
  await opened.menu.getByRole("menuitem", { name: "Examine" }).click();
  await expect(opened.menu).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await turn.textContent()).toBe(turnBefore);
});

test("Examine Newt content: renders one facts-first scroll flow without tabs in a real browser", async ({
  page,
}) => {
  await installNewtAssetRoute(page);
  await startContextGame(page, "ExamineNewtContent-Arc-Hum-Mal-Law", {
    informationLevel: "Detailed",
    showTime: true,
  });
  const turn = statusField(page, "time");
  const turnBefore = await turn.textContent();
  const opened = await openMapContextMenu(page);
  await opened.menu.getByRole("menuitem", { name: "Examine" }).click();
  const dialog = page.getByRole("dialog", { name: "Newt" });
  await expect(dialog).toBeVisible();
  const geometry = await dialog.evaluate((element) => {
    const layout = element.querySelector(".examine-layout");
    const facts = element.querySelector(".examine-facts");
    const source = element.querySelector(".examine-source-strip");
    const article = element.querySelector(".examine-article");
    const document = element.querySelector(".examine-fact-document");
    const keyFacts = element.querySelector(
      ".examine-key-facts .examine-detail-list",
    );
    const layoutBounds = layout?.getBoundingClientRect() ?? null;
    const factsBounds = facts?.getBoundingClientRect() ?? null;
    const sourceBounds = source?.getBoundingClientRect() ?? null;
    const articleBounds = article?.getBoundingClientRect() ?? null;
    const scrollOwners = Array.from(element.querySelectorAll<Element>(
      ".examine-layout, .examine-layout *",
    )).filter((candidate) => candidate.getClientRects().length > 0)
      .filter((candidate) => {
        const overflow = getComputedStyle(candidate).overflowY;
        return overflow === "auto" || overflow === "scroll";
      });
    return {
      articleTop: articleBounds?.top ?? 0,
      documentClient: document?.clientWidth ?? 0,
      documentScroll: document?.scrollWidth ?? 0,
      factsClient: facts?.clientWidth ?? 0,
      factsLeft: factsBounds?.left ?? 0,
      factsScroll: facts?.scrollWidth ?? 0,
      factsTop: factsBounds?.top ?? 0,
      factsWidth: factsBounds?.width ?? 0,
      keyFactColumns: keyFacts
        ? getComputedStyle(keyFacts).gridTemplateColumns.split(" ").length
        : 0,
      layoutClient: layout?.clientWidth ?? 0,
      layoutLeft: layoutBounds?.left ?? 0,
      layoutScroll: layout?.scrollWidth ?? 0,
      layoutWidth: layoutBounds?.width ?? 0,
      scrollOwners: scrollOwners.map((candidate) =>
        candidate.classList.contains("examine-layout")
          ? "examine-layout"
          : candidate.className
      ),
      sourceTop: sourceBounds?.top ?? 0,
    };
  });
  expect(Math.abs(geometry.factsLeft - geometry.layoutLeft))
    .toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.factsWidth - geometry.layoutWidth))
    .toBeLessThanOrEqual(1);
  expect(geometry.factsScroll).toBeLessThanOrEqual(geometry.factsClient);
  expect(geometry.documentScroll).toBeLessThanOrEqual(geometry.documentClient);
  expect(geometry.layoutScroll).toBeLessThanOrEqual(geometry.layoutClient);
  expect(geometry.keyFactColumns).toBeGreaterThan(1);
  expect(geometry.scrollOwners).toEqual(["examine-layout"]);
  expect(geometry.factsTop).toBeLessThan(geometry.sourceTop);
  expect(geometry.sourceTop).toBeLessThan(geometry.articleTop);
  await expect(dialog.locator(".examine-article")).toHaveAttribute(
    "data-source-revision",
    String(NEWT_ACCEPTANCE.revision),
  );
  await expect(dialog.getByRole("tablist")).toHaveCount(0);
  await expect(dialog.locator('[role="tab"], [role="tabpanel"]'))
    .toHaveCount(0);
  await expect(dialog.locator(".examine-article section[hidden]"))
    .toHaveCount(0);
  await expect(dialog.locator(".examine-wiki-section h2")).toHaveText([
    "Strategy",
    "History",
    "Dudley's dungeon",
  ]);
  await expect(dialog.locator(".examine-wiki-excerpt p"))
    .toHaveText(NEWT_ACCEPTANCE.paragraphs);
  await expect(dialog.locator(".examine-source-strip"))
    .toContainText(`revision ${NEWT_ACCEPTANCE.revision}`);
  await expect(dialog.locator(".examine-source-strip"))
    .toContainText("CC BY-SA 3.0");
  expect(await turn.textContent()).toBe(turnBefore);
});

test("Examine browser fallback: a real entity without Wiki stays facts-only", async ({
  page,
}) => {
  await startContextGame(page, "ExamineFactsOnly-Arc-Hum-Mal-Law", {
    informationLevel: "Detailed",
    permanentInventory: true,
    showTime: true,
  });
  const turn = statusField(page, "time");
  const turnBefore = await turn.textContent();
  const item = page.getByRole("region", { name: "Inventory" }).locator(
    ".permanent-inventory-item:not(.permanent-inventory-heading)",
  ).first();
  const opened = await openInventoryContextMenu(page, item);
  await opened.getByRole("menuitem", { name: "Examine" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".examine-facts")).toBeVisible();
  const factsGeometry = await dialog.evaluate((element) => {
    const layout = element.querySelector(".examine-layout")
      ?.getBoundingClientRect();
    const facts = element.querySelector(".examine-facts")
      ?.getBoundingClientRect();
    const factsElement = element.querySelector(".examine-facts");
    const document = element.querySelector(".examine-fact-document");
    const keyFacts = element.querySelector(
      ".examine-key-facts .examine-detail-list",
    );
    return {
      documentClient: document?.clientWidth ?? 0,
      documentScroll: document?.scrollWidth ?? 0,
      factsClient: factsElement?.clientWidth ?? 0,
      factsLeft: facts?.left ?? 0,
      factsScroll: factsElement?.scrollWidth ?? 0,
      factsWidth: facts?.width ?? 0,
      keyFactColumns: keyFacts
        ? getComputedStyle(keyFacts).gridTemplateColumns.split(" ").length
        : 0,
      layoutLeft: layout?.left ?? 0,
      layoutWidth: layout?.width ?? 0,
    };
  });
  expect(Math.abs(factsGeometry.factsLeft - factsGeometry.layoutLeft))
    .toBeLessThanOrEqual(1);
  expect(Math.abs(factsGeometry.factsWidth - factsGeometry.layoutWidth))
    .toBeLessThanOrEqual(1);
  expect(factsGeometry.factsScroll).toBeLessThanOrEqual(
    factsGeometry.factsClient,
  );
  expect(factsGeometry.documentScroll).toBeLessThanOrEqual(
    factsGeometry.documentClient,
  );
  expect(factsGeometry.keyFactColumns).toBeGreaterThan(1);
  await expect(dialog.getByRole("tablist")).toHaveCount(0);
  const factsOnlyScrollOwners = await dialog.evaluate((element) => {
    return Array.from(element.querySelectorAll<Element>(
      ".examine-layout, .examine-layout *",
    )).filter((candidate) => candidate.getClientRects().length > 0)
      .filter((candidate) => {
        const overflow = getComputedStyle(candidate).overflowY;
        return overflow === "auto" || overflow === "scroll";
      })
      .map((candidate) =>
        candidate.classList.contains("examine-layout")
          ? "examine-layout"
          : candidate.className
      );
  });
  expect(factsOnlyScrollOwners).toEqual(["examine-layout"]);
  expect(await turn.textContent()).toBe(turnBefore);
  await page.keyboard.press("Escape");
});

test("Examine browser loading: a closed slow request cannot reopen after resolve", async ({
  page,
}) => {
  let releaseChunk: (() => void) | undefined;
  let markRequested: (() => void) | undefined;
  const chunkRequested = new Promise<void>((resolve) => {
    markRequested = resolve;
  });
  const releaseGate = new Promise<void>((resolve) => {
    releaseChunk = resolve;
  });
  await page.route(
    "**/encyclopedia/core/object-*.json",
    async (route) => {
      markRequested?.();
      await releaseGate;
      await route.fallback();
    },
  );
  await startContextGame(page, "ExamineSlow-Arc-Hum-Mal-Law", {
    informationLevel: "Detailed",
    permanentInventory: true,
    showTime: true,
  });
  const turn = statusField(page, "time");
  const turnBefore = await turn.textContent();
  const item = page.getByRole("region", { name: "Inventory" }).locator(
    ".permanent-inventory-item:not(.permanent-inventory-heading)",
  ).first();
  const opened = await openInventoryContextMenu(page, item);
  await opened.getByRole("menuitem", { name: "Examine" }).click();
  await chunkRequested;
  const loading = page.getByRole("dialog", { name: "Loading" });
  await expect(loading).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(loading).toHaveCount(0);
  await expect(item).toBeFocused();
  releaseChunk?.();
  await page.waitForTimeout(250);

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-command-input",
    "ready",
  );
  expect(await turn.textContent()).toBe(turnBefore);
});

test("Examine browser fallback: invalid core data closes the loading request", async ({
  page,
}) => {
  await installNewtAssetRoute(page);
  await page.route("**/encyclopedia/core/monster-003.json", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.abort("failed");
  });
  await startContextGame(page, "ExamineCoreFailure-Arc-Hum-Mal-Law", {
    informationLevel: "Detailed",
    showTime: true,
  });
  const turn = statusField(page, "time");
  const turnBefore = await turn.textContent();
  const opened = await openMapContextMenu(page);
  await opened.menu.getByRole("menuitem", { name: "Examine" }).click();
  const loading = page.getByRole("dialog", { name: "Loading" });
  await expect(loading).toBeVisible();
  await expect(loading).toHaveCount(0);
  await expect(opened.map).toBeFocused();
  expect(await turn.textContent()).toBe(turnBefore);
});

const EXAMINE_LAYOUTS = [
  {
    height: 900,
    overflowOwners: 1,
    position: "Right" as const,
    renderer: "Tiles" as const,
    width: 1280,
  },
  {
    height: 700,
    overflowOwners: 1,
    position: "Below" as const,
    renderer: "ASCII" as const,
    width: 900,
  },
  {
    height: 800,
    overflowOwners: 1,
    position: "Below" as const,
    renderer: "Tiles" as const,
    width: 700,
  },
  {
    height: 600,
    overflowOwners: 1,
    position: "Right" as const,
    renderer: "ASCII" as const,
    width: 900,
  },
] as const;

for (const viewport of [
  { width: 700, height: 800 },
  { width: 900, height: 600 },
] as const) {
  test(
    `Examine Wiki responsive layout: ${viewport.width}x${viewport.height}`,
    async ({ page }) => {
      await page.setViewportSize(viewport);
      await installNewtAssetRoute(page);
      await startContextGame(
        page,
        `ExamineWiki${viewport.width}x${viewport.height}-Arc-Hum-Mal-Law`,
        { informationLevel: "Detailed" },
      );
      const opened = await openMapContextMenu(page);
      await opened.menu.getByRole("menuitem", { name: "Examine" }).click();
      const dialog = page.getByRole("dialog", { name: "Newt" });
      await expect(dialog).toBeVisible();

      const geometry = await dialog.evaluate((element) => {
        const facts = element.querySelector(".examine-facts");
        const document = element.querySelector(".examine-fact-document");
        const candidates = Array.from(element.querySelectorAll<Element>(
          ".examine-layout, .examine-layout *",
        )).filter((candidate) => candidate.getClientRects().length > 0);
        return {
          documentClient: document?.clientWidth ?? 0,
          documentScroll: document?.scrollWidth ?? 0,
          factsClient: facts?.clientWidth ?? 0,
          factsScroll: facts?.scrollWidth ?? 0,
          overflowOwners: candidates.filter((candidate) => {
            const overflow = getComputedStyle(candidate).overflowY;
            return overflow === "auto" || overflow === "scroll";
          }).length,
        };
      });

      expect(geometry.factsScroll).toBeLessThanOrEqual(geometry.factsClient);
      expect(geometry.documentScroll)
        .toBeLessThanOrEqual(geometry.documentClient);
      expect(geometry.overflowOwners).toBe(1);
      await expect(dialog.getByRole("tablist")).toHaveCount(0);
    },
  );
}

for (const variant of EXAMINE_LAYOUTS) {
  test(
    `Examine responsive layout: ${variant.width}x${variant.height} `
      + `${variant.renderer}/${variant.position}`,
    async ({ page }) => {
      await page.setViewportSize({
        width: variant.width,
        height: variant.height,
      });
      await startContextGame(
        page,
        `Examine${variant.width}x${variant.height}-Arc-Hum-Mal-Law`,
        {
          informationLevel: "Detailed",
          inventoryPosition: variant.position,
          mapRenderer: variant.renderer,
          permanentInventory: true,
        },
      );
      const item = page.getByRole("region", { name: "Inventory" }).locator(
        ".permanent-inventory-item:not(.permanent-inventory-heading)",
      ).first();
      const opened = await openInventoryContextMenu(page, item);
      await opened.getByRole("menuitem", { name: "Examine" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.locator(".examine-portrait")).toHaveAttribute(
        "data-examine-renderer",
        variant.renderer.toLowerCase(),
      );
      await expect(page.getByRole("region", { name: "Inventory" }))
        .toHaveAttribute("data-position", variant.position.toLowerCase());

      const geometry = await dialog.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const article = element.querySelector(".examine-article");
        const facts = element.querySelector(".examine-facts");
        const factDocument = element.querySelector(".examine-fact-document");
        const keyFacts = element.querySelector(
          ".examine-key-facts .examine-detail-list",
        );
        const candidates = Array.from(element.querySelectorAll<Element>(
          ".examine-layout, .examine-layout *",
        )).filter((candidate) => candidate.getClientRects().length > 0);
        const overflowOwners = candidates.filter((candidate) => {
          const overflow = getComputedStyle(candidate).overflowY;
          return overflow === "auto" || overflow === "scroll";
        }).length;
        const articleBounds = article?.getBoundingClientRect() ?? null;
        const factsBounds = facts?.getBoundingClientRect() ?? null;
        const overlap = articleBounds && factsBounds
          ? !(
            articleBounds.right <= factsBounds.left
            || factsBounds.right <= articleBounds.left
            || articleBounds.bottom <= factsBounds.top
            || factsBounds.bottom <= articleBounds.top
          )
          : false;
        return {
          bounds: {
            bottom: bounds.bottom,
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
          },
          documentOverflow:
            document.documentElement.scrollHeight > innerHeight
            || document.documentElement.scrollWidth > innerWidth,
          factDocumentClient: factDocument?.clientWidth ?? 0,
          factDocumentScroll: factDocument?.scrollWidth ?? 0,
          factsClient: facts?.clientWidth ?? 0,
          factsScroll: facts?.scrollWidth ?? 0,
          keyFactColumns: keyFacts
            ? getComputedStyle(keyFacts).gridTemplateColumns.split(" ").length
            : 0,
          overlap,
          overflowOwners,
        };
      });

      expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
      expect(geometry.bounds.top).toBeGreaterThanOrEqual(0);
      expect(geometry.bounds.right).toBeLessThanOrEqual(variant.width);
      expect(geometry.bounds.bottom).toBeLessThanOrEqual(variant.height);
      expect(geometry.documentOverflow).toBe(false);
      expect(geometry.factsScroll).toBeLessThanOrEqual(geometry.factsClient);
      expect(geometry.factDocumentScroll)
        .toBeLessThanOrEqual(geometry.factDocumentClient);
      expect(geometry.keyFactColumns).toBeGreaterThan(1);
      expect(geometry.overlap).toBe(false);
      expect(geometry.overflowOwners).toBe(variant.overflowOwners);
    },
  );
}

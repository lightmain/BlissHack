import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import {
  openHome,
  startNewGameFromHome,
} from "./helpers/game-flow";
import { readShellRevision } from "./helpers/map-viewport-state";
import { readDownload } from "./helpers/save-flow";

interface ActionBarLayoutDocument {
  schemaVersion: number;
  actionBarLayout: {
    activeCategory: string;
    all: Array<{
      category: string;
      columns: number;
      slots: Array<string | null>;
    }>;
    categories: Record<string, Array<string | null>>;
    locked: boolean;
    rows: 1 | 2 | 3 | 4;
  };
}

interface RenderedActionGrid {
  horizontalOverflow: boolean;
  sections: Array<{
    columns: number;
    emptySlots: number;
    slots: number;
  }>;
  slotSizes: Array<{ height: number; width: number }>;
  viewportClientWidth: number;
  viewportScrollWidth: number;
}

/** Start a real game with the BlissHack action bar selected. */
async function startActionBarGame(page: Page, marker: string): Promise<void> {
  await openHome(page, marker);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("group", { name: "Action bar" })
    .getByRole("radio", { name: "BlissHack" })
    .check();
  await page.getByRole("button", { name: "Apply" }).click();
  await startNewGameFromHome(page, `${marker}-Arc-Hum-Mal-Law`);
  await expect(page.locator(".nh-shell"))
    .toHaveAttribute("data-command-input", "ready");
  await expect(page.getByRole("region", {
    name: "Action bar",
    exact: true,
  })).toBeVisible();
}

/** Read the complete-column and overflow contract from the rendered grid. */
async function readActionGrid(dock: Locator): Promise<RenderedActionGrid> {
  return dock.evaluate((element) => {
    const viewport = element.querySelector<HTMLElement>(
      ".nh-action-grid-viewport",
    );
    if (!viewport) throw new Error("Expected one action grid viewport");
    const slots = [...element.querySelectorAll<HTMLElement>(
      "[data-action-slot]",
    )];
    return {
      horizontalOverflow:
        element.getAttribute("data-horizontal-overflow") === "true",
      sections: [...element.querySelectorAll<HTMLElement>(
        "[data-action-section]",
      )].map((section) => {
        const sectionSlots = [...section.querySelectorAll<HTMLElement>(
          ":scope > [data-action-slot]",
        )];
        return {
          columns: getComputedStyle(section).gridTemplateColumns
            .split(/\s+/)
            .filter(Boolean)
            .length,
          emptySlots: sectionSlots.filter(
            (slot) => slot.hasAttribute("data-empty-action-slot"),
          ).length,
          slots: sectionSlots.length,
        };
      }),
      slotSizes: slots.map((slot) => {
        const bounds = slot.getBoundingClientRect();
        return { height: bounds.height, width: bounds.width };
      }),
      viewportClientWidth: viewport.clientWidth,
      viewportScrollWidth: viewport.scrollWidth,
    };
  });
}

/** Assert one live action grid uses complete columns and honest overflow. */
async function expectActionGrid(
  dock: Locator,
  rows: 1 | 2 | 3 | 4,
): Promise<void> {
  await expect(dock).toHaveAttribute("data-row-count", String(rows));
  const grid = await readActionGrid(dock);
  expect(grid.sections).toHaveLength(4);
  for (const section of grid.sections) {
    expect(section.columns).toBeGreaterThan(0);
    expect(section.slots).toBe(section.columns * rows);
  }
  if (rows > 1) {
    expect(grid.sections.at(-1)?.emptySlots).toBeGreaterThanOrEqual(rows);
  }
  for (const size of grid.slotSizes) {
    expect(size.width).toBeGreaterThanOrEqual(32);
    expect(size.height).toBeGreaterThanOrEqual(32);
  }
  if (grid.horizontalOverflow) {
    expect(grid.viewportScrollWidth).toBeGreaterThan(grid.viewportClientWidth);
  } else {
    expect(grid.viewportScrollWidth).toBeLessThanOrEqual(
      grid.viewportClientWidth,
    );
  }
}

/** Drag with primary Pointer Events instead of the HTML drag-and-drop API. */
async function pointerDrag(
  page: Page,
  source: Locator,
  target: Locator,
): Promise<void> {
  const sourceBounds = await source.boundingBox();
  const targetBounds = await target.boundingBox();
  expect(sourceBounds).not.toBeNull();
  expect(targetBounds).not.toBeNull();
  await page.mouse.move(
    sourceBounds!.x + sourceBounds!.width / 2,
    sourceBounds!.y + sourceBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBounds!.x + targetBounds!.width / 2,
    targetBounds!.y + targetBounds!.height / 2,
    { steps: 8 },
  );
}

/** Read the profile-owned action layout from browser storage. */
async function readPersistedLayout(
  page: Page,
): Promise<ActionBarLayoutDocument["actionBarLayout"] | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("blisshack.profile.v4");
    if (!raw) return null;
    return (JSON.parse(raw) as {
      interface?: { actionBarLayout?: unknown };
    }).interface?.actionBarLayout ?? null;
  }) as Promise<ActionBarLayoutDocument["actionBarLayout"] | null>;
}

test("Action bar integration: keeps geometry, focus, Pointer Events, and a real WASM command coherent", async ({
  page,
}) => {
  test.slow();
  const errors = captureErrors(page);
  await startActionBarGame(page, "ActionBarContract");
  const dock = page.getByRole("region", {
    name: "Action bar",
    exact: true,
  });

  await expectActionGrid(dock, 2);
  await page.getByRole("button", { name: "Unlock action bar" }).click();
  await expect(page.getByRole("button", { name: "Lock action bar" }))
    .toBeVisible();

  await page.getByRole("button", { name: "Decrease rows" }).click();
  await expectActionGrid(dock, 1);
  expect((await readActionGrid(dock)).horizontalOverflow).toBe(true);
  for (const rows of [2, 3, 4] as const) {
    await page.getByRole("button", { name: "Increase rows" }).click();
    await expectActionGrid(dock, rows);
  }
  await expect(page.getByRole("button", { name: "Increase rows" }))
    .toBeDisabled();

  await page.getByRole("button", { name: "Lock action bar" }).click();
  const first = dock.locator(
    '[data-action-slot-area="all"][data-action-slot-category="common"]'
      + '[data-slot-index="0"]',
  );
  const second = dock.locator(
    '[data-action-slot-area="all"][data-action-slot-category="common"]'
      + '[data-slot-index="1"]',
  );
  await expect(first).toHaveAttribute("data-action-name", "eat");
  await expect(second).toHaveAttribute("data-action-name", "quaff");
  await pointerDrag(page, first, second);
  await expect(dock).toHaveAttribute("data-layout-edit-status", "dragging");
  await expect(page.getByRole("button", { name: "Unlock action bar" }))
    .toHaveAttribute("data-lock-rejected", "true");
  await page.mouse.up();
  await expect(dock).toHaveAttribute("data-layout-edit-status", "idle");
  await expect(first).toHaveAttribute("data-action-name", "eat");
  await expect(second).toHaveAttribute("data-action-name", "quaff");

  await page.getByRole("button", { name: "Unlock action bar" }).click();
  await pointerDrag(page, first, second);
  await expect(dock).toHaveAttribute("data-layout-edit-status", "dragging");
  await page.mouse.up();
  await expect(dock).toHaveAttribute("data-layout-edit-status", "idle");
  await expect(first).toHaveAttribute("data-action-name", "quaff");
  await expect(second).toHaveAttribute("data-action-name", "eat");
  await expect.poll(async () => (await readPersistedLayout(page))
    ?.all[0]?.slots.slice(0, 2)).toEqual(["quaff", "eat"]);

  const allActions = page.getByRole("button", { name: "All Actions" });
  await allActions.click();
  const panel = page.getByRole("dialog", { name: "All Actions" });
  await expect(panel.getByRole("button", { name: "Close All Actions" }))
    .toBeFocused();
  const catalogNames = await panel.locator("[data-action-name]")
    .evaluateAll((actions) =>
      actions.map((action) => action.getAttribute("data-action-name")));
  expect(catalogNames).toHaveLength(104);
  expect(new Set(catalogNames).size).toBe(104);
  await page.keyboard.press("Shift+Tab");
  await expect(panel.getByRole("button", {
    name: "Import action bar layout",
  })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(allActions).toBeFocused();

  const revision = await readShellRevision(page);
  const search = dock.locator('[data-action-name="search"]');
  await expect(search).toHaveAttribute("data-action-state", "available");
  await search.click();
  await expect.poll(async () => {
    const ready = await page.locator(".nh-shell")
      .getAttribute("data-command-input");
    return ready === "ready" && await readShellRevision(page) > revision;
  }).toBe(true);
  expect(errors).toEqual({ console: [], page: [] });
});

test("Action bar layout transfer: exports, cancels, rejects damage, and rolls back atomically", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startActionBarGame(page, "ActionBarTransfer");
  const dock = page.getByRole("region", {
    name: "Action bar",
    exact: true,
  });
  await page.getByRole("button", { name: "All Actions" }).click();
  const panel = page.getByRole("dialog", { name: "All Actions" });
  const fileInput = panel.locator('input[type="file"]');

  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", {
    name: "Export action bar layout",
  }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "blisshack-action-bar.bhactions",
  );
  const exportedText = (await readDownload(download)).toString("utf8");
  expect(exportedText.endsWith("\n")).toBe(true);
  const exported = JSON.parse(exportedText) as ActionBarLayoutDocument;
  expect(exported).toMatchObject({
    schemaVersion: 1,
    actionBarLayout: {
      activeCategory: "all",
      locked: true,
      rows: 2,
    },
  });

  await fileInput.setInputFiles({
    name: "damaged.bhactions",
    mimeType: "application/json",
    buffer: Buffer.from("{bad"),
  });
  await expect(panel.locator(".nh-all-actions-error")).toContainText(
    "damaged, unsupported, or invalid",
  );
  await expect(panel.locator("[data-action-layout-import-preview]"))
    .toHaveCount(0);

  const incoming = structuredClone(exported);
  incoming.actionBarLayout.rows = 3;
  incoming.actionBarLayout.locked = false;
  incoming.actionBarLayout.activeCategory = "custom";
  incoming.actionBarLayout.categories.custom = [
    "wait",
    null,
    "search",
  ];
  const incomingBytes = Buffer.from(`${JSON.stringify(incoming, null, 2)}\n`);
  await fileInput.setInputFiles({
    name: "custom.bhactions",
    mimeType: "application/json",
    buffer: incomingBytes,
  });
  const preview = panel.getByRole("region", {
    name: "Review action bar layout import",
  });
  await expect(preview).toContainText("Rows");
  await expect(preview).toContainText("Active category");
  await expect(preview).toContainText("Layout lock");
  await expect(preview).toContainText("Slots");
  await preview.getByRole("button", { name: "Cancel" }).click();
  await expect(preview).toHaveCount(0);
  expect((await readPersistedLayout(page))?.rows).toBe(2);

  await fileInput.setInputFiles({
    name: "custom.bhactions",
    mimeType: "application/json",
    buffer: incomingBytes,
  });
  await preview.getByRole("button", { name: "Import", exact: true }).click();
  await expect.poll(async () => {
    if (await preview.count() === 0) return "accepted";
    const error = panel.locator(".nh-all-actions-error");
    return await error.isVisible() ? "reported-failure" : "pending";
  }).not.toBe("pending");
  await expect(dock).toHaveAttribute("data-row-count", "3");
  await expect(page.getByRole("button", { name: "Lock action bar" }))
    .toBeVisible();
  await expect.poll(() => readPersistedLayout(page))
    .toEqual(incoming.actionBarLayout);
  await expect(preview).toHaveCount(0);
  await expect(panel.locator(".nh-all-actions-error")).toHaveCount(0);
  const revisionAfterImport = await readShellRevision(page);
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", {
    name: "Export action bar layout",
  })).toBeFocused();
  await page.waitForTimeout(100);
  expect(await readShellRevision(page)).toBe(revisionAfterImport);
  await expect(page.locator(".nh-shell"))
    .toHaveAttribute("data-command-input", "ready");

  const rejected = structuredClone(incoming);
  rejected.actionBarLayout.rows = 4;
  rejected.actionBarLayout.locked = true;
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function failProfileWrite(
      key: string,
      value: string,
    ): void {
      if (key === "blisshack.profile.v4") {
        Storage.prototype.setItem = original;
        throw new Error("blocked action layout persistence");
      }
      original.call(this, key, value);
    };
  });
  await fileInput.setInputFiles({
    name: "rejected.bhactions",
    mimeType: "application/json",
    buffer: Buffer.from(`${JSON.stringify(rejected, null, 2)}\n`),
  });
  await preview.getByRole("button", { name: "Import", exact: true }).click();
  await expect(panel.locator(".nh-all-actions-error")).toContainText(
    "previous layout is unchanged",
  );
  await expect(dock).toHaveAttribute("data-row-count", "3");
  await expect(dock).toHaveAttribute("data-layout-edit-status", "error");
  expect(await readPersistedLayout(page)).toEqual(incoming.actionBarLayout);
  expect(errors).toEqual({ console: [], page: [] });
});

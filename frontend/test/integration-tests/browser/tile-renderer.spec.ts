import type {
  Locator,
  Page,
  TestInfo,
} from "@playwright/test";
import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import {
  openHome,
  readCursorPosition,
  startNewGame,
  startNewGameFromHome,
} from "./helpers/game-flow";

const DIAGNOSTIC_STORAGE_KEY = "blisshack.diagnostics.v1";
const PROFILE_STORAGE_KEY = "blisshack.profile.v2";

interface TileAssetRequestCounts {
  manifest: number;
  png: number;
}

interface StoredDiagnosticEvent {
  event: string;
  sessionId: string | null;
}

interface CanvasPixelSummary {
  nonTransparentPixels: number;
  opaqueColorCount: number;
}

/**
 * Count requests for each checked-in tile resource during one page lifetime.
 * @param page - Playwright page whose requests should be observed.
 * @returns mutable counters updated by later requests.
 */
function countTileAssetRequests(page: Page): TileAssetRequestCounts {
  const counts = { manifest: 0, png: 0 };
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/tiles/nethack-classic.json")) counts.manifest += 1;
    if (path.endsWith("/tiles/nethack-classic.png")) counts.png += 1;
  });
  return counts;
}

/**
 * Read the persisted diagnostic events without changing application state.
 * @param page - Playwright page with access to the application origin.
 * @returns sanitized events retained by the browser diagnostic log.
 */
async function readDiagnosticEvents(
  page: Page,
): Promise<StoredDiagnosticEvent[]> {
  return page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { events?: StoredDiagnosticEvent[] };
    return Array.isArray(parsed.events) ? parsed.events : [];
  }, DIAGNOSTIC_STORAGE_KEY);
}

/**
 * Wait until a named diagnostic event has been persisted.
 * @param page - Playwright page under test.
 * @param eventName - exact diagnostic event name.
 */
async function expectDiagnosticEvent(
  page: Page,
  eventName: string,
): Promise<void> {
  await expect.poll(async () => {
    const events = await readDiagnosticEvents(page);
    return events.some(({ event }) => event === eventName);
  }).toBe(true);
}

/**
 * Return the session IDs recorded by the real WASM startup lifecycle.
 * @param page - running game page.
 * @returns session IDs in diagnostic sequence order.
 */
async function readCreatedSessionIds(page: Page): Promise<Array<string | null>> {
  return (await readDiagnosticEvents(page))
    .filter(({ event }) => event === "session.created")
    .map(({ sessionId }) => sessionId);
}

/**
 * Summarize actual Canvas pixels through getImageData.
 * @param canvas - visible tile-map canvas.
 * @returns opaque pixel count and distinct opaque RGBA color count.
 */
async function readCanvasPixels(
  canvas: Locator,
): Promise<CanvasPixelSummary> {
  return canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) {
      throw new Error("Tile map is not a canvas");
    }
    const context = element.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Tile map has no 2D context");
    const pixels = context.getImageData(
      0,
      0,
      element.width,
      element.height,
    ).data;
    const colors = new Set<string>();
    let nonTransparentPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] === 0) continue;
      nonTransparentPixels += 1;
      colors.add(
        `${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},`
          + `${pixels[offset + 3]}`,
      );
    }
    return {
      nonTransparentPixels,
      opaqueColorCount: colors.size,
    };
  });
}

/**
 * Capture one viewport and prove the rendered map stays above the status area.
 * @param page - running Tiles game page.
 * @param testInfo - current Playwright artifact sink.
 * @param width - viewport width in CSS pixels.
 * @param height - viewport height in CSS pixels.
 */
async function attachViewportEvidence(
  page: Page,
  testInfo: TestInfo,
  width: number,
  height: number,
): Promise<void> {
  await page.setViewportSize({ width, height });
  const map = page.locator(".nh-map-scroll");
  const status = page.getByRole("region", { name: "Character status" });
  await expect(page.locator("canvas.nh-map-tiles")).toBeVisible();
  const [mapBox, statusBox] = await Promise.all([
    map.boundingBox(),
    status.boundingBox(),
  ]);
  expect(mapBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(mapBox!.y + mapBox!.height).toBeLessThanOrEqual(statusBox!.y + 0.5);
  await testInfo.attach(`tiles-${width}x${height}.png`, {
    body: await page.screenshot({ animations: "disabled" }),
    contentType: "image/png",
  });
}

/**
 * Change the in-game renderer through the player-visible Settings workflow.
 * @param page - running game page at command input.
 * @param renderer - display option to apply.
 */
async function switchMapRenderer(
  page: Page,
  renderer: "Tiles" | "ASCII",
): Promise<void> {
  await page.keyboard.press("Escape");
  const pause = page.getByRole("dialog", { name: "Game paused" });
  await expect(pause).toBeVisible();
  await pause.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: renderer }).check();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(pause).toBeVisible();
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-settings-status",
    "applied",
  );
  await pause.getByRole("button", { name: "Resume" }).click();
  await expect(pause).toHaveCount(0);
}

/**
 * Disable automatic map following through in-game Settings.
 * @param page - running game page at command input.
 */
async function disablePlayerFollowing(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  const pause = page.getByRole("dialog", { name: "Game paused" });
  await expect(pause).toBeVisible();
  await pause.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("checkbox", {
    name: "Follow player on the map",
  }).uncheck();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(pause).toBeVisible();
  await pause.getByRole("button", { name: "Resume" }).click();
  await expect(pause).toHaveCount(0);
}

/**
 * Read the normalized horizontal center of the visible map viewport.
 * @param viewport - map scroll container.
 * @returns center position as a fraction of the rendered map width.
 */
async function readHorizontalScrollAnchor(viewport: Locator): Promise<number> {
  return viewport.evaluate((element) =>
    (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth);
}

/**
 * Read the exact persisted profile value for fallback mutation checks.
 * @param page - page at the application origin.
 * @returns serialized profile or null when defaults were never persisted.
 */
async function readStoredProfile(page: Page): Promise<string | null> {
  return page.evaluate(
    (storageKey) => localStorage.getItem(storageKey),
    PROFILE_STORAGE_KEY,
  );
}

/**
 * Verify that fallback rendering leaves the active renderer preference on Tiles.
 * @param page - running fallback game page.
 */
async function expectTilesPreference(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  const pause = page.getByRole("dialog", { name: "Game paused" });
  await expect(pause).toBeVisible();
  await pause.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("radio", { name: "Tiles" })).toBeChecked();
}

test(
  "renders default Tiles pixels and switches renderers without restarting",
  async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    const assetRequests = countTileAssetRequests(page);
    await startNewGame(page, "TileRenderer");

    const canvas = page.locator("canvas.nh-map-tiles");
    await expect(canvas).toBeVisible();
    const pixels = await readCanvasPixels(canvas);
    expect(pixels.nonTransparentPixels).toBeGreaterThan(0);
    expect(pixels.opaqueColorCount).toBeGreaterThan(1);
    expect(assetRequests).toEqual({ manifest: 1, png: 1 });

    const initialCursor = await readCursorPosition(page);
    await expect.poll(async () => readCreatedSessionIds(page)).toHaveLength(1);
    const initialSessionIds = await readCreatedSessionIds(page);
    expect(initialSessionIds[0]).not.toBeNull();

    await attachViewportEvidence(page, testInfo, 1280, 900);
    await attachViewportEvidence(page, testInfo, 900, 700);
    await disablePlayerFollowing(page);
    const viewport = page.locator(".nh-map-scroll");
    await viewport.evaluate(async (element) => {
      element.scrollLeft = Math.min(
        300,
        element.scrollWidth - element.clientWidth,
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(await viewport.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    const manualAnchor = await readHorizontalScrollAnchor(viewport);

    await switchMapRenderer(page, "ASCII");
    await expect(page.locator(".nh-map-ascii")).toBeVisible();
    await expect.poll(async () => readCursorPosition(page)).toEqual(
      initialCursor,
    );
    expect(await readCreatedSessionIds(page)).toEqual(initialSessionIds);

    await switchMapRenderer(page, "Tiles");
    await expect(canvas).toBeVisible();
    await expect.poll(async () =>
      readHorizontalScrollAnchor(viewport)).toBeCloseTo(manualAnchor, 2);
    await expect.poll(async () => readCursorPosition(page)).toEqual(
      initialCursor,
    );
    expect(await readCreatedSessionIds(page)).toEqual(initialSessionIds);
    expect(assetRequests.manifest).toBeLessThanOrEqual(1);
    expect(assetRequests.png).toBeLessThanOrEqual(1);

    await testInfo.attach("tile-asset-requests.json", {
      body: JSON.stringify(assetRequests, null, 2),
      contentType: "application/json",
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(errors).toEqual({ console: [], page: [] });
  },
);

test("falls back to ASCII when the tile PNG is unavailable", async ({
  page,
}) => {
  let blockedPngRequests = 0;
  await page.route("**/tiles/nethack-classic.png", async (route) => {
    blockedPngRequests += 1;
    await route.abort("failed");
  });
  await openHome(page, "tiles-assets-fallback");
  const storedProfile = await readStoredProfile(page);

  await startNewGameFromHome(page, "TileAssetsFallback");
  await expectDiagnosticEvent(page, "map.tiles_assets_fallback");
  await expect(page.locator(".nh-map-ascii")).toBeVisible();
  await expect(page.locator("canvas.nh-map-tiles")).toHaveCount(0);
  expect(blockedPngRequests).toBe(1);
  expect(await readStoredProfile(page)).toBe(storedProfile);
  await expectTilesPreference(page);
});

test("falls back to ASCII when a 2D Canvas context is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => null,
    });
  });
  await openHome(page, "tiles-canvas-fallback");
  const storedProfile = await readStoredProfile(page);

  await startNewGameFromHome(page, "TileCanvasFallback");
  await expectDiagnosticEvent(page, "map.tiles_canvas_fallback");
  await expect(page.locator(".nh-map-ascii")).toBeVisible();
  await expect(page.locator("canvas.nh-map-tiles")).toHaveCount(0);
  expect(await readStoredProfile(page)).toBe(storedProfile);
  await expectTilesPreference(page);
});

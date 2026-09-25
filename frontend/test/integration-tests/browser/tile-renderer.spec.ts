import type {
  Locator,
  Page,
  TestInfo,
} from "@playwright/test";
import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import {
  moveToAdjacentFloor,
  openHome,
  startNewGame,
  startNewGameFromHome,
} from "./helpers/game-flow";
import {
  readCursorPosition,
  readMapRenderer,
  readMapScrollAnchor,
  readShellRevision,
} from "./helpers/map-viewport-state";

const DIAGNOSTIC_STORAGE_KEY = "blisshack.diagnostics.v1";
const PROFILE_STORAGE_KEY = "blisshack.profile.v4";

interface TileAssetRequestCounts {
  manifest: number;
  png: number;
}

interface StoredDiagnosticEvent {
  event: string;
  sessionId: string | null;
}

interface CanvasPixelSummary {
  distinctNearbyTileCount: number;
  nonTransparentPixels: number;
  nonTransparentNearbyTileCount: number;
  opaqueColorCount: number;
}

interface PointerPoint {
  x: number;
  y: number;
}

interface HorizontalScrollState {
  left: number;
  maxLeft: number;
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
    const tileWidth = element.width / 80;
    const tileHeight = element.height / 21;
    const parent = element.closest<HTMLElement>(".nh-map-interaction");
    const cursorX = Number(parent?.dataset.cursorX);
    const cursorY = Number(parent?.dataset.cursorY);
    const nearbyTiles = new Set<string>();
    let nonTransparentNearbyTileCount = 0;
    for (
      let y = Math.max(0, cursorY - 2);
      y <= Math.min(20, cursorY + 2);
      y += 1
    ) {
      for (
        let x = Math.max(1, cursorX - 2);
        x <= Math.min(79, cursorX + 2);
        x += 1
      ) {
        const tilePixels = context.getImageData(
          Math.round(x * tileWidth),
          Math.round(y * tileHeight),
          Math.round(tileWidth),
          Math.round(tileHeight),
        ).data;
        let hash = 2166136261;
        let tileOpaquePixels = 0;
        for (let offset = 0; offset < tilePixels.length; offset += 4) {
          if (tilePixels[offset + 3] > 0) tileOpaquePixels += 1;
          hash = Math.imul(hash ^ tilePixels[offset], 16777619);
          hash = Math.imul(hash ^ tilePixels[offset + 1], 16777619);
          hash = Math.imul(hash ^ tilePixels[offset + 2], 16777619);
          hash = Math.imul(hash ^ tilePixels[offset + 3], 16777619);
        }
        if (tileOpaquePixels > 0) {
          nonTransparentNearbyTileCount += 1;
          nearbyTiles.add(`${tileOpaquePixels}:${hash >>> 0}`);
        }
      }
    }
    return {
      distinctNearbyTileCount: nearbyTiles.size,
      nonTransparentPixels,
      nonTransparentNearbyTileCount,
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
  const viewport = page.locator(".nh-map-scroll");
  const canvas = page.locator("canvas.nh-map-tiles");
  const status = page.getByRole("region", { name: "Character status" });
  await expect(canvas).toBeVisible();
  const [viewportBox, canvasBox, statusBox, dimensions] = await Promise.all([
    viewport.boundingBox(),
    canvas.boundingBox(),
    status.boundingBox(),
    canvas.evaluate((element) => {
      if (!(element instanceof HTMLCanvasElement)) {
        throw new Error("Tile map is not a canvas");
      }
      const bounds = element.getBoundingClientRect();
      const viewport = element.closest<HTMLElement>(".nh-map-scroll");
      return {
        backingHeight: element.height,
        backingWidth: element.width,
        cssHeight: bounds.height,
        cssWidth: bounds.width,
        clientHeight: viewport?.clientHeight ?? 0,
        devicePixelRatio: window.devicePixelRatio,
        imageRendering: getComputedStyle(element).imageRendering,
        scrollHeight: viewport?.scrollHeight ?? 0,
        scrollWidth: viewport?.scrollWidth ?? 0,
      };
    }),
  ]);
  expect(viewportBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(canvasBox).toMatchObject({ width: 1280, height: 336 });
  expect(dimensions).toMatchObject({
    cssHeight: 336,
    cssWidth: 1280,
    scrollWidth: 1280,
  });
  expect(dimensions.scrollHeight).toBeGreaterThanOrEqual(
    dimensions.cssHeight,
  );
  expect(dimensions.scrollHeight).toBe(dimensions.clientHeight);
  expect(dimensions.backingWidth).toBe(
    Math.round(dimensions.cssWidth * dimensions.devicePixelRatio),
  );
  expect(dimensions.backingHeight).toBe(
    Math.round(dimensions.cssHeight * dimensions.devicePixelRatio),
  );
  expect(dimensions.imageRendering).toMatch(/pixelated|crisp-edges/);
  expect(viewportBox!.width).toBeLessThanOrEqual(width);
  expect(viewportBox!.y + viewportBox!.height)
    .toBeLessThanOrEqual(statusBox!.y + 0.5);
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
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(pause).toBeVisible();
  await expect(page.locator(".nh-shell")).toHaveAttribute(
    "data-settings-status",
    "idle",
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
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(pause).toBeVisible();
  await pause.getByRole("button", { name: "Resume" }).click();
  await expect(pause).toHaveCount(0);
}

/**
 * Enter NetHack's semicolon position-input flow at a published snapshot boundary.
 * @param page - running game page at command input.
 * @returns snapshot revision after position input is visible and command input is busy.
 */
async function enterPositionInput(page: Page): Promise<number> {
  const shell = page.locator(".nh-shell");
  await expect(shell).toHaveAttribute("data-command-input", "ready");
  const previousRevision = await readShellRevision(page);
  await page.keyboard.press(";");
  await expect(shell).toHaveAttribute("data-command-input", "busy");
  await expect(page.locator(".nh-messages")).toContainText(
    /pick .*location/i,
  );
  const tip = page.getByRole("dialog", { name: "Menu" }).filter({
    hasText: "Tip: Farlooking or selecting a map location",
  });
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  await expect(shell).toHaveAttribute("data-command-input", "busy");
  const revision = await readShellRevision(page);
  expect(revision).toBeGreaterThan(previousRevision);
  return revision;
}

/**
 * Exit position input and wait for the real WASM command boundary.
 * @param page - running game page in position input.
 * @param previousRevision - revision observed before requesting cancellation.
 */
async function exitPositionInput(
  page: Page,
  previousRevision: number,
): Promise<void> {
  await page.keyboard.press("Escape");
  await page.waitForFunction((revision) => {
    const shell = document.querySelector<HTMLElement>(".nh-shell");
    return shell?.dataset.commandInput === "ready"
      && Number(shell.dataset.snapshotRevision) > revision;
  }, previousRevision, { timeout: 10_000 });
}

/**
 * Move the horizontal viewport to a repeatable manual location.
 * @param viewport - map scroll container.
 * @param location - center for drag headroom or opposite edge from current Follow.
 * @returns resulting horizontal scroll offset and range.
 */
async function setManualHorizontalScroll(
  viewport: Locator,
  location: "center" | "opposite",
): Promise<HorizontalScrollState> {
  return viewport.evaluate(async (element, requestedLocation) => {
    const maxLeft = element.scrollWidth - element.clientWidth;
    const target = requestedLocation === "center"
      ? maxLeft / 2
      : element.scrollLeft < maxLeft / 2
        ? maxLeft
        : 0;
    element.scrollLeft = target;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return { left: element.scrollLeft, maxLeft };
  }, location);
}

/**
 * Locate a point safely inside the visible map viewport.
 * @param viewport - map scroll container.
 * @returns viewport-relative center point in page coordinates.
 */
async function visibleMapPoint(viewport: Locator): Promise<PointerPoint> {
  const bounds = await viewport.boundingBox();
  expect(bounds).not.toBeNull();
  return {
    x: bounds!.x + bounds!.width * 0.6,
    y: bounds!.y + bounds!.height * 0.5,
  };
}

/**
 * Send one right-button mouse gesture through Playwright's native input path.
 * @param page - running game page.
 * @param start - gesture origin in page coordinates.
 * @param deltaX - horizontal pointer movement in CSS pixels.
 * @param deltaY - vertical pointer movement in CSS pixels.
 */
async function rightMouseGesture(
  page: Page,
  start: PointerPoint,
  deltaX: number,
  deltaY = 0,
): Promise<void> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(start.x + deltaX, start.y + deltaY);
  await page.mouse.up({ button: "right" });
}

/**
 * Start one captured secondary-button gesture and return its browser pointer ID.
 * @param page - running game page.
 * @param map - renderer-independent map interaction surface.
 * @param start - gesture origin in page coordinates.
 * @returns pointer ID captured by the map.
 */
async function startCapturedRightGesture(
  page: Page,
  map: Locator,
  start: PointerPoint,
): Promise<number> {
  await map.evaluate((element) => {
    element.removeAttribute("data-test-pointer-id");
    element.addEventListener("pointerdown", (event) => {
      element.setAttribute(
        "data-test-pointer-id",
        String((event as PointerEvent).pointerId),
      );
    }, { once: true });
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "right" });
  const pointerId = Number(await map.getAttribute("data-test-pointer-id"));
  expect(pointerId).toBeGreaterThan(0);
  expect(await map.evaluate(
    (element, id) => element.hasPointerCapture(id),
    pointerId,
  )).toBe(true);
  return pointerId;
}

/**
 * Record context-menu events after application handlers have run.
 * @param map - renderer-independent map interaction surface.
 */
async function observeMapContextMenus(map: Locator): Promise<void> {
  await map.evaluate((element) => {
    element.setAttribute("data-test-context-menu-count", "0");
    element.setAttribute("data-test-unprevented-context-menu-count", "0");
    window.addEventListener("contextmenu", (event) => {
      if (!(event.target instanceof Node) || !element.contains(event.target)) {
        return;
      }
      const count = Number(
        element.getAttribute("data-test-context-menu-count"),
      );
      element.setAttribute("data-test-context-menu-count", String(count + 1));
      if (!event.defaultPrevented) {
        const unprevented = Number(
          element.getAttribute("data-test-unprevented-context-menu-count"),
        );
        element.setAttribute(
          "data-test-unprevented-context-menu-count",
          String(unprevented + 1),
        );
      }
    });
  });
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
    expect(await readMapRenderer(page)).toBe("tiles");
    const pixels = await readCanvasPixels(canvas);
    expect(pixels.nonTransparentPixels).toBeGreaterThan(0);
    expect(pixels.opaqueColorCount).toBeGreaterThan(1);
    expect(pixels.nonTransparentNearbyTileCount).toBeGreaterThanOrEqual(4);
    expect(pixels.distinctNearbyTileCount).toBeGreaterThanOrEqual(2);
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
    const manualAnchor = await readMapScrollAnchor(viewport);

    await switchMapRenderer(page, "ASCII");
    await expect.poll(async () => readMapRenderer(page)).toBe("ascii");
    await expect.poll(async () => readCursorPosition(page)).toEqual(
      initialCursor,
    );
    expect(await readCreatedSessionIds(page)).toEqual(initialSessionIds);

    await switchMapRenderer(page, "Tiles");
    await expect(canvas).toBeVisible();
    await expect.poll(async () =>
      readMapScrollAnchor(viewport)).toBeCloseTo(manualAnchor, 2);
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

test("keeps a manual Follow anchor after a right-click position look", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await startNewGame(page, "FollowRightClick");

  const viewport = page.locator(".nh-map-scroll");
  await enterPositionInput(page);
  const scroll = await setManualHorizontalScroll(viewport, "opposite");
  expect(scroll.maxLeft).toBeGreaterThan(0);
  const manualAnchor = await readMapScrollAnchor(viewport);

  const revisionBeforeClick = await readShellRevision(page);
  await rightMouseGesture(page, await visibleMapPoint(viewport), 3);
  await page.waitForFunction((revision) => {
    const shell = document.querySelector<HTMLElement>(".nh-shell");
    return shell?.dataset.commandInput === "ready"
      && Number(shell.dataset.snapshotRevision) > revision;
  }, revisionBeforeClick, { timeout: 10_000 });

  expect(await readMapScrollAnchor(viewport)).toBeCloseTo(
    manualAnchor,
    2,
  );
  await page.setViewportSize({ width: 960, height: 700 });
  const resizedManualAnchor = await viewport.evaluate((element, anchor) => {
    const maximum = element.scrollWidth - element.clientWidth;
    const left = Math.min(Math.max(
      anchor * element.scrollWidth - element.clientWidth / 2,
      0,
    ), maximum);
    return (left + element.clientWidth / 2) / element.scrollWidth;
  }, manualAnchor);
  await expect.poll(async () =>
    readMapScrollAnchor(viewport)).toBeCloseTo(resizedManualAnchor, 2);

  const movedCursor = await moveToAdjacentFloor(page);
  const expectedFollowLeft = await viewport.evaluate((element, cursorX) => {
    const maximum = element.scrollWidth - element.clientWidth;
    return Math.min(Math.max(
      ((cursorX + 0.5) / 80) * element.scrollWidth
        - element.clientWidth / 2,
      0,
    ), maximum);
  }, movedCursor.x);
  await expect.poll(async () =>
    viewport.evaluate((element) => element.scrollLeft))
    .toBeCloseTo(expectedFollowLeft, 0);
});

test(
  "keeps a manual Follow anchor for an unchanged player turn",
  async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await startNewGame(page, "FollowUnchangedTurn");

    const shell = page.locator(".nh-shell");
    const viewport = page.locator(".nh-map-scroll");
    const cursor = await readCursorPosition(page);
    const scroll = await setManualHorizontalScroll(viewport, "opposite");
    expect(scroll.maxLeft).toBeGreaterThan(0);
    const manualAnchor = await readMapScrollAnchor(viewport);
    const revision = await readShellRevision(page);

    await page.keyboard.press(".");
    await page.waitForFunction((previousRevision) => {
      const game = document.querySelector<HTMLElement>(".nh-shell");
      return game?.dataset.commandInput === "ready"
        && Number(game.dataset.snapshotRevision) > previousRevision;
    }, revision, { timeout: 10_000 });

    await expect.poll(async () => readCursorPosition(page)).toEqual(cursor);
    expect(await readMapScrollAnchor(viewport)).toBeCloseTo(manualAnchor, 2);
    await expect(shell).toHaveAttribute("data-command-input", "ready");
  },
);

test("keeps a manual camera when Follow is disabled and the player moves", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await startNewGame(page, "FollowDisabledMove");
  await disablePlayerFollowing(page);

  const viewport = page.locator(".nh-map-scroll");
  const initialCursor = await readCursorPosition(page);
  const scroll = await setManualHorizontalScroll(viewport, "opposite");
  expect(scroll.maxLeft).toBeGreaterThan(0);
  const manualAnchor = await readMapScrollAnchor(viewport);

  const movedCursor = await moveToAdjacentFloor(page);

  expect(movedCursor).not.toEqual(initialCursor);
  await expect.poll(async () =>
    readMapScrollAnchor(viewport)).toBeCloseTo(manualAnchor, 2);
});

test("right-drag pans during position input without submitting it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await startNewGame(page, "RightDragCommand");

  const shell = page.locator(".nh-shell");
  const viewport = page.locator(".nh-map-scroll");
  const map = page.locator(".nh-map-interaction");
  const positionRevision = await enterPositionInput(page);
  const initialScroll = await setManualHorizontalScroll(viewport, "center");
  expect(initialScroll.maxLeft).toBeGreaterThan(80);
  await observeMapContextMenus(map);

  await rightMouseGesture(page, await visibleMapPoint(viewport), -40);

  await expect(shell).toHaveAttribute("data-command-input", "busy");
  expect(await viewport.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(initialScroll.left + 5);
  await expect(viewport).toHaveCSS("scrollbar-width", "none");
  await expect(map).toHaveAttribute("data-dragging", "false");
  expect(Number(
    await map.getAttribute("data-test-context-menu-count"),
  )).toBeGreaterThan(0);
  expect(await map.getAttribute(
    "data-test-unprevented-context-menu-count",
  )).toBe("0");
  await exitPositionInput(page, positionRevision);
});

test("cleans up cancelled and lost-capture right drags", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await startNewGame(page, "RightDragInterruptions");

  const shell = page.locator(".nh-shell");
  const viewport = page.locator(".nh-map-scroll");
  const map = page.locator(".nh-map-interaction");
  const positionRevision = await enterPositionInput(page);
  const initialScroll = await setManualHorizontalScroll(viewport, "center");
  expect(initialScroll.maxLeft).toBeGreaterThan(80);

  const firstStart = await visibleMapPoint(viewport);
  const cancelledPointer = await startCapturedRightGesture(
    page,
    map,
    firstStart,
  );
  await page.mouse.move(firstStart.x - 20, firstStart.y);
  await expect(map).toHaveAttribute("data-dragging", "true");
  await map.dispatchEvent("pointercancel", {
    button: 2,
    buttons: 0,
    clientX: firstStart.x - 20,
    clientY: firstStart.y,
    pointerId: cancelledPointer,
  });
  await expect(map).toHaveAttribute("data-dragging", "false");
  await page.mouse.up({ button: "right" });
  await expect(shell).toHaveAttribute("data-command-input", "busy");

  const secondStart = await visibleMapPoint(viewport);
  const lostPointer = await startCapturedRightGesture(page, map, secondStart);
  await page.mouse.move(secondStart.x - 20, secondStart.y);
  await expect(map).toHaveAttribute("data-dragging", "true");
  await map.dispatchEvent("lostpointercapture", {
    pointerId: lostPointer,
  });
  await expect(map).toHaveAttribute("data-dragging", "false");
  await page.mouse.up({ button: "right" });
  await expect(shell).toHaveAttribute("data-command-input", "busy");

  const revisionBeforeClick = await readShellRevision(page);
  await rightMouseGesture(page, await visibleMapPoint(viewport), 3);
  await page.waitForFunction((revision) => {
    const game = document.querySelector<HTMLElement>(".nh-shell");
    return game?.dataset.commandInput === "ready"
      && Number(game.dataset.snapshotRevision) > revision;
  }, revisionBeforeClick, { timeout: 10_000 });
  expect(await readShellRevision(page)).toBeGreaterThan(positionRevision);
});

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
  await expect.poll(async () => readMapRenderer(page)).toBe("tiles-fallback");
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
  await expect.poll(async () => readMapRenderer(page)).toBe("tiles-fallback");
  await expect(page.locator("canvas.nh-map-tiles")).toHaveCount(0);
  expect(await readStoredProfile(page)).toBe(storedProfile);
  await expectTilesPreference(page);
});

import {
  expect,
  type Locator,
  type Page,
} from "@playwright/test";

/** Stable player position read from renderer-independent map metadata. */
export interface CursorPosition {
  x: number;
  y: number;
}

export type ActiveMapRenderer = "ascii" | "tiles";

/**
 * Read the current immutable game snapshot revision exposed by the shell.
 * @param page - running game page.
 * @returns numeric snapshot revision.
 */
export async function readShellRevision(page: Page): Promise<number> {
  return Number(
    await page.locator(".nh-shell").getAttribute("data-snapshot-revision"),
  );
}

/**
 * Read the current player position from renderer-independent map metadata.
 * @param page - running game page.
 * @returns visible cursor coordinates.
 */
export async function readCursorPosition(
  page: Page,
): Promise<CursorPosition> {
  const map = page.locator(".nh-map-interaction");
  await expect(map).toHaveAttribute("data-cursor-visible", "true");
  const [x, y] = await Promise.all([
    map.getAttribute("data-cursor-x"),
    map.getAttribute("data-cursor-y"),
  ]);
  return {
    x: Number(x),
    y: Number(y),
  };
}

/**
 * Read the renderer currently visible inside the shared map viewport.
 * @param page - running game page.
 * @returns the visible ASCII or Tiles renderer.
 */
export async function readMapRenderer(
  page: Page,
): Promise<ActiveMapRenderer> {
  const map = page.locator(".nh-map-interaction");
  if (await map.locator("canvas.nh-map-tiles").isVisible()) return "tiles";
  if (await map.locator(".nh-map-ascii").isVisible()) return "ascii";
  throw new Error("No visible map renderer");
}

/**
 * Read the normalized horizontal center of the visible map viewport.
 * @param viewport - map scroll container.
 * @returns center position as a fraction of the rendered map width.
 */
export async function readMapScrollAnchor(viewport: Locator): Promise<number> {
  return viewport.evaluate((element) =>
    (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth);
}

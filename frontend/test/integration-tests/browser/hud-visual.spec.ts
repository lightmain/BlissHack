import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import {
  openHome,
  startNewGameFromHome,
} from "./helpers/game-flow";
import {
  readMapRenderer,
  readShellRevision,
} from "./helpers/map-viewport-state";

type HudRenderer = "tiles" | "ascii";
type InventoryPosition = "right" | "below";
type RegionName = "messages" | "map" | "inventory" | "status";

interface ViewportSize {
  width: number;
  height: number;
}

interface Rectangle {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface OverflowOwner {
  name: string;
  overflowX: string;
  overflowY: string;
}

interface HudGeometry {
  body: {
    clientHeight: number;
    clientWidth: number;
    scrollHeight: number;
    scrollWidth: number;
  };
  document: {
    clientHeight: number;
    clientWidth: number;
    scrollHeight: number;
    scrollWidth: number;
  };
  hud: Rectangle;
  overflowOwners: OverflowOwner[];
  regions: Record<RegionName, Rectangle>;
  viewport: ViewportSize;
}

const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 900, height: 700 },
] as const;

const HUD_VARIANTS = [
  { renderer: "tiles", position: "right" },
  { renderer: "tiles", position: "below" },
  { renderer: "ascii", position: "right" },
  { renderer: "ascii", position: "below" },
] as const;

const EXPECTED_OVERFLOW = {
  inventory: "auto",
  map: "auto",
  messages: "hidden",
  status: "hidden",
} as const;

/**
 * Configure one HUD variant through the public Home settings workflow.
 * @param page - Playwright page currently loading a fresh application.
 * @param renderer - requested map renderer.
 * @param position - requested permanent-inventory placement.
 */
async function configureHud(
  page: Page,
  renderer: HudRenderer,
  position: InventoryPosition,
): Promise<void> {
  await openHome(page, `hud-${renderer}-${position}`);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", {
    name: renderer === "tiles" ? "Tiles" : "ASCII",
  }).check();
  await page.getByRole("checkbox", {
    name: "Enable Permanent Inventory",
    exact: true,
  }).check();
  await page.getByRole("radio", {
    name: position === "right" ? "Right" : "Below",
  }).check();
  await page.getByRole("button", { name: "Apply" }).click();
}

/**
 * Wait for the real WASM game and selected HUD variant to become authoritative.
 * @param page - Playwright page running the configured game.
 * @param renderer - expected active renderer, excluding fallback states.
 * @param position - expected permanent-inventory placement.
 * @returns stable game snapshot revision observed at command readiness.
 */
async function expectReadyHud(
  page: Page,
  renderer: HudRenderer,
  position: InventoryPosition,
): Promise<number> {
  const shell = page.locator(".nh-shell");
  const inventory = page.getByRole("region", { name: "Inventory" });

  await expect(shell).toHaveAttribute("data-command-input", "ready");
  await expect.poll(async () => readMapRenderer(page)).toBe(renderer);
  await expect(inventory).toHaveAttribute("data-position", position);
  await expect(inventory.locator(
    ".permanent-inventory-item:not(.permanent-inventory-heading)",
  ).first()).toBeVisible();

  const revision = await readShellRevision(page);
  const inventoryRevision = Number(
    await inventory.getAttribute("data-inventory-revision"),
  );
  expect(revision).toBeGreaterThan(0);
  expect(inventoryRevision).toBeGreaterThan(0);
  return revision;
}

/**
 * Read all viewport and HUD rectangles in one browser layout sample.
 * @param page - Playwright page with a visible game HUD.
 * @returns geometry and computed overflow ownership for layout assertions.
 */
async function readHudGeometry(page: Page): Promise<HudGeometry> {
  return page.locator(".nh-hud-layout").evaluate((hud) => {
    /** Convert one DOM rectangle into a serializable value. */
    function rectangle(element: Element): Rectangle {
      const bounds = element.getBoundingClientRect();
      return {
        height: bounds.height,
        width: bounds.width,
        x: bounds.x,
        y: bounds.y,
      };
    }

    /** Require one uniquely named HUD region from the rendered shell. */
    function region(name: RegionName): HTMLElement {
      const matches = hud.querySelectorAll<HTMLElement>(
        `[data-hud-region="${name}"]`,
      );
      if (matches.length !== 1) {
        throw new Error(`Expected one ${name} HUD region, got ${matches.length}`);
      }
      return matches[0];
    }

    const root = document.documentElement;
    const body = document.body;
    const overflowOwners = [
      ...hud.querySelectorAll<HTMLElement>("[data-overflow-owner]"),
    ].map((element) => {
      const style = getComputedStyle(element);
      return {
        name: element.dataset.overflowOwner ?? "",
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      };
    });

    return {
      body: {
        clientHeight: body.clientHeight,
        clientWidth: body.clientWidth,
        scrollHeight: body.scrollHeight,
        scrollWidth: body.scrollWidth,
      },
      document: {
        clientHeight: root.clientHeight,
        clientWidth: root.clientWidth,
        scrollHeight: root.scrollHeight,
        scrollWidth: root.scrollWidth,
      },
      hud: rectangle(hud),
      overflowOwners,
      regions: {
        messages: rectangle(region("messages")),
        map: rectangle(region("map")),
        inventory: rectangle(region("inventory")),
        status: rectangle(region("status")),
      },
      viewport: {
        height: innerHeight,
        width: innerWidth,
      },
    };
  });
}

/**
 * Return the visible overlap area of two viewport rectangles.
 * @param first - first region rectangle.
 * @param second - second region rectangle.
 * @returns overlap area in CSS pixels.
 */
function overlapArea(first: Rectangle, second: Rectangle): number {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width)
      - Math.max(first.x, second.x),
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height)
      - Math.max(first.y, second.y),
  );
  return width * height;
}

/**
 * Verify viewport containment, region topology, and the four overflow owners.
 * @param geometry - one browser layout sample.
 * @param expectedViewport - requested Playwright viewport dimensions.
 * @param position - expected inventory placement.
 */
function expectValidHudGeometry(
  geometry: HudGeometry,
  expectedViewport: ViewportSize,
  position: InventoryPosition,
): void {
  expect(geometry.viewport).toEqual(expectedViewport);
  expect(geometry.hud).toEqual({
    x: 0,
    y: 0,
    width: expectedViewport.width,
    height: expectedViewport.height,
  });
  for (const dimensions of [geometry.document, geometry.body]) {
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(
      expectedViewport.width,
    );
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(
      expectedViewport.height,
    );
  }

  const regionEntries = Object.entries(geometry.regions) as Array<
    [RegionName, Rectangle]
  >;
  for (const [name, rectangle] of regionEntries) {
    expect(rectangle.width, `${name} width`).toBeGreaterThan(0);
    expect(rectangle.height, `${name} height`).toBeGreaterThan(0);
    expect(rectangle.x, `${name} left`).toBeGreaterThanOrEqual(0);
    expect(rectangle.y, `${name} top`).toBeGreaterThanOrEqual(0);
    expect(
      rectangle.x + rectangle.width,
      `${name} right`,
    ).toBeLessThanOrEqual(expectedViewport.width);
    expect(
      rectangle.y + rectangle.height,
      `${name} bottom`,
    ).toBeLessThanOrEqual(expectedViewport.height);
  }
  for (let first = 0; first < regionEntries.length; first += 1) {
    for (let second = first + 1; second < regionEntries.length; second += 1) {
      const [firstName, firstRectangle] = regionEntries[first];
      const [secondName, secondRectangle] = regionEntries[second];
      expect(
        overlapArea(firstRectangle, secondRectangle),
        `${firstName} overlaps ${secondName}`,
      ).toBe(0);
    }
  }

  const { inventory, map, messages, status } = geometry.regions;
  expect(messages.y + messages.height).toBeLessThanOrEqual(map.y);
  expect(map.y + map.height).toBeLessThanOrEqual(status.y);
  if (position === "right") {
    for (const region of [messages, map, status]) {
      expect(region.x + region.width).toBeLessThanOrEqual(inventory.x);
    }
  } else {
    expect(status.y + status.height).toBeLessThanOrEqual(inventory.y);
  }

  expect(geometry.overflowOwners).toHaveLength(4);
  expect(
    geometry.overflowOwners.map(({ name }) => name).sort(),
  ).toEqual(Object.keys(EXPECTED_OVERFLOW).sort());
  for (const owner of geometry.overflowOwners) {
    const expected = EXPECTED_OVERFLOW[
      owner.name as keyof typeof EXPECTED_OVERFLOW
    ];
    expect(owner.overflowX, `${owner.name} overflow-x`).toBe(expected);
    expect(owner.overflowY, `${owner.name} overflow-y`).toBe(expected);
  }
}

for (const { renderer, position } of HUD_VARIANTS) {
  test(`HUD visual regression: ${renderer} with inventory ${position}`, async ({
    page,
  }) => {
    test.slow();
    const errors = captureErrors(page);
    await page.setViewportSize(VIEWPORTS[0]);
    await configureHud(page, renderer, position);
    await startNewGameFromHome(
      page,
      `Hud${renderer === "tiles" ? "Tiles" : "Ascii"}${
        position === "right" ? "Right" : "Below"
      }`,
    );
    const readyRevision = await expectReadyHud(page, renderer, position);

    for (const viewport of VIEWPORTS) {
      await test.step(`${viewport.width}x${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await expect(page.locator(".nh-shell")).toHaveAttribute(
          "data-command-input",
          "ready",
        );
        expect(await readShellRevision(page)).toBeGreaterThanOrEqual(
          readyRevision,
        );
        expectValidHudGeometry(
          await readHudGeometry(page),
          viewport,
          position,
        );

        await expect(page).toHaveScreenshot(
          `hud-${renderer}-${position}-${viewport.width}x${viewport.height}.png`,
          {
            mask: [
              page.locator(".nh-map"),
              page.locator(".nh-messages > *"),
              page.locator(".permanent-inventory-header > div"),
              page.locator(".permanent-inventory-items"),
              page.locator(".nh-status"),
            ],
            maskColor: "#202428",
          },
        );
      });
    }

    expect(errors).toEqual({ console: [], page: [] });
  });
}

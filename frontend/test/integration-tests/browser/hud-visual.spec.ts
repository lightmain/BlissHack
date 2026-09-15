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
  await page.getByRole("combobox", { name: "Contents" })
    .selectOption("in-use");
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
  let observedRevision = -1;
  let stableRevisionSamples = 0;
  await expect.poll(async () => {
    const revision = Number(
      await inventory.getAttribute("data-inventory-revision"),
    );
    const text = await inventory.textContent();
    if (
      !text?.match(/being worn/i)
      || !text.match(/weapon in hand|wielded/i)
    ) {
      observedRevision = revision;
      stableRevisionSamples = 0;
      return stableRevisionSamples;
    }
    if (revision === observedRevision) {
      stableRevisionSamples += 1;
    } else {
      observedRevision = revision;
      stableRevisionSamples = 1;
    }
    return stableRevisionSamples;
  }, {
    intervals: [100, 200, 400, 800],
    timeout: 10_000,
  }).toBeGreaterThanOrEqual(3);

  const revision = await readShellRevision(page);
  const inventoryRevision = Number(
    await inventory.getAttribute("data-inventory-revision"),
  );
  expect(revision).toBeGreaterThan(0);
  expect(inventoryRevision).toBeGreaterThan(0);
  return revision;
}

/**
 * Verify that the selected renderer contains real map output before masking it.
 * @param page - Playwright page with an authoritative map snapshot.
 * @param renderer - renderer selected through Settings.
 */
async function expectRendererContent(
  page: Page,
  renderer: HudRenderer,
): Promise<void> {
  if (renderer === "tiles") {
    const pixels = await page.locator("canvas.nh-map-tiles").evaluate(
      (canvas) => {
        const context = canvas.getContext("2d");
        if (!context) return { colors: 0, opaque: 0 };
        const data = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        const colors = new Set<number>();
        let opaque = 0;
        for (let index = 0; index < data.length; index += 64) {
          if (data[index + 3] === 0) continue;
          opaque += 1;
          colors.add(
            (data[index] << 16) | (data[index + 1] << 8) | data[index + 2],
          );
        }
        return { colors: colors.size, opaque };
      },
    );
    expect(pixels.opaque).toBeGreaterThan(0);
    expect(pixels.colors).toBeGreaterThan(1);
    return;
  }

  const ascii = page.locator(".nh-map-ascii");
  await expect(ascii.locator(".nh-map-row")).toHaveCount(21);
  expect(await ascii.textContent()).toMatch(/\S/);
}

/**
 * Freeze one validated inventory DOM snapshot while pixel baselines are taken.
 * @param page - Playwright page after authoritative inventory stabilization.
 */
async function freezeInventoryPresentation(page: Page): Promise<void> {
  await page.locator(".permanent-inventory-items").evaluate((items) => {
    items.replaceWith(items.cloneNode(true));
  });
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
  expect(messages.y + messages.height).toBeCloseTo(map.y, 0);
  if (position === "right") {
    expect(map.y + map.height).toBeCloseTo(status.y, 0);
    for (const region of [messages, map, status]) {
      expect(region.x + region.width).toBeLessThanOrEqual(inventory.x);
    }
  } else {
    expect(map.y + map.height).toBeCloseTo(inventory.y, 0);
    expect(inventory.y + inventory.height).toBeCloseTo(status.y, 0);
    expect(inventory.height).toBeGreaterThanOrEqual(
      Math.min(240, expectedViewport.height * 0.25),
    );
  }
  expect(status.y + status.height).toBeCloseTo(expectedViewport.height, 0);

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
  }, testInfo) => {
    test.slow();
    const errors = captureErrors(page);
    await page.setViewportSize(VIEWPORTS[0]);
    await configureHud(page, renderer, position);
    await startNewGameFromHome(
      page,
      `Hud${renderer === "tiles" ? "Tiles" : "Ascii"}${
        position === "right" ? "Right" : "Below"
      }-Arc-Hum-Mal-Law`,
    );
    const readyRevision = await expectReadyHud(page, renderer, position);
    await expectRendererContent(page, renderer);
    await freezeInventoryPresentation(page);

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

        if (!["firefox", "webkit"].includes(testInfo.project.name)) {
          await expect(page).toHaveScreenshot(
            `hud-${renderer}-${position}-${viewport.width}x${viewport.height}.png`,
            {
              mask: [
                page.locator(".nh-map"),
                page.locator(".nh-messages > *"),
                page.locator(".permanent-inventory-header strong"),
                page.locator(".permanent-inventory-header span"),
                page.locator(".permanent-inventory-heading"),
                page.locator(".permanent-inventory-items .nh-menu-glyph"),
                page.locator(".permanent-inventory-items .nh-menu-mark"),
                page.locator(".permanent-inventory-items .nh-menu-accelerator"),
                page.locator(".permanent-inventory-items .nh-menu-text"),
                page.locator(".nh-status-resource-value"),
                page.locator(".nh-status-value"),
                page.locator(".nh-condition"),
              ],
              maskColor: "#202428",
            },
          );
        }
      });
    }

    expect(errors).toEqual({ console: [], page: [] });
  });
}

test("HUD visual regression: disabled below inventory reserves no collapsed track", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await page.setViewportSize(VIEWPORTS[1]);
  await openHome(page, "hud-disabled-below-collapsed");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("checkbox", {
    name: "Enable Permanent Inventory",
    exact: true,
  }).check();
  await page.getByRole("radio", { name: "Below" }).check();
  await page.getByRole("checkbox", { name: "Start collapsed" }).check();
  await page.getByRole("checkbox", {
    name: "Enable Permanent Inventory",
    exact: true,
  }).uncheck();
  await page.getByRole("button", { name: "Apply" }).click();
  await startNewGameFromHome(page, "HudNoInventory-Arc-Hum-Mal-Law");

  const hud = page.locator(".nh-hud-layout");
  await expect(hud).toHaveAttribute("data-has-inventory", "false");
  await expect(hud).toHaveAttribute("data-inventory-collapsed", "true");
  await expect(page.getByRole("region", { name: "Inventory" })).toHaveCount(0);
  const layout = await hud.evaluate((element) => {
    const status = element.querySelector<HTMLElement>(
      '[data-hud-region="status"]',
    );
    const statusBounds = status?.getBoundingClientRect();
    return {
      gridRows: getComputedStyle(element).gridTemplateRows.split(/\s+/),
      statusBottom: statusBounds
        ? statusBounds.y + statusBounds.height
        : -1,
    };
  });
  expect(layout.gridRows.slice(-2)).toEqual(["0px", "0px"]);
  expect(layout.statusBottom).toBeCloseTo(VIEWPORTS[1].height, 0);
  expect(errors).toEqual({ console: [], page: [] });
});

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
type InventoryPosition = "right" | "right-short" | "below";
type ActionBarStyle = "original" | "blisshack";
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
  actionBarStyle: string;
  actionDock: Rectangle | null;
  actionSlot: Rectangle;
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
  mapContent: Rectangle;
  mapViewport: {
    borderLeft: number;
    borderTop: number;
    clientHeight: number;
    clientWidth: number;
    scrollLeft: number;
    scrollHeight: number;
    scrollTop: number;
    scrollWidth: number;
  };
  overflowOwners: OverflowOwner[];
  rootRem: number;
  regions: Record<RegionName, Rectangle>;
  viewport: ViewportSize;
}

interface ActionGridGeometry {
  horizontalOverflow: boolean;
  sections: Array<{
    columns: number;
    emptySlots: number;
    slotCount: number;
  }>;
  slotHeights: number[];
  slotWidths: number[];
  viewportClientWidth: number;
  viewportScrollWidth: number;
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
  actionBarStyle: ActionBarStyle = "original",
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
  const inventoryPosition = page.getByRole("radio", {
    name: position === "right"
      ? /^Right(?: \(Long\))?$/
      : position === "right-short"
      ? "Right (Short)"
      : "Below",
  });
  await expect(inventoryPosition).toBeVisible();
  await inventoryPosition.check();
  await page.getByRole("group", { name: "Action bar" })
    .getByRole("radio", {
      name: actionBarStyle === "original" ? "Original" : "BlissHack",
    })
    .check();
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
  actionBarStyle: ActionBarStyle = "original",
): Promise<number> {
  const shell = page.locator(".nh-shell");
  const hud = page.locator(".nh-hud-layout");
  const inventory = page.getByRole("region", { name: "Inventory" });

  await expect(shell).toHaveAttribute("data-command-input", "ready");
  await expect(hud).toHaveAttribute("data-action-bar-style", actionBarStyle);
  await expect(page.getByRole("region", { name: "Action bar" }))
    .toHaveCount(actionBarStyle === "blisshack" ? 1 : 0);
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
      (element) => {
        const canvas = element as HTMLCanvasElement;
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
 * Hide validated random inventory rows before pixel baselines are taken.
 * @param page - Playwright page after authoritative inventory stabilization.
 */
async function freezeInventoryPresentation(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      .permanent-inventory-items {
        display: none !important;
      }
    `,
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
    const mapContent = hud.querySelector<HTMLElement>(".nh-map-interaction");
    if (!mapContent) throw new Error("Expected one map interaction surface");
    const actionSlot = hud.querySelector<HTMLElement>(
      '[data-hud-region="actions"]',
    );
    if (!actionSlot) throw new Error("Expected one action HUD slot");
    const actionDock = hud.querySelector<HTMLElement>("[data-action-dock]");
    const mapViewport = region("map");
    const mapViewportStyle = getComputedStyle(mapViewport);
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
      actionBarStyle: hud.dataset.actionBarStyle ?? "",
      actionDock: actionDock ? rectangle(actionDock) : null,
      actionSlot: rectangle(actionSlot),
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
      mapContent: rectangle(mapContent),
      mapViewport: {
        borderLeft: Number.parseFloat(mapViewportStyle.borderLeftWidth),
        borderTop: Number.parseFloat(mapViewportStyle.borderTopWidth),
        clientHeight: mapViewport.clientHeight,
        clientWidth: mapViewport.clientWidth,
        scrollLeft: mapViewport.scrollLeft,
        scrollHeight: mapViewport.scrollHeight,
        scrollTop: mapViewport.scrollTop,
        scrollWidth: mapViewport.scrollWidth,
      },
      overflowOwners,
      rootRem: Number.parseFloat(getComputedStyle(root).fontSize),
      regions: {
        messages: rectangle(region("messages")),
        map: rectangle(mapViewport),
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
 * Read the rendered action grid without depending on browser-specific pixels.
 * @param page - Playwright page with a visible BlissHack action dock.
 * @returns complete-column, slot-size, and overflow measurements.
 */
async function readActionGridGeometry(
  page: Page,
): Promise<ActionGridGeometry> {
  return page.locator("[data-action-dock]").evaluate((dock) => {
    const viewport = dock.querySelector<HTMLElement>(
      ".nh-action-grid-viewport",
    );
    if (!viewport) throw new Error("Expected one action grid viewport");
    const slots = [...dock.querySelectorAll<HTMLElement>(
      "[data-action-slot]",
    )];
    return {
      horizontalOverflow: dock.getAttribute("data-horizontal-overflow")
        === "true",
      sections: [...dock.querySelectorAll<HTMLElement>(
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
          slotCount: sectionSlots.length,
        };
      }),
      slotHeights: slots.map(
        (slot) => slot.getBoundingClientRect().height,
      ),
      slotWidths: slots.map(
        (slot) => slot.getBoundingClientRect().width,
      ),
      viewportClientWidth: viewport.clientWidth,
      viewportScrollWidth: viewport.scrollWidth,
    };
  });
}

/**
 * Wait for ResizeObserver-driven action sizing to settle before measurement.
 * @param page - Playwright page with a visible BlissHack action dock.
 */
async function expectStableActionSizing(page: Page): Promise<void> {
  const tolerance = 0.1;
  let previous: {
    slotWidth: number;
    toolWidths: number[];
  } | null = null;
  let stableSamples = 0;

  await expect.poll(async () => {
    const current = await page.locator("[data-action-dock]").evaluate((dock) => {
      const grid = dock.querySelector<HTMLElement>(".nh-action-grid");
      const viewport = dock.querySelector<HTMLElement>(
        ".nh-action-grid-viewport",
      );
      const slot = dock.querySelector<HTMLElement>("[data-action-slot]");
      const tools = [...dock.querySelectorAll<HTMLElement>(
        "[data-action-dock-tool]",
      )];
      if (!grid || !viewport || !slot || tools.length === 0) {
        throw new Error(
          "Expected action grid, viewport, slots, and dock tools",
        );
      }
      return {
        gridWidth: grid.getBoundingClientRect().width,
        horizontalOverflow: dock.getAttribute("data-horizontal-overflow")
          === "true",
        slotWidth: slot.getBoundingClientRect().width,
        toolWidths: tools.map((tool) => tool.getBoundingClientRect().width),
        viewportClientWidth: viewport.clientWidth,
      };
    });
    const expectedToolWidth = Math.min(28, current.slotWidth / 2 + 4.25);
    const matchesSlot = current.toolWidths.every(
      (width) => Math.abs(width - expectedToolWidth) <= tolerance,
    );
    const matchesViewport = current.horizontalOverflow
      ? Math.abs(current.slotWidth - 32) <= tolerance
      : Math.abs(current.gridWidth - current.viewportClientWidth) <= tolerance;
    const previousSample = previous;
    const matchesPrevious = previousSample !== null
      && Math.abs(current.slotWidth - previousSample.slotWidth) <= tolerance
      && current.toolWidths.length === previousSample.toolWidths.length
      && current.toolWidths.every(
        (width, index) =>
          Math.abs(width - previousSample.toolWidths[index]) <= tolerance,
      );
    stableSamples = matchesSlot && matchesViewport
      ? matchesPrevious ? stableSamples + 1 : 1
      : 0;
    previous = current;
    return stableSamples;
  }, {
    message: "Action slot and tool sizing did not stabilize",
  }).toBeGreaterThanOrEqual(3);
}

/**
 * Assert the browser-rendered row contract and its real overflow state.
 * @param geometry - current action grid measurements.
 * @param rows - persisted row count rendered by the dock.
 */
function expectValidActionGridGeometry(
  geometry: ActionGridGeometry,
  rows: 1 | 2 | 3 | 4,
): void {
  expect(geometry.sections).toHaveLength(4);
  for (const section of geometry.sections) {
    expect(section.columns).toBeGreaterThan(0);
    expect(section.slotCount).toBe(section.columns * rows);
  }
  expect(geometry.sections.at(-1)?.emptySlots).toBeGreaterThanOrEqual(rows);
  expect(geometry.slotWidths.length).toBeGreaterThan(0);
  for (const width of geometry.slotWidths) {
    expect(width).toBeGreaterThanOrEqual(32);
  }
  for (const height of geometry.slotHeights) {
    expect(height).toBeGreaterThanOrEqual(32);
  }
  if (geometry.horizontalOverflow) {
    expect(geometry.viewportScrollWidth).toBeGreaterThan(
      geometry.viewportClientWidth,
    );
  } else {
    expect(geometry.viewportScrollWidth).toBeLessThanOrEqual(
      geometry.viewportClientWidth,
    );
  }
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
 * @param actionBarStyle - expected bottom-region mode.
 */
function expectValidHudGeometry(
  geometry: HudGeometry,
  expectedViewport: ViewportSize,
  position: InventoryPosition,
  actionBarStyle: ActionBarStyle = "original",
  inventoryCollapsed = false,
  intrinsicMapHeight?: number,
): void {
  expect(geometry.actionBarStyle).toBe(actionBarStyle);
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
    ).toBeLessThanOrEqual(expectedViewport.width + 0.1);
    expect(
      rectangle.y + rectangle.height,
      `${name} bottom`,
    ).toBeLessThanOrEqual(expectedViewport.height + 0.1);
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
  if (position === "below") {
    const mapHeightDelta = geometry.mapContent.height - map.height;
    if (actionBarStyle === "original") {
      expect(Math.abs(mapHeightDelta)).toBeLessThanOrEqual(2);
    } else if (mapHeightDelta > 2) {
      expect(geometry.mapViewport.scrollHeight).toBeGreaterThan(
        geometry.mapViewport.clientHeight,
      );
    }
    expect(geometry.mapContent.height).toBeCloseTo(
      intrinsicMapHeight ?? geometry.mapContent.height,
      0,
    );
    expect(Math.abs(
      geometry.mapContent.y + geometry.mapViewport.scrollTop
        - (map.y + geometry.mapViewport.borderTop),
    )).toBeLessThanOrEqual(2);
    if (geometry.mapContent.width <= map.width) {
      const expectedMapX =
        map.x + (map.width - geometry.mapContent.width) / 2;
      expect(Math.abs(geometry.mapContent.x - expectedMapX))
        .toBeLessThanOrEqual(2);
    } else {
      expect(geometry.mapViewport.scrollWidth).toBeGreaterThan(
        geometry.mapViewport.clientWidth,
      );
      expect(Math.abs(
        geometry.mapContent.x + geometry.mapViewport.scrollLeft
          - (map.x + geometry.mapViewport.borderLeft),
      )).toBeLessThanOrEqual(2);
    }
  }

  if (actionBarStyle === "original") {
    expect(geometry.actionDock).toBeNull();
    expect(geometry.actionSlot.width).toBe(0);
    expect(geometry.actionSlot.height).toBe(0);
    if (position === "right") {
      expect(map.y + map.height).toBeCloseTo(status.y, 0);
      for (const region of [messages, map, status]) {
        expect(region.x + region.width).toBeLessThanOrEqual(inventory.x);
      }
      expect(inventory.y).toBeCloseTo(0, 0);
      expect(inventory.y + inventory.height).toBeCloseTo(
        expectedViewport.height,
        0,
      );
    } else if (position === "right-short") {
      for (const region of [messages, map]) {
        expect(region.x + region.width).toBeLessThanOrEqual(inventory.x);
      }
      expect(inventory.y).toBeCloseTo(0, 0);
      expect(inventory.y + inventory.height).toBeCloseTo(status.y, 0);
      expect(status.x).toBeCloseTo(0, 0);
      expect(status.width).toBeCloseTo(expectedViewport.width, 0);
    } else {
      expect(map.y + map.height).toBeCloseTo(status.y, 0);
      expect(inventory.y).toBeCloseTo(status.y, 0);
      expect(inventory.height).toBeCloseTo(status.height, 0);
      expect(status.x + status.width).toBeCloseTo(inventory.x, 0);
      expect(inventory.x + inventory.width).toBeCloseTo(
        expectedViewport.width,
        0,
      );
      expect(status.height).toBeGreaterThanOrEqual(geometry.rootRem * 11 - 2);
      if (inventoryCollapsed) {
        expect(inventory.width).toBeLessThanOrEqual(44);
        expect(status.width).toBeGreaterThan(inventory.width);
      } else {
        expect(status.width).toBeLessThan(inventory.width);
      }
    }
    expect(status.y + status.height).toBeCloseTo(expectedViewport.height, 0);
  } else {
    const actionDock = geometry.actionDock;
    expect(actionDock).not.toBeNull();
    expect(geometry.actionSlot.width).toBeGreaterThan(0);
    expect(geometry.actionSlot.height).toBeGreaterThan(0);
    expect(actionDock!.x).toBeCloseTo(geometry.actionSlot.x, 0);
    expect(actionDock!.y).toBeCloseTo(geometry.actionSlot.y, 0);
    expect(actionDock!.width).toBeCloseTo(geometry.actionSlot.width, 0);
    expect(actionDock!.height).toBeCloseTo(geometry.actionSlot.height, 0);
    expect(status.x).toBeGreaterThanOrEqual(actionDock!.x);
    expect(status.y).toBeGreaterThanOrEqual(actionDock!.y);
    expect(status.x + status.width).toBeLessThanOrEqual(
      actionDock!.x + actionDock!.width,
    );
    expect(status.y + status.height).toBeLessThanOrEqual(
      actionDock!.y + actionDock!.height,
    );
    expect(
      geometry.actionSlot.y + geometry.actionSlot.height,
    ).toBeCloseTo(expectedViewport.height, 0);

    if (position === "right") {
      expect(map.y + map.height).toBeCloseTo(geometry.actionSlot.y, 0);
      for (const region of [messages, map, geometry.actionSlot]) {
        expect(region.x + region.width).toBeLessThanOrEqual(inventory.x);
      }
      expect(inventory.y).toBeCloseTo(0, 0);
      expect(inventory.y + inventory.height).toBeCloseTo(
        expectedViewport.height,
        0,
      );
    } else if (position === "right-short") {
      for (const region of [messages, map]) {
        expect(region.x + region.width).toBeLessThanOrEqual(inventory.x);
      }
      expect(inventory.y).toBeCloseTo(0, 0);
      expect(inventory.y + inventory.height).toBeCloseTo(
        geometry.actionSlot.y,
        0,
      );
      expect(geometry.actionSlot.x).toBeCloseTo(0, 0);
      expect(geometry.actionSlot.width).toBeCloseTo(
        expectedViewport.width,
        0,
      );
    } else {
      expect(map.y + map.height).toBeCloseTo(inventory.y, 0);
      expect(inventory.x).toBeCloseTo(0, 0);
      expect(inventory.width).toBeCloseTo(expectedViewport.width, 0);
      expect(inventory.y + inventory.height).toBeCloseTo(
        geometry.actionSlot.y,
        0,
      );
    }
  }

  expect(geometry.overflowOwners).toHaveLength(4);
  expect(
    geometry.overflowOwners.map(({ name }) => name).sort(),
  ).toEqual(Object.keys(EXPECTED_OVERFLOW).sort());
  for (const owner of geometry.overflowOwners) {
    const expected = owner.name === "inventory" && inventoryCollapsed
      ? "hidden"
      : owner.name === "status" && actionBarStyle === "blisshack"
      ? "auto"
      : EXPECTED_OVERFLOW[owner.name as keyof typeof EXPECTED_OVERFLOW];
    expect(owner.overflowX, `${owner.name} overflow-x`).toBe(expected);
    expect(owner.overflowY, `${owner.name} overflow-y`).toBe(expected);
  }
}

test("HUD visual regression: right-short keeps inventory above a full-width bottom region", async ({
  page,
}) => {
  test.slow();
  const errors = captureErrors(page);
  const viewport = VIEWPORTS[1];
  await page.setViewportSize(viewport);
  await configureHud(page, "tiles", "right-short");
  await startNewGameFromHome(
    page,
    "HudRightShort-Arc-Hum-Mal-Law",
  );
  await expectReadyHud(page, "tiles", "right-short");
  expectValidHudGeometry(
    await readHudGeometry(page),
    viewport,
    "right-short",
    "original",
  );

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Game paused" })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("group", { name: "Action bar" })
    .getByRole("radio", { name: "BlissHack" })
    .check();
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Resume" }).click();
  await expectReadyHud(page, "tiles", "right-short", "blisshack");
  await expectStableActionSizing(page);
  expectValidHudGeometry(
    await readHudGeometry(page),
    viewport,
    "right-short",
    "blisshack",
  );

  expect(errors).toEqual({ console: [], page: [] });
});

for (const { renderer, position } of HUD_VARIANTS) {
  test(`HUD visual regression: original ${renderer} with inventory ${position}`, async ({
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
    const intrinsicMapHeight = await page.locator(
      ".nh-map-interaction",
    ).evaluate((element) => element.getBoundingClientRect().height);

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
          "original",
          false,
          intrinsicMapHeight,
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

    if (position === "below") {
      await page.getByRole("button", { name: "Collapse inventory" }).click();
      await expect(
        page.getByRole("button", { name: "Expand inventory" }),
      ).toBeVisible();
      expectValidHudGeometry(
        await readHudGeometry(page),
        VIEWPORTS[1],
        position,
        "original",
        true,
        intrinsicMapHeight,
      );
    }

    expect(errors).toEqual({ console: [], page: [] });
  });
}

for (const { renderer, position } of HUD_VARIANTS) {
  test(`HUD visual regression: blisshack ${renderer} with inventory ${position}`, async ({
    page,
  }, testInfo) => {
    test.slow();
    const errors = captureErrors(page);
    await page.setViewportSize(VIEWPORTS[0]);
    await configureHud(page, renderer, position, "blisshack");
    await startNewGameFromHome(
      page,
      `HudBh${renderer === "tiles" ? "Tiles" : "Ascii"}${
        position === "right" ? "Right" : "Below"
      }-Arc-Hum-Mal-Law`,
    );
    const readyRevision = await expectReadyHud(
      page,
      renderer,
      position,
      "blisshack",
    );
    await expectRendererContent(page, renderer);
    await freezeInventoryPresentation(page);
    const intrinsicMapHeight = await page.locator(
      ".nh-map-interaction",
    ).evaluate((element) => element.getBoundingClientRect().height);

    for (const rows of [2, 4] as const) {
      await expect(page.getByRole("region", { name: "Action bar" }))
        .toHaveAttribute("data-row-count", String(rows));

      for (const viewport of VIEWPORTS) {
        await test.step(
          `${rows} rows at ${viewport.width}x${viewport.height}`,
          async () => {
            await page.setViewportSize(viewport);
            await expect(page.locator(".nh-shell")).toHaveAttribute(
              "data-command-input",
              "ready",
            );
            expect(await readShellRevision(page)).toBeGreaterThanOrEqual(
              readyRevision,
            );
            await expectStableActionSizing(page);
            if (!["firefox", "webkit"].includes(testInfo.project.name)) {
              await expect(page).toHaveScreenshot(
                `hud-blisshack-${renderer}-${position}-${rows}-rows-${viewport.width}x${viewport.height}.png`,
                {
                  mask: [
                    page.locator(".nh-map"),
                    page.locator(".nh-messages > *"),
                    page.locator(".permanent-inventory-header strong"),
                    page.locator(".permanent-inventory-header span"),
                    page.locator(".nh-status-resource-value"),
                    page.locator(".nh-status-value"),
                    page.locator(".nh-condition"),
                  ],
                  maskColor: "#202428",
                },
              );
            }
            expectValidHudGeometry(
              await readHudGeometry(page),
              viewport,
              position,
              "blisshack",
              false,
              intrinsicMapHeight,
            );
            expectValidActionGridGeometry(
              await readActionGridGeometry(page),
              rows,
            );
          },
        );
      }

      if (rows === 2) {
        const unlock = page.getByRole("button", {
          name: "Unlock action bar",
        });
        await unlock.click();
        await expect(page.getByRole("button", {
          name: "Lock action bar",
        })).toBeVisible();
        const increase = page.getByRole("button", { name: "Increase rows" });
        await increase.click();
        await expect(page.getByRole("region", { name: "Action bar" }))
          .toHaveAttribute("data-row-count", "3");
        await increase.click();
        await expect(page.getByRole("region", { name: "Action bar" }))
          .toHaveAttribute("data-row-count", "4");
        await page.getByRole("button", { name: "Lock action bar" }).click();
        await expect(page.getByRole("button", {
          name: "Unlock action bar",
        })).toBeVisible();
      }
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
    const messages = element.querySelector<HTMLElement>(
      '[data-hud-region="messages"]',
    );
    const map = element.querySelector<HTMLElement>('[data-hud-region="map"]');
    const mapContent = element.querySelector<HTMLElement>(
      ".nh-map-interaction",
    );
    const status = element.querySelector<HTMLElement>(
      '[data-hud-region="status"]',
    );
    const messagesBounds = messages?.getBoundingClientRect();
    const mapBounds = map?.getBoundingClientRect();
    const mapContentBounds = mapContent?.getBoundingClientRect();
    const statusBounds = status?.getBoundingClientRect();
    return {
      gridColumns: getComputedStyle(element).gridTemplateColumns.split(/\s+/),
      map: mapBounds
        ? { height: mapBounds.height, width: mapBounds.width, x: mapBounds.x, y: mapBounds.y }
        : null,
      mapContent: mapContentBounds
        ? {
            height: mapContentBounds.height,
            width: mapContentBounds.width,
            x: mapContentBounds.x,
            y: mapContentBounds.y,
          }
        : null,
      messagesBottom: messagesBounds
        ? messagesBounds.y + messagesBounds.height
        : -1,
      rootRem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      statusHeight: statusBounds?.height ?? -1,
      statusLeft: statusBounds?.x ?? -1,
      statusBottom: statusBounds
        ? statusBounds.y + statusBounds.height
        : -1,
      statusTop: statusBounds?.y ?? -1,
      statusWidth: statusBounds?.width ?? -1,
    };
  });
  expect(layout.map).not.toBeNull();
  expect(layout.mapContent).not.toBeNull();
  expect(layout.gridColumns).toHaveLength(1);
  expect(layout.messagesBottom).toBeCloseTo(layout.map!.y, 0);
  expect(Math.abs(
    layout.map!.height - layout.mapContent!.height,
  )).toBeLessThanOrEqual(2);
  if (layout.mapContent!.width <= layout.map!.width) {
    expect(Math.abs(
      layout.mapContent!.x
        - (layout.map!.x + (layout.map!.width - layout.mapContent!.width) / 2),
    )).toBeLessThanOrEqual(2);
  }
  expect(layout.statusTop).toBeCloseTo(
    layout.map!.y + layout.map!.height,
    0,
  );
  expect(layout.statusLeft).toBeCloseTo(0, 0);
  expect(layout.statusWidth).toBeCloseTo(VIEWPORTS[1].width, 0);
  expect(layout.statusHeight).toBeGreaterThanOrEqual(layout.rootRem * 11 - 2);
  expect(layout.statusBottom).toBeCloseTo(VIEWPORTS[1].height, 0);
  expect(errors).toEqual({ console: [], page: [] });
});

test("HUD visual regression: below remains recoverable in a short minimum-width viewport", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await page.setViewportSize(VIEWPORTS[1]);
  await configureHud(page, "ascii", "below");
  await startNewGameFromHome(
    page,
    "HudBelowCompact-Arc-Hum-Mal-Law",
  );
  await expectReadyHud(page, "ascii", "below");

  await page.setViewportSize({ width: 320, height: 240 });
  const hud = page.locator(".nh-hud-layout");
  const compact = await hud.evaluate((element) => {
    const inventory = element.querySelector<HTMLElement>(
      '[data-hud-region="inventory"]',
    );
    const status = element.querySelector<HTMLElement>(
      '[data-hud-region="status"]',
    );
    const inventoryBounds = inventory?.getBoundingClientRect();
    const statusBounds = status?.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      inventoryWidth: inventoryBounds?.width ?? 0,
      overflowY: style.overflowY,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
      statusWidth: statusBounds?.width ?? 0,
    };
  });
  expect(compact.overflowY).toBe("auto");
  expect(compact.scrollHeight).toBeGreaterThan(compact.clientHeight);
  expect(compact.scrollWidth).toBeLessThanOrEqual(compact.clientWidth);
  expect(compact.statusWidth).toBeGreaterThanOrEqual(160);
  expect(compact.inventoryWidth).toBeGreaterThanOrEqual(160);

  await hud.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => hud.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const bottom = await hud.evaluate((element) => {
    const inventory = element.querySelector<HTMLElement>(
      '[data-hud-region="inventory"]',
    );
    const status = element.querySelector<HTMLElement>(
      '[data-hud-region="status"]',
    );
    const inventoryBounds = inventory?.getBoundingClientRect();
    const statusBounds = status?.getBoundingClientRect();
    return {
      inventoryBottom: inventoryBounds
        ? inventoryBounds.y + inventoryBounds.height
        : Number.POSITIVE_INFINITY,
      statusBottom: statusBounds
        ? statusBounds.y + statusBounds.height
        : Number.POSITIVE_INFINITY,
    };
  });
  expect(bottom.inventoryBottom).toBeLessThanOrEqual(241);
  expect(bottom.statusBottom).toBeLessThanOrEqual(241);
  expect(errors).toEqual({ console: [], page: [] });
});

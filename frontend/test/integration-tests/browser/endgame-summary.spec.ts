import { expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("?end-summary-fixture=1");
  await expect(page.getByRole("heading", { name: "Game Over" })).toBeVisible();
});

test("[defect-probing] presents a bounded green modal over a dimming backdrop", async ({
  page,
}) => {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const dialog = page.getByRole("dialog", { name: "Game Over" });
  await expect(dialog).toBeVisible();
  const appearance = await dialog.evaluate((element) => {
    const backdrop = element.parentElement;
    const confirm = element.querySelector<HTMLElement>(
      "[data-end-summary-confirm='true']",
    );
    if (!backdrop || !confirm) {
      throw new Error("Endgame modal structure is incomplete");
    }
    const colorChannels = (value: string): number[] =>
      value.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const isGreen = (value: string): boolean => {
      const [red = 0, green = 0, blue = 0] = colorChannels(value);
      return green > red && green > blue;
    };
    const dialogStyle = getComputedStyle(element);
    const backdropStyle = getComputedStyle(backdrop);
    const confirmStyle = getComputedStyle(confirm);
    const dialogBox = element.getBoundingClientRect();
    const backdropBox = backdrop.getBoundingClientRect();
    const backdropChannels = colorChannels(backdropStyle.backgroundColor);
    return {
      backdropAlpha: backdropChannels[3] ?? 1,
      backdropBox: {
        height: backdropBox.height,
        width: backdropBox.width,
      },
      backdropPosition: backdropStyle.position,
      buttonGreen: isGreen(confirmStyle.backgroundColor)
        || isGreen(confirmStyle.borderTopColor),
      buttonMinHeight: Number.parseFloat(confirmStyle.minHeight),
      buttonRadius: Number.parseFloat(confirmStyle.borderTopLeftRadius),
      dialogBox: {
        height: dialogBox.height,
        width: dialogBox.width,
        x: dialogBox.x,
        y: dialogBox.y,
      },
      dialogGreen: isGreen(dialogStyle.borderTopColor),
      dialogRadius: Number.parseFloat(dialogStyle.borderTopLeftRadius),
    };
  });

  expect(appearance.backdropPosition).toBe("fixed");
  expect(appearance.backdropBox.width).toBeCloseTo(viewport?.width ?? 0, 0);
  expect(appearance.backdropBox.height).toBeCloseTo(viewport?.height ?? 0, 0);
  expect(appearance.backdropAlpha).toBeGreaterThan(0);
  expect(appearance.backdropAlpha).toBeLessThan(1);
  expect(appearance.dialogBox.x).toBeGreaterThan(0);
  expect(appearance.dialogBox.y).toBeGreaterThan(0);
  expect(appearance.dialogBox.width).toBeLessThan(viewport?.width ?? 0);
  expect(appearance.dialogBox.height).toBeLessThan(viewport?.height ?? 0);
  expect(appearance.dialogGreen).toBe(true);
  expect(appearance.dialogRadius).toBeGreaterThanOrEqual(3);
  expect(appearance.buttonGreen).toBe(true);
  expect(appearance.buttonRadius).toBeGreaterThanOrEqual(3);
  expect(appearance.buttonMinHeight).toBeGreaterThanOrEqual(38);
});

test("navigates result tabs by mouse and keyboard without moving Confirm", async ({
  page,
}) => {
  const tabs = page.getByRole("tab");
  const confirm = page.getByRole("button", { name: "Confirm" });
  const initialConfirmBox = await confirm.boundingBox();
  expect(initialConfirmBox).not.toBeNull();

  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("identified fixture item").first()).toBeVisible();

  await tabs.nth(1).press("ArrowRight");
  await expect(tabs.nth(2)).toBeFocused();
  await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
  await tabs.nth(2).press("End");
  await expect(tabs.nth(3)).toBeFocused();
  await tabs.nth(3).press("Home");
  await expect(tabs.nth(0)).toBeFocused();
  await tabs.nth(0).press("Tab");
  const summaryPanel = page.getByRole("tabpanel", { name: "Summary" });
  await expect(summaryPanel).toBeFocused();

  const finalConfirmBox = await confirm.boundingBox();
  expect(finalConfirmBox?.y).toBe(initialConfirmBox?.y);
  await confirm.click();
  await expect(page.locator("[data-end-summary-returned-home=true]"))
    .toBeVisible();
});

test("keeps long sections independently scrollable without page overflow", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Dungeon overview" }).click();
  const panel = page.getByRole("tabpanel", {
    name: "Dungeon overview",
  });
  await page.getByRole("tab", { name: "Dungeon overview" }).press("Tab");
  await expect(panel).toBeFocused();

  const scrollState = await panel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
  await panel.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();

  const pageOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(pageOverflow).toBe(false);
});

test("fits the result shell at the supported minimum width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
});

import { expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("?end-summary-fixture=1");
  await expect(page.getByRole("heading", { name: "Game Over" })).toBeVisible();
});

test("[defect-probing] uses the game dialog palette and Home primary button design", async ({
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
      buttonBackground: confirmStyle.backgroundColor,
      buttonMinHeight: Number.parseFloat(confirmStyle.minHeight),
      buttonRadius: Number.parseFloat(confirmStyle.borderTopLeftRadius),
      dialogBox: {
        height: dialogBox.height,
        width: dialogBox.width,
        x: dialogBox.x,
        y: dialogBox.y,
      },
      dialogBackground: dialogStyle.backgroundColor,
      dialogBorder: dialogStyle.borderTopColor,
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
  expect(appearance.dialogBackground).toBe("rgb(13, 16, 17)");
  expect(appearance.dialogBorder).toBe("rgb(90, 98, 104)");
  expect(appearance.dialogRadius).toBeGreaterThanOrEqual(3);
  expect(appearance.buttonBackground).toBe("rgb(17, 20, 22)");
  expect(appearance.buttonRadius).toBeGreaterThanOrEqual(3);
  expect(appearance.buttonMinHeight).toBe(46);
});

test("[defect-probing] uses the Home and game monospace font throughout the result", async ({
  page,
}) => {
  const fonts = await page.evaluate(() => {
    const home = document.createElement("div");
    const game = document.createElement("div");
    home.className = "home-screen";
    game.className = "nh-shell";
    home.style.cssText = "position: fixed; visibility: hidden;";
    game.style.cssText = "position: fixed; visibility: hidden;";
    document.body.append(home, game);

    const screen = document.querySelector<HTMLElement>(".end-summary-screen");
    const heading = screen?.querySelector<HTMLElement>("h1");
    const tab = screen?.querySelector<HTMLElement>("[role='tab']");
    const panel = screen?.querySelector<HTMLElement>("[role='tabpanel']");
    const confirm = screen?.querySelector<HTMLElement>(
      "[data-end-summary-confirm='true']",
    );
    if (!screen || !heading || !tab || !panel || !confirm) {
      throw new Error("Endgame font targets are incomplete");
    }

    const fontFamily = (element: Element): string =>
      getComputedStyle(element).fontFamily;
    const result = {
      home: fontFamily(home),
      game: fontFamily(game),
      screen: fontFamily(screen),
      heading: fontFamily(heading),
      tab: fontFamily(tab),
      panel: fontFamily(panel),
      confirm: fontFamily(confirm),
    };
    home.remove();
    game.remove();
    return result;
  });

  expect(fonts.home).toContain("monospace");
  expect(fonts).toEqual({
    home: fonts.home,
    game: fonts.home,
    screen: fonts.home,
    heading: fonts.home,
    tab: fonts.home,
    panel: fonts.home,
    confirm: fonts.home,
  });
});

test("uses the global scrollbar palette across browser engines", async ({
  browserName,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const panel = page.getByRole("tabpanel", { name: "Summary" });

  // Read both the standard and WebKit pseudo-element scrollbar contracts.
  const readScrollbarAppearance = () => panel.evaluate((element) => {
    const rootStyle = getComputedStyle(document.documentElement);
    const elementStyle = getComputedStyle(element);
    const scrollbarStyle = getComputedStyle(element, "::-webkit-scrollbar");
    const trackStyle = getComputedStyle(
      element,
      "::-webkit-scrollbar-track",
    );
    const thumbStyle = getComputedStyle(
      element,
      "::-webkit-scrollbar-thumb",
    );
    const isTransparent = (value: string): boolean =>
      value === "transparent" || /rgba\([^)]*,\s*0\)$/.test(value);
    return {
      scrollbarColor: elementStyle.getPropertyValue("scrollbar-color"),
      tokens: {
        active: rootStyle.getPropertyValue(
          "--blisshack-scrollbar-thumb-active",
        ).trim(),
        hover: rootStyle.getPropertyValue(
          "--blisshack-scrollbar-thumb-hover",
        ).trim(),
        size: rootStyle.getPropertyValue(
          "--blisshack-scrollbar-size",
        ).trim(),
        thumb: rootStyle.getPropertyValue(
          "--blisshack-scrollbar-thumb",
        ).trim(),
        track: rootStyle.getPropertyValue(
          "--blisshack-scrollbar-track",
        ).trim(),
      },
      webkit: {
        height: scrollbarStyle.height,
        thumbBackground: thumbStyle.backgroundColor,
        thumbBackgroundClip: thumbStyle.backgroundClip,
        thumbBorderRadius: thumbStyle.borderRadius,
        thumbBorderWidth: thumbStyle.borderWidth,
        thumbMinHeight: thumbStyle.minHeight,
        thumbMinWidth: thumbStyle.minWidth,
        thumbTransparent: isTransparent(thumbStyle.backgroundColor),
        trackBackground: trackStyle.backgroundColor,
        trackTransparent: isTransparent(trackStyle.backgroundColor),
        width: scrollbarStyle.width,
      },
    };
  });

  const normal = await readScrollbarAppearance();
  expect(normal.tokens).toEqual({
    active: "#a5edb1",
    hover: "#7ddc8c",
    size: "8px",
    thumb: "#5a6268",
    track: "#0d1011",
  });

  if (browserName === "firefox") {
    expect(normal.scrollbarColor)
      .toBe("rgb(90, 98, 104) rgb(13, 16, 17)");
  } else {
    expect(normal.webkit).toMatchObject({
      height: "8px",
      thumbBackground: "rgb(90, 98, 104)",
      thumbBorderRadius: "4px",
      trackBackground: "rgb(13, 16, 17)",
      width: "8px",
    });
  }

  await panel.focus();
  await expect(panel).toBeFocused();
  const focused = await readScrollbarAppearance();
  if (browserName === "firefox") {
    expect(focused.scrollbarColor)
      .toBe("rgb(125, 220, 140) rgb(13, 16, 17)");
  } else {
    expect(focused.webkit.thumbBackground).toBe("rgb(125, 220, 140)");
  }

  await panel.blur();
  await panel.hover();
  const hovered = await readScrollbarAppearance();
  if (browserName === "firefox") {
    expect(hovered.scrollbarColor)
      .toBe("rgb(125, 220, 140) rgb(13, 16, 17)");
  } else {
    expect(hovered.webkit.thumbBackground).toBe("rgb(125, 220, 140)");
  }

  await page.emulateMedia({ forcedColors: "active" });
  const forcedColors = await readScrollbarAppearance();
  expect(forcedColors.scrollbarColor).toBe("auto");
  if (browserName !== "firefox") {
    expect(forcedColors.webkit).toMatchObject({
      height: "auto",
      thumbBackgroundClip: "border-box",
      thumbBorderRadius: "0px",
      thumbBorderWidth: "0px",
      thumbMinHeight: "0px",
      thumbMinWidth: "0px",
      thumbTransparent: true,
      trackTransparent: true,
      width: "auto",
    });
  }
});

test("navigates result tabs by mouse and keyboard without moving Confirm", async ({
  page,
}) => {
  const tabs = page.getByRole("tab");
  const confirm = page.getByRole("button", { name: "Confirm" });
  const initialConfirmBox = await confirm.boundingBox();
  expect(initialConfirmBox).not.toBeNull();
  await expect(tabs.nth(0)).toBeFocused();
  await tabs.nth(0).press("Shift+Tab");
  await expect(confirm).toBeFocused();
  await confirm.press("Tab");
  await expect(tabs.nth(0)).toBeFocused();

  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("identified fixture item").first()).toBeVisible();

  await tabs.nth(1).press("ArrowRight");
  await expect(tabs.nth(2)).toBeFocused();
  await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
  await tabs.nth(2).press("End");
  await expect(tabs.last()).toBeFocused();
  await tabs.last().press("Home");
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

test("confirms once with Enter from every endgame dialog focus target", async ({
  page,
}) => {
  const confirm = page.getByRole("button", {
    name: "Confirm",
    exact: true,
  });
  const shortcut = confirm.locator("kbd");
  await expect(shortcut).toHaveText("enter");
  const shortcutAppearance = await shortcut.evaluate((element) => {
    const marker = element.getBoundingClientRect();
    const button = element.parentElement?.getBoundingClientRect();
    return {
      color: getComputedStyle(element).color,
      leftOfCenter: button ? marker.right <= button.left + button.width / 2 : false,
    };
  });
  expect(shortcutAppearance).toEqual({
    color: "rgb(125, 220, 140)",
    leftOfCenter: true,
  });

  for (const focusTarget of ["tab", "tabpanel", "confirm"] as const) {
    if (focusTarget !== "tab") {
      await page.goto("?end-summary-fixture=1");
      await expect(page.getByRole("heading", { name: "Game Over" }))
        .toBeVisible();
    }
    const target = focusTarget === "tab"
      ? page.getByRole("tab").first()
      : focusTarget === "tabpanel"
        ? page.getByRole("tabpanel", { name: "Summary" })
        : page.getByRole("button", { name: "Confirm", exact: true });
    await target.focus();
    await expect(target).toBeFocused();
    await target.press("Enter");
    await expect.soft(
      page.locator("[data-end-summary-returned-home=true]"),
      `Enter from ${focusTarget} should perform one confirmation transition`,
    ).toHaveCount(1, { timeout: 2_000 });
  }
});

test("[defect-probing] scrolls overflowing result tabs with a real vertical wheel", async ({
  page,
}) => {
  const tablist = page.getByRole("tablist", { name: "Endgame results" });
  const unoverflowedWheel = await tablist.evaluate((element) => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY: 80,
    });
    return {
      clientWidth: element.clientWidth,
      defaultAllowed: element.dispatchEvent(event),
      defaultPrevented: event.defaultPrevented,
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
    };
  });
  expect(unoverflowedWheel.scrollWidth)
    .toBeLessThanOrEqual(unoverflowedWheel.clientWidth);
  expect(unoverflowedWheel.defaultAllowed).toBe(true);
  expect(unoverflowedWheel.defaultPrevented).toBe(false);
  expect(unoverflowedWheel.scrollLeft).toBe(0);

  await page.setViewportSize({ width: 320, height: 700 });
  const overflow = await tablist.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);

  const tablistBox = await tablist.boundingBox();
  expect(tablistBox).not.toBeNull();
  await page.mouse.move(
    (tablistBox?.x ?? 0) + (tablistBox?.width ?? 0) / 2,
    (tablistBox?.y ?? 0) + (tablistBox?.height ?? 0) / 2,
  );

  await tablist.evaluate((element) => {
    element.scrollLeft = 80;
  });
  await page.mouse.wheel(80, 10);
  await expect.poll(() =>
    tablist.evaluate((element) => element.scrollLeft)).toBe(160);

  await tablist.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.mouse.wheel(0, 120);
  await expect.poll(() =>
    tablist.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const afterWheelRight = await tablist.evaluate(
    (element) => element.scrollLeft,
  );

  await page.mouse.wheel(0, -60);
  await expect.poll(() =>
    tablist.evaluate((element) => element.scrollLeft))
    .toBeLessThan(afterWheelRight);

  const conductTab = page.getByRole("tab", {
    name: "Conduct and Achievements",
  });
  await conductTab.click();
  await expect(conductTab).toHaveAttribute("aria-selected", "true");
  await conductTab.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Ranking" })).toBeFocused();
});

test("keeps long sections independently scrollable without page overflow", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Dungeon Overview" }).click();
  const panel = page.getByRole("tabpanel", {
    name: "Dungeon Overview",
  });
  await page.getByRole("tab", { name: "Dungeon Overview" }).press("Tab");
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

test("[defect-probing] keeps Ranking identity intact while Outcome wraps", async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 700 });
  await page.getByRole("tab", { name: "Ranking" }).click();

  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  for (const label of ["Rank", "Points", "Character", "Outcome", "HP"]) {
    await expect(table.getByRole("columnheader", { name: label }))
      .toBeVisible();
  }

  const character = table.getByRole("cell", {
    name: "TenLetters-Wiz-Hum-Fem-Neu",
  });
  const outcome = table.getByRole("cell", {
    name: /died in The Dungeons of Doom on level 7.*Killed by a minotaur/,
  });
  const characterLayout = await character.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const lineTops = new Set(
      [...range.getClientRects()].map((rect) => Math.round(rect.top)),
    );
    return {
      lineCount: lineTops.size,
      text: element.textContent,
      whiteSpace: getComputedStyle(element).whiteSpace,
    };
  });
  const outcomeLayout = await outcome.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const lineTops = new Set(
      [...range.getClientRects()].map((rect) => Math.round(rect.top)),
    );
    return {
      lineCount: lineTops.size,
      whiteSpace: getComputedStyle(element).whiteSpace,
    };
  });

  expect(characterLayout).toEqual({
    lineCount: 1,
    text: "TenLetters-Wiz-Hum-Fem-Neu",
    whiteSpace: "nowrap",
  });
  expect(outcomeLayout.whiteSpace).not.toBe("nowrap");
  expect(outcomeLayout.lineCount).toBeGreaterThan(1);
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth
      === document.documentElement.clientWidth)).toBe(true);
});

test("keeps Ranking in a focusable horizontal scroller at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const rankingTab = page.getByRole("tab", { name: "Ranking" });
  await rankingTab.click();

  const panel = page.getByRole("tabpanel", { name: "Ranking" });
  const scrollRegion = page.getByRole("region", { name: "Ranking table" });
  await expect(scrollRegion).toBeVisible();
  await rankingTab.press("Tab");
  await expect(panel).toBeFocused();
  await panel.press("Tab");
  await expect(scrollRegion).toBeFocused();

  const scrollState = await scrollRegion.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
    return {
      clientWidth: element.clientWidth,
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
    };
  });
  expect(scrollState.scrollWidth).toBeGreaterThan(scrollState.clientWidth);
  expect(scrollState.scrollLeft).toBeGreaterThan(0);

  const documentWidth = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(documentWidth.scrollWidth).toBe(documentWidth.clientWidth);
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

import { expect, test, type Page } from "@playwright/test";

interface CapturedErrors {
  console: string[];
  page: string[];
}

/**
 * Capture browser errors so an apparently playable UI cannot hide runtime failures.
 * @param page - Playwright page under test.
 * @returns mutable error collections populated for the page lifetime.
 */
function captureErrors(page: Page): CapturedErrors {
  const errors: CapturedErrors = { console: [], page: [] };
  page.on("console", (message) => {
    if (message.type() === "error") errors.console.push(message.text());
  });
  page.on("pageerror", (error) => errors.page.push(error.message));
  return errors;
}

/**
 * Start a new game through the real askname and random role-selection flow.
 * @param page - Playwright page under test.
 * @param name - unique player name.
 */
async function startNewGame(page: Page, name: string): Promise<void> {
  await page.goto(`?integration=${encodeURIComponent(name)}`);
  await expect(page.getByRole("heading", { name: "BlissHack" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Settings" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Who are you?" })).toHaveCount(0);
  const [commands, identity] = await Promise.all([
    page.locator(".home-commands").boundingBox(),
    page.locator(".home-identity").boundingBox(),
  ]);
  expect(Math.abs((commands?.x ?? 0) - (identity?.x ?? 0))).toBeLessThan(2);
  expect(commands?.y).toBeGreaterThan(
    (identity?.y ?? 0) + (identity?.height ?? 0),
  );
  await page.getByRole("button", { name: "New Game" }).click();

  const nameInput = page.getByRole("textbox", { name: "Who are you?" });
  await expect(nameInput).toBeVisible();
  await expect(page.getByText(/Shall I pick character's/)).toHaveCount(0);
  await nameInput.fill(name);
  await nameInput.press("Enter");

  await expect(page.getByText(/Shall I pick character's/)).toBeVisible();
  await page.keyboard.press("y");

  await expect(
    page.getByRole("dialog", { name: "Is this ok? [ynq]" }),
  ).toBeVisible();
  await page.keyboard.press("y");

  await expect(page.locator(".nh-text-dialog")).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("dialog", { name: "Do you want a tutorial?" }),
  ).toBeVisible();
  await page.keyboard.press("n");

  await expect(page.locator(".nh-hp-bar")).toBeVisible();
}

/**
 * Save through the real NetHack command flow and wait for the next home module.
 * @param page - running NetHack page.
 */
async function saveAndReturnHome(page: Page): Promise<void> {
  await page.keyboard.press("S");
  await expect(page.getByText(/Really save/)).toBeVisible();
  await page.keyboard.press("y");
  await expect(page.getByText("--More--", { exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Open the save picker and select one validated character.
 * @param page - page showing the ready home screen.
 * @param name - validated character name shown by the picker.
 */
async function continueSavedGame(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("dialog", { name: "Saved games" })).toBeVisible();
  await page.getByRole("button", {
    name: new RegExp(`^${name}\\b`),
  }).click();
}

/**
 * Move to an adjacent floor square without depending on dungeon randomness.
 * @param page - running NetHack page.
 */
async function moveToAdjacentFloor(page: Page): Promise<void> {
  const cursor = page.locator(".nh-cursor");
  const startX = Number(await cursor.getAttribute("data-start"));
  const startY = Number(await cursor.locator("..").getAttribute("data-y"));
  const rows = await page.locator(".nh-map-row").allTextContents();
  const directions = [
    { dx: -1, dy: 0, key: "ArrowLeft" },
    { dx: 1, dy: 0, key: "ArrowRight" },
    { dx: 0, dy: -1, key: "ArrowUp" },
    { dx: 0, dy: 1, key: "ArrowDown" },
  ];
  const direction = directions.find(
    ({ dx, dy }) => rows[startY + dy]?.[startX + dx] === ".",
  );

  expect(direction, "the initial room should have an adjacent floor").toBeTruthy();
  await page.keyboard.press(direction!.key);
  await expect.poll(async () => {
    const x = await cursor.getAttribute("data-start");
    const y = await cursor.locator("..").getAttribute("data-y");
    return `${x}:${y}`;
  }).not.toBe(`${startX}:${startY}`);
}

test("q quits character selection and returns home", async ({ page }) => {
  const errors = captureErrors(page);
  await page.goto("?integration=quit-role-selection");
  await page.getByRole("button", { name: "New Game" }).click();

  const nameInput = page.getByRole("textbox", { name: "Who are you?" });
  await nameInput.fill("E2E_Quit");
  await nameInput.press("Enter");
  await expect(page.getByText(/Shall I pick character's/)).toBeVisible();

  await page.keyboard.press("q");

  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
  await expect(page.locator(".nh-shell")).toHaveCount(0);
  expect(errors).toEqual({ console: [], page: [] });
});

test("plays through startup and routes terminal UI input", async ({ page }) => {
  const errors = captureErrors(page);
  await startNewGame(page, "E2E_Ada");

  const messageMetrics = await page.locator(".nh-messages").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      requiredHeight: Number.parseFloat(style.lineHeight) * 3
        + Number.parseFloat(style.paddingTop)
        + Number.parseFloat(style.paddingBottom),
    };
  });
  expect(messageMetrics.height).toBeGreaterThanOrEqual(
    messageMetrics.requiredHeight - 0.5,
  );

  await expect(page.getByLabel(/E2E_Ada the .+, 100% HP/)).toBeVisible();
  await expect(page.locator(".nh-map-row")).toHaveCount(21);
  expect(
    await page.locator(".nh-map-row").evaluateAll(
      (rows) => rows.every((row) => row.textContent?.length === 80),
    ),
  ).toBe(true);

  const fill = page.locator(".nh-hp-fill");
  await expect(fill).toHaveClass(/nh-hp-full/);
  expect(await fill.textContent()).toHaveLength(30);
  expect(
    await fill.evaluate((element) => getComputedStyle(element).backgroundColor),
  ).not.toBe("rgba(0, 0, 0, 0)");

  const firstStatusRow = page.locator(".nh-status > div").first();
  const titleBox = await firstStatusRow.locator(":scope > span").first()
    .boundingBox();
  const strengthBox = await firstStatusRow.locator(":scope > span").nth(1)
    .boundingBox();
  expect(titleBox).not.toBeNull();
  expect(strengthBox).not.toBeNull();
  expect(strengthBox!.x - titleBox!.x - titleBox!.width).toBeGreaterThan(4);

  await moveToAdjacentFloor(page);

  await page.keyboard.press("Control+p");
  await expect(
    page.getByRole("dialog", { name: "Message history" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.keyboard.press("Alt+a");
  await expect(page.getByText(/What do you want to adjust/)).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("o");
  await expect(page.getByText("In what direction?", { exact: true })).toBeVisible();
  await page.keyboard.press("Alt+h");
  await expect(page.getByText("In what direction?", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  expect(errors).toEqual({ console: [], page: [] });
});

test("enumerates a persisted save after returning home and refreshing", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "E2ESave";
  await startNewGame(page, name);
  await saveAndReturnHome(page);

  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "BlissHack" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Saved games" })).toBeVisible();
  const [continueButton, savePopover] = await Promise.all([
    page.getByRole("button", { name: "Continue", exact: true }).boundingBox(),
    page.getByRole("dialog", { name: "Saved games" }).boundingBox(),
  ]);
  expect(savePopover?.x).toBeGreaterThanOrEqual(
    (continueButton?.x ?? 0) + (continueButton?.width ?? 0),
  );
  await page.locator(".home-footer").click();
  await expect(page.getByRole("dialog", { name: "Saved games" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", {
    name: new RegExp(`^${name}\\b`),
  })).toBeVisible();
  expect(errors).toEqual({ console: [], page: [] });
});

test("continues through the core restore path without asking for a new name", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "E2ERestore";
  await startNewGame(page, name);
  await moveToAdjacentFloor(page);
  await saveAndReturnHome(page);
  await page.reload();
  await continueSavedGame(page, name);

  await expect(page.getByLabel(new RegExp(`${name} the .+, \\d+% HP`)))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("textbox", { name: "Who are you?" })).toHaveCount(0);
  await expect(page.getByText(/Shall I pick character's/)).toHaveCount(0);
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  expect(errors).toEqual({ console: [], page: [] });
});

test("deletes a saved game only after confirmation and persists deletion", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "E2EDelete";
  await startNewGame(page, name);
  await saveAndReturnHome(page);

  const continueButton = page.getByRole("button", {
    name: "Continue",
    exact: true,
  });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  const savePicker = page.getByRole("dialog", { name: "Saved games" });
  const saveEntry = savePicker.getByRole("button", {
    name: new RegExp(`^${name}\\b`),
  });
  const deleteButton = savePicker.getByRole("button", {
    name: `Delete save ${name}`,
  });
  await expect(saveEntry).toBeVisible();
  await expect(deleteButton).toBeVisible();

  await deleteButton.click();
  await expect(savePicker.getByText("Sure?", { exact: true })).toBeVisible();
  await expect(saveEntry).toBeVisible();
  await expect(continueButton).toBeEnabled();

  await deleteButton.click();
  await expect(saveEntry).toHaveCount(0);
  await expect(continueButton).toBeDisabled();

  await page.reload();
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  expect(errors).toEqual({ console: [], page: [] });
});

test("retires the first module before preparing and running the second game", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "E2ETwoGames";
  await startNewGame(page, name);
  await saveAndReturnHome(page);

  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await continueSavedGame(page, name);
  await expect(page.getByLabel(new RegExp(`${name} the .+, \\d+% HP`)))
    .toBeVisible({ timeout: 15_000 });
  await saveAndReturnHome(page);

  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("dialog", { name: "Saved games" })).toBeVisible();
  await page.getByRole("button", { name: "New Game" }).click();
  await expect(page.getByRole("textbox", { name: "Who are you?" })).toBeVisible();
  await expect(page.locator(".nh-cursor")).toHaveCount(0);
  expect(errors).toEqual({ console: [], page: [] });
});

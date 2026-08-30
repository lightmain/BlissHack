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
  await page.goto(`/?integration=${encodeURIComponent(name)}`);

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

test("plays through startup and routes terminal UI input", async ({ page }) => {
  const errors = captureErrors(page);
  await startNewGame(page, "E2E_Ada");

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

test("persists and restores a named game through IDBFS", async ({ page }) => {
  const errors = captureErrors(page);
  const name = "E2ESave";
  await startNewGame(page, name);

  await page.keyboard.press("S");
  await expect(page.getByText(/Really save/)).toBeVisible();
  await page.keyboard.press("y");
  await expect(page.getByText("--More--", { exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.locator(".nh-runtime-exited")).toHaveText("Be seeing you...", {
    timeout: 15_000,
  });

  await page.reload();
  const nameInput = page.getByRole("textbox", { name: "Who are you?" });
  await expect(nameInput).toBeVisible();
  await nameInput.fill(name);
  await nameInput.press("Enter");

  await expect(page.getByLabel(new RegExp(`${name} the .+, \\d+% HP`)))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Shall I pick character's/)).toHaveCount(0);
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  expect(errors).toEqual({ console: [], page: [] });
});

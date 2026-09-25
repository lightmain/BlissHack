import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import {
  moveToAdjacentFloor,
  openHome,
  saveAndReturnHome,
  startNewGame,
  statusField,
} from "./helpers/game-flow";
import { readCursorPosition } from "./helpers/map-viewport-state";

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
  const saveChoice = page.getByRole("button", {
    name: new RegExp(`^${name}\\b`),
  });
  await expect(saveChoice).toBeVisible();
  await expect(saveChoice.locator("small")).toHaveText(
    /^[A-Za-z]{3} · [A-Za-z]{3} · [A-Za-z]{3} · [A-Za-z]{3}$/,
  );
  await expect(saveChoice).not.toContainText("Ready to continue");
  expect(errors).toEqual({ console: [], page: [] });
});

test("restores the saved identity and map position", async ({ page }) => {
  const errors = captureErrors(page);
  const name = "E2ERestore";
  await openHome(page, "restore-known-identity");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("group", { name: "Character setup style" })
    .getByRole("radio", { name: "Original" })
    .check();
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "New Game" }).click();
  const nameInput = page.getByRole("textbox", { name: "Who are you?" });
  await nameInput.fill(name);
  await nameInput.press("Enter");
  await expect(page.getByText(/Shall I pick character's/)).toBeVisible();
  await page.keyboard.press("n");
  await expect(page.getByRole("dialog", {
    name: "Pick a role or profession",
  })).toBeVisible();
  await page.keyboard.press("a");
  await expect(page.getByRole("dialog", {
    name: "Pick a race or species",
  })).toBeVisible();
  await page.keyboard.press("h");
  await expect(page.getByRole("dialog", {
    name: "Pick a gender or sex",
  })).toBeVisible();
  await page.keyboard.press("m");
  await expect(page.getByRole("dialog", {
    name: "Pick an alignment or creed",
  })).toBeVisible();
  await page.keyboard.press("l");
  await expect(page.getByRole("dialog", {
    name: "Is this ok? [ynq]",
  })).toContainText(`${name} the lawful male human Archeologist`);
  await page.keyboard.press("y");
  await expect(page.locator(".nh-text-dialog")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", {
    name: "Do you want a tutorial?",
  })).toBeVisible();
  await page.keyboard.press("n");

  const statusTitle = statusField(page, "title");
  const savedTitle = (await statusTitle.textContent())?.trim();
  expect(savedTitle).toMatch(new RegExp(`^${name} the .+$`));
  const savedPosition = await moveToAdjacentFloor(page);
  await saveAndReturnHome(page);
  await page.reload();

  await page.getByRole("button", { name: "Continue" }).click();
  const saveChoice = page.getByRole("button", {
    name: new RegExp(`^${name}\\b`),
  });
  await expect(saveChoice).toBeVisible();
  await expect(saveChoice.locator("small")).toHaveText(
    "Arc · Hum · Mal · Law",
  );
  await saveChoice.click();

  await expect(statusTitle).toHaveText(savedTitle!, { timeout: 15_000 });
  await expect(page.getByRole("textbox", { name: "Who are you?" })).toHaveCount(0);
  await expect(page.getByText(/Shall I pick character's/)).toHaveCount(0);
  await expect.poll(async () => readCursorPosition(page)).toEqual(savedPosition);
  expect(errors).toEqual({ console: [], page: [] });
});

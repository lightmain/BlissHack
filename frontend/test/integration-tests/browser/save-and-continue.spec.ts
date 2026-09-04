import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import {
  continueSavedGame,
  moveToAdjacentFloor,
  readCursorPosition,
  saveAndReturnHome,
  startNewGame,
} from "./helpers/game-flow";

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
  await startNewGame(page, name);
  const savedPosition = await moveToAdjacentFloor(page);
  await saveAndReturnHome(page);
  await page.reload();
  await continueSavedGame(page, name);

  await expect(page.getByLabel(new RegExp(`${name} the .+, \\d+% HP`)))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("textbox", { name: "Who are you?" })).toHaveCount(0);
  await expect(page.getByText(/Shall I pick character's/)).toHaveCount(0);
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await expect.poll(async () => readCursorPosition(page)).toEqual(savedPosition);
  expect(errors).toEqual({ console: [], page: [] });
});

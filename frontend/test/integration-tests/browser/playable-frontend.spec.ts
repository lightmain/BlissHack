import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { captureErrors } from "./helpers/browser-errors";
import {
  continueSavedGame,
  moveToAdjacentFloor,
  saveAndReturnHome,
  startNewGame,
} from "./helpers/game-flow";

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

  await page.keyboard.press("Control+p");
  await expect(
    page.getByRole("dialog", { name: "Message history" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.keyboard.press("Alt+a");
  await expect(page.getByText(/What do you want to adjust/)).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Alt+u");
  await expect(page.getByText("In what direction?", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("o");
  await expect(page.getByText("In what direction?", { exact: true })).toBeVisible();
  await page.keyboard.press("Alt+h");
  await expect(page.getByText("In what direction?", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await moveToAdjacentFloor(page);

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
  const confirmation = savePicker.getByText("Sure?", { exact: true });
  await expect(confirmation).toBeVisible();
  await expect(saveEntry).toBeVisible();
  await expect(continueButton).toBeEnabled();
  const [confirmationBox, deleteButtonBox] = await Promise.all([
    confirmation.boundingBox(),
    deleteButton.boundingBox(),
  ]);
  expect(Math.abs(
    (confirmationBox?.x ?? 0) + (confirmationBox?.width ?? 0) / 2
      - (deleteButtonBox?.x ?? 0) - (deleteButtonBox?.width ?? 0) / 2,
  )).toBeLessThan(1);
  expect((confirmationBox?.y ?? 0) + (confirmationBox?.height ?? 0))
    .toBeLessThan(deleteButtonBox?.y ?? 0);

  await deleteButton.click();
  await expect(saveEntry).toHaveCount(0);
  await expect(continueButton).toBeEnabled();
  await expect(savePicker.getByText("No saved games")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  expect(errors).toEqual({ console: [], page: [] });
});

test("exports, deletes, imports, and continues the same raw save", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "E2ERawTransfer";
  await startNewGame(page, name);
  await saveAndReturnHome(page);

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const savePicker = page.getByRole("dialog", { name: "Saved games" });
  const downloadPromise = page.waitForEvent("download");
  await savePicker.getByRole("button", {
    name: `Export save ${name}`,
  }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${name}.nhsave`);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const rawBytes = await readFile(downloadPath!);
  expect(rawBytes.byteLength).toBeGreaterThan(100);

  const deleteButton = savePicker.getByRole("button", {
    name: `Delete save ${name}`,
  });
  await deleteButton.click();
  await deleteButton.click();
  await expect(savePicker.getByText("No saved games")).toBeVisible();

  await savePicker.getByLabel("Import save file").setInputFiles({
    name: "renamed-by-user.bin",
    mimeType: "application/octet-stream",
    buffer: rawBytes,
  });
  await expect(savePicker.getByText("Import successful", { exact: true }))
    .toBeVisible();
  await expect(savePicker.getByRole("button", {
    name: new RegExp(`^${name}\\b`),
  })).toBeVisible();

  await page.reload();
  await continueSavedGame(page, name);
  await expect(page.getByLabel(new RegExp(`${name} the .+, \\d+% HP`)))
    .toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual({ console: [], page: [] });
});

test("shows raw save conflict details and requires cancel or overwrite", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "E2EConflict";
  await startNewGame(page, name);
  await saveAndReturnHome(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const savePicker = page.getByRole("dialog", { name: "Saved games" });
  const downloadPromise = page.waitForEvent("download");
  await savePicker.getByRole("button", {
    name: `Export save ${name}`,
  }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  const rawBytes = await readFile(downloadPath!);

  const input = savePicker.getByLabel("Import save file");
  await input.setInputFiles({
    name: "conflicting-save",
    mimeType: "application/octet-stream",
    buffer: rawBytes,
  });
  const conflict = page.getByRole("dialog", { name: "Save conflict" });
  await expect(conflict).toBeVisible();
  await expect(conflict.getByText("Existing", { exact: true })).toBeVisible();
  await expect(conflict.getByText("Incoming", { exact: true })).toBeVisible();
  await expect(conflict.getByText(/Role/)).toHaveCount(2);
  await expect(conflict.getByText(/Race/)).toHaveCount(2);
  await expect(conflict.getByText(/Gender/)).toHaveCount(2);
  await expect(conflict.getByText(/Alignment/)).toHaveCount(2);
  await conflict.getByRole("button", { name: "Cancel" }).click();
  await expect(conflict).toHaveCount(0);

  await input.setInputFiles({
    name: "conflicting-save",
    mimeType: "application/octet-stream",
    buffer: rawBytes,
  });
  await page.getByRole("dialog", { name: "Save conflict" })
    .getByRole("button", { name: "Overwrite" }).click();
  await expect(savePicker.getByText("Import successful", { exact: true }))
    .toBeVisible();
  expect(errors).toEqual({ console: [], page: [] });
});

test("acknowledges an invalid raw save and returns to normal Home", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await page.goto("?integration=invalid-raw-import");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const savePicker = page.getByRole("dialog", { name: "Saved games" });
  await savePicker.getByLabel("Import save file").setInputFiles({
    name: "not-a-save.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from([0x00, 0x01, 0x02]),
  });

  const errorDialog = page.getByRole("alertdialog", { name: "Import failed" });
  await expect(errorDialog).toBeVisible();
  await errorDialog.getByRole("button", { name: "OK" }).click();
  await expect(errorDialog).toHaveCount(0);
  await expect(savePicker).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "BlissHack" })).toBeVisible();
  expect(errors).toEqual({ console: [], page: [] });
});

test("warns that a New Game name will continue an existing save", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "E2ENameHint";
  const hint = "A save with this name already exists. "
    + "The game will continue from that save.";
  await startNewGame(page, name);
  await saveAndReturnHome(page);

  await page.getByRole("button", { name: "New Game" }).click();
  const nameInput = page.getByRole("textbox", { name: "Who are you?" });
  await nameInput.fill("DifferentName");
  await expect(page.getByText(hint, { exact: true })).toHaveCount(0);

  await nameInput.fill(`  ${name}  `);
  await expect(page.getByText(hint, { exact: true })).toBeVisible();
  await nameInput.press("Enter");
  await expect(page.locator(".nh-hp-bar")).toBeVisible({ timeout: 15_000 });
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

import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import {
  continueSavedGame,
  saveAndReturnHome,
  startNewGame,
} from "./helpers/game-flow";
import {
  deleteSave,
  exportSave,
  importSave,
  openSavePicker,
} from "./helpers/save-flow";

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
  const savePicker = await openSavePicker(page);
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

test("exports, deletes, imports, and continues identical raw save bytes", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "E2ERawTransfer";
  await startNewGame(page, name);
  await saveAndReturnHome(page);

  const savePicker = await openSavePicker(page);
  const rawBytes = await exportSave(page, name);
  expect(rawBytes.byteLength).toBeGreaterThan(100);

  await deleteSave(page, name);
  await expect(savePicker.getByText("No saved games")).toBeVisible();
  await importSave(page, rawBytes, "renamed-by-user.bin");
  await expect(savePicker.getByText("Import successful", { exact: true }))
    .toBeVisible();
  await expect(savePicker.getByRole("button", {
    name: new RegExp(`^${name}\\b`),
  })).toBeVisible();

  const importedBytes = await exportSave(page, name);
  expect(importedBytes).toEqual(rawBytes);

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
  const savePicker = await openSavePicker(page);
  const rawBytes = await exportSave(page, name);

  await importSave(page, rawBytes, "conflicting-save");
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

  await importSave(page, rawBytes, "conflicting-save");
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
  const savePicker = await openSavePicker(page);
  await importSave(page, Buffer.from([0x00, 0x01, 0x02]), "not-a-save.bin");

  const errorDialog = page.getByRole("alertdialog", { name: "Import failed" });
  await expect(errorDialog).toBeVisible();
  await errorDialog.getByRole("button", { name: "OK" }).click();
  await expect(errorDialog).toHaveCount(0);
  await expect(savePicker).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "BlissHack" })).toBeVisible();
  expect(errors).toEqual({ console: [], page: [] });
});

test("keeps the original save after rejecting a truncated import", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "E2ETruncated";
  await startNewGame(page, name);
  await saveAndReturnHome(page);
  await openSavePicker(page);
  const originalBytes = await exportSave(page, name);

  await importSave(page, originalBytes.subarray(0, 3), "truncated.nhsave");
  const errorDialog = page.getByRole("alertdialog", { name: "Import failed" });
  await expect(errorDialog).toBeVisible();
  await errorDialog.getByRole("button", { name: "OK" }).click();

  await openSavePicker(page);
  const preservedBytes = await exportSave(page, name);
  expect(preservedBytes).toEqual(originalBytes);
  expect(errors).toEqual({ console: [], page: [] });
});

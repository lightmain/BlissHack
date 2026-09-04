import { readFile } from "node:fs/promises";
import {
  expect,
  type Download,
  type Locator,
  type Page,
} from "@playwright/test";

/** Open and return the saved-games dialog from a prepared Home screen. */
export async function openSavePicker(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Saved games" });
  await expect(picker).toBeVisible();
  return picker;
}

/** Read all bytes from one completed Playwright download. */
export async function readDownload(download: Download): Promise<Buffer> {
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path!);
}

/** Export one save through the player-visible browser control. */
export async function exportSave(
  page: Page,
  name: string,
): Promise<Buffer> {
  const picker = page.getByRole("dialog", { name: "Saved games" });
  const downloadPromise = page.waitForEvent("download");
  await picker.getByRole("button", {
    name: `Export save ${name}`,
  }).click();
  return readDownload(await downloadPromise);
}

/** Confirm deletion of one save through both clicks required by the UI. */
export async function deleteSave(page: Page, name: string): Promise<void> {
  const picker = page.getByRole("dialog", { name: "Saved games" });
  const deleteButton = picker.getByRole("button", {
    name: `Delete save ${name}`,
  });
  await deleteButton.click();
  await expect(picker.getByText("Sure?", { exact: true })).toBeVisible();
  await deleteButton.click();
}

/** Upload raw save bytes through the real file input. */
export async function importSave(
  page: Page,
  bytes: Buffer,
  fileName = "imported.nhsave",
): Promise<void> {
  const picker = page.getByRole("dialog", { name: "Saved games" });
  await picker.getByLabel("Import save file").setInputFiles({
    name: fileName,
    mimeType: "application/octet-stream",
    buffer: bytes,
  });
}

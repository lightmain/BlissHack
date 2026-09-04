import { createHash } from "node:crypto";
import { expect, test } from "../browser/fixtures";
import { captureErrors } from "../browser/helpers/browser-errors";
import {
  openHome,
  saveAndReturnHome,
  startNewGame,
} from "../browser/helpers/game-flow";
import {
  exportSave,
  openSavePicker,
} from "../browser/helpers/save-flow";

/**
 * Compute the test-only SHA-256 digest for exact transfer comparisons.
 * @param bytes - downloaded raw save bytes.
 */
function saveDigest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

test("creates and normally exits ten consecutive sessions", async ({ page }) => {
  const errors = captureErrors(page);
  await openHome(page, "long-session-cycle");

  for (let round = 1; round <= 10; round += 1) {
    await test.step(`round ${round}/10`, async () => {
      await page.getByRole("button", { name: "New Game" }).click();
      const nameInput = page.getByRole("textbox", { name: "Who are you?" });
      await expect(nameInput).toBeVisible();
      await nameInput.fill(`LongQuit${round}`);
      await nameInput.press("Enter");
      await expect(page.getByText(/Shall I pick character's/)).toBeVisible();

      await page.keyboard.press("q");

      await expect(page.getByRole("button", { name: "New Game" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.locator(".nh-shell")).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Who are you?" }))
        .toHaveCount(0);
    });
  }

  expect(errors).toEqual({ console: [], page: [] });
});

test("continues, saves, and reloads one game ten times", async ({ page }) => {
  const errors = captureErrors(page);
  const name = "LongRestore";
  await startNewGame(page, name);
  await saveAndReturnHome(page);

  for (let round = 1; round <= 10; round += 1) {
    await test.step(`round ${round}/10`, async () => {
      await page.reload();
      await expect(page.getByRole("heading", { name: "BlissHack" }))
        .toBeVisible();
      const picker = await openSavePicker(page);
      await expect(picker.getByRole("button", {
        name: new RegExp(`^${name}\\b`),
      })).toHaveCount(1);
      await picker.getByRole("button", {
        name: new RegExp(`^${name}\\b`),
      }).click();

      await expect(page.getByLabel(new RegExp(`${name} the .+, \\d+% HP`)))
        .toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("textbox", { name: "Who are you?" }))
        .toHaveCount(0);
      await expect(page.getByText(/Shall I pick character's/)).toHaveCount(0);
      await saveAndReturnHome(page);
    });
  }

  expect(errors).toEqual({ console: [], page: [] });
});

test("exports, deletes, imports, and continues five times", async ({ page }) => {
  const errors = captureErrors(page);
  const name = "LongTransfer";
  await startNewGame(page, name);
  await saveAndReturnHome(page);

  for (let round = 1; round <= 5; round += 1) {
    await test.step(`round ${round}/5`, async () => {
      const picker = await openSavePicker(page);
      const original = await exportSave(page, name);
      expect(original.byteLength).toBeGreaterThan(100);
      const originalDigest = saveDigest(original);

      const deleteButton = picker.getByRole("button", {
        name: `Delete save ${name}`,
      });
      await deleteButton.click();
      await deleteButton.click();
      await expect(picker.getByText("No saved games")).toBeVisible();

      await picker.getByLabel("Import save file").setInputFiles({
        name: `round-${round}.nhsave`,
        mimeType: "application/octet-stream",
        buffer: original,
      });
      await expect(picker.getByText("Import successful", { exact: true }))
        .toBeVisible();
      await expect(picker.getByRole("button", {
        name: new RegExp(`^${name}\\b`),
      })).toHaveCount(1);

      const imported = await exportSave(page, name);
      expect(imported).toEqual(original);
      expect(saveDigest(imported)).toBe(originalDigest);

      await picker.getByRole("button", {
        name: new RegExp(`^${name}\\b`),
      }).click();
      await expect(page.getByLabel(new RegExp(`${name} the .+, \\d+% HP`)))
        .toBeVisible({ timeout: 15_000 });
      await saveAndReturnHome(page);
    });
  }

  expect(errors).toEqual({ console: [], page: [] });
});

test("returns from the background and repeatedly scans without duplicates", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "LongScan";
  await startNewGame(page, name);
  await saveAndReturnHome(page);

  const otherPage = await page.context().newPage();
  await otherPage.goto("about:blank");
  await otherPage.bringToFront();
  await page.bringToFront();
  await otherPage.close();

  await expect(page.getByRole("heading", { name: "BlissHack" })).toBeVisible();
  await expect(page.locator(".nh-shell")).toHaveCount(0);

  for (let round = 1; round <= 5; round += 1) {
    await test.step(`scan ${round}/5`, async () => {
      await page.reload();
      await expect(page.getByRole("heading", { name: "BlissHack" }))
        .toBeVisible();
      const picker = await openSavePicker(page);
      await expect(picker.getByRole("button", {
        name: new RegExp(`^${name}\\b`),
      })).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
    });
  }

  expect(errors).toEqual({ console: [], page: [] });
});

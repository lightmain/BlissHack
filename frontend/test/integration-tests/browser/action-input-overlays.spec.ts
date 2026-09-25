import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import {
  openHome,
  startNewGameFromHome,
} from "./helpers/game-flow";

test.use({ screenshot: "off", trace: "off" });

/** Start a real Archeologist game with the BlissHack action bar enabled. */
async function startBlissHackGame(page: Page, marker: string): Promise<void> {
  await openHome(page, marker);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("group", { name: "Action bar" })
    .getByRole("radio", { name: "BlissHack" })
    .check();
  await page.getByRole("button", { name: "Apply" }).click();
  await startNewGameFromHome(page, `${marker}-Arc-Hum-Mal-Law`);
  await expect(page.locator(".nh-shell"))
    .toHaveAttribute("data-command-input", "ready");
}

/** Read a stable rounded bounding box for layout-shift comparisons. */
async function roundedBox(locator: Locator): Promise<{
  height: number;
  width: number;
  x: number;
  y: number;
}> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return {
    height: Math.round(box!.height * 10) / 10,
    width: Math.round(box!.width * 10) / 10,
    x: Math.round(box!.x * 10) / 10,
    y: Math.round(box!.y * 10) / 10,
  };
}

/** Click the center of one pointer-transparent map target marker. */
async function clickTarget(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(
    box!.x + box!.width / 2,
    box!.y + box!.height / 2,
  );
}

test("[defect-probing] BlissHack routes keyboard getdir through a compact overlay without moving the dock", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startBlissHackGame(page, "SecondaryKeyboardDirection");
  const dock = page.getByRole("region", { name: "Action bar", exact: true });
  const before = await roundedBox(dock);

  await page.keyboard.press("Alt+u");
  await expect(page.getByText("In what direction?", { exact: true }))
    .toBeVisible();

  const dialog = page.getByRole("dialog", { name: "In what direction?" });
  const targets = page.locator('[data-direction-target-highlight="true"]');
  const dialogCount = await dialog.count();
  const targetCount = await targets.count();
  expect.soft(await roundedBox(dock)).toEqual(before);
  expect.soft(await dock.locator('[data-dock-region="input"]').count()).toBe(0);
  expect.soft(dialogCount).toBe(1);
  if (dialogCount === 1) {
    expect.soft(await dialog.getAttribute("class")).toContain(
      "nh-secondary-dialog",
    );
  }
  expect.soft(targetCount).toBe(8);

  if (targetCount === 8) {
    await clickTarget(page, targets.first());
    await expect(dialog).toHaveCount(0);
    await expect(targets).toHaveCount(0);
  } else {
    await page.keyboard.press("Escape");
  }
  await expect(page.locator(".nh-shell"))
    .toHaveAttribute("data-command-input", "ready");
  expect(errors).toEqual({ console: [], page: [] });
});

test("[defect-probing] action item selection still advances into the shared direction overlay", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startBlissHackGame(page, "SecondaryActionDirection");
  const dock = page.getByRole("region", { name: "Action bar", exact: true });
  const before = await roundedBox(dock);

  await dock.locator('[data-action-name="throw"]').click();
  const itemDialog = page.getByRole("dialog", { name: "Choose an item" });
  await expect(itemDialog).toBeVisible();
  expect.soft(await itemDialog.getAttribute("class")).toContain(
    "nh-secondary-dialog",
  );
  await itemDialog.locator("[data-action-item]").first().click();

  await expect(page.getByText("In what direction?", { exact: true }))
    .toBeVisible();
  const directionDialog = page.getByRole("dialog", {
    name: "In what direction?",
  });
  const directionDialogCount = await directionDialog.count();
  const targets = page.locator('[data-direction-target-highlight="true"]');
  expect.soft(directionDialogCount).toBe(1);
  if (directionDialogCount === 1) {
    expect.soft(await directionDialog.getAttribute("class")).toContain(
      "nh-secondary-dialog",
    );
  }
  expect.soft(await targets.count()).toBe(8);
  expect.soft(await roundedBox(dock)).toEqual(before);
  expect.soft(await dock.locator('[data-dock-region="input"]').count()).toBe(0);

  await page.keyboard.press("Escape");
  await expect(directionDialog).toHaveCount(0);
  await expect(page.locator('[data-direction-target-highlight="true"]'))
    .toHaveCount(0);
  await expect(page.locator(".nh-shell"))
    .toHaveAttribute("data-command-input", "ready");
  expect(errors).toEqual({ console: [], page: [] });
});

test("[defect-probing] BlissHack yn buttons preserve keyboard and Escape semantics outside the dock", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startBlissHackGame(page, "SecondaryYn");
  const dock = page.getByRole("region", { name: "Action bar", exact: true });
  const before = await roundedBox(dock);

  await page.keyboard.press("S");
  await expect(page.getByText("Really save?", { exact: true })).toBeVisible();
  const firstPrompt = page.getByRole("dialog", { name: "Really save?" });
  const firstPromptCount = await firstPrompt.count();
  expect.soft(await roundedBox(dock)).toEqual(before);
  expect.soft(await dock.locator('[data-dock-region="input"]').count()).toBe(0);
  expect.soft(firstPromptCount).toBe(1);
  if (firstPromptCount === 1) {
    expect.soft(await firstPrompt.getAttribute("class")).toContain(
      "nh-secondary-dialog",
    );
    expect.soft(await firstPrompt.getByRole("button", { name: "Yes" }).count())
      .toBe(1);
    expect.soft(await firstPrompt.getByRole("button", { name: "No" }).count())
      .toBe(1);
    expect.soft(await firstPrompt.getByRole("button", { name: "Quit" }).count())
      .toBe(0);
  }

  if (await firstPrompt.getByRole("button", { name: "No" }).count()) {
    await firstPrompt.getByRole("button", { name: "No" }).click();
  } else {
    await page.keyboard.press("n");
  }
  await expect(page.locator(".nh-shell"))
    .toHaveAttribute("data-command-input", "ready");

  await page.keyboard.press("S");
  await expect(page.getByText("Really save?", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Really save?", { exact: true })).toHaveCount(0);
  await expect(page.locator(".nh-shell"))
    .toHaveAttribute("data-command-input", "ready");
  expect(errors).toEqual({ console: [], page: [] });
});

test("[defect-probing] Messages invokes the real prevmsg action and opens the larger history dialog", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startBlissHackGame(page, "MessageHistoryAction");
  const messages = page.getByRole("region", { name: "Messages" });
  const historyButton = messages.getByRole("button", {
    name: "Message history",
  });
  const historyButtonCount = await historyButton.count();

  expect.soft(historyButtonCount).toBe(1);
  if (historyButtonCount === 1) {
    expect.soft(await historyButton.getAttribute("data-action-name"))
      .toBe("prevmsg");
    await historyButton.click();
  } else {
    await page.keyboard.press("Control+p");
  }

  const history = page.getByRole("dialog", { name: "Message history" });
  await expect(history).toBeVisible();
  await expect(history).toHaveClass(/nh-history-dialog/);
  await expect(history.locator("pre")).not.toBeEmpty();
  await history.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".nh-shell"))
    .toHaveAttribute("data-command-input", "ready");
  expect(errors).toEqual({ console: [], page: [] });
});

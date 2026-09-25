import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import {
  openHome,
  startNewGameFromHome,
} from "./helpers/game-flow";
import { readCursorPosition } from "./helpers/map-viewport-state";

test.use({ screenshot: "off", trace: "off" });

/** Start a real Archeologist game with the BlissHack action bar enabled. */
async function startBlissHackGame(
  page: Page,
  marker: string,
  options: { originalEndgame?: boolean } = {},
): Promise<void> {
  await openHome(page, marker);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("group", { name: "Action bar" })
    .getByRole("radio", { name: "BlissHack" }))
    .toBeChecked();
  if (options.originalEndgame) {
    await page.getByRole("group", { name: "Endgame style" })
      .getByRole("radio", { name: "Original" })
      .check();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "Back to Home" }).click();
  }
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

/**
 * Click the center of one renderer-independent map cell.
 * @param page - running game page.
 * @param mapX - NetHack map column.
 * @param mapY - NetHack map row.
 */
async function clickMapCell(
  page: Page,
  mapX: number,
  mapY: number,
): Promise<void> {
  const box = await page.locator(".nh-map-interaction").boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(
    box!.x + ((mapX + 0.5) / 80) * box!.width,
    box!.y + ((mapY + 0.5) / 21) * box!.height,
  );
}

/**
 * Confirm a real default-No save prompt from its focused Yes button.
 * @param page - running game page.
 * @param marker - unique navigation and character marker.
 * @param activationKey - native button activation key under test.
 */
async function saveWithFocusedYes(
  page: Page,
  marker: string,
  activationKey: "Enter" | "Space",
): Promise<void> {
  await startBlissHackGame(page, marker);
  await page.keyboard.press("S");

  const prompt = page.getByRole("dialog", { name: "Really save?" });
  const yes = prompt.getByRole("button", { name: "Yes" });
  await expect(prompt.getByRole("button", { name: "No" })).toBeFocused();
  await yes.focus();
  await expect(yes).toBeFocused();
  await page.keyboard.press(activationKey);

  const more = page.getByText("--More--", { exact: true });
  await expect(more).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Quit a real game and stop at the first original endgame ynq disclosure.
 * @param page - running game page.
 * @param marker - unique navigation and character marker.
 * @returns the first disclosure dialog.
 */
async function openYnqDisclosure(
  page: Page,
  marker: string,
): Promise<Locator> {
  await startBlissHackGame(page, marker, { originalEndgame: true });
  await page.keyboard.press("#");
  const commandDialog = page.getByRole("dialog", { name: "Extended command" });
  await expect(commandDialog).toBeVisible();
  await commandDialog.locator("input").fill("quit");
  await commandDialog.locator("input").press("Enter");

  const quitPrompt = page.getByRole("dialog", {
    name: "Really quit without saving?",
  });
  await expect(quitPrompt).toBeVisible();
  await page.keyboard.press("y");

  const disclosure = page.getByRole("dialog", {
    name: /Do you want (your possessions identified|to see what you had)/,
  });
  await expect(disclosure).toBeVisible();
  await expect(disclosure.getByRole("button", { name: "Quit" })).toBeVisible();
  return disclosure;
}

/**
 * Advance non-interactive quit output until the next Home module is ready.
 * @param page - page finishing a real NetHack quit.
 */
async function finishQuit(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const home = page.getByRole("button", { name: "New Game" });
    if (await home.isVisible()) return;

    const text = page.locator(".nh-text-dialog");
    const more = page.getByText("--More--", { exact: true });
    if (await text.isVisible()) {
      await text.getByRole("button", { name: "Close" }).click();
    } else if (await more.isVisible()) {
      await page.keyboard.press("Space");
    } else {
      await page.waitForTimeout(100);
    }
  }

  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible({
    timeout: 15_000,
  });
}

test("[defect-probing] BlissHack keeps getdir map clicks on adjacent cells without moving the dock", async ({
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
    const cursor = await readCursorPosition(page);
    const distantX = cursor.x <= 77 ? cursor.x + 2 : cursor.x - 2;
    await clickMapCell(page, distantX, cursor.y);
    await expect(dialog).toBeVisible();
    await expect(targets).toHaveCount(8);

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

test("[defect-probing] BlissHack passes getdir help to the core and retries direction input", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startBlissHackGame(page, "SecondaryKeyboardDirectionHelp");

  await page.keyboard.press("Alt+u");
  const dialog = page.getByRole("dialog", { name: "In what direction?" });
  const targets = page.locator('[data-direction-target-highlight="true"]');
  await expect(dialog).toBeVisible();
  await expect(targets).toHaveCount(8);

  await page.keyboard.press("Shift+Slash");
  const help = page.locator(".nh-text-dialog");
  await expect(help).toContainText("Valid direction keys");
  await help.getByRole("button", { name: "Close" }).click();
  await expect(help).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(targets).toHaveCount(8);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(targets).toHaveCount(0);
  await expect(page.locator(".nh-shell"))
    .toHaveAttribute("data-command-input", "ready");
  expect(errors).toEqual({ console: [], page: [] });
});

test("[defect-probing] getdir buttons preserve Tab and native keyboard activation", async ({
  browserName,
  page,
}) => {
  const errors = captureErrors(page);
  await startBlissHackGame(page, "SecondaryDirectionButtonKeyboard");

  for (const activationKey of ["Enter", "Space"] as const) {
    await page.keyboard.press("Alt+u");
    const dialog = page.getByRole("dialog", { name: "In what direction?" });
    const northwest = dialog.getByRole("button", { name: "Northwest" });
    const north = dialog.getByRole("button", { name: "North", exact: true });
    await expect(northwest).toBeFocused();

    if (browserName === "chromium") {
      await page.keyboard.press("Tab");
      await expect(north).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(northwest).toBeFocused();
    }
    await northwest.focus();
    await page.keyboard.press(activationKey);

    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".nh-shell"))
      .toHaveAttribute("data-command-input", "ready");
  }
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

test("[defect-probing] ynq focuses its default and accepts direct q", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const firstDisclosure = await openYnqDisclosure(
    page,
    "SecondaryYnqDefaultAndQuit",
  );
  await expect(firstDisclosure.getByRole("button", { name: "No" }))
    .toBeFocused();
  await page.keyboard.press("Enter");

  const secondDisclosure = page.getByRole("dialog", {
    name: "Do you want to see your attributes?",
  });
  await expect(secondDisclosure).toBeVisible();
  await page.keyboard.press("q");
  await expect(secondDisclosure).toHaveCount(0);
  await finishQuit(page);
  expect(errors).toEqual({ console: [], page: [] });
});

test("[defect-probing] Escape selects Quit from a real ynq prompt", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const disclosure = await openYnqDisclosure(
    page,
    "SecondaryYnqEscape",
  );
  await page.keyboard.press("Escape");
  await expect(disclosure).toHaveCount(0);
  await finishQuit(page);
  expect(errors).toEqual({ console: [], page: [] });
});

test("[defect-probing] focused Yes submits a default-No yn prompt with Enter", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await saveWithFocusedYes(page, "SecondaryYnFocusedYesEnter", "Enter");
  expect(errors).toEqual({ console: [], page: [] });
});

test("[defect-probing] focused Yes submits a default-No yn prompt with Space", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await saveWithFocusedYes(page, "SecondaryYnFocusedYesSpace", "Space");
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
    await expect(firstPrompt.getByRole("button", { name: "No" }))
      .toBeFocused();
    await page.keyboard.press("Enter");
  } else {
    await page.keyboard.press("n");
  }
  await expect(page.locator(".nh-shell"))
    .toHaveAttribute("data-command-input", "ready");

  await page.keyboard.press("S");
  await expect(page.getByText("Really save?", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Really save?" })
      .getByRole("button", { name: "No" }),
  ).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator(".nh-shell"))
    .toHaveAttribute("data-command-input", "ready");

  await page.keyboard.press("S");
  await expect(page.getByText("Really save?", { exact: true })).toBeVisible();
  await page.keyboard.press("n");
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
    await historyButton.focus();
    await expect(historyButton).toBeFocused();
    await page.keyboard.press("Enter");
  } else {
    await page.keyboard.press("Control+p");
  }

  const history = page.getByRole("dialog", { name: "Message history" });
  await expect(history).toBeVisible();
  await expect(history).toHaveClass(/nh-history-dialog/);
  await expect(history.locator("pre")).not.toBeEmpty();
  await history.getByRole("button", { name: "Close" }).click();
  await historyButton.focus();
  await page.keyboard.press("Space");
  await expect(history).toBeVisible();
  await history.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".nh-shell"))
    .toHaveAttribute("data-command-input", "ready");
  expect(errors).toEqual({ console: [], page: [] });
});

test("[defect-probing] compact PICK_ONE cancel keeps native keyboard activation", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startBlissHackGame(page, "SecondaryPickOneCancel");

  await page.keyboard.press("i");
  const dialog = page.locator(".nh-secondary-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".nh-secondary-dialog-option").first())
    .toBeFocused();

  const cancel = dialog.getByRole("button", { name: "Cancel" });
  await cancel.focus();
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".nh-shell"))
    .toHaveAttribute("data-command-input", "ready");

  await page.keyboard.press("i");
  await expect(dialog).toBeVisible();
  await cancel.focus();
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Space");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".nh-shell"))
    .toHaveAttribute("data-command-input", "ready");
  expect(errors).toEqual({ console: [], page: [] });
});

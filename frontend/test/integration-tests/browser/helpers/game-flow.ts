import { expect, type Locator, type Page } from "@playwright/test";
import {
  readCursorPosition,
  readShellRevision,
  type CursorPosition,
} from "./map-viewport-state";

/**
 * Open a fresh application page and verify the prepared Home screen.
 * @param page - Playwright page under test.
 * @param marker - unique query value used to distinguish the test navigation.
 */
export async function openHome(page: Page, marker: string): Promise<void> {
  await page.goto(`?integration=${encodeURIComponent(marker)}`);
  await expect(page.getByRole("heading", { name: "BlissHack" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Who are you?" })).toHaveCount(0);
  await expect(page.getByText(
    "This browser cannot protect games opened in multiple BlissHack pages.",
  )).toHaveCount(0);
  await expect(page.getByRole("alertdialog", {
    name: "BlissHack is busy in another page",
  })).toHaveCount(0);
}

/**
 * Start a new game through askname and either random or name-specified roles.
 * @param page - page currently showing the prepared Home screen.
 * @param name - unique player name.
 */
export async function startNewGameFromHome(
  page: Page,
  name: string,
): Promise<void> {
  await page.getByRole("button", { name: "New Game" }).click();

  const unifiedNameInput = page.getByRole("textbox", {
    name: "Name",
    exact: true,
  });
  const originalNameInput = page.getByRole("textbox", {
    name: "Who are you?",
    exact: true,
  });
  await expect(unifiedNameInput.or(originalNameInput)).toBeVisible();
  const selectionPrompt = page.getByText(
    /Shall I pick (?:character's|your .+'s)/,
  );
  const introduction = page.locator(".nh-text-dialog");
  if (await unifiedNameInput.isVisible()) {
    const specified = name.match(
      /^(.*)-(Arc|Bar)-Hum-(Mal|Fem)-(Law|Neu|Cha)$/,
    );
    await unifiedNameInput.fill(specified?.[1] ?? name);
    if (specified) {
      const shortcuts = {
        Arc: "a",
        Bar: "b",
        Cha: "c",
        Fem: "f",
        Hum: "h",
        Law: "l",
        Mal: "m",
        Neu: "n",
      } as const;
      await unifiedNameInput.press("Enter");
      await expect(page.locator('[data-character-column="role"]'))
        .toBeFocused();
      await page.keyboard.press(shortcuts[specified[2] as "Arc" | "Bar"]);
      await page.keyboard.press(shortcuts.Hum);
      await page.keyboard.press(shortcuts[specified[3] as "Mal" | "Fem"]);
      await page.keyboard.press(
        shortcuts[specified[4] as "Law" | "Neu" | "Cha"],
      );
      await page.keyboard.press("Enter");
    } else {
      await page.getByRole("button", { name: "Auto & Start" }).click();
    }
  } else {
    await expect(selectionPrompt).toHaveCount(0);
    await originalNameInput.fill(name);
    await originalNameInput.press("Enter");

    const confirmation = page.getByRole("dialog", {
      name: "Is this ok? [ynq]",
    });
    await expect(selectionPrompt.or(confirmation).or(introduction)).toBeVisible();
    if (await selectionPrompt.isVisible()) {
      await page.keyboard.press("y");
      await expect(confirmation).toBeVisible();
    }
    if (await confirmation.isVisible()) await page.keyboard.press("y");
  }

  await expect(introduction).toBeVisible();
  await page.keyboard.press("Enter");

  const tutorial = page.getByRole("dialog", {
    name: "Do you want a tutorial?",
  });
  const characterStatus = page.getByRole("region", {
    name: "Character status",
  });
  await expect(tutorial).toBeVisible();
  await page.keyboard.press("n");
  await expect(characterStatus).toBeVisible();
}

/**
 * Navigate to Home and start a complete new game.
 * @param page - Playwright page under test.
 * @param name - unique player name.
 */
export async function startNewGame(page: Page, name: string): Promise<void> {
  await openHome(page, name);
  const [commands, identity] = await Promise.all([
    page.locator(".home-commands").boundingBox(),
    page.locator(".home-identity").boundingBox(),
  ]);
  expect(Math.abs((commands?.x ?? 0) - (identity?.x ?? 0))).toBeLessThan(2);
  expect(commands?.y).toBeGreaterThan(
    (identity?.y ?? 0) + (identity?.height ?? 0),
  );
  await startNewGameFromHome(page, name);
}

/**
 * Save through the real NetHack command flow and wait for the next Home module.
 * @param page - running NetHack page.
 */
export async function saveAndReturnHome(page: Page): Promise<void> {
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
 * Quit an active game through NetHack's extended-command and end screens.
 * @param page - running NetHack page.
 */
export async function quitAndReturnHome(page: Page): Promise<void> {
  await page.keyboard.press("#");
  const commandDialog = page.getByRole("dialog", { name: "Extended command" });
  await expect(commandDialog).toBeVisible();
  const commandInput = commandDialog.locator("input");
  await commandInput.fill("quit");
  await commandInput.press("Enter");

  await expect(page.getByText(/Really quit without saving/)).toBeVisible();
  await page.keyboard.press("y");

  for (let attempt = 0; attempt < 150; attempt += 1) {
    const homeButton = page.getByRole("button", { name: "New Game" });
    if (await homeButton.isVisible()) return;

    const gameOver = page.getByRole("dialog", { name: "Game Over" });
    const disclosure = page.getByText(
      /Do you want (your possessions identified|to see)/,
    ).first();
    if (await gameOver.isVisible()) {
      await gameOver.getByRole("button", {
        name: "Confirm",
        exact: true,
      }).click();
    } else if (await disclosure.isVisible()) {
      await page.keyboard.press("q");
    } else if (await page.locator(".nh-text-dialog").isVisible()) {
      await page.keyboard.press("Enter");
    } else if (await page.getByText("--More--", { exact: true }).isVisible()) {
      await page.keyboard.press("Space");
    } else {
      await page.waitForTimeout(100);
    }
  }

  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Open the save picker and select one validated character.
 * @param page - page showing the prepared Home screen.
 * @param name - validated character name shown by the picker.
 */
export async function continueSavedGame(
  page: Page,
  name: string,
): Promise<void> {
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("dialog", { name: "Saved games" })).toBeVisible();
  await page.getByRole("button", {
    name: new RegExp(`^${name}\\b`),
  }).click();
  await expect(page.getByRole("region", {
    name: "Character status",
  })).toBeVisible({ timeout: 15_000 });
}

/**
 * Locate one structured status field in either Original or BlissHack mode.
 * @param page - running game page.
 * @param id - semantic field identifier supplied by buildStatusMetrics.
 * @returns locator for the currently rendered status field.
 */
export function statusField(page: Page, id: string): Locator {
  return page.getByRole("region", { name: "Character status" })
    .locator(`[data-status-field="${id}"]`);
}

/**
 * Move to an adjacent floor square without depending on dungeon randomness.
 * @param page - running NetHack page.
 * @returns cursor position after the movement completes.
 */
export async function moveToAdjacentFloor(
  page: Page,
): Promise<CursorPosition> {
  const { x: startX, y: startY } = await readCursorPosition(page);
  const directions = [
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
  ];

  for (const direction of directions) {
    const revision = await readShellRevision(page);
    await page.keyboard.press(direction);
    await page.waitForFunction((previousRevision) => {
      const game = document.querySelector<HTMLElement>(".nh-shell");
      return game !== null
        && Number(game.dataset.snapshotRevision) > previousRevision
        && game.dataset.commandInput === "ready";
    }, revision, { timeout: 10_000 });
    const position = await readCursorPosition(page);
    if (position.x !== startX || position.y !== startY) return position;
  }

  throw new Error("The initial room has no traversable adjacent square");
}

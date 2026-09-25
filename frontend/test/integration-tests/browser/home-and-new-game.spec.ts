import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import { exportDiagnosticLog } from "./helpers/diagnostic-artifact";
import {
  moveToAdjacentFloor,
  openHome,
  saveAndReturnHome,
  startNewGame,
  startNewGameFromHome,
  statusField,
} from "./helpers/game-flow";
import { readExpectedProductVersion } from "./helpers/product-version";
import { openSavePicker } from "./helpers/save-flow";

test("uses n as the guarded Home New Game shortcut", async ({ page }) => {
  await openHome(page, "home-new-game-shortcut");
  const newGame = page.getByRole("button", {
    name: "New Game",
    exact: true,
  });
  const shortcut = newGame.locator("kbd");

  await expect(shortcut).toHaveText("n");
  const shortcutAppearance = await shortcut.evaluate((element) => {
    const marker = element.getBoundingClientRect();
    const button = element.parentElement?.getBoundingClientRect();
    return {
      color: getComputedStyle(element).color,
      leftOfCenter: button ? marker.right <= button.left + button.width / 2 : false,
    };
  });
  expect(shortcutAppearance).toEqual({
    color: "rgb(125, 220, 140)",
    leftOfCenter: true,
  });

  const input = page.locator("[data-test-home-shortcut-input]");
  await page.locator(".home-main").evaluate((element) => {
    const probe = document.createElement("input");
    probe.dataset.testHomeShortcutInput = "true";
    probe.setAttribute("aria-label", "Home shortcut input");
    element.append(probe);
    probe.focus();
  });
  await input.press("n");
  await expect(input).toHaveValue("n");
  await expect(newGame).toBeVisible();
  await input.evaluate((element) => element.remove());

  const guardedDispatches = await page.locator(".home-screen").evaluate(
    (home) => {
      const dispatch = (
        modifiers: Partial<Pick<
          KeyboardEventInit,
          "altKey" | "ctrlKey" | "metaKey"
        >> = {},
        prevent = false,
      ): boolean => {
        if (prevent) {
          home.addEventListener("keydown", (event) => event.preventDefault(), {
            once: true,
          });
        }
        return home.dispatchEvent(new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          code: "KeyN",
          key: "n",
          ...modifiers,
        }));
      };
      return {
        alt: dispatch({ altKey: true }),
        ctrl: dispatch({ ctrlKey: true }),
        defaultPrevented: dispatch({}, true),
        meta: dispatch({ metaKey: true }),
      };
    },
  );
  expect(guardedDispatches.defaultPrevented).toBe(false);
  await expect(newGame).toBeVisible();

  const savePicker = await openSavePicker(page);
  const savePickerDispatchAllowed = await savePicker.evaluate((element) =>
    element.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyN",
      key: "n",
    })));
  expect(savePickerDispatchAllowed).toBe(true);
  await expect(savePicker).toBeVisible();
  await expect(newGame).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(savePicker).toHaveCount(0);

  await page.keyboard.press("n");
  await expect(page.getByRole("textbox")).toBeVisible();
});

test("ignores n while the Home root is inert", async ({ page }) => {
  await openHome(page, "home-new-game-inert-shortcut");
  const newGame = page.getByRole("button", {
    name: "New Game",
    exact: true,
  });
  const root = page.locator("#root");
  const inertDispatchAllowed = await root.evaluate((element) => {
    element.inert = true;
    return element.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyN",
      key: "n",
    }));
  });
  expect(inertDispatchAllowed).toBe(true);
  await expect(newGame).toBeVisible();
  await root.evaluate((element) => {
    element.inert = false;
  });

  await page.keyboard.press("n");
  await expect(page.getByRole("textbox")).toBeVisible();
});

test("starts no NetHack session before the player begins a game", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const expectedProductVersion = await readExpectedProductVersion();
  await openHome(page, "initial-lifecycle");
  await expect(page.locator(".home-version")).toHaveText(expectedProductVersion);
  await expect(page.locator(".home-footer")).toContainText(
    `BlissHack ${expectedProductVersion}`,
  );
  await expect(page.locator(".nh-shell")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();

  const picker = await openSavePicker(page);
  await expect(picker.getByText("No saved games")).toBeVisible();
  await page.keyboard.press("Escape");
  const initial = await exportDiagnosticLog(page);
  expect(initial.diagnostic.events.filter(
    ({ event }) => event === "wasm.main_started",
  )).toHaveLength(0);
  expect(initial.diagnostic.events.filter(
    ({ event }) => event === "session.created",
  )).toHaveLength(0);

  await startNewGameFromHome(page, "E2E_OneSession");
  await saveAndReturnHome(page);
  const afterGame = await exportDiagnosticLog(page);
  expect(afterGame.diagnostic.events.filter(
    ({ event }) => event === "wasm.main_started",
  )).toHaveLength(1);
  expect(afterGame.diagnostic.events.filter(
    ({ event }) => event === "session.created",
  )).toHaveLength(1);
  expect(errors).toEqual({ console: [], page: [] });
});

test("q quits character selection and returns home", async ({ page }) => {
  const errors = captureErrors(page);
  await page.goto("?integration=quit-role-selection");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("group", { name: "Character setup style" })
    .getByRole("radio", { name: "Original" })
    .check();
  await page.getByRole("button", { name: "Apply" }).click();
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

test("keeps the original manual character selection sequence", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "E2EManual";
  await openHome(page, "manual-character-selection");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("group", { name: "Character setup style" })
    .getByRole("radio", { name: "Original" })
    .check();
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "New Game" }).click();

  const nameInput = page.getByRole("textbox", { name: "Who are you?" });
  await expect(nameInput).toBeVisible();
  await nameInput.fill(name);
  await nameInput.press("Enter");

  await expect(page.getByText(/Shall I pick character's/)).toBeVisible();
  await page.keyboard.press("n");

  const role = page.getByRole("dialog", {
    name: "Pick a role or profession",
  });
  await expect(role).toBeVisible();
  await expect(role).toContainText("an Archeologist");
  await page.keyboard.press("a");

  const race = page.getByRole("dialog", {
    name: "Pick a race or species",
  });
  await expect(race).toBeVisible();
  await expect(race).toContainText("human");
  await page.keyboard.press("h");

  const gender = page.getByRole("dialog", {
    name: "Pick a gender or sex",
  });
  await expect(gender).toBeVisible();
  await expect(gender).toContainText("male");
  await page.keyboard.press("m");

  const alignment = page.getByRole("dialog", {
    name: "Pick an alignment or creed",
  });
  await expect(alignment).toBeVisible();
  await expect(alignment).toContainText("lawful");
  await page.keyboard.press("l");

  const confirmation = page.getByRole("dialog", {
    name: "Is this ok? [ynq]",
  });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(
    `${name} the lawful male human Archeologist`,
  );
  await page.keyboard.press("y");

  await expect(page.locator(".nh-text-dialog")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", {
    name: "Do you want a tutorial?",
  })).toBeVisible();
  await page.keyboard.press("n");
  await expect(statusField(page, "title")).toHaveText(`${name} the Digger`);
  expect(errors).toEqual({ console: [], page: [] });
});

test("plays through startup and routes terminal UI input", async ({ page }) => {
  const errors = captureErrors(page);
  await openHome(page, "E2E_Ada");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("group", { name: "Action bar" })
    .getByRole("radio", { name: "BlissHack" }))
    .toBeChecked();
  await page.getByRole("button", { name: "Back to Home" }).click();
  await startNewGameFromHome(page, "E2E_Ada");

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

  await expect(statusField(page, "title")).toHaveText(/^E2E_Ada the .+$/);
  const hitPointProgressbar = page.getByRole("progressbar", {
    name: /^Hit points:/,
  });
  await expect(hitPointProgressbar).toBeVisible();
  const map = page.getByRole("img", { name: "Dungeon map" });
  await expect(map).toBeVisible();
  await expect(map).toHaveClass(/nh-map-tiles/);
  const mapDimensions = await map.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) {
      throw new Error("Tile map is not a canvas");
    }
    const bounds = element.getBoundingClientRect();
    return {
      backingHeight: element.height,
      backingWidth: element.width,
      cssHeight: bounds.height,
      cssWidth: bounds.width,
      devicePixelRatio: window.devicePixelRatio,
    };
  });
  expect(mapDimensions.cssWidth).toBe(1280);
  expect(mapDimensions.cssHeight).toBe(336);
  expect(mapDimensions.backingWidth).toBe(
    Math.round(mapDimensions.cssWidth * mapDimensions.devicePixelRatio),
  );
  expect(mapDimensions.backingHeight).toBe(
    Math.round(mapDimensions.cssHeight * mapDimensions.devicePixelRatio),
  );

  await expect(hitPointProgressbar).toHaveAttribute(
    "aria-valuenow",
    /^-?\d+(?:\.\d+)?$/,
  );
  const hitPointPercent = Number(
    await hitPointProgressbar.getAttribute("aria-valuenow"),
  );
  expect(hitPointPercent).toBeGreaterThanOrEqual(0);
  expect(hitPointPercent).toBeLessThanOrEqual(100);

  const fill = page.locator(".nh-status-bar-hitpoints");
  await expect(fill).toBeVisible();
  const fillStyle = await fill.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      width: Number.parseFloat(style.width),
    };
  });
  expect(fillStyle.width).toBeGreaterThan(0);
  expect(fillStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");

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

test("warns that a New Game name will continue an existing save", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "E2ENameHint";
  const hint = "A save with this name already exists. "
    + "The game will continue from that save.";
  await startNewGame(page, name);
  await saveAndReturnHome(page);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("group", { name: "Character setup style" })
    .getByRole("radio", { name: "Original" })
    .check();
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "New Game" }).click();
  const nameInput = page.getByRole("textbox", { name: "Who are you?" });
  await nameInput.fill("DifferentName");
  await expect(page.getByText(hint, { exact: true })).toHaveCount(0);

  await nameInput.fill(`  ${name}  `);
  await expect(page.getByText(hint, { exact: true })).toBeVisible();
  await nameInput.press("Enter");
  await expect(statusField(page, "title")).toHaveText(
    new RegExp(`^${name} the .+$`),
    { timeout: 15_000 },
  );
  expect(errors).toEqual({ console: [], page: [] });
});

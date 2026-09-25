import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import {
  openHome,
  saveAndReturnHome,
  startNewGame,
  statusField,
} from "./helpers/game-flow";
import {
  exportDiagnosticLog,
} from "./helpers/diagnostic-artifact";
import {
  exportSave,
  openSavePicker,
} from "./helpers/save-flow";

/**
 * Persist the unified character setup style and return to Home.
 * @param page - page showing a prepared Home screen.
 * @param mapRenderer - preview renderer to persist with the setup style.
 */
async function enableUnifiedSetup(
  page: Page,
  mapRenderer: "tiles" | "ascii" = "tiles",
): Promise<void> {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("group", { name: "Character setup style" })
    .getByRole("radio", { name: "BlissHack" }))
    .toBeChecked();
  await page.getByRole("radio", {
    name: mapRenderer === "tiles" ? "Tiles" : "ASCII",
  }).check();
  const apply = page.getByRole("button", { name: "Apply" });
  if (await apply.isEnabled()) {
    await apply.click();
  } else {
    await page.getByRole("button", { name: "Back to Home" }).click();
  }
  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
}

/**
 * Enter a new name and wait for the core-owned selection boundary.
 * @param page - page showing Home with unified setup enabled.
 * @param name - unique player name for the new game.
 */
async function enterCharacterName(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "New Game" }).click();
  const input = page.getByRole("textbox", { name: "Name" });
  await expect(input).toBeFocused();
  await input.fill(name);
  await input.press("Enter");
  await expect(page.locator("[data-character-column=\"role\"]")).toBeFocused();
  await expect(page.getByRole("button", { name: "Auto", exact: true }))
    .toBeEnabled();
}

/**
 * Dismiss the introduction and tutorial to reach the initialized game HUD.
 * @param page - page waiting at the post-selection introduction.
 */
async function finishStartup(page: Page): Promise<void> {
  await expect(page.locator(".nh-text-dialog")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", {
    name: "Do you want a tutorial?",
  })).toBeVisible();
  await page.keyboard.press("n");
  await expect(statusField(page, "title")).toBeVisible();
}

type RejectedShortcutGuard = "repeat" | "isComposing" | "defaultPrevented";
type SetupShortcutKey = "," | "." | "a" | "n";

/**
 * Dispatch a key event which the interface shortcut guard must reject.
 * @param target - active character setup surface.
 * @param key - setup shortcut under test.
 * @param guard - event condition which disqualifies the shortcut.
 * @returns the browser-observed guard flags from the dispatched event.
 */
async function dispatchRejectedShortcut(
  target: Locator,
  key: SetupShortcutKey,
  guard: RejectedShortcutGuard,
): Promise<Record<RejectedShortcutGuard, boolean>> {
  return target.evaluate((element, request) => {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: request.key === ","
        ? "Comma"
        : request.key === "."
          ? "Period"
          : `Key${request.key.toUpperCase()}`,
      isComposing: request.guard === "isComposing",
      key: request.key,
      repeat: request.guard === "repeat",
    });
    if (request.guard === "defaultPrevented") event.preventDefault();
    const observed = {
      repeat: event.repeat,
      isComposing: event.isComposing,
      defaultPrevented: event.defaultPrevented,
    };
    element.dispatchEvent(event);
    return observed;
  }, { guard, key });
}

/**
 * Replace one durable IDBFS save without refreshing the mounted Home module.
 * @param page - page whose origin owns the save database.
 * @param path - formal Emscripten save path.
 * @param bytes - replacement bytes to persist.
 */
async function overwritePersistentSave(
  page: Page,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await page.evaluate(async ({ savePath, contents }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("/save", 21);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("FILE_DATA", "readwrite");
        const store = transaction.objectStore("FILE_DATA");
        const getRequest = store.get(savePath);
        getRequest.onerror = () => reject(getRequest.error);
        getRequest.onsuccess = () => {
          const source = getRequest.result as {
            mode: number;
            timestamp: Date;
          };
          store.put({
            mode: source.mode,
            timestamp: new Date(),
            contents: new Uint8Array(contents),
          }, savePath);
        };
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, { savePath: path, contents: [...bytes] });
}

test("submits a non-empty character name on blur", async ({ page }) => {
  const errors = captureErrors(page);
  await openHome(page, "unified-character-name-blur");
  await enableUnifiedSetup(page);

  await page.getByRole("button", { name: "New Game" }).click();
  const setup = page.getByRole("region", { name: "Character setup" });
  const input = page.getByRole("textbox", { name: "Name" });
  const auto = page.getByRole("button", { name: "Auto", exact: true });
  const autoAndStart = page.getByRole("button", { name: "Auto & Start" });

  await setup.locator(".character-setup-header").click();
  await expect(setup).toHaveAttribute(
    "data-character-phase",
    "entering-name",
  );
  await expect(auto).toBeDisabled();
  await expect(autoAndStart).toBeDisabled();

  await input.fill("E2EUnifiedBlur");
  await setup.locator(".character-setup-header").click();
  await expect(setup).toHaveAttribute("data-character-phase", "selecting");
  await expect(page.locator("[data-character-column=\"role\"]")).toBeFocused();
  await expect(auto).toBeEnabled();
  await expect(autoAndStart).toBeEnabled();
  expect(errors).toEqual({ console: [], page: [] });
});

test("shows column focus only after keyboard character choices", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await openHome(page, "unified-character-pointer-focus");
  await enableUnifiedSetup(page);
  await enterCharacterName(page, "E2EUnifiedPointer");

  const setup = page.getByRole("region", { name: "Character setup" });
  const focusedColumns = setup.locator(".character-option-column:focus");
  const role = setup.locator("[data-character-column=\"role\"]");
  const race = setup.locator("[data-character-column=\"race\"]");
  const gender = setup.locator("[data-character-column=\"gender\"]");
  const alignment = setup.locator("[data-character-column=\"alignment\"]");

  await role.locator(".character-option:not(:disabled)").first().click();
  await expect.soft(focusedColumns).toHaveCount(0);
  await page.keyboard.press("h");
  await expect(gender).toBeFocused();

  await race.getByRole("button", { pressed: true }).click();
  await expect.soft(focusedColumns).toHaveCount(0);
  await page.keyboard.press("m");
  await expect(alignment).toBeFocused();

  await gender.getByRole("button", { pressed: true }).click();
  await expect.soft(focusedColumns).toHaveCount(0);
  await page.keyboard.press("l");
  await expect(page.getByRole("button", { name: "Confirm" })).toBeFocused();

  await alignment.getByRole("button", { pressed: true }).click();
  await expect.soft(focusedColumns).toHaveCount(0);
  expect(errors).toEqual({ console: [], page: [] });
});

test("shows the complete Role column without desktop scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openHome(page, "unified-character-desktop-layout");
  await enableUnifiedSetup(page);
  await enterCharacterName(page, "E2EUnifiedDesktop");

  const dimensions = await page
    .locator("[data-character-column=\"role\"]")
    .evaluate((column) => ({
      clientHeight: column.clientHeight,
      scrollHeight: column.scrollHeight,
    }));
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(
    dimensions.clientHeight,
  );
});

test("uses controlled vertical scrolling without small-screen overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openHome(page, "unified-character-small-layout");
  await enableUnifiedSetup(page);
  await page.getByRole("button", { name: "New Game" }).click();

  const dimensions = await page
    .getByRole("region", { name: "Character setup" })
    .evaluate((setup) => ({
      clientHeight: setup.clientHeight,
      clientWidth: setup.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      overflowY: getComputedStyle(setup).overflowY,
      scrollHeight: setup.scrollHeight,
      scrollWidth: setup.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
  expect(dimensions.overflowY).toBe("auto");
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );
});

test("uses the unified keyboard character setup flow", async ({ page }) => {
  const errors = captureErrors(page);
  const name = "E2EUnifiedKeys";
  await openHome(page, "unified-character-keyboard");
  await enableUnifiedSetup(page);

  await page.getByRole("button", { name: "New Game" }).click();
  const input = page.getByRole("textbox", { name: "Name" });
  await expect(input).toBeFocused();
  await input.press("Enter");
  await expect(input).toBeFocused();
  await expect(page.getByRole("button", { name: "Confirm" })).toBeDisabled();

  await input.fill(`  ${name}  `);
  await input.press("Enter");
  await expect(page.locator("[data-character-column=\"role\"]")).toBeFocused();
  await page.keyboard.press("k");
  await expect(page.locator("[data-character-column=\"race\"]")).toBeFocused();
  await page.keyboard.press("h");
  await expect(page.locator("[data-character-column=\"gender\"]")).toBeFocused();
  await page.keyboard.press("m");
  await expect(
    page.locator("[data-character-column=\"alignment\"]"),
  ).toBeFocused();
  await page.keyboard.press("l");
  await expect(page.getByRole("button", { name: "Confirm" })).toBeFocused();
  await page.keyboard.press("Enter");

  await finishStartup(page);
  await expect(statusField(page, "title")).toHaveText(
    new RegExp(`^${name} the `),
  );
  expect(errors).toEqual({ console: [], page: [] });
});

test("shows punctuation setup actions without intercepting name input", async ({
  page,
}) => {
  await openHome(page, "unified-character-action-labels");
  await enableUnifiedSetup(page);
  await page.getByRole("button", { name: "New Game" }).click();

  const setup = page.getByRole("region", { name: "Character setup" });
  const input = page.getByRole("textbox", { name: "Name" });
  const auto = page.getByRole("button", { name: "Auto", exact: true });
  const autoAndStart = page.getByRole("button", {
    name: "Auto & Start",
    exact: true,
  });
  await expect(auto).toHaveAttribute("aria-keyshortcuts", ",");
  await expect(auto.locator("kbd")).toHaveText(",");
  await expect(autoAndStart).toHaveAttribute("aria-keyshortcuts", ".");
  await expect(autoAndStart.locator("kbd")).toHaveText(".");
  for (const action of [auto, autoAndStart]) {
    const marker = await action.locator("kbd").boundingBox();
    const button = await action.boundingBox();
    expect(marker).not.toBeNull();
    expect(button).not.toBeNull();
    expect(marker!.x + marker!.width).toBeLessThanOrEqual(
      button!.x + button!.width / 2,
    );
  }

  await input.press(",");
  await input.press(".");
  await expect(input).toHaveValue(",.");
  await expect(input).toBeFocused();
  await expect(setup).toHaveAttribute(
    "data-character-phase",
    "entering-name",
  );
});

test("uses comma as the unified Auto action during selection", async ({
  page,
}) => {
  await openHome(page, "unified-character-comma-auto");
  await enableUnifiedSetup(page);
  await enterCharacterName(page, "E2EUnifiedCommaAuto");

  const setup = page.getByRole("region", { name: "Character setup" });
  await setup.evaluate((element) => {
    document.documentElement.dataset.testCharacterPhaseLog = "";
    const observer = new MutationObserver(() => {
      const phase = element.getAttribute("data-character-phase");
      document.documentElement.dataset.testCharacterPhaseLog += ` ${phase}`;
    });
    observer.observe(element, {
      attributeFilter: ["data-character-phase"],
      attributes: true,
    });
  });
  await page.keyboard.press(",");
  await expect(page.getByRole("button", { name: "Confirm" })).toBeEnabled();
  await expect(page.getByRole("button", { pressed: true })).toHaveCount(4);
  const autoPhaseLog = await page.locator("html").getAttribute(
    "data-test-character-phase-log",
  );
  expect(autoPhaseLog).toContain("auto-selecting");
});

test("uses period as the unified Auto & Start action during selection", async ({
  page,
}) => {
  await openHome(page, "unified-character-period-start");
  await enableUnifiedSetup(page);
  await enterCharacterName(page, "E2EUnifiedPeriodStart");

  const setup = page.getByRole("region", { name: "Character setup" });
  await setup.evaluate((element) => {
    document.documentElement.dataset.testCharacterPhaseLog = "";
    const observer = new MutationObserver(() => {
      const phase = element.getAttribute("data-character-phase");
      document.documentElement.dataset.testCharacterPhaseLog += ` ${phase}`;
    });
    observer.observe(element, {
      attributeFilter: ["data-character-phase"],
      attributes: true,
    });
  });
  await page.keyboard.press(".");
  await expect.poll(
    () => page.locator("html").getAttribute(
      "data-test-character-phase-log",
    ),
    { timeout: 2_000 },
  ).toContain("starting");
  await finishStartup(page);
});

test("keeps a available for the Archeologist accelerator", async ({ page }) => {
  await openHome(page, "unified-character-archeologist-accelerator");
  await enableUnifiedSetup(page);
  await enterCharacterName(page, "E2EUnifiedArcheologist");

  const setup = page.getByRole("region", { name: "Character setup" });
  const archeologist = page.getByRole("button", {
    name: "a Archeologist",
    exact: true,
  });

  await page.keyboard.press("a");

  await expect(archeologist).toHaveAttribute("aria-pressed", "true");
  await expect(setup).toHaveAttribute("data-character-focus", "race");
  await expect(setup).toHaveAttribute("data-character-phase", "selecting");
});

test("keeps n available for the Neutral accelerator", async ({ page }) => {
  await openHome(page, "unified-character-neutral-accelerator");
  await enableUnifiedSetup(page);
  await enterCharacterName(page, "E2EUnifiedNeutral");

  const setup = page.getByRole("region", { name: "Character setup" });
  await page.getByRole("button", {
    name: "a Archeologist",
    exact: true,
  }).click();
  await page.getByRole("button", { name: "h human", exact: true }).click();
  await page.getByRole("button", { name: "m male", exact: true }).click();
  const neutral = page.getByRole("button", {
    name: "n neutral",
    exact: true,
  });
  await expect(setup).toHaveAttribute("data-character-focus", "alignment");
  await expect(neutral).toBeEnabled();
  await setup.evaluate((element) => {
    document.documentElement.dataset.testCharacterPhaseLog = "";
    const observer = new MutationObserver(() => {
      const phase = element.getAttribute("data-character-phase");
      document.documentElement.dataset.testCharacterPhaseLog += ` ${phase}`;
    });
    observer.observe(element, {
      attributeFilter: ["data-character-phase"],
      attributes: true,
    });
  });

  await page.keyboard.press("n");

  await expect(neutral).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Confirm" })).toBeFocused();
  await expect(setup).toHaveAttribute("data-character-phase", "ready");
  const phaseLog = await page.locator("html").getAttribute(
    "data-test-character-phase-log",
  );
  expect(phaseLog).not.toMatch(/auto-selecting|starting/);
});

for (
  const guard of [
    "repeat",
    "isComposing",
    "defaultPrevented",
  ] as const satisfies readonly RejectedShortcutGuard[]
) {
  test(`rejects guarded character accelerators: ${guard}`, async ({ page }) => {
    await openHome(page, `unified-character-accelerator-guard-${guard}`);
    await enableUnifiedSetup(page);
    await enterCharacterName(page, `E2EA${guard}`);

    const setup = page.getByRole("region", { name: "Character setup" });
    const archeologist = page.getByRole("button", {
      name: "a Archeologist",
      exact: true,
    });
    const neutral = page.getByRole("button", {
      name: "n neutral",
      exact: true,
    });

    const roleEventState = await dispatchRejectedShortcut(setup, "a", guard);
    expect(roleEventState[guard]).toBe(true);
    await expect(archeologist).toHaveAttribute("aria-pressed", "false");
    await expect(setup).toHaveAttribute("data-character-focus", "role");
    await expect(page.getByRole("button", { pressed: true })).toHaveCount(0);

    await archeologist.click();
    await page.getByRole("button", {
      name: "h human",
      exact: true,
    }).click();
    await page.getByRole("button", {
      name: "m male",
      exact: true,
    }).click();
    await expect(neutral).toBeEnabled();

    const alignmentEventState = await dispatchRejectedShortcut(
      setup,
      "n",
      guard,
    );
    expect(alignmentEventState[guard]).toBe(true);
    await expect(neutral).toHaveAttribute("aria-pressed", "false");
    await expect(setup).toHaveAttribute("data-character-phase", "selecting");
    await expect(setup).toHaveAttribute("data-character-focus", "alignment");
    await expect(page.getByRole("button", { pressed: true })).toHaveCount(3);
  });
}

for (
  const guard of [
    "repeat",
    "isComposing",
    "defaultPrevented",
  ] as const satisfies readonly RejectedShortcutGuard[]
) {
  test(`rejects guarded punctuation setup actions: ${guard}`, async ({
    page,
  }) => {
    await openHome(page, `unified-character-guard-${guard}`);
    await enableUnifiedSetup(page);
    await enterCharacterName(page, `E2EGuard${guard}`);

    const setup = page.getByRole("region", { name: "Character setup" });
    await expect(setup).toHaveAttribute("data-character-focus", "role");
    await expect(page.getByRole("button", { pressed: true })).toHaveCount(0);

    for (const key of [",", "."] as const) {
      const eventState = await dispatchRejectedShortcut(
        setup,
        key,
        guard,
      );
      expect(eventState[guard]).toBe(true);
      await expect(setup).toHaveAttribute("data-character-phase", "selecting");
      await expect(setup).toHaveAttribute("data-character-focus", "role");
      await expect(page.getByRole("button", { pressed: true })).toHaveCount(0);
    }
  });
}

test("activates a focused Role button with Space and advances focus", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await openHome(page, "unified-character-button-keyboard");
  await enableUnifiedSetup(page);
  await enterCharacterName(page, "E2EUnifiedButton");

  const setup = page.getByRole("region", { name: "Character setup" });
  const role = setup.locator("[data-character-column=\"role\"]");
  const race = setup.locator("[data-character-column=\"race\"]");
  const gender = setup.locator("[data-character-column=\"gender\"]");
  const firstRole = role.locator(".character-option:not(:disabled)").first();

  await firstRole.focus();
  await expect(firstRole).toBeFocused();
  await page.keyboard.press("Space");

  await expect(firstRole).toHaveAttribute("aria-pressed", "true");
  await expect(setup).toHaveAttribute("data-character-focus", "race");
  await expect.soft(race).toBeFocused();

  await page.keyboard.press("h");
  await expect(race.getByRole("button", {
    name: "h human",
    exact: true,
  })).toHaveAttribute("aria-pressed", "true");
  await expect(setup).toHaveAttribute("data-character-focus", "gender");
  await expect(gender).toBeFocused();
  expect(errors).toEqual({ console: [], page: [] });
});

test("preserves case-sensitive core role accelerators", async ({ page }) => {
  const errors = captureErrors(page);
  await openHome(page, "unified-character-case-accelerator");
  await enableUnifiedSetup(page);
  await enterCharacterName(page, "E2EUnifiedCase");

  await expect(page.getByRole("button", {
    name: "r Rogue",
    exact: true,
  })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Shift+KeyR");
  await expect(page.getByRole("button", {
    name: "R Ranger",
    exact: true,
  })).toHaveAttribute("aria-pressed", "true");
  const preview = page.locator(".character-preview-tile");
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) return 0;
    return element.getContext("2d")
      ?.getImageData(0, 0, element.width, element.height)
      .data.some((value, index) => index % 4 === 3 && value > 0)
      ? 1
      : 0;
  })).toBe(1);
  expect(errors).toEqual({ console: [], page: [] });
});

test("uses core Auto and returns to unified confirmation", async ({ page }) => {
  const errors = captureErrors(page);
  await openHome(page, "unified-character-auto");
  await enableUnifiedSetup(page);
  await page.getByRole("button", { name: "New Game" }).click();
  const input = page.getByRole("textbox", { name: "Name" });
  await input.fill("E2EUnifiedAuto");
  await expect(input).toBeFocused();
  await expect(page.getByRole("button", { name: "Auto", exact: true }))
    .toBeEnabled();
  await expect(page.getByRole("button", { name: "Auto & Start" }))
    .toBeEnabled();

  await page.getByRole("button", { name: "Auto", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm" })).toBeEnabled();
  await expect(page.getByRole("button", { pressed: true })).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Auto", exact: true }))
    .toBeDisabled();
  await expect(page.getByRole("button", { name: "Auto & Start" }))
    .toBeDisabled();
  await expect(page.getByRole("dialog", {
    name: "Is this ok? [ynq]",
  })).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm" }).click();

  await finishStartup(page);
  expect(errors).toEqual({ console: [], page: [] });
});

test("uses core Auto and Start without stopping for confirmation", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await openHome(page, "unified-character-auto-start");
  await enableUnifiedSetup(page);
  await page.getByRole("button", { name: "New Game" }).click();
  const input = page.getByRole("textbox", { name: "Name" });
  await input.fill("E2EUnifiedStart");
  await expect(input).toBeFocused();
  await expect(page.getByRole("button", { name: "Auto", exact: true }))
    .toBeEnabled();
  await expect(page.getByRole("button", { name: "Auto & Start" }))
    .toBeEnabled();

  await page.getByRole("button", { name: "Auto & Start" }).click();

  await finishStartup(page);
  await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);
  expect(errors).toEqual({ console: [], page: [] });
});

test("cancels unified setup from name", async ({ page }) => {
  const errors = captureErrors(page);
  await openHome(page, "unified-character-name-cancel");
  await enableUnifiedSetup(page);

  await page.getByRole("button", { name: "New Game" }).click();
  await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
  await expect(page.locator(".nh-shell")).toHaveCount(0);
  expect(errors).toEqual({ console: [], page: [] });
});

test("cancels unified setup from character selection", async ({ page }) => {
  const errors = captureErrors(page);
  await openHome(page, "unified-character-selection-cancel");
  await enableUnifiedSetup(page);
  await enterCharacterName(page, "E2EUnifiedCancel");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
  await expect(page.locator(".nh-shell")).toHaveCount(0);
  expect(errors).toEqual({ console: [], page: [] });
});

test("cancels an existing-save name without restoring it", async ({ page }) => {
  const errors = captureErrors(page);
  const name = "E2EUnifiedSavedCancel";
  await startNewGame(page, name);
  await saveAndReturnHome(page);
  await enableUnifiedSetup(page);

  await page.getByRole("button", { name: "New Game" }).click();
  const input = page.getByRole("textbox", { name: "Name" });
  await input.fill(name);
  await expect(page.getByText(
    "Existing save found. This character will continue.",
    { exact: true },
  )).toBeVisible();
  await page.getByRole("button", {
    name: "Cancel character setup",
  }).click();

  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".nh-shell")).toHaveCount(0);
  await expect(statusField(page, "title")).toHaveCount(0);
  expect(errors).toEqual({ console: [], page: [] });
});

test("locks an existing save identity and restores it by name", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "E2EUnifiedSave";
  await openHome(page, "unified-character-save");
  await enableUnifiedSetup(page);
  await enterCharacterName(page, name);
  await page.keyboard.press("k");
  await page.keyboard.press("h");
  await page.keyboard.press("m");
  await page.keyboard.press("l");
  await page.keyboard.press("Enter");
  await finishStartup(page);
  await saveAndReturnHome(page);

  await page.getByRole("button", { name: "New Game" }).click();
  const input = page.getByRole("textbox", { name: "Name" });
  await input.fill(`${name}-Knight`);
  await expect(page.getByText(
    "Existing save found. This character will continue.",
    { exact: true },
  )).toBeVisible();
  await expect(input).toBeFocused();
  await expect(page.getByRole("button", { pressed: true })).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Auto", exact: true }))
    .toBeDisabled();
  await expect(page.getByRole("button", { name: "Auto & Start" }))
    .toBeDisabled();
  await expect(page.getByRole("button", { name: "Confirm" })).toBeEnabled();
  await input.press("Enter");

  await expect(statusField(page, "title")).toHaveText(
    new RegExp(`^${name} the `),
    { timeout: 15_000 },
  );
  expect(errors).toEqual({ console: [], page: [] });
});

test("does not create a new game when same-name restore fails", async ({
  page,
}) => {
  const name = "E2EUnifiedGuard";
  await startNewGame(page, name);
  await saveAndReturnHome(page);
  await enableUnifiedSetup(page);
  await openSavePicker(page);
  const rawBytes = await exportSave(page, name);
  await page.keyboard.press("Escape");
  const identityOffset = rawBytes.indexOf(new TextEncoder().encode(name));
  expect(identityOffset).toBeGreaterThan(0);
  const truncated = rawBytes.subarray(0, identityOffset + 49);
  await overwritePersistentSave(page, `/save/0${name}`, truncated);

  await page.reload();
  const damagedPicker = await openSavePicker(page);
  await expect(damagedPicker.getByRole("button", {
    name: new RegExp(`^${name}\\b`),
  })).toBeEnabled();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "New Game" }).click();
  const input = page.getByRole("textbox", { name: "Name" });
  await input.fill(name);
  await expect(page.getByText(
    "Existing save found. This character will continue.",
    { exact: true },
  )).toBeVisible();
  await input.press("Enter");

  await expect(page.getByText("Read 0 instead of 4 bytes.")).toBeVisible();
  await expect(page.getByText("--More--", { exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Dungeon map" })).toHaveCount(0);
  const { diagnostic } = await exportDiagnosticLog(page);
  expect(diagnostic.events).toContainEqual(expect.objectContaining({
    level: "info",
    event: "session.cleaned",
  }));
});

test("shows a stable ASCII preview without uninitialized status", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await openHome(page, "unified-character-ascii");
  await enableUnifiedSetup(page, "ascii");
  await page.getByRole("button", { name: "New Game" }).click();

  const setup = page.getByRole("region", { name: "Character setup" });
  await expect(setup.locator("[data-preview-renderer=\"ascii\"]")).toHaveText(
    "@",
  );
  await expect(setup.getByText(/\bHP\b|\bEnergy\b|\bStrength\b/)).toHaveCount(0);
  expect(errors).toEqual({ console: [], page: [] });
});

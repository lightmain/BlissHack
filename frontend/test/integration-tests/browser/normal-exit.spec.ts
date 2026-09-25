import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { captureErrors } from "./helpers/browser-errors";
import { exportDiagnosticLog } from "./helpers/diagnostic-artifact";
import {
  quitAndReturnHome,
  openHome,
  saveAndReturnHome,
  startNewGame,
  startNewGameFromHome,
  statusField,
} from "./helpers/game-flow";
import {
  readCursorPosition,
  readShellRevision,
} from "./helpers/map-viewport-state";

/** Return a movement key for one step from the player toward a map cell. */
function directionKey(deltaX: number, deltaY: number): string {
  const directions = new Map([
    ["-1,-1", "y"],
    ["0,-1", "k"],
    ["1,-1", "u"],
    ["-1,0", "h"],
    ["1,0", "l"],
    ["-1,1", "b"],
    ["0,1", "j"],
    ["1,1", "n"],
  ]);
  const key = directions.get(`${Math.sign(deltaX)},${Math.sign(deltaY)}`);
  if (!key) throw new Error("Ranking score target overlaps the player");
  return key;
}

/** Earn a positive core score by force-fighting the visible starting pet. */
async function earnRankingScore(page: Page): Promise<void> {
  const experience = statusField(page, "experience");
  await expect(experience).toBeVisible();

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const currentExperience = Number(
      (await experience.textContent())?.match(/\d+/)?.[0],
    );
    if (currentExperience > 0) return;

    const pet = page.locator(".nh-map-run.nh-pet").first();
    await expect(pet).toBeVisible();
    const [petX, petY, player, revision] = await Promise.all([
      pet.getAttribute("data-start").then(Number),
      pet.locator("..").getAttribute("data-y").then(Number),
      readCursorPosition(page),
      readShellRevision(page),
    ]);
    const deltaX = petX - player.x;
    const deltaY = petY - player.y;
    const adjacent = Math.abs(deltaX) <= 1 && Math.abs(deltaY) <= 1;
    if (adjacent) await page.keyboard.press("F");
    await page.keyboard.press(directionKey(deltaX, deltaY));
    await page.waitForFunction((previousRevision) => {
      const shell = document.querySelector<HTMLElement>(".nh-shell");
      return shell !== null
        && Number(shell.dataset.snapshotRevision) > previousRevision;
    }, revision);
    await expect(page.locator(".nh-shell")).toHaveAttribute(
      "data-command-input",
      "ready",
    );
  }

  throw new Error("Could not earn a positive ranking score");
}

/** Read the exact durable ranking sidecar from Emscripten's IDBFS store. */
async function readDurableRanking(page: Page): Promise<string> {
  return page.evaluate(async () =>
    new Promise<string>((resolve, reject) => {
      const request = indexedDB.open("/save", 21);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("FILE_DATA", "readonly");
        const entryRequest = transaction.objectStore("FILE_DATA")
          .get("/save/.ranking-record");
        entryRequest.onerror = () => reject(entryRequest.error);
        entryRequest.onsuccess = () => {
          const entry = entryRequest.result as {
            contents?: Uint8Array;
          } | undefined;
          if (!(entry?.contents instanceof Uint8Array)) {
            reject(new Error("Durable ranking sidecar was not found"));
            return;
          }
          resolve(String.fromCharCode(...entry.contents));
        };
        transaction.oncomplete = () => database.close();
      };
    }));
}

/** Make this scoring scenario reproducible without changing production code. */
async function installDeterministicRandom(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let state = 0x6d2b79f5;
    Object.defineProperty(globalThis.crypto, "getRandomValues", {
      configurable: true,
      value: <T extends ArrayBufferView | null>(array: T): T => {
        if (array === null) throw new TypeError("Expected an array");
        const bytes = new Uint8Array(
          array.buffer,
          array.byteOffset,
          array.byteLength,
        );
        for (let index = 0; index < bytes.length; index += 1) {
          state ^= state << 13;
          state ^= state >>> 17;
          state ^= state << 5;
          bytes[index] = state & 0xff;
        }
        return array;
      },
    });
  });
}

test("quits an active game and starts a clean second session", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startNewGame(page, "E2E_ActiveQuit");
  await quitAndReturnHome(page);

  await expect(page.locator(".nh-shell")).toHaveCount(0);
  await startNewGameFromHome(page, "E2E_AfterQuit");
  await expect(statusField(page, "title")).toHaveText(
    /^E2E_AfterQuit the .+$/,
  );
  await saveAndReturnHome(page);

  const { diagnostic } = await exportDiagnosticLog(page);
  const sessionIds = diagnostic.events
    .filter(({ event }) => event === "session.created")
    .map(({ sessionId }) => sessionId);
  const moduleIds = diagnostic.events
    .filter(({ event }) => event === "module.loading")
    .map(({ moduleId }) => moduleId);
  expect(sessionIds).toHaveLength(2);
  expect(sessionIds.every(Boolean)).toBe(true);
  expect(new Set(sessionIds).size).toBe(2);
  expect(moduleIds.length).toBeGreaterThanOrEqual(3);
  expect(moduleIds.every(Boolean)).toBe(true);
  expect(new Set(moduleIds).size).toBe(moduleIds.length);
  expect(errors).toEqual({ console: [], page: [] });
});

test("toggles extended-command description search without losing keyboard focus", async ({
  browserName,
  page,
}) => {
  const errors = captureErrors(page);
  await startNewGame(page, "E2E_ExtSearch");

  await page.keyboard.press("#");
  const commandDialog = page.getByRole("dialog", { name: "Extended command" });
  const commandInput = commandDialog.locator("input");
  const descriptionToggle = commandDialog.getByRole("button", {
    name: "Include descriptions in search",
    exact: true,
  });
  const descriptionTooltip = commandDialog.getByRole("tooltip", {
    includeHidden: true,
  });
  const chatCommand = commandDialog.getByRole("button", {
    name: /chat\s+talk to someone/i,
  });

  await expect(commandDialog).toBeVisible();
  await expect(commandInput).toBeFocused();
  await expect(descriptionTooltip).toHaveText(
    "Include descriptions in search",
  );
  const tooltipId = await descriptionTooltip.getAttribute("id");
  expect(tooltipId).toMatch(/^[A-Za-z][\w:.-]*$/);
  await expect(descriptionToggle).toHaveAttribute(
    "aria-describedby",
    tooltipId ?? "",
  );
  expect(await descriptionToggle.getAttribute("title")).toBeNull();
  await expect(descriptionTooltip).toBeHidden();
  await commandInput.fill("talk");
  await expect(chatCommand).toBeVisible();
  expect(await descriptionToggle.evaluate((button) =>
    [...button.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join("")
      .trim()
  )).toBe("?");
  await expect(descriptionToggle).toHaveAttribute("aria-pressed", "true");

  const [inputBox, toggleBox] = await Promise.all([
    commandInput.boundingBox(),
    descriptionToggle.boundingBox(),
  ]);
  expect(inputBox).not.toBeNull();
  expect(toggleBox).not.toBeNull();
  if (!inputBox || !toggleBox) {
    throw new Error("Extended-command search controls were not measurable");
  }
  expect(toggleBox.x).toBeGreaterThanOrEqual(
    inputBox.x + inputBox.width - 1,
  );
  expect(toggleBox.y).toBeLessThan(inputBox.y + inputBox.height);
  expect(toggleBox.y + toggleBox.height).toBeGreaterThan(inputBox.y);

  await descriptionToggle.hover();
  await expect(descriptionTooltip).toBeVisible();
  const [tooltipBox, viewport] = await Promise.all([
    descriptionTooltip.boundingBox(),
    page.evaluate(() => ({
      height: globalThis.innerHeight,
      width: globalThis.innerWidth,
    })),
  ]);
  expect(tooltipBox).not.toBeNull();
  if (!tooltipBox) {
    throw new Error("Description-search tooltip was not measurable");
  }
  expect(tooltipBox.x).toBeGreaterThanOrEqual(0);
  expect(tooltipBox.y).toBeGreaterThanOrEqual(0);
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(
    viewport.width + 1,
  );
  expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(
    viewport.height + 1,
  );
  expect(await page.evaluate(() => ({
    body: document.body.scrollWidth <= document.body.clientWidth,
    document:
      document.documentElement.scrollWidth
      <= document.documentElement.clientWidth,
  }))).toEqual({ body: true, document: true });

  await page.mouse.move(0, 0);
  await expect(descriptionTooltip).toBeHidden();
  if (browserName === "webkit") {
    await descriptionToggle.focus();
  } else {
    await page.keyboard.press("Tab");
  }
  await expect(descriptionToggle).toBeFocused();
  await expect(descriptionTooltip).toBeVisible();
  await page.keyboard.press("Space");
  await expect(descriptionToggle).toHaveAttribute("aria-pressed", "false");
  await expect(commandInput).toBeFocused();
  await expect(descriptionTooltip).toBeHidden();
  await expect(chatCommand).toHaveCount(0);

  await descriptionToggle.click();
  await expect(descriptionToggle).toHaveAttribute("aria-pressed", "true");
  await expect(descriptionTooltip).toHaveAttribute("id", tooltipId ?? "");
  await expect(commandInput).toBeFocused();
  await expect(chatCommand).toBeVisible();

  await descriptionToggle.click();
  await expect(descriptionToggle).toHaveAttribute("aria-pressed", "false");
  await expect(commandInput).toBeFocused();
  await expect(chatCommand).toHaveCount(0);

  await page.mouse.move(0, 0);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("c");
  const commandRows = commandDialog.locator(".nh-extcmd-list > button");
  expect(await commandRows.count()).toBeGreaterThan(1);
  await expect(commandRows.first()).toHaveClass(/focused/);
  await page.keyboard.press("ArrowDown");
  await expect(commandInput).toBeFocused();
  await expect(commandRows.nth(1)).toHaveClass(/focused/);
  await page.keyboard.press("ArrowUp");
  await expect(commandRows.first()).toHaveClass(/focused/);

  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("chat");
  await expect(chatCommand).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(commandDialog).toHaveCount(0);
  expect(errors).toEqual({ console: [], page: [] });
});

test("persists rankings across a reload and a second completed game", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const firstName = "RankOne";
  const secondName = "RankTwo";
  expect(new TextEncoder().encode(firstName).byteLength).toBeLessThanOrEqual(10);
  expect(new TextEncoder().encode(secondName).byteLength).toBeLessThanOrEqual(10);

  await installDeterministicRandom(page);
  await openHome(page, firstName);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "ASCII" }).check();
  await page.getByRole("checkbox", { name: "Show experience" }).check();
  await page.getByRole("button", { name: "Apply" }).click();
  await startNewGameFromHome(page, `${firstName}-Bar-Hum-Mal-Neu`);
  await earnRankingScore(page);
  await quitAndReturnHome(page);
  expect(await readDurableRanking(page)).toContain(firstName);

  await page.reload();
  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
  await startNewGameFromHome(page, `${secondName}-Bar-Hum-Mal-Neu`);
  await earnRankingScore(page);
  await quitAndReturnHome(page);

  const secondRanking = await readDurableRanking(page);
  expect(secondRanking).toContain(firstName);
  expect(secondRanking).toContain(secondName);
  expect(errors).toEqual({ console: [], page: [] });
});

test("retains the last permanent inventory through end-game disclosure", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await openHome(page, "inventory-at-gameover");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("checkbox", {
    name: "Enable Permanent Inventory",
    exact: true,
  }).check();
  await page.getByRole("button", { name: "Apply" }).click();
  await startNewGameFromHome(page, "InventoryGameover");

  const inventory = page.getByRole("region", { name: "Inventory" });
  await expect(inventory).toBeVisible();
  const lastItem = inventory.locator(".permanent-inventory-item").last();
  const lastItemText = await lastItem.textContent();
  expect(lastItemText?.trim()).not.toBe("");

  await page.keyboard.press("#");
  const commandDialog = page.getByRole("dialog", { name: "Extended command" });
  await expect(commandDialog).toBeVisible();
  await commandDialog.locator("input").fill("quit");
  await commandDialog.locator("input").press("Enter");
  await expect(page.getByText(/Really quit without saving/)).toBeVisible();
  await page.keyboard.press("y");
  await expect(page.getByText(
    /Do you want (your possessions identified|to see)/,
  )).toBeVisible();
  await expect(inventory).toBeVisible();
  await expect(inventory).toContainText(lastItemText ?? "");
  expect(errors).toEqual({ console: [], page: [] });
});

test("collects a real unified-character quit into the BlissHack summary", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "E2EBlissEnd";
  await openHome(page, "blisshack-endgame-collection");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("group", { name: "Endgame style" })
    .getByRole("radio", { name: "BlissHack" })
    .check();
  await page.getByRole("group", { name: "Character setup style" })
    .getByRole("radio", { name: "BlissHack" })
    .check();
  await page.getByRole("button", { name: "Apply" }).click();

  await page.getByRole("button", { name: "New Game" }).click();
  const nameInput = page.getByRole("textbox", { name: "Name" });
  await expect(nameInput).toBeFocused();
  await nameInput.fill(name);
  await nameInput.press("Enter");
  await expect(page.locator("[data-character-column=\"role\"]")).toBeFocused();
  await page.keyboard.press("a");
  await page.keyboard.press("h");
  await page.keyboard.press("m");
  await page.keyboard.press("l");
  for (const choice of [
    "a Archeologist",
    "h human",
    "m male",
    "l lawful",
  ]) {
    await expect(page.getByRole("button", {
      name: choice,
      exact: true,
    })).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByRole("button", { name: "Confirm" })).toBeFocused();
  await page.keyboard.press("Enter");

  const introduction = page.locator(".nh-text-dialog");
  await expect(introduction).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", {
    name: "Do you want a tutorial?",
  })).toBeVisible();
  await page.keyboard.press("n");
  await expect(statusField(page, "title")).toHaveText(
    new RegExp(`^${name} the .+$`),
  );

  await page.evaluate(() => {
    type CallbackRecord = {
      name: string;
      choices?: string;
      how?: number;
      identifier?: number;
      query?: string;
      windowId?: number;
    };
    const host = globalThis as typeof globalThis
      & Record<string, unknown>
      & {
        __blisshackEndgameCallbacks?: CallbackRecord[];
        __blisshackEndgameUiSightings?: string[];
      };
    const callbackName = Object.keys(host).find((key) =>
      key.startsWith("blissCallback_session_")
    );
    const callback = callbackName ? host[callbackName] : null;
    if (!callbackName || typeof callback !== "function") {
      throw new Error("Active session callback was not found");
    }
    const callbacks: CallbackRecord[] = [];
    const uiSightings: string[] = [];
    host.__blisshackEndgameCallbacks = callbacks;
    host.__blisshackEndgameUiSightings = uiSightings;
    const observer = new MutationObserver(() => {
      const prompt = document.querySelector(".nh-prompt")?.textContent ?? "";
      if (/Do you want (your possessions identified|to see)/.test(prompt)) {
        uiSightings.push(`prompt:${prompt.trim()}`);
      }
      if (document.querySelector(".nh-dialog.nh-menu")) {
        uiSightings.push("menu");
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    host[callbackName] = async (...args: unknown[]) => {
      const callbackNameArg = typeof args[0] === "string" ? args[0] : "";
      if (
        callbackNameArg === "shim_yn_function"
        || callbackNameArg === "shim_add_menu"
        || callbackNameArg === "shim_select_menu"
      ) {
        callbacks.push({
          name: callbackNameArg,
          ...(callbackNameArg === "shim_yn_function"
            ? {
              query: typeof args[1] === "string" ? args[1] : "",
              choices: typeof args[2] === "string" ? args[2] : "",
            }
            : {}),
          ...(callbackNameArg === "shim_add_menu"
            ? {
              windowId: typeof args[1] === "number" ? args[1] : undefined,
              identifier: typeof args[3] === "number" ? args[3] : undefined,
            }
            : {}),
          ...(callbackNameArg === "shim_select_menu"
            ? {
              windowId: typeof args[1] === "number" ? args[1] : undefined,
              how: typeof args[2] === "number" ? args[2] : undefined,
            }
            : {}),
        });
      }
      return callback(...args);
    };
  });

  await page.keyboard.press("#");
  const commandDialog = page.getByRole("dialog", { name: "Extended command" });
  await expect(commandDialog).toBeVisible();
  await commandDialog.locator("input").fill("quit");
  await commandDialog.locator("input").press("Enter");
  await expect(page.locator(".nh-prompt")).toContainText(
    "Really quit without saving?",
  );
  await page.keyboard.press("n");
  await expect(
    page.getByRole("region", { name: "Character status" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Game Over" })).toHaveCount(0);

  await page.keyboard.press("#");
  await expect(commandDialog).toBeVisible();
  await commandDialog.locator("input").fill("quit");
  await commandDialog.locator("input").press("Enter");
  await expect(page.locator(".nh-prompt")).toContainText(
    "Really quit without saving?",
  );
  await page.keyboard.press("y");

  await page.waitForFunction(() => {
    const host = globalThis as typeof globalThis & {
      __blisshackEndgameUiSightings?: string[];
    };
    return (host.__blisshackEndgameUiSightings?.length ?? 0) > 0
      || document.querySelector(".end-summary-screen") !== null;
  }, undefined, { timeout: 15_000 });
  const callbackTrace = await page.evaluate(() => {
    const host = globalThis as typeof globalThis & {
      __blisshackEndgameCallbacks?: Array<{
        name: string;
        choices?: string;
        how?: number;
        identifier?: number;
        query?: string;
        windowId?: number;
      }>;
      __blisshackEndgameUiSightings?: string[];
    };
    return {
      callbacks: host.__blisshackEndgameCallbacks ?? [],
      uiSightings: host.__blisshackEndgameUiSightings ?? [],
    };
  });
  const inventoryQuestionIndex = callbackTrace.callbacks.findIndex(
    ({ name: callbackName, query }) =>
      callbackName === "shim_yn_function"
      && /possessions identified|what you had when you quit/.test(query ?? ""),
  );
  expect(inventoryQuestionIndex).toBeGreaterThan(-1);
  expect(callbackTrace.callbacks[inventoryQuestionIndex]?.choices).toBe("ynq");
  expect(callbackTrace.uiSightings).toEqual([]);

  const inventorySelectIndex = callbackTrace.callbacks.findIndex(
    ({ how, name: callbackName }, index) =>
      index > inventoryQuestionIndex
      && callbackName === "shim_select_menu"
      && how === 1,
  );
  const inventoryWindowId =
    callbackTrace.callbacks[inventorySelectIndex]?.windowId;
  const inventoryItemCount = callbackTrace.callbacks
    .slice(inventoryQuestionIndex + 1, inventorySelectIndex)
    .filter(({ identifier, name: callbackName, windowId }) =>
      callbackName === "shim_add_menu"
      && windowId === inventoryWindowId
      && identifier !== 0)
    .length;
  expect(inventorySelectIndex).toBeGreaterThan(inventoryQuestionIndex);
  expect(inventoryItemCount).toBeGreaterThan(1);
  expect(callbackTrace.callbacks.findIndex(
    ({ name: callbackName }, index) =>
      index > inventorySelectIndex && callbackName === "shim_yn_function",
  )).toBeGreaterThan(inventorySelectIndex);

  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Game Over" })).toBeVisible();
  await expect(page.locator(".nh-shell"))
    .toHaveAttribute("data-read-only", "true");
  await expect(page.getByRole("dialog", { name: "Game Over" })).toBeVisible();
  const inventoryTab = page.getByRole("tab", {
    name: "Identified Possessions",
  });
  await expect(inventoryTab).toBeVisible();
  await inventoryTab.click();
  const inventoryPanel = page.getByRole("tabpanel", {
    name: "Identified Possessions",
  });
  await expect(inventoryPanel.locator(".permanent-inventory-items"))
    .toBeVisible();
  await expect(inventoryPanel.locator(".permanent-inventory-item"))
    .not.toHaveCount(0);
  expect(errors).toEqual({ console: [], page: [] });
});

test("keeps original end-game disclosures serial and returns after summary", async ({
  page,
}) => {
  const errors = captureErrors(page);
  const name = "E2EEnd";
  await startNewGame(page, name);

  await page.keyboard.press("#");
  const commandDialog = page.getByRole("dialog", { name: "Extended command" });
  await expect(commandDialog).toBeVisible();
  await commandDialog.locator("input").fill("quit");
  await commandDialog.locator("input").press("Enter");
  await expect(page.locator(".nh-prompt")).toContainText(
    "Really quit without saving?",
  );
  await page.keyboard.press("y");

  const prompt = page.locator(".nh-prompt");
  await expect(prompt).toContainText("Do you want your possessions identified?");
  await page.keyboard.press("y");
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu).toBeVisible();
  await expect(menu.locator(".nh-menu-item")).not.toHaveCount(0);
  await page.keyboard.press("Enter");

  await expect(prompt).toContainText("Do you want to see your attributes?");
  await page.keyboard.press("y");
  const textWindow = page.locator(".nh-text-dialog");
  await expect(textWindow).toContainText(`${name} the`);
  await expect(textWindow).toContainText("Final Attributes:");
  await page.keyboard.press("Enter");

  await expect(prompt).toContainText(
    /Do you want to see your conduct(?: and achievements)?/,
  );
  await expect(prompt).not.toContainText(/vanquished|genocided|extinct/i);
  await page.keyboard.press("y");
  await expect(textWindow).toContainText("Voluntary challenges:");
  await page.keyboard.press("Enter");

  await expect(prompt).toContainText("Do you want to see the dungeon overview?");
  await page.keyboard.press("y");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("The Dungeons of Doom");
  await page.keyboard.press("Enter");

  const more = page.getByText("--More--", { exact: true });
  if (await more.isVisible()) await page.keyboard.press("Space");

  await expect(textWindow).toContainText(
    new RegExp(`${name} the .+\\.\\.\\.`),
  );
  await expect(textWindow).toContainText(
    /You quit in The Dungeons of Doom on dungeon level 1 with \d+ points?/,
  );
  await page.evaluate(() => {
    const host = globalThis as typeof globalThis & Record<string, unknown>;
    const callbackName = Object.keys(host).find((name) =>
      name.startsWith("blissCallback_session_")
    );
    const callback = callbackName ? host[callbackName] : null;
    if (!callbackName || typeof callback !== "function") {
      throw new Error("Active session callback was not found");
    }
    const rankingOutput: string[] = [];
    host.__blisshackEndgameRanking = rankingOutput;
    host[callbackName] = async (...args: unknown[]) => {
      if (
        (args[0] === "shim_raw_print" || args[0] === "shim_raw_print_bold")
        && typeof args[1] === "string"
      ) {
        rankingOutput.push(args[1]);
      }
      return callback(...args);
    };
  });
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(textWindow).toHaveCount(0);
  await expect(page.locator(".nh-shell")).toHaveCount(0);
  const rankingOutput = await page.evaluate(() => {
    const host = globalThis as typeof globalThis & {
      __blisshackEndgameRanking?: string[];
    };
    return host.__blisshackEndgameRanking ?? [];
  });
  expect(rankingOutput.join("\n")).toMatch(/\bNo\s+Points\s+Name\b/);
  expect(rankingOutput.join("\n")).toContain(name);

  const { diagnostic } = await exportDiagnosticLog(page);
  const sessionId = diagnostic.events.findLast(
    ({ event }) => event === "session.created",
  )?.sessionId;
  expect(sessionId).toBeTruthy();
  const flushIndex = diagnostic.events.findIndex((event) =>
    event.event === "storage.flush_completed"
      && event.sessionId === sessionId);
  const cleanupIndex = diagnostic.events.findIndex((event) =>
    event.event === "session.cleaned"
      && event.sessionId === sessionId);
  const nextModuleIndex = diagnostic.events.findIndex((event, index) =>
    index > cleanupIndex
      && event.event === "module.loading"
      && event.sessionId === null);
  expect(flushIndex).toBeGreaterThan(-1);
  expect(cleanupIndex).toBeGreaterThan(flushIndex);
  expect(nextModuleIndex).toBeGreaterThan(cleanupIndex);
  expect(errors).toEqual({ console: [], page: [] });
});

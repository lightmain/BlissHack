import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from "@playwright/test";
import { startNewGameFromHome } from "../browser/helpers/game-flow";

const frontendRoot = resolve(import.meta.dirname, "../../..");

test("loads the isolated desktop Home and approves a native close", async () => {
  const userDataDirectory = await mkdtemp(
    join(tmpdir(), "blisshack-desktop-smoke-"),
  );
  let electronApplication: ElectronApplication | null = null;

  try {
    electronApplication = await electron.launch({
      args: [`--user-data-dir=${userDataDirectory}`, "."],
      cwd: frontendRoot,
    });
    const window = await electronApplication.firstWindow();

    await expect.poll(() => window.url()).toBe("blisshack://app/");
    await expect(window.locator(".home-screen")).toBeVisible();
    await expect(
      window.getByRole("heading", { level: 1, name: "BlissHack" }),
    ).toBeVisible();

    expect(await window.evaluate(() => ({
      apiVersion: window.blisshackDesktop?.apiVersion,
      processType: typeof process,
      requireType: typeof require,
    }))).toEqual({
      apiVersion: 1,
      processType: "undefined",
      requireType: "undefined",
    });

    expect(await window.evaluate(async () => {
      const response = await fetch("/nethack-runtime.json");
      const manifest = await response.json() as {
        files?: Record<string, { bytes?: number; sha256?: string }>;
        schemaVersion?: number;
      };
      return {
        files: Object.keys(manifest.files ?? {}).sort(),
        ok: response.ok,
        schemaVersion: manifest.schemaVersion,
        status: response.status,
      };
    })).toEqual({
      files: ["nethack.js", "nethack.wasm"],
      ok: true,
      schemaVersion: 3,
      status: 200,
    });

    expect(await window.evaluate(() =>
      new Promise<{ name: string; value: string }>((resolve, reject) => {
        const request = indexedDB.open("blisshack-desktop-smoke", 1);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("probe");
        };
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("probe", "readwrite");
          const store = transaction.objectStore("probe");
          store.put("available", "indexeddb");
          const result = store.get("indexeddb");
          result.onerror = () => reject(result.error);
          result.onsuccess = () => {
            resolve({ name: database.name, value: String(result.result) });
          };
          transaction.oncomplete = () => database.close();
          transaction.onerror = () => reject(transaction.error);
        };
      })
    )).toEqual({
      name: "blisshack-desktop-smoke",
      value: "available",
    });

    const githubUrl = "https://github.com/lightmain/BlissHack";
    await electronApplication.evaluate(({ shell }) => {
      (
        globalThis as typeof globalThis & { openedExternalUrls?: string[] }
      ).openedExternalUrls = [];
      shell.openExternal = async (url: string) => {
        (
          globalThis as typeof globalThis & { openedExternalUrls?: string[] }
        ).openedExternalUrls?.push(url);
      };
    });
    await window.evaluate((url) => {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      document.body.append(link);
      link.click();
      link.remove();
    }, githubUrl);
    await expect.poll(() => electronApplication?.evaluate(() =>
      (
        globalThis as typeof globalThis & { openedExternalUrls?: string[] }
      ).openedExternalUrls ?? []
    )).toContain(githubUrl);

    const windowClosed = window.waitForEvent("close");
    await electronApplication.evaluate(({ BrowserWindow }) => {
      const [mainWindow] = BrowserWindow.getAllWindows();
      if (!mainWindow) throw new Error("BlissHack did not create a window");
      mainWindow.close();
    });
    await windowClosed;
    expect(window.isClosed()).toBe(true);
  } finally {
    if (electronApplication) {
      await stopElectron(electronApplication);
    }
    await rm(userDataDirectory, { force: true, recursive: true });
  }
});

test("cancels one native close, then saves before closing the game", async () => {
  const userDataDirectory = await mkdtemp(
    join(tmpdir(), "blisshack-desktop-save-"),
  );
  let electronApplication: ElectronApplication | null = null;
  const playerName = "DesktopClose";

  try {
    electronApplication = await electron.launch({
      args: [`--user-data-dir=${userDataDirectory}`, "."],
      cwd: frontendRoot,
    });
    const window = await electronApplication.firstWindow();
    const rendererErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") {
        rendererErrors.push(message.text());
      }
    });
    window.on("pageerror", (error) => {
      rendererErrors.push(error.message);
    });
    await expect(window.locator(".home-screen")).toBeVisible();
    await startNewGameFromHome(window, playerName);

    await requestNativeClose(electronApplication);
    const closeDialog = window.getByRole("alertdialog", {
      name: "Exit BlissHack?",
    });
    await expect(closeDialog).toBeVisible();
    await closeDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(closeDialog).toHaveCount(0);
    expect(window.isClosed()).toBe(false);

    await requestNativeClose(electronApplication);
    await expect(closeDialog).toBeVisible();
    const saveAndExit = closeDialog.getByRole("button", {
      name: "Save and Exit",
    });
    await expect(saveAndExit).toBeEnabled();
    const firstWindowClosed = window.waitForEvent("close");
    await saveAndExit.click();
    await firstWindowClosed;

    const reopenedPromise = electronApplication.waitForEvent("window");
    await electronApplication.evaluate(({ app }) => {
      app.emit("activate");
    });
    const reopened = await reopenedPromise;
    await expect(reopened.locator(".home-screen")).toBeVisible({
      timeout: 20_000,
    });
    await reopened.getByRole("button", { name: "Continue" }).click();
    await expect(reopened.getByRole("dialog", { name: "Saved games" }))
      .toBeVisible();
    const savedGame = reopened.getByRole("button", {
      name: new RegExp(`^${playerName}\\b`),
    });
    await expect(savedGame).toBeVisible();
    await savedGame.click();
    await expect(reopened.getByRole("region", {
      name: "Character status",
    })).toBeVisible({ timeout: 20_000 });

    await requestNativeClose(electronApplication);
    const discardDialog = reopened.getByRole("alertdialog", {
      name: "Exit BlissHack?",
    });
    await expect(discardDialog).toBeVisible();
    const reopenedClosed = reopened.waitForEvent("close");
    await discardDialog.getByRole("button", {
      name: "Exit Without Saving",
    }).click();
    await reopenedClosed;

    const finalWindowPromise = electronApplication.waitForEvent("window");
    await electronApplication.evaluate(({ app }) => {
      app.emit("activate");
    });
    const finalWindow = await finalWindowPromise;
    await expect(finalWindow.locator(".home-screen")).toBeVisible({
      timeout: 20_000,
    });
    await finalWindow.getByRole("button", { name: "Continue" }).click();
    await expect(finalWindow.getByRole("dialog", { name: "Saved games" }))
      .toBeVisible();
    await expect(finalWindow.getByRole("button", {
      name: new RegExp(`^${playerName}\\b`),
    })).toBeVisible();

    expect(rendererErrors).toEqual([]);
  } finally {
    if (electronApplication) {
      await stopElectron(electronApplication);
    }
    await rm(userDataDirectory, { force: true, recursive: true });
  }
});

/** Ask the native BrowserWindow to close through the production handshake. */
async function requestNativeClose(
  application: ElectronApplication,
): Promise<void> {
  await application.evaluate(({ BrowserWindow }) => {
    const [mainWindow] = BrowserWindow.getAllWindows();
    if (!mainWindow) throw new Error("BlissHack did not create a window");
    mainWindow.close();
  });
}

/** Exit the test process directly after production close behavior is verified. */
async function stopElectron(application: ElectronApplication): Promise<void> {
  const child = application.process();
  if (child.exitCode !== null || child.signalCode !== null) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    if (child.exitCode !== null || child.signalCode !== null) return;
    await Promise.race([
      once(child, "exit"),
      new Promise<void>((resolve) => {
        timer = setTimeout(
          resolve,
          5_000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

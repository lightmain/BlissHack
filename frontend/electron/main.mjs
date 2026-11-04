import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
} from "electron";
import { spawn } from "node:child_process";
import {
  open,
  rename,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  basename,
  dirname,
  join,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";
import {
  APP_ORIGIN,
  DESKTOP_CONTENT_SECURITY_POLICY,
  DESKTOP_WEB_PREFERENCES,
  resolveAppResource,
  validateNativeSaveRequest,
} from "./desktop-contract.mjs";

const CLOSE_REQUEST_CHANNEL = "blisshack:close-requested";
const CLOSE_RESPONSE_CHANNEL = "blisshack:respond-to-close";
const SAVE_FILE_CHANNEL = "blisshack:save-file";
const ALLOWED_EXTERNAL_HOSTS = new Set([
  "creativecommons.org",
  "github.com",
  "nethackwiki.com",
  "www.nethack.org",
]);

protocol.registerSchemesAsPrivileged([{
  scheme: "blisshack",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    codeCache: true,
    stream: true,
  },
}]);

app.setName("BlissHack");
const squirrelStartup = handleSquirrelStartup();
const ownsSingleInstance = !squirrelStartup && app.requestSingleInstanceLock();
let mainWindow = null;
let closeAuthorized = false;
let quitAfterClose = false;
let pendingCloseRequest = null;
let nextCloseRequestId = 1;

if (squirrelStartup || !ownsSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("before-quit", (event) => {
    if (!mainWindow || closeAuthorized) return;
    event.preventDefault();
    quitAfterClose = true;
    requestRendererClose("quit");
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  void app.whenReady().then(async () => {
    const desktopSession = session.fromPartition("persist:blisshack");
    configureApplicationMenu();
    configureAboutPanel();
    registerIpcHandlers();
    configureSessionPermissions(desktopSession);
    await registerAssetProtocol(desktopSession);
    createMainWindow();
  }).catch((error) => {
    console.error("BlissHack desktop startup failed", error);
    dialog.showErrorBox(
      "BlissHack could not start",
      "The desktop application could not initialize its secure runtime.",
    );
    app.exit(1);
  });
}

/** Create the single isolated renderer window. */
function createMainWindow() {
  closeAuthorized = false;
  quitAfterClose = false;
  pendingCloseRequest = null;
  const iconPath = join(app.getAppPath(), "electron", "assets", "icon.png");
  const preloadPath = join(app.getAppPath(), "electron", "preload.cjs");
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 840,
    minHeight: 640,
    backgroundColor: "#121218",
    icon: iconPath,
    show: false,
    title: "BlissHack",
    webPreferences: {
      ...DESKTOP_WEB_PREFERENCES,
      preload: preloadPath,
      partition: "persist:blisshack",
    },
  });
  mainWindow = window;

  window.once("ready-to-show", () => window.show());
  window.on("close", (event) => {
    if (closeAuthorized) return;
    event.preventDefault();
    requestRendererClose(quitAfterClose ? "quit" : "window");
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  void window.loadURL(`${APP_ORIGIN}/`).catch((error) => {
    console.error("BlissHack renderer failed to load", error);
    dialog.showErrorBox(
      "BlissHack could not load",
      "The packaged game resources could not be opened.",
    );
    closeAuthorized = true;
    window.destroy();
    app.exit(1);
  });
}

/** Register the immutable renderer bundle below blisshack://app/. */
async function registerAssetProtocol(desktopSession) {
  const assetRoot = join(app.getAppPath(), "dist");
  await desktopSession.protocol.handle("blisshack", async (request) => {
    try {
      const assetPath = await resolveAppResource(request, assetRoot);
      const response = await net.fetch(pathToFileURL(assetPath).toString(), {
        method: request.method,
      });
      const headers = new Headers(response.headers);
      headers.set(
        "Content-Security-Policy",
        DESKTOP_CONTENT_SECURITY_POLICY,
      );
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(request.method === "HEAD" ? null : response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    } catch {
      return new Response("Not Found", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        status: 404,
      });
    }
  });
}

/** Deny browser capabilities which are unnecessary for this local game. */
function configureSessionPermissions(desktopSession) {
  desktopSession.setPermissionCheckHandler(() => false);
  desktopSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
}

/** Register the two narrow renderer-to-main operations. */
function registerIpcHandlers() {
  ipcMain.handle(CLOSE_RESPONSE_CHANNEL, (event, payload) => {
    assertTrustedSender(event);
    if (
      typeof payload !== "object"
      || payload === null
      || !Number.isSafeInteger(payload.requestId)
      || (payload.decision !== "approve" && payload.decision !== "cancel")
      || !pendingCloseRequest
      || payload.requestId !== pendingCloseRequest.requestId
    ) {
      throw new Error("Invalid desktop close response");
    }
    if (payload.decision === "cancel") {
      pendingCloseRequest = null;
      quitAfterClose = false;
      return;
    }

    const shouldQuit = quitAfterClose || process.platform !== "darwin";
    pendingCloseRequest = null;
    closeAuthorized = true;
    const window = mainWindow;
    if (window && !window.isDestroyed()) window.destroy();
    if (shouldQuit) app.quit();
  });

  ipcMain.handle(SAVE_FILE_CHANNEL, async (event, rawRequest) => {
    assertTrustedSender(event);
    const request = validateNativeSaveRequest(rawRequest);
    const window = mainWindow;
    if (!window || window.isDestroyed()) {
      throw new Error("The BlissHack window is unavailable");
    }
    const result = await dialog.showSaveDialog(window, {
      buttonLabel: "Save",
      defaultPath: join(app.getPath("downloads"), request.fileName),
      properties: [
        "createDirectory",
        "showOverwriteConfirmation",
      ],
      title: "Save BlissHack File",
    });
    if (result.canceled || !result.filePath) return { status: "cancelled" };
    await writeFileAtomically(result.filePath, new Uint8Array(request.data));
    return { status: "saved" };
  });
}

/** Replace a user-selected file only after durable temporary-file completion. */
async function writeFileAtomically(filePath, data) {
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle = null;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, filePath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Send at most one close request until the renderer answers it. */
function requestRendererClose(reason) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!pendingCloseRequest) {
    pendingCloseRequest = {
      reason,
      requestId: nextCloseRequestId,
    };
    nextCloseRequestId += 1;
  }
  mainWindow.webContents.send(CLOSE_REQUEST_CHANNEL, pendingCloseRequest);
  mainWindow.show();
  mainWindow.focus();
}

/** Reject IPC from subframes, stale windows and non-application origins. */
function assertTrustedSender(event) {
  if (
    !mainWindow
    || event.sender !== mainWindow.webContents
    || event.senderFrame !== mainWindow.webContents.mainFrame
    || !event.senderFrame.url.startsWith(`${APP_ORIGIN}/`)
  ) {
    throw new Error("Untrusted desktop IPC sender");
  }
}

/** Keep all external navigation in the system browser and on reviewed hosts. */
function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_EXTERNAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** Avoid Windows Alt accelerators while preserving expected macOS roles. */
function configureApplicationMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ]));
}

/** Populate the native About panel without granting renderer privileges. */
function configureAboutPanel() {
  app.setAboutPanelOptions({
    applicationName: "BlissHack",
    applicationVersion: "alpha-2.6",
    copyright: "NetHack copyright 1985-2026",
    credits: "Unofficial NetHack 5.0 port. See bundled notices for licensing.",
    website: "https://github.com/lightmain/BlissHack",
  });
}

/** Complete Squirrel shortcut maintenance without starting the game window. */
function handleSquirrelStartup() {
  if (process.platform !== "win32") return false;
  const squirrelEvent = process.argv[1];
  if (!squirrelEvent?.startsWith("--squirrel-")) return false;
  if (squirrelEvent === "--squirrel-obsolete") return true;

  const updateExecutable = resolve(dirname(process.execPath), "..", "Update.exe");
  const executableName = basename(process.execPath);
  const action = squirrelEvent === "--squirrel-uninstall"
    ? "--removeShortcut"
    : squirrelEvent === "--squirrel-install"
        || squirrelEvent === "--squirrel-updated"
      ? "--createShortcut"
      : null;
  if (!action) return false;

  const child = spawn(updateExecutable, [action, executableName], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return true;
}

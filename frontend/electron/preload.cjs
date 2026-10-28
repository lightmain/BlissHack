const { contextBridge, ipcRenderer } = require("electron");

const CLOSE_REQUEST_CHANNEL = "blisshack:close-requested";
const CLOSE_RESPONSE_CHANNEL = "blisshack:respond-to-close";
const SAVE_FILE_CHANNEL = "blisshack:save-file";
const MAX_NATIVE_SAVE_BYTES = 96 * 1024 * 1024;
const WINDOWS_RESERVED_FILE_NAME =
  /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/iu;

let pendingCloseRequest = null;
const closeListeners = new Set();

ipcRenderer.on(CLOSE_REQUEST_CHANNEL, (_event, payload) => {
  if (
    typeof payload !== "object"
    || payload === null
    || !Number.isSafeInteger(payload.requestId)
    || (payload.reason !== "quit" && payload.reason !== "window")
  ) {
    return;
  }
  pendingCloseRequest = Object.freeze({
    reason: payload.reason,
    requestId: payload.requestId,
  });
  for (const listener of closeListeners) listener(pendingCloseRequest);
});

contextBridge.exposeInMainWorld("blisshackDesktop", Object.freeze({
  apiVersion: 1,
  onCloseRequested(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Close listener must be a function");
    }
    closeListeners.add(listener);
    const bufferedRequest = pendingCloseRequest;
    if (bufferedRequest) queueMicrotask(() => listener(bufferedRequest));
    return () => closeListeners.delete(listener);
  },
  respondToClose(requestId, decision) {
    return ipcRenderer.invoke(CLOSE_RESPONSE_CHANNEL, {
      decision,
      requestId,
    }).then((result) => {
      if (pendingCloseRequest?.requestId === requestId) {
        pendingCloseRequest = null;
      }
      return result;
    });
  },
  saveFile(fileName, data) {
    return ipcRenderer.invoke(
      SAVE_FILE_CHANNEL,
      validateSaveRequest(fileName, data),
    );
  },
}));

/** Bound renderer-controlled values before Electron serializes them for IPC. */
function validateSaveRequest(fileName, data) {
  if (
    typeof fileName !== "string"
    || fileName.length === 0
    || fileName.length > 255
    || fileName.trim() !== fileName
    || fileName === "."
    || fileName === ".."
    || fileName.endsWith(".")
    || /[\\/:<>"|?*]/.test(fileName)
    || [...fileName].some((character) => character.codePointAt(0) < 32)
    || WINDOWS_RESERVED_FILE_NAME.test(fileName)
  ) {
    throw new TypeError("Native save filename is not portable");
  }
  if (!(data instanceof ArrayBuffer)) {
    throw new TypeError("Native save data must be an ArrayBuffer");
  }
  if (data.byteLength > MAX_NATIVE_SAVE_BYTES) {
    throw new RangeError("Native save data exceeds the 96 MiB limit");
  }
  return { data, fileName };
}

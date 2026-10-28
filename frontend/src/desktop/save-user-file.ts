import {
  getDesktopApi,
  type BlissHackDesktopApi,
  type DesktopSaveResult,
} from "./desktop-api";

const MAX_USER_FILE_BYTES = 96 * 1024 * 1024;

interface UserFile {
  readonly data: string | Uint8Array;
  readonly fileName: string;
  readonly mimeType: string;
}

interface BrowserAnchor {
  download: string;
  href: string;
  click(): void;
  remove(): void;
}

interface BrowserDownloadApi {
  appendAnchor(anchor: BrowserAnchor): void;
  createAnchor(): BrowserAnchor;
  createBlob(parts: BlobPart[], options?: BlobPropertyBag): Blob;
  createObjectURL(blob: Blob): string;
  defer(callback: () => void): void;
  revokeObjectURL(url: string): void;
}

interface SaveUserFileDependencies {
  readonly browser?: BrowserDownloadApi;
  readonly desktopApi?: Pick<BlissHackDesktopApi, "saveFile"> | null;
}

export type SaveUserFileResult =
  | DesktopSaveResult
  | { readonly status: "downloaded" };

/** Save through Electron when present, otherwise retain browser downloads. */
export async function saveUserFile(
  file: UserFile,
  dependencies: SaveUserFileDependencies = {},
): Promise<SaveUserFileResult> {
  if (file.fileName.trim().length === 0) {
    throw new TypeError("A file name is required");
  }
  if (
    file.data instanceof Uint8Array
    && file.data.byteLength > MAX_USER_FILE_BYTES
  ) {
    throw new RangeError("User files cannot exceed 96 MiB");
  }
  const data = copyUserFileData(file.data);
  if (data.byteLength > MAX_USER_FILE_BYTES) {
    throw new RangeError("User files cannot exceed 96 MiB");
  }

  const desktopApi = dependencies.desktopApi === undefined
    ? getDesktopApi()
    : dependencies.desktopApi;
  if (desktopApi) return desktopApi.saveFile(file.fileName, data);

  const browser = dependencies.browser ?? createBrowserDownloadApi();
  const blob = browser.createBlob([data], { type: file.mimeType });
  const url = browser.createObjectURL(blob);
  const anchor = browser.createAnchor();
  anchor.href = url;
  anchor.download = file.fileName;
  browser.appendAnchor(anchor);
  anchor.click();
  anchor.remove();
  browser.defer(() => browser.revokeObjectURL(url));
  return { status: "downloaded" };
}

/** Copy renderer-owned bytes before transferring them across an IPC boundary. */
function copyUserFileData(data: string | Uint8Array): ArrayBuffer {
  if (typeof data === "string") {
    return new TextEncoder().encode(data).buffer;
  }
  return Uint8Array.from(data).buffer;
}

/** Bind browser globals only when the browser fallback is selected. */
function createBrowserDownloadApi(): BrowserDownloadApi {
  return {
    appendAnchor: (anchor) => document.body.append(anchor as HTMLAnchorElement),
    createAnchor: () => document.createElement("a"),
    createBlob: (parts, options) => new Blob(parts, options),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    defer: (callback) => {
      globalThis.setTimeout(callback, 0);
    },
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}

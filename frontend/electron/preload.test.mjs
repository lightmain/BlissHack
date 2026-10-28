import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const MAX_NATIVE_SAVE_BYTES = 96 * 1024 * 1024;
const WINDOWS_RESERVED_FILE_NAMES = [
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
  ..."¹²³".split("").map((suffix) => `COM${suffix}`),
  ..."¹²³".split("").map((suffix) => `LPT${suffix}`),
];

/** Execute the preload with narrow Electron fakes and capture its public API. */
async function loadPreloadApi() {
  let invokeCount = 0;
  let exposedApi;
  const source = await readFile(
    join(import.meta.dirname, "preload.cjs"),
    "utf8",
  );

  vm.runInNewContext(source, {
    ArrayBuffer,
    queueMicrotask,
    require(specifier) {
      if (specifier !== "electron") {
        throw new Error(`Unexpected preload dependency: ${specifier}`);
      }
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            expect(name).toBe("blisshackDesktop");
            exposedApi = api;
          },
        },
        ipcRenderer: {
          invoke() {
            invokeCount += 1;
            return Promise.resolve({ status: "saved" });
          },
          on: vi.fn(),
        },
      };
    },
  });

  expect(exposedApi).toBeDefined();
  return {
    api: exposedApi,
    getInvokeCount: () => invokeCount,
  };
}

describe("desktop preload save boundary", () => {
  it("rejects every raw Windows device filename before invoking IPC", async () => {
    const { api, getInvokeCount } = await loadPreloadApi();
    const acceptedNames = [];

    for (const fileName of WINDOWS_RESERVED_FILE_NAMES) {
      try {
        await api.saveFile(fileName, new ArrayBuffer(1));
        acceptedNames.push(fileName);
      } catch {
        // Rejection is the public preload contract under test.
      }
    }

    expect.soft(getInvokeCount()).toBe(0);
    expect(acceptedNames).toEqual([]);
  });

  it.each([
    {
      data: new Uint8Array(1),
      label: "non-ArrayBuffer data",
      message: /ArrayBuffer/i,
    },
    {
      data: new ArrayBuffer(MAX_NATIVE_SAVE_BYTES + 1),
      label: "data larger than 96 MiB",
      message: /96 MiB/i,
    },
  ])("rejects $label before invoking IPC", async ({ data, message }) => {
    const { api, getInvokeCount } = await loadPreloadApi();
    const result = Promise.resolve().then(() =>
      api.saveFile("save.bin", data)
    );

    await result.catch(() => undefined);
    expect.soft(getInvokeCount()).toBe(0);
    await expect(result).rejects.toThrow(message);
  });
});

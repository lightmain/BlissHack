import { describe, expect, it, vi } from "vitest";
import { saveUserFile } from "./save-user-file";

const MAX_USER_FILE_BYTES = 96 * 1024 * 1024;

/** Create explicit browser download fakes without installing a DOM runtime. */
function createBrowserHarness() {
  const anchor = {
    href: "",
    download: "",
    click: vi.fn(),
    remove: vi.fn(),
  };
  const appendAnchor = vi.fn();
  const createAnchor = vi.fn(() => anchor);
  const createBlob = vi.fn(
    (parts: BlobPart[], options?: BlobPropertyBag) => new Blob(parts, options),
  );
  const createObjectURL = vi.fn(() => "blob:blisshack-test");
  const revokeObjectURL = vi.fn();
  const defer = vi.fn((callback: () => void) => callback());
  return {
    anchor,
    browser: {
      appendAnchor,
      createAnchor,
      createBlob,
      createObjectURL,
      defer,
      revokeObjectURL,
    },
  };
}

describe("saveUserFile", () => {
  it("copies a string into one exact UTF-8 ArrayBuffer for native save", async () => {
    const saveFile = vi.fn().mockResolvedValue({ status: "saved" });
    const data = "BlissHack \u53f0\u6e7e";

    const result = await saveUserFile(
      {
        fileName: "profile.bhprofile",
        data,
        mimeType: "application/json;charset=utf-8",
      },
      { desktopApi: { saveFile } },
    );

    expect(result).toEqual({ status: "saved" });
    expect(saveFile).toHaveBeenCalledOnce();
    const [fileName, buffer] = saveFile.mock.calls[0] as [string, ArrayBuffer];
    const expected = new TextEncoder().encode(data);
    expect(fileName).toBe("profile.bhprofile");
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBe(expected.byteLength);
    expect(new Uint8Array(buffer)).toEqual(expected);
  });

  it("copies only the selected Uint8Array bytes for native save", async () => {
    const saveFile = vi.fn().mockResolvedValue({ status: "saved" });
    const backing = new Uint8Array([99, 10, 20, 30, 88]);
    const data = backing.subarray(1, 4);

    await saveUserFile(
      {
        fileName: "0Wizard",
        data,
        mimeType: "application/octet-stream",
      },
      { desktopApi: { saveFile } },
    );

    const [, buffer] = saveFile.mock.calls[0] as [string, ArrayBuffer];
    expect(buffer.byteLength).toBe(3);
    expect([...new Uint8Array(buffer)]).toEqual([10, 20, 30]);

    backing[1] = 255;
    expect([...new Uint8Array(buffer)]).toEqual([10, 20, 30]);
  });

  it("returns native dialog cancellation to the caller", async () => {
    const saveFile = vi.fn().mockResolvedValue({ status: "cancelled" });

    await expect(saveUserFile(
      {
        fileName: "backup.bhbackup",
        data: "{}",
        mimeType: "application/json",
      },
      { desktopApi: { saveFile } },
    )).resolves.toEqual({ status: "cancelled" });
  });

  it("uses Blob, an anchor, an object URL, and revocation without desktop API", async () => {
    const { anchor, browser } = createBrowserHarness();
    const data = new Uint8Array([1, 3, 3, 7]);

    const result = await saveUserFile(
      {
        fileName: "diagnostics.json",
        data,
        mimeType: "application/json",
      },
      { desktopApi: null, browser },
    );

    expect(result).toEqual({ status: "downloaded" });
    expect(browser.createBlob).toHaveBeenCalledOnce();
    const blob = browser.createBlob.mock.results[0].value;
    expect(blob.type).toBe("application/json");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([
      1,
      3,
      3,
      7,
    ]);
    expect(browser.createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe("blob:blisshack-test");
    expect(anchor.download).toBe("diagnostics.json");
    expect(browser.appendAnchor).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(browser.defer).toHaveBeenCalledOnce();
    expect(browser.revokeObjectURL).toHaveBeenCalledOnce();
    expect(browser.revokeObjectURL).toHaveBeenCalledWith(
      "blob:blisshack-test",
    );
  });

  it("rejects an empty file name before invoking native save", async () => {
    const saveFile = vi.fn();

    await expect(saveUserFile(
      {
        fileName: "",
        data: "not written",
        mimeType: "text/plain",
      },
      { desktopApi: { saveFile } },
    )).rejects.toThrow(/file.?name/i);

    expect(saveFile).not.toHaveBeenCalled();
  });

  it("accepts exactly 96 MiB through the real renderer copy path", async () => {
    let savedFileName = "";
    let savedBytes = 0;
    const saveFile = async (fileName: string, data: ArrayBuffer) => {
      savedFileName = fileName;
      savedBytes = data.byteLength;
      return { status: "saved" as const };
    };

    await expect(saveUserFile(
      {
        fileName: "maximum-size.bin",
        data: new Uint8Array(MAX_USER_FILE_BYTES),
        mimeType: "application/octet-stream",
      },
      { desktopApi: { saveFile } },
    )).resolves.toEqual({ status: "saved" });

    expect(savedFileName).toBe("maximum-size.bin");
    expect(savedBytes).toBe(MAX_USER_FILE_BYTES);
  });

  it("rejects data larger than 96 MiB before invoking native save", async () => {
    const saveFile = vi.fn();

    await expect(saveUserFile(
      {
        fileName: "too-large.bin",
        data: new Uint8Array(MAX_USER_FILE_BYTES + 1),
        mimeType: "application/octet-stream",
      },
      { desktopApi: { saveFile } },
    )).rejects.toThrow(/96 MiB/i);

    expect(saveFile).not.toHaveBeenCalled();
  });
});

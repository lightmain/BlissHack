import { describe, expect, it, vi } from "vitest";
import { createStorageModuleHarness } from "./storage-test-helpers";
import { importRawSaveTransaction } from "./storage-transaction";

describe("raw save import transaction", () => {
  it("verifies a temporary copy, renames it, and flushes the formal save", async () => {
    const harness = createStorageModuleHarness();
    const bytes = Uint8Array.of(0x68, 0x01, 0x02, 0x03);
    const flush = vi.fn(async () => undefined);

    await expect(importRawSaveTransaction({
      fileSystem: harness.module.FS as never,
      destinationPath: "/save/0Ada",
      bytes,
      overwrite: false,
      flush,
    })).resolves.toBeUndefined();

    const temporaryPath = vi.mocked(harness.module.FS.writeFile)
      .mock.calls[0]?.[0] as string;
    expect(temporaryPath).toMatch(/^\/save\/\.blisshack-import-.+\.tmp$/);
    expect(harness.module.FS.readFile).toHaveBeenCalledWith(temporaryPath);
    expect(harness.module.FS.rename).toHaveBeenCalledWith(
      temporaryPath,
      "/save/0Ada",
    );
    expect(harness.files.get("/save/0Ada")).toEqual(bytes);
    expect(harness.files.has(temporaryPath)).toBe(false);
    expect(flush).toHaveBeenCalledOnce();
  });

  it("refuses an unapproved replacement before writing temporary data", async () => {
    const harness = createStorageModuleHarness();
    harness.files.set("/save/0Ada", Uint8Array.of(0x01));
    const flush = vi.fn(async () => undefined);

    await expect(importRawSaveTransaction({
      fileSystem: harness.module.FS as never,
      destinationPath: "/save/0Ada",
      bytes: Uint8Array.of(0x02),
      overwrite: false,
      flush,
    })).rejects.toThrow(/already exists|overwrite/i);

    expect(harness.files.get("/save/0Ada")).toEqual(Uint8Array.of(0x01));
    expect(harness.module.FS.writeFile).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it("keeps the original save when writing temporary data fails", async () => {
    const harness = createStorageModuleHarness();
    const original = Uint8Array.of(0x10, 0x20, 0x30);
    harness.files.set("/save/0Ada", original);
    vi.mocked(harness.module.FS.writeFile).mockImplementationOnce(() => {
      throw new Error("temporary write failed");
    });
    const flush = vi.fn(async () => undefined);

    await expect(importRawSaveTransaction({
      fileSystem: harness.module.FS as never,
      destinationPath: "/save/0Ada",
      bytes: Uint8Array.of(0x40, 0x50, 0x60),
      overwrite: true,
      flush,
    })).rejects.toThrow("temporary write failed");

    expect(harness.files.get("/save/0Ada")).toEqual(original);
    expect(Array.from(harness.files.keys())).toEqual(["/save/0Ada"]);
    expect(harness.module.FS.rename).not.toHaveBeenCalled();
    expect(flush).toHaveBeenCalledOnce();
  });

  it("removes mismatched temporary data without creating a formal save", async () => {
    const harness = createStorageModuleHarness();
    vi.mocked(harness.module.FS.readFile).mockImplementation((path: string) => {
      const bytes = harness.files.get(path);
      if (!bytes) throw new Error(`ENOENT: ${path}`);
      return path.endsWith(".tmp")
        ? Uint8Array.of(0x00)
        : bytes.slice();
    });
    const flush = vi.fn(async () => undefined);

    await expect(importRawSaveTransaction({
      fileSystem: harness.module.FS as never,
      destinationPath: "/save/0Ada",
      bytes: Uint8Array.of(0x68, 0x01),
      overwrite: false,
      flush,
    })).rejects.toThrow("Temporary save verification failed");

    expect(harness.files.size).toBe(0);
    expect(harness.module.FS.rename).not.toHaveBeenCalled();
    expect(flush).toHaveBeenCalledOnce();
  });

  it("removes temporary data and keeps the original when rename fails", async () => {
    const harness = createStorageModuleHarness();
    const original = Uint8Array.of(0x10, 0x20, 0x30);
    harness.files.set("/save/0Ada", original);
    vi.mocked(harness.module.FS.rename).mockImplementationOnce(() => {
      throw new Error("rename failed");
    });
    const flush = vi.fn(async () => undefined);

    await expect(importRawSaveTransaction({
      fileSystem: harness.module.FS as never,
      destinationPath: "/save/0Ada",
      bytes: Uint8Array.of(0x40, 0x50, 0x60),
      overwrite: true,
      flush,
    })).rejects.toThrow("rename failed");

    expect(harness.files.get("/save/0Ada")).toEqual(original);
    expect(Array.from(harness.files.keys())).toEqual(["/save/0Ada"]);
    expect(flush).toHaveBeenCalledOnce();
  });

  it("restores the old bytes and persists rollback when replacement flush fails", async () => {
    const harness = createStorageModuleHarness();
    const original = Uint8Array.of(0x10, 0x20, 0x30);
    const replacement = Uint8Array.of(0x40, 0x50, 0x60);
    harness.files.set("/save/0Ada", original);
    const flush = vi.fn()
      .mockRejectedValueOnce(new Error("quota exceeded"))
      .mockResolvedValueOnce(undefined);

    await expect(importRawSaveTransaction({
      fileSystem: harness.module.FS as never,
      destinationPath: "/save/0Ada",
      bytes: replacement,
      overwrite: true,
      flush,
    })).rejects.toThrow("quota exceeded");

    expect(harness.files.get("/save/0Ada")).toEqual(original);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(harness.module.FS.writeFile).toHaveBeenLastCalledWith(
      "/save/0Ada",
      original,
    );
    expect(Array.from(harness.files.keys())).toEqual(["/save/0Ada"]);
  });

  it("removes a newly imported save when its first flush fails", async () => {
    const harness = createStorageModuleHarness();
    const flush = vi.fn()
      .mockRejectedValueOnce(new Error("IndexedDB unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(importRawSaveTransaction({
      fileSystem: harness.module.FS as never,
      destinationPath: "/save/0Ada",
      bytes: Uint8Array.of(0x68),
      overwrite: false,
      flush,
    })).rejects.toThrow("IndexedDB unavailable");

    expect(harness.files.has("/save/0Ada")).toBe(false);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(harness.files.size).toBe(0);
  });

  it("reports both import and rollback errors when both flushes fail", async () => {
    const harness = createStorageModuleHarness();
    const original = Uint8Array.of(0x10, 0x20, 0x30);
    harness.files.set("/save/0Ada", original);
    const flush = vi.fn()
      .mockRejectedValueOnce(new Error("import flush failed"))
      .mockRejectedValueOnce(new Error("rollback flush failed"));

    const result = importRawSaveTransaction({
      fileSystem: harness.module.FS as never,
      destinationPath: "/save/0Ada",
      bytes: Uint8Array.of(0x40, 0x50, 0x60),
      overwrite: true,
      flush,
    });

    await expect(result).rejects.toMatchObject({
      name: "AggregateError",
      message: "Could not import or restore save at /save/0Ada",
      errors: [
        expect.objectContaining({ message: "import flush failed" }),
        expect.objectContaining({ message: "rollback flush failed" }),
      ],
    });
    expect(harness.files.get("/save/0Ada")).toEqual(original);
    expect(Array.from(harness.files.keys())).toEqual(["/save/0Ada"]);
    expect(flush).toHaveBeenCalledTimes(2);
  });
});

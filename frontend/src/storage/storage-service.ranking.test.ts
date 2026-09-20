import { afterEach, describe, expect, it, vi } from "vitest";
import {
  concatBytes,
  createRankingRecord,
} from "./ranking-record-test-helpers";
import {
  createStorageModuleHarness,
  type StorageModuleHarness,
} from "./storage-test-helpers";

const RANKING_PATH = "/record";
const RANKING_SIDECAR_PATH = "/save/.ranking-record";

interface RankingStatus {
  source: "packaged" | "sidecar";
  recovery: "damaged-sidecar" | null;
}

interface RankingStorageService {
  initialize(): Promise<boolean>;
  refreshFromPersistent(): Promise<unknown[]>;
  exportRanking(): Promise<Uint8Array>;
  importRanking(bytes: Uint8Array): Promise<void>;
  getRankingStatus(): RankingStatus;
  clearManagedFiles(): Promise<Array<{ path: string; bytes: Uint8Array }>>;
  restoreManagedFiles(
    files: Array<{ path: string; bytes: Uint8Array }>,
  ): Promise<void>;
  flush(): Promise<void>;
}

interface RankingStorageModule {
  MAX_RANKING_RECORD_BYTES: number;
  createStorageService(
    module: StorageModuleHarness["module"],
    options: { validateSaveMetadata: () => Promise<never> },
  ): RankingStorageService;
}

/** Load the future ranking-aware storage contract without compile-time exports. */
async function loadStorageService(): Promise<RankingStorageModule> {
  const implementationUrl = new URL("./storage-service.ts", import.meta.url).href;
  return import(/* @vite-ignore */ implementationUrl) as Promise<RankingStorageModule>;
}

/**
 * Create and initialize a persistent service with a packaged root record.
 * @param harness - in-memory module fixture.
 * @param packagedRecord - initial root record embedded in the WASM package.
 * @returns initialized ranking-aware storage service.
 */
async function initializeService(
  harness: StorageModuleHarness,
  packagedRecord: Uint8Array = new Uint8Array(),
): Promise<RankingStorageService> {
  harness.files.set(RANKING_PATH, packagedRecord);
  vi.stubGlobal("indexedDB", {});
  const { createStorageService } = await loadStorageService();
  const service = createStorageService(harness.module, {
    validateSaveMetadata: vi.fn(async () => {
      throw new Error("save validation is not expected");
    }),
  });
  const initialization = service.initialize();
  expect(harness.syncRequests).toHaveLength(1);
  harness.syncRequests[0].complete();
  await expect(initialization).resolves.toBe(true);
  return service;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local ranking hydration and persistence", () => {
  it("hydrates /record from the IDBFS sidecar during initialization", async () => {
    const harness = createStorageModuleHarness();
    const ranking = createRankingRecord(
      Uint8Array.of(0x41, 0xff, 0x61),
      Uint8Array.of(0x64, 0x65, 0xfe, 0x61, 0x74, 0x68),
    );
    harness.files.set(RANKING_SIDECAR_PATH, ranking);

    const service = await initializeService(harness);

    expect(harness.files.get(RANKING_PATH)).toEqual(ranking);
    expect(service.getRankingStatus()).toEqual({
      source: "sidecar",
      recovery: null,
    });
  });

  it("rehydrates /record after refreshing the persistent mount", async () => {
    const harness = createStorageModuleHarness();
    const firstRanking = createRankingRecord();
    const refreshedRanking = createRankingRecord(
      new TextEncoder().encode("Bob"),
      new TextEncoder().encode("escaped the dungeon"),
    );
    harness.files.set(RANKING_SIDECAR_PATH, firstRanking);
    const service = await initializeService(harness);
    harness.files.set(RANKING_SIDECAR_PATH, refreshedRanking);
    harness.files.set(RANKING_PATH, firstRanking);

    const refresh = service.refreshFromPersistent();
    await vi.waitFor(() => expect(harness.syncRequests).toHaveLength(2));
    harness.syncRequests[1].complete();
    await refresh;

    expect(harness.files.get(RANKING_PATH)).toEqual(refreshedRanking);
  });

  it("resets a stale root record when refresh observes a deleted sidecar", async () => {
    const harness = createStorageModuleHarness();
    const ranking = createRankingRecord();
    harness.files.set(RANKING_SIDECAR_PATH, ranking);
    const service = await initializeService(harness);

    const refresh = service.refreshFromPersistent();
    await vi.waitFor(() => expect(harness.syncRequests).toHaveLength(2));
    harness.files.delete(RANKING_SIDECAR_PATH);
    harness.syncRequests[1].complete();
    await refresh;

    expect(harness.files.get(RANKING_PATH)).toEqual(new Uint8Array());
    expect(service.getRankingStatus()).toEqual({
      source: "packaged",
      recovery: null,
    });

    const flushing = service.flush();
    await vi.waitFor(() => expect(harness.syncRequests).toHaveLength(3));
    expect(harness.files.get(RANKING_SIDECAR_PATH)).toEqual(new Uint8Array());
    harness.syncRequests[2].complete();
    await flushing;
  });

  it("copies the current root record to the sidecar before syncfs(false)", async () => {
    const harness = createStorageModuleHarness();
    const service = await initializeService(harness);
    const ranking = createRankingRecord();
    harness.files.set(RANKING_PATH, ranking);

    const flushing = service.flush();
    await vi.waitFor(() => expect(harness.syncRequests).toHaveLength(2));
    const sidecarWrite = harness.module.FS.writeFile.mock.calls.findLastIndex(
      ([path]) => path === RANKING_SIDECAR_PATH,
    );
    const sidecarBeforeSync = harness.files.get(RANKING_SIDECAR_PATH);
    harness.syncRequests[1].complete();
    await flushing;

    expect(sidecarBeforeSync).toEqual(ranking);
    expect(sidecarWrite).toBeGreaterThanOrEqual(0);
    expect(harness.module.FS.writeFile.mock.invocationCallOrder[sidecarWrite])
      .toBeLessThan(harness.module.FS.syncfs.mock.invocationCallOrder[1]);
  });

  it("persists the packaged empty record when no sidecar exists", async () => {
    const harness = createStorageModuleHarness();
    const packagedRecord = new Uint8Array();
    const service = await initializeService(harness, packagedRecord);

    const flushing = service.flush();
    await vi.waitFor(() => expect(harness.syncRequests).toHaveLength(2));
    const sidecarBeforeSync = harness.files.get(RANKING_SIDECAR_PATH);
    harness.syncRequests[1].complete();
    await flushing;

    expect(sidecarBeforeSync).toEqual(packagedRecord);
  });
});

describe("local ranking validation and recovery", () => {
  it("uses a bounded ranking payload size", async () => {
    const rankingModule = await loadStorageService();
    const limit = rankingModule.MAX_RANKING_RECORD_BYTES;

    expect(limit).toBeTypeOf("number");
    if (typeof limit !== "number") return;
    expect(limit).toBeGreaterThanOrEqual(64 * 1024);
    expect(limit).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it.each([
    {
      name: "NUL bytes",
      bytes: concatBytes(
        createRankingRecord().subarray(0, 20),
        Uint8Array.of(0),
        createRankingRecord().subarray(21),
      ),
    },
    {
      name: "a non-record line",
      bytes: new TextEncoder().encode("not a NetHack record\n"),
    },
    {
      name: "a missing terminating newline",
      bytes: createRankingRecord().subarray(0, -1),
    },
  ])("falls back to the packaged record for $name", async ({ bytes }) => {
    const harness = createStorageModuleHarness();
    const packagedRecord = new Uint8Array();
    harness.files.set(RANKING_SIDECAR_PATH, bytes);

    const service = await initializeService(harness, packagedRecord);

    expect(harness.files.get(RANKING_PATH)).toEqual(packagedRecord);
    expect(service.getRankingStatus).toBeTypeOf("function");
    if (typeof service.getRankingStatus !== "function") return;
    expect(service.getRankingStatus()).toEqual({
      source: "packaged",
      recovery: "damaged-sidecar",
    });
  });

  it("rejects an oversized sidecar before hydrating the core record", async () => {
    const rankingModule = await loadStorageService();
    const limit = rankingModule.MAX_RANKING_RECORD_BYTES;
    expect(limit).toBeTypeOf("number");
    if (typeof limit !== "number") return;
    const harness = createStorageModuleHarness();
    const packagedRecord = new Uint8Array();
    harness.files.set(RANKING_SIDECAR_PATH, new Uint8Array(limit + 1));

    const service = await initializeService(harness, packagedRecord);

    expect(harness.files.get(RANKING_PATH)).toEqual(packagedRecord);
    expect(service.getRankingStatus()).toMatchObject({
      source: "packaged",
      recovery: "damaged-sidecar",
    });
  });
});

describe("local ranking transactions", () => {
  it("clears and restores the sidecar and root record as one snapshot", async () => {
    const harness = createStorageModuleHarness();
    const ranking = createRankingRecord();
    harness.files.set(RANKING_SIDECAR_PATH, ranking);
    harness.files.set("/save/0Ada", Uint8Array.of(1, 2, 3));
    const service = await initializeService(harness);

    const clearing = service.clearManagedFiles();
    await vi.waitFor(() => expect(harness.syncRequests).toHaveLength(2));
    expect(harness.files.has(RANKING_SIDECAR_PATH)).toBe(false);
    expect(harness.files.get(RANKING_PATH)).toEqual(new Uint8Array());
    harness.syncRequests[1].complete();
    const snapshot = await clearing;
    expect(snapshot).toEqual(expect.arrayContaining([
      { path: RANKING_PATH, bytes: ranking },
      { path: RANKING_SIDECAR_PATH, bytes: ranking },
      { path: "/save/0Ada", bytes: Uint8Array.of(1, 2, 3) },
    ]));

    const restoring = service.restoreManagedFiles(snapshot);
    await vi.waitFor(() => expect(harness.syncRequests).toHaveLength(3));
    expect(harness.files.get(RANKING_PATH)).toEqual(ranking);
    expect(harness.files.get(RANKING_SIDECAR_PATH)).toEqual(ranking);
    harness.syncRequests[2].complete();
    await restoring;
  });

  it("rolls both ranking copies back when replacement persistence fails", async () => {
    const harness = createStorageModuleHarness();
    const original = createRankingRecord();
    const replacement = createRankingRecord(
      new TextEncoder().encode("Bob"),
      new TextEncoder().encode("ascended"),
    );
    harness.files.set(RANKING_SIDECAR_PATH, original);
    const service = await initializeService(harness);

    expect(service.importRanking).toBeTypeOf("function");
    if (typeof service.importRanking !== "function") return;
    const importing = service.importRanking(replacement);
    await vi.waitFor(() => expect(harness.syncRequests).toHaveLength(2));
    expect(harness.files.get(RANKING_PATH)).toEqual(replacement);
    expect(harness.files.get(RANKING_SIDECAR_PATH)).toEqual(replacement);
    harness.syncRequests[1].complete(new Error("quota exceeded"));
    await vi.waitFor(() => expect(harness.syncRequests).toHaveLength(3));
    expect(harness.files.get(RANKING_PATH)).toEqual(original);
    expect(harness.files.get(RANKING_SIDECAR_PATH)).toEqual(original);
    harness.syncRequests[2].complete();

    await expect(importing).rejects.toThrow("quota exceeded");
  });
});

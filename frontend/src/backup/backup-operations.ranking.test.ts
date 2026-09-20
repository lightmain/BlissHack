import { describe, expect, it, vi } from "vitest";
import { createDefaultProfile } from "../settings/profile";
import { createRankingRecord } from "../storage/ranking-record-test-helpers";

const backupFileMocks = vi.hoisted(() => ({
  parseBackupImport: vi.fn(),
  serializeBackup: vi.fn(),
}));

vi.mock("./backup-file", async (importOriginal) => ({
  ...await importOriginal<typeof import("./backup-file")>(),
  parseBackupImport: backupFileMocks.parseBackupImport,
  serializeBackup: backupFileMocks.serializeBackup,
}));

import {
  BackupRollbackError,
  exportFullBackup,
  importFullBackup,
  previewFullBackup,
  refreshBackupPreview,
} from "./backup-operations";

interface RankingStorage {
  exportAllSaves(): Promise<Array<{ fileName: string; bytes: Uint8Array }>>;
  exportRanking(): Promise<Uint8Array>;
  importRanking(bytes: Uint8Array): Promise<void>;
  listSaves(): Promise<never[]>;
}

interface RankingPreview {
  source: {
    productVersion: string;
    buildId: string;
    exportedAt: string;
    profile: ReturnType<typeof createDefaultProfile>;
    ranking: Uint8Array | null;
  };
  entries: never[];
}

/** Build the minimum ranking-aware storage fake used by backup operations. */
function rankingStorage(
  overrides: Partial<RankingStorage> = {},
): RankingStorage {
  return {
    exportAllSaves: vi.fn(async () => []),
    exportRanking: vi.fn(async () => new Uint8Array()),
    importRanking: vi.fn(async () => undefined),
    listSaves: vi.fn(async (): Promise<never[]> => []),
    ...overrides,
  };
}

/** Cast the future ranking storage contract at the current production boundary. */
function asCurrentStorage(storage: RankingStorage): Parameters<
  typeof exportFullBackup
>[0] {
  return storage as unknown as Parameters<typeof exportFullBackup>[0];
}

/** Cast the future ranking preview contract at the current production boundary. */
function asCurrentPreview(preview: RankingPreview): Parameters<
  typeof importFullBackup
>[1] {
  return preview as unknown as Parameters<typeof importFullBackup>[1];
}

describe("full backup ranking operations", () => {
  it("exports the current opaque ranking with the save snapshot", async () => {
    const ranking = createRankingRecord(
      Uint8Array.of(0x41, 0xff),
      Uint8Array.of(0x64, 0xfe),
    );
    const saves = [{ fileName: "0Ada", bytes: Uint8Array.of(1, 2, 3) }];
    const storage = rankingStorage({
      exportAllSaves: vi.fn(async () => saves),
      exportRanking: vi.fn(async () => ranking),
    });
    backupFileMocks.serializeBackup.mockResolvedValueOnce("serialized");

    await expect(exportFullBackup(
      asCurrentStorage(storage),
      createDefaultProfile(),
      "alpha-2.2",
      "test-build",
    )).resolves.toBe("serialized");

    expect(storage.exportRanking).toHaveBeenCalledOnce();
    expect(backupFileMocks.serializeBackup).toHaveBeenCalledWith(
      expect.any(Object),
      saves,
      "alpha-2.2",
      "test-build",
      undefined,
      ranking,
    );
  });

  it("retains ranking bytes through preview and refresh without writing them", async () => {
    const ranking = createRankingRecord();
    const storage = rankingStorage();
    backupFileMocks.parseBackupImport.mockResolvedValueOnce({
      productVersion: "alpha-2.2",
      buildId: "test-build",
      exportedAt: "2026-09-20T12:00:00.000Z",
      profile: createDefaultProfile(),
      saves: [],
      ranking,
    });

    const preview = await previewFullBackup(
      asCurrentStorage(storage),
      Uint8Array.of(1),
    ) as unknown as RankingPreview;
    const refreshed = await refreshBackupPreview(
      asCurrentStorage(storage),
      asCurrentPreview(preview),
    ) as unknown as RankingPreview;

    expect(preview.source.ranking).toEqual(ranking);
    expect(refreshed.source.ranking).toEqual(ranking);
    expect(storage.importRanking).not.toHaveBeenCalled();
  });

  it("imports ranking after final preview approval", async () => {
    const ranking = createRankingRecord();
    const storage = rankingStorage();
    const preview: RankingPreview = {
      source: {
        productVersion: "alpha-2.2",
        buildId: "test-build",
        exportedAt: "2026-09-20T12:00:00.000Z",
        profile: createDefaultProfile(),
        ranking,
      },
      entries: [],
    };

    await importFullBackup(
      asCurrentStorage(storage),
      asCurrentPreview(preview),
      new Set(),
    );

    expect(storage.importRanking).toHaveBeenCalledWith(ranking);
  });

  it("surfaces a ranking rollback failure as a fatal backup rollback", async () => {
    const rollback = new AggregateError([], "ranking rollback failed");
    const storage = rankingStorage({
      importRanking: vi.fn(async () => {
        throw rollback;
      }),
    });
    const preview: RankingPreview = {
      source: {
        productVersion: "alpha-2.2",
        buildId: "test-build",
        exportedAt: "2026-09-20T12:00:00.000Z",
        profile: createDefaultProfile(),
        ranking: createRankingRecord(),
      },
      entries: [],
    };

    await expect(importFullBackup(
      asCurrentStorage(storage),
      asCurrentPreview(preview),
      new Set(),
    )).rejects.toBeInstanceOf(BackupRollbackError);
  });

  it("does not clear the current ranking when importing a legacy v1 preview", async () => {
    const storage = rankingStorage();
    const preview: RankingPreview = {
      source: {
        productVersion: "alpha-2.1",
        buildId: "legacy",
        exportedAt: "2026-09-01T12:00:00.000Z",
        profile: createDefaultProfile(),
        ranking: null,
      },
      entries: [],
    };

    await importFullBackup(
      asCurrentStorage(storage),
      asCurrentPreview(preview),
      new Set(),
    );

    expect(storage.importRanking).not.toHaveBeenCalled();
  });
});

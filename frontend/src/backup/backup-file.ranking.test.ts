import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "../settings/profile";
import {
  concatBytes,
  createRankingRecord,
} from "../storage/ranking-record-test-helpers";

interface RankingBackupModule {
  BACKUP_SCHEMA_VERSION: number;
  MAX_RANKING_RECORD_BYTES: number;
  parseBackupImport(bytes: Uint8Array): Promise<{
    ranking: Uint8Array | null;
  }>;
  serializeBackup(
    profile: ReturnType<typeof createDefaultProfile>,
    saves: Array<{ fileName: string; bytes: Uint8Array }>,
    productVersion: string,
    buildId: string,
    exportedAt?: Date,
    ranking?: Uint8Array | null,
  ): Promise<string>;
  sha256Hex(bytes: Uint8Array): Promise<string>;
}

const exportedAt = new Date("2026-09-20T12:00:00.000Z");

/** Load the future schema-v2 backup contract without compile-time exports. */
async function loadBackupModule(): Promise<RankingBackupModule> {
  const implementationUrl = new URL("./backup-file.ts", import.meta.url).href;
  return import(/* @vite-ignore */ implementationUrl) as Promise<RankingBackupModule>;
}

/** Encode an untrusted JSON value as backup input bytes. */
function encodeDocument(document: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(document));
}

/** Create one schema-v2 document containing the supplied ranking bytes. */
async function rankingDocument(
  ranking: Uint8Array | null,
): Promise<Record<string, any>> {
  const { serializeBackup, sha256Hex } = await loadBackupModule();
  const document = JSON.parse(await serializeBackup(
    createDefaultProfile(),
    [{ fileName: "0Ada", bytes: Uint8Array.of(1, 2, 3) }],
    "alpha-2.2",
    "test-build",
    exportedAt,
  )) as Record<string, any>;
  document.schemaVersion = 2;
  document.ranking = ranking === null
    ? null
    : {
      byteLength: ranking.byteLength,
      sha256: await sha256Hex(ranking),
      data: bytesToBase64(ranking),
    };
  return document;
}

/** Encode opaque bytes as canonical Base64 without interpreting text fields. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("full backup ranking schema", () => {
  it("serializes schema v2 and round-trips opaque ranking bytes", async () => {
    const backup = await loadBackupModule();
    const ranking = createRankingRecord(
      Uint8Array.of(0x41, 0xff, 0x61),
      Uint8Array.of(0x64, 0xfe, 0x61, 0x74, 0x68),
    );

    const json = await backup.serializeBackup(
      createDefaultProfile(),
      [],
      "alpha-2.2",
      "test-build",
      exportedAt,
      ranking,
    );
    const document = JSON.parse(json) as Record<string, any>;

    expect(backup.BACKUP_SCHEMA_VERSION).toBe(2);
    expect(document).toMatchObject({
      format: "blisshack-backup",
      schemaVersion: 2,
      ranking: {
        byteLength: ranking.byteLength,
        sha256: await backup.sha256Hex(ranking),
      },
    });
    expect(await backup.parseBackupImport(new TextEncoder().encode(json)))
      .toMatchObject({ ranking });
  });

  it("represents an omitted schema-v2 ranking as null", async () => {
    const backup = await loadBackupModule();
    const json = await backup.serializeBackup(
      createDefaultProfile(),
      [],
      "alpha-2.2",
      "test-build",
      exportedAt,
      null,
    );

    expect(JSON.parse(json)).toMatchObject({
      schemaVersion: 2,
      ranking: null,
    });
    await expect(backup.parseBackupImport(new TextEncoder().encode(json)))
      .resolves.toMatchObject({ ranking: null });
  });

  it("parses a legacy schema-v1 backup with ranking null", async () => {
    const backup = await loadBackupModule();
    const document = await rankingDocument(null);
    document.schemaVersion = 1;
    delete document.ranking;

    await expect(backup.parseBackupImport(encodeDocument(document)))
      .resolves.toMatchObject({ ranking: null });
  });

  it("rejects a tampered ranking checksum", async () => {
    const backup = await loadBackupModule();
    const document = await rankingDocument(createRankingRecord());
    document.ranking.sha256 = "0".repeat(64);

    await expect(backup.parseBackupImport(encodeDocument(document)))
      .rejects.toMatchObject({ code: "invalid-backup" });
  });

  it("rejects ranking bytes over the dedicated reasonable limit", async () => {
    const backup = await loadBackupModule();
    const limit = backup.MAX_RANKING_RECORD_BYTES;

    expect(limit).toBeTypeOf("number");
    if (typeof limit !== "number") return;
    expect(limit).toBeGreaterThanOrEqual(64 * 1024);
    expect(limit).toBeLessThanOrEqual(8 * 1024 * 1024);
    const oversized = new Uint8Array(limit + 1);

    await expect(backup.serializeBackup(
      createDefaultProfile(),
      [],
      "alpha-2.2",
      "test-build",
      exportedAt,
      oversized,
    )).rejects.toMatchObject({ code: "invalid-backup" });
  });

  it.each([
    {
      name: "NUL",
      bytes: concatBytes(
        createRankingRecord().subarray(0, 20),
        Uint8Array.of(0),
        createRankingRecord().subarray(21),
      ),
    },
    {
      name: "malformed line",
      bytes: new TextEncoder().encode("not a NetHack record\n"),
    },
    {
      name: "unterminated line",
      bytes: createRankingRecord().subarray(0, -1),
    },
    {
      name: "empty death field",
      bytes: createRankingRecord(
        new TextEncoder().encode("Ada"),
        new Uint8Array(),
      ),
    },
  ])("rejects a ranking containing $name despite a valid checksum", async ({
    bytes,
  }) => {
    const backup = await loadBackupModule();
    const document = await rankingDocument(createRankingRecord());
    document.ranking = {
      byteLength: bytes.byteLength,
      sha256: await backup.sha256Hex(bytes),
      data: bytesToBase64(bytes),
    };

    await expect(backup.parseBackupImport(encodeDocument(document)))
      .rejects.toMatchObject({ code: "invalid-backup" });
  });
});

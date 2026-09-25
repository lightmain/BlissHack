import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "../settings/profile";
import {
  BackupFormatError,
  parseBackupImport,
  serializeBackup,
  sha256Hex,
} from "./backup-file";

const exportedAt = new Date("2026-09-06T12:00:00.000Z");

describe("full backup format", () => {
  it("round-trips exact bytes and sorts saves by file name", async () => {
    const ada = Uint8Array.of(0x00, 0x68, 0xff, 0x41);
    const bob = Uint8Array.of(0x68, 0x10, 0x20);
    const json = await serializeBackup(
      createDefaultProfile(),
      [
        { fileName: "0Bob", bytes: bob },
        { fileName: "0Ada", bytes: ada },
      ],
      "prealpha-3",
      "build-123",
      exportedAt,
    );

    expect(json.endsWith("\n")).toBe(true);
    const document = JSON.parse(json) as {
      format: string;
      schemaVersion: number;
      profile: {
        schemaVersion: number;
        interface: Record<string, unknown>;
      };
      ranking: unknown;
      saves: Array<{ fileName: string; sha256: string }>;
    };
    expect(document.format).toBe("blisshack-backup");
    expect(document.schemaVersion).toBe(2);
    expect(document.ranking).toBeNull();
    expect(document.profile).toMatchObject({
      schemaVersion: 4,
      interface: {
        mapRenderer: "tiles",
        informationLevel: "detailed",
        endgameStyle: "blisshack",
        characterSetupStyle: "blisshack",
        actionBarStyle: "blisshack",
        actionBarLayout: {
          rows: 2,
          locked: true,
          activeCategory: "all",
        },
      },
    });
    expect(document.saves.map((save) => save.fileName)).toEqual(["0Ada", "0Bob"]);
    expect(document.saves[0].sha256).toBe(await sha256Hex(ada));

    const parsed = await parseBackupImport(new TextEncoder().encode(json));
    expect(parsed.productVersion).toBe("prealpha-3");
    expect(parsed.buildId).toBe("build-123");
    expect(parsed.exportedAt).toBe(exportedAt.toISOString());
    expect(parsed.profile).toEqual(createDefaultProfile());
    expect(parsed.saves).toEqual([
      { fileName: "0Ada", bytes: ada },
      { fileName: "0Bob", bytes: bob },
    ]);
  });

  it("sorts non-BMP names by Unicode code point", async () => {
    const json = await serializeBackup(
      createDefaultProfile(),
      [
        { fileName: "0\u{10000}", bytes: Uint8Array.of(2) },
        { fileName: "0\uE000", bytes: Uint8Array.of(1) },
      ],
      "prealpha-3",
      "development",
      exportedAt,
    );
    const document = JSON.parse(json) as {
      saves: Array<{ fileName: string }>;
    };

    expect(document.saves.map((save) => save.fileName)).toEqual([
      "0\uE000",
      "0\u{10000}",
    ]);
  });

  it("round-trips a profile-only backup", async () => {
    const json = await serializeBackup(
      createDefaultProfile(),
      [],
      "prealpha-3",
      "development",
      exportedAt,
    );

    await expect(parseBackupImport(new TextEncoder().encode(json)))
      .resolves.toMatchObject({ saves: [] });
  });

  it("round-trips every presentation and permanent inventory profile field", async () => {
    const profile = createDefaultProfile();
    const interfaceSettings = profile.interface as unknown as
      Record<string, unknown>;
    interfaceSettings.informationLevel = "detailed";
    interfaceSettings.endgameStyle = "blisshack";
    interfaceSettings.characterSetupStyle = "blisshack";
    profile.interface.permanentInventoryPosition = "below";
    profile.interface.permanentInventoryCollapsed = true;
    profile.nethack.permInvent = true;
    profile.nethack.perminvMode = "in-use";

    const json = await serializeBackup(
      profile,
      [],
      "prealpha-3",
      "development",
      exportedAt,
    );

    await expect(parseBackupImport(new TextEncoder().encode(json)))
      .resolves.toMatchObject({ profile });
  });

  it("imports a backup with a strict v1 profile as v4 with compatibility defaults", async () => {
    const document = await exportedDocument();
    document.profile.schemaVersion = 1;
    delete document.profile.interface.mapRenderer;
    delete document.profile.interface.informationLevel;
    delete document.profile.interface.endgameStyle;
    delete document.profile.interface.characterSetupStyle;
    delete document.profile.interface.actionBarStyle;
    delete document.profile.interface.actionBarLayout;

    await expect(parseDocument(document)).resolves.toMatchObject({
      profile: {
        schemaVersion: 4,
        interface: {
          mapRenderer: "ascii",
          informationLevel: "original",
          endgameStyle: "original",
          characterSetupStyle: "original",
          actionBarStyle: "original",
          actionBarLayout: {
            rows: 2,
            locked: true,
            activeCategory: "all",
          },
        },
      },
    });
  });

  it("imports a backup with a strict v2 profile as v4", async () => {
    const document = await exportedDocument();
    document.profile.schemaVersion = 2;
    delete document.profile.interface.informationLevel;
    delete document.profile.interface.endgameStyle;
    delete document.profile.interface.characterSetupStyle;
    delete document.profile.interface.actionBarStyle;
    delete document.profile.interface.actionBarLayout;

    await expect(parseDocument(document)).resolves.toMatchObject({
      profile: {
        schemaVersion: 4,
        interface: {
          mapRenderer: "tiles",
          informationLevel: "original",
          endgameStyle: "original",
          characterSetupStyle: "original",
          actionBarStyle: "original",
          actionBarLayout: {
            rows: 2,
            locked: true,
            activeCategory: "all",
          },
        },
      },
    });
  });

  it("imports schema v1 and v2 backups containing a strict v3 profile", async () => {
    for (const backupSchemaVersion of [1, 2]) {
      const document = await exportedDocument();
      document.schemaVersion = backupSchemaVersion;
      if (backupSchemaVersion === 1) delete document.ranking;
      document.profile.schemaVersion = 3;
      delete document.profile.interface.actionBarStyle;
      delete document.profile.interface.actionBarLayout;

      await expect(parseDocument(document)).resolves.toMatchObject({
        profile: {
          schemaVersion: 4,
          interface: {
            actionBarStyle: "original",
            actionBarLayout: {
              rows: 2,
              locked: true,
              activeCategory: "all",
            },
          },
        },
      });
    }
  });

  it("rejects a schema 1 backup containing the old profile shape", async () => {
    const document = await exportedDocument();
    document.profile.schemaVersion = 1;
    delete document.profile.interface.mapRenderer;
    delete document.profile.interface.informationLevel;
    delete document.profile.interface.endgameStyle;
    delete document.profile.interface.characterSetupStyle;
    delete document.profile.interface.actionBarStyle;
    delete document.profile.interface.actionBarLayout;
    delete document.profile.interface.permanentInventoryPosition;
    delete document.profile.interface.permanentInventoryCollapsed;
    delete document.profile.nethack.permInvent;
    delete document.profile.nethack.perminvMode;

    await expect(parseDocument(document)).rejects.toMatchObject({
      code: "invalid-backup",
    });
  });

  it("preserves a zero-byte formal file for damaged-save rescue", async () => {
    const json = await serializeBackup(
      createDefaultProfile(),
      [{ fileName: "0Empty", bytes: new Uint8Array() }],
      "prealpha-3",
      "development",
      exportedAt,
    );

    await expect(parseBackupImport(new TextEncoder().encode(json)))
      .resolves.toMatchObject({
        saves: [{ fileName: "0Empty", bytes: new Uint8Array() }],
      });
  });

  it("rejects a checksum mismatch before returning any saves", async () => {
    const document = await exportedDocument();
    document.saves[0].sha256 = "0".repeat(64);

    await expect(parseDocument(document)).rejects.toMatchObject({
      code: "invalid-backup",
    });
  });

  it("rejects non-canonical Base64 and mismatched encoded lengths", async () => {
    const document = await exportedDocument();
    document.saves[0].data = "aGk";

    await expect(parseDocument(document)).rejects.toThrow(
      "encoded length does not match",
    );
  });

  it.each([
    "../0Ada",
    "/save/0Ada",
    "0Ada\\Other",
    "0Ada.tmp",
    "0Ada Name",
    "0",
  ])("rejects unsafe save file name %s", async (fileName) => {
    const document = await exportedDocument();
    document.saves[0].fileName = fileName;

    await expect(parseDocument(document)).rejects.toBeInstanceOf(
      BackupFormatError,
    );
  });

  it("rejects duplicate file names during export", async () => {
    await expect(serializeBackup(
      createDefaultProfile(),
      [
        { fileName: "0Ada", bytes: Uint8Array.of(1) },
        { fileName: "0Ada", bytes: Uint8Array.of(2) },
      ],
      "prealpha-3",
      "development",
      exportedAt,
    )).rejects.toThrow("duplicate");
  });

  it("rejects an unsupported schema and wrong file format", async () => {
    const wrongSchema = await exportedDocument();
    wrongSchema.schemaVersion = 3;
    await expect(parseDocument(wrongSchema)).rejects.toMatchObject({
      code: "unsupported-schema",
    });

    const wrongFormat = await exportedDocument();
    wrongFormat.format = "blisshack-profile";
    await expect(parseDocument(wrongFormat)).rejects.toMatchObject({
      code: "invalid-backup",
    });
  });

  it("ignores unknown container fields but strictly validates profile", async () => {
    const withUnknown = await exportedDocument();
    withUnknown.future = { ignored: true };
    withUnknown.saves[0].future = "ignored";
    await expect(parseDocument(withUnknown)).resolves.toMatchObject({
      saves: [{ fileName: "0Ada" }],
    });

    const invalidProfile = await exportedDocument();
    invalidProfile.profile.future = true;
    await expect(parseDocument(invalidProfile)).rejects.toThrow(
      "profile is invalid",
    );
  });
});

async function exportedDocument(): Promise<Record<string, any>> {
  return JSON.parse(await serializeBackup(
    createDefaultProfile(),
    [{ fileName: "0Ada", bytes: new TextEncoder().encode("hi") }],
    "prealpha-3",
    "development",
    exportedAt,
  )) as Record<string, any>;
}

function parseDocument(document: unknown) {
  return parseBackupImport(
    new TextEncoder().encode(JSON.stringify(document)),
  );
}

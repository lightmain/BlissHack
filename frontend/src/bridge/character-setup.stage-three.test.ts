import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSnapshot,
} from "../game-state";
import * as nethackBridge from "../nethack-bridge";
import type { EmscriptenModule } from "./emscripten-module";

interface CharacterOption {
  index: number;
  name: string;
  fileCode: string;
  accelerator: string;
  allow: number;
}

interface CharacterCatalog {
  schemaVersion: 1;
  masks: {
    race: number;
    gender: number;
    alignment: number;
  };
  roles: CharacterOption[];
  races: CharacterOption[];
  genders: CharacterOption[];
  alignments: CharacterOption[];
}

interface CharacterTuple {
  role: number;
  race: number;
  gender: number;
  alignment: number;
}

interface CharacterSelection {
  role: number | null;
  race: number | null;
  gender: number | null;
  alignment: number | null;
}

type CharacterAspect = keyof CharacterSelection;

interface CharacterSetupContext {
  style: "original" | "blisshack";
  saveIdentities: readonly [];
}

interface StageThreeBridgeApi {
  setCharacterSetupContext(context: CharacterSetupContext): void;
  submitCharacterSelection(selection: CharacterTuple): void;
  cancelCharacterSelection(): void;
  decodeCharacterCatalog(value: unknown): CharacterCatalog;
  buildLegalCharacterTuples(catalog: CharacterCatalog): CharacterTuple[];
  filterCharacterTuples(
    tuples: readonly CharacterTuple[],
    selection: CharacterSelection,
  ): CharacterTuple[];
  updateCharacterSelection(
    tuples: readonly CharacterTuple[],
    selection: CharacterSelection,
    aspect: CharacterAspect,
    value: number,
  ): CharacterSelection;
}

const stageThreeApi = nethackBridge as unknown as Partial<StageThreeBridgeApi>;

/**
 * Require one planned stage-three façade export without breaking test loading.
 * @param name - export required by the current contract test.
 * @returns the implemented stage-three function.
 */
function requireStageThreeApi<Key extends keyof StageThreeBridgeApi>(
  name: Key,
): StageThreeBridgeApi[Key] {
  const value = stageThreeApi[name];
  expect(value).toBeTypeOf("function");
  return value as StageThreeBridgeApi[Key];
}

/**
 * Create the minimum observable Emscripten module used by callback tests.
 * @returns an isolated module whose C calls can be asserted.
 */
function createModule(): EmscriptenModule {
  return {
    ccall: vi.fn(),
    getValue: vi.fn(() => 0),
    setValue: vi.fn(),
    UTF8ToString: vi.fn(() => ""),
    stringToUTF8: vi.fn(),
    _malloc: vi.fn(() => 1024),
    _free: vi.fn(),
    FS: {
      analyzePath: vi.fn(() => ({ exists: true })),
      mkdir: vi.fn(),
      mount: vi.fn(),
      readFile: vi.fn(() => new Uint8Array()),
      syncfs: vi.fn((_populate, callback) => callback(null)),
    },
  };
}

/**
 * Assert that an Asyncify-facing Promise remains pending for one microtask.
 * @param promise - callback result which must still await user input.
 */
async function expectPending(promise: Promise<unknown>): Promise<void> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
}

/**
 * Build a small authoritative metadata payload with known compatibility masks.
 * @returns catalog fixture containing valid and invalid combinations.
 */
function metadataFixture(): CharacterCatalog {
  return {
    schemaVersion: 1,
    masks: {
      race: 0x0003,
      gender: 0x000c,
      alignment: 0x0030,
    },
    roles: [
      {
        index: 0,
        name: "Adventurer",
        fileCode: "Adv",
        accelerator: "a",
        allow: 0x003f,
      },
      {
        index: 1,
        name: "Chronomancer",
        fileCode: "Chr",
        accelerator: "c",
        allow: 0x0026,
      },
    ],
    races: [
      {
        index: 0,
        name: "human",
        fileCode: "Hum",
        accelerator: "h",
        allow: 0x001d,
      },
      {
        index: 1,
        name: "elf",
        fileCode: "Elf",
        accelerator: "e",
        allow: 0x002e,
      },
    ],
    genders: [
      {
        index: 0,
        name: "male",
        fileCode: "Mal",
        accelerator: "m",
        allow: 0x0004,
      },
      {
        index: 1,
        name: "female",
        fileCode: "Fem",
        accelerator: "f",
        allow: 0x0008,
      },
    ],
    alignments: [
      {
        index: 0,
        name: "lawful",
        fileCode: "Law",
        accelerator: "l",
        allow: 0x0010,
      },
      {
        index: 1,
        name: "neutral",
        fileCode: "Neu",
        accelerator: "n",
        allow: 0x0020,
      },
    ],
  };
}

beforeEach(() => {
  nethackBridge.resetBridgeState();
  (globalThis as Record<string, unknown>).nethackGlobal = {
    globals: {
      flags: {
        initrole: -1,
        initrace: -1,
        initgend: -1,
        initalign: -1,
      },
      iflags: {},
      svp: { plname: "" },
    },
    pointers: {},
  };
});

describe("stage-three character setup callback contract", () => {
  /**
   * Verify that original setup delegates immediately without owning input.
   */
  it("returns true immediately for original character setup", async () => {
    const module = createModule();
    const result = nethackBridge.shimCallbackForModule(
      module,
      "shim_player_selection_or_tty",
    );

    expect(nethackBridge.isWaitingForInput()).toBe(false);
    expect(getSnapshot().inputRequest).toBeNull();
    await expect(result).resolves.toBe(true);
    expect(module.ccall).not.toHaveBeenCalled();
  });

  /**
   * Verify that a complete BlissHack selection writes all flags and skips tty.
   */
  it("returns false after a complete BlissHack selection", async () => {
    const module = createModule();
    requireStageThreeApi("setCharacterSetupContext")({
      style: "blisshack",
      saveIdentities: [],
    });
    const result = nethackBridge.shimCallbackForModule(
      module,
      "shim_player_selection_or_tty",
    );
    await expectPending(result);

    requireStageThreeApi("submitCharacterSelection")({
      role: 1,
      race: 1,
      gender: 0,
      alignment: 1,
    });

    await expect(result).resolves.toBe(false);
    expect(globalThis.nethackGlobal?.globals?.flags).toEqual({
      initrole: 1,
      initrace: 1,
      initgend: 0,
      initalign: 1,
    });
  });

  /**
   * Verify that cancellation returns to the native quit path and submits q.
   */
  it("preserves native quit semantics when BlissHack setup is cancelled", async () => {
    const module = createModule();
    requireStageThreeApi("setCharacterSetupContext")({
      style: "blisshack",
      saveIdentities: [],
    });
    const selection = nethackBridge.shimCallbackForModule(
      module,
      "shim_player_selection_or_tty",
    );
    await expectPending(selection);

    requireStageThreeApi("cancelCharacterSelection")();

    await expect(selection).resolves.toBe(true);
    await expect(nethackBridge.shimCallbackForModule(
      module,
      "shim_yn_function",
      "Shall I pick character's race, role, gender and alignment for you?",
      "ynaq",
      "n".charCodeAt(0),
    )).resolves.toBe("q".charCodeAt(0));
    expect(nethackBridge.isWaitingForInput()).toBe(false);
  });

  /**
   * Verify that resolving pending setup only mutates exposed globals.
   */
  it("does not call into C while the character callback is pending", async () => {
    const module = createModule();
    requireStageThreeApi("setCharacterSetupContext")({
      style: "blisshack",
      saveIdentities: [],
    });
    const selection = nethackBridge.shimCallbackForModule(
      module,
      "shim_player_selection_or_tty",
    );
    await expectPending(selection);
    expect(module.ccall).not.toHaveBeenCalled();

    requireStageThreeApi("submitCharacterSelection")({
      role: 0,
      race: 0,
      gender: 1,
      alignment: 0,
    });
    await expect(selection).resolves.toBe(false);
    expect(module.ccall).not.toHaveBeenCalled();
  });
});

describe("stage-three character metadata contract", () => {
  /**
   * Verify that the decoder requires and preserves the current build catalog.
   */
  it("decodes authoritative metadata without a handwritten fallback", () => {
    const decodeCharacterCatalog = requireStageThreeApi(
      "decodeCharacterCatalog",
    );
    const source = metadataFixture();

    expect(decodeCharacterCatalog(source)).toEqual(source);
    expect(() => decodeCharacterCatalog(undefined)).toThrow(
      /character metadata/i,
    );
  });

  /**
   * Verify that compatibility masks produce only complete legal tuples.
   */
  it("builds and filters the complete legal tuple set", () => {
    const catalog = metadataFixture();
    const tuples = requireStageThreeApi("buildLegalCharacterTuples")(catalog);

    expect(tuples).toEqual([
      { role: 0, race: 0, gender: 0, alignment: 0 },
      { role: 0, race: 0, gender: 1, alignment: 0 },
      { role: 0, race: 1, gender: 0, alignment: 1 },
      { role: 0, race: 1, gender: 1, alignment: 1 },
      { role: 1, race: 1, gender: 0, alignment: 1 },
    ]);
    expect(requireStageThreeApi("filterCharacterTuples")(tuples, {
      role: 1,
      race: null,
      gender: null,
      alignment: null,
    })).toEqual([
      { role: 1, race: 1, gender: 0, alignment: 1 },
    ]);
  });

  /**
   * Verify that changing an earlier choice clears every incompatible suffix.
   */
  it("clears incompatible later choices after an earlier selection changes", () => {
    const tuples = requireStageThreeApi("buildLegalCharacterTuples")(
      metadataFixture(),
    );

    expect(requireStageThreeApi("updateCharacterSelection")(
      tuples,
      { role: 0, race: 0, gender: 1, alignment: 0 },
      "role",
      1,
    )).toEqual({
      role: 1,
      race: null,
      gender: null,
      alignment: null,
    });
  });
});

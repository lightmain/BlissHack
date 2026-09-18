import { describe, expect, it, vi } from "vitest";
import type { MapRenderer } from "../settings/profile";
import type { SaveIdentity } from "../storage/storage-service";
import * as characterSetup from "./character-setup";
import type {
  CharacterAspect,
  CharacterCatalog,
  CharacterSelection,
  CharacterSetupOwnerToken,
  CharacterTuple,
} from "./character-setup";

type CharacterSetupFocus = "name" | CharacterAspect | "confirm";
type CharacterSetupPhase =
  | "entering-name"
  | "selecting"
  | "ready"
  | "continuing-save"
  | "auto-selecting"
  | "starting"
  | "cancelled";

interface CharacterCandidateState {
  index: number;
  enabled: boolean;
  selected: boolean;
  locked: boolean;
}

interface CharacterSetupState {
  owner: CharacterSetupOwnerToken;
  phase: CharacterSetupPhase;
  name: string;
  normalizedName: string;
  matchedSave: SaveIdentity | null;
  selection: CharacterSelection;
  focus: CharacterSetupFocus;
  locked: boolean;
  canConfirm: boolean;
  canAuto: boolean;
  candidates: Record<
    CharacterAspect,
    readonly CharacterCandidateState[]
  >;
  preview:
    | { kind: "tiles"; tileIndex: number | null }
    | { kind: "ascii"; text: "@" };
}

interface CharacterSetupController {
  getState(): CharacterSetupState;
  setName(value: string, owner: CharacterSetupOwnerToken): boolean;
  pressEnter(owner: CharacterSetupOwnerToken): boolean;
  selectOption(
    aspect: CharacterAspect,
    index: number,
    owner: CharacterSetupOwnerToken,
  ): boolean;
  pressAccelerator(
    accelerator: string,
    owner: CharacterSetupOwnerToken,
  ): boolean;
  requestAuto(owner: CharacterSetupOwnerToken): boolean;
  requestAutoAndStart(owner: CharacterSetupOwnerToken): boolean;
  acceptNativeSelection(
    selection: CharacterTuple,
    owner: CharacterSetupOwnerToken,
  ): boolean;
  pressEscape(owner: CharacterSetupOwnerToken): boolean;
  cancel(owner: CharacterSetupOwnerToken): boolean;
}

interface CharacterSetupControllerOptions {
  scope: CharacterSetupOwnerToken;
  catalog: CharacterCatalog;
  mapRenderer: MapRenderer;
  saveIdentities: readonly SaveIdentity[];
  onSubmitName(
    name: string,
    owner: CharacterSetupOwnerToken,
  ): void;
  onSubmitSelection(
    selection: CharacterTuple,
    owner: CharacterSetupOwnerToken,
  ): void;
  onNativeChoice(
    choice: "y" | "a",
    owner: CharacterSetupOwnerToken,
  ): void;
  onNativeConfirm(owner: CharacterSetupOwnerToken): void;
  onCancel(owner: CharacterSetupOwnerToken): void;
}

interface StageFourCharacterSetupApi {
  createCharacterSetupController(
    options: CharacterSetupControllerOptions,
  ): CharacterSetupController;
}

const stageFourApi = characterSetup as unknown as
  Partial<StageFourCharacterSetupApi>;
const CURRENT_OWNER: CharacterSetupOwnerToken = {
  moduleId: "module-current",
  sessionId: "session-current",
};
const STALE_OWNER: CharacterSetupOwnerToken = {
  moduleId: "module-stale",
  sessionId: "session-stale",
};
const EMPTY_SELECTION: CharacterSelection = {
  role: null,
  race: null,
  gender: null,
  alignment: null,
};

/**
 * Require the planned stage-four controller without breaking module loading.
 * @returns the controller factory once production implements the contract.
 */
function requireControllerFactory():
StageFourCharacterSetupApi["createCharacterSetupController"] {
  const factory = stageFourApi.createCharacterSetupController;
  expect(factory).toBeTypeOf("function");
  return factory as StageFourCharacterSetupApi["createCharacterSetupController"];
}

/**
 * Build a small authoritative catalog with one restrictive role.
 * @returns metadata covering valid and invalid suffix combinations.
 */
function catalogFixture(): CharacterCatalog {
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
        femaleName: "Adventuress",
        maleTileIndex: 100,
        femaleTileIndex: 101,
      },
      {
        index: 1,
        name: "Chronomancer",
        fileCode: "Chr",
        accelerator: "c",
        allow: 0x0026,
        maleTileIndex: 200,
        femaleTileIndex: 201,
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
    legalTupleCount: 5,
  };
}

/**
 * Return an existing save whose labels intentionally differ from file codes.
 * @returns a complete identity which maps to catalog indices 1, 1, 0, 1.
 */
function saveFixture(): SaveIdentity {
  return {
    playerName: "Ada",
    role: "Chr",
    race: "Elf",
    gender: "Mal",
    alignment: "Neu",
  };
}

/**
 * Create an isolated controller and observable bridge side effects.
 * @param options - renderer and save overrides for the scenario.
 * @returns the controller plus every bridge callback spy.
 */
function createHarness(options: {
  mapRenderer?: MapRenderer;
  saveIdentities?: readonly SaveIdentity[];
} = {}) {
  const onSubmitName = vi.fn<
    CharacterSetupControllerOptions["onSubmitName"]
  >();
  const onSubmitSelection = vi.fn<
    CharacterSetupControllerOptions["onSubmitSelection"]
  >();
  const onNativeChoice = vi.fn<
    CharacterSetupControllerOptions["onNativeChoice"]
  >();
  const onNativeConfirm = vi.fn<
    CharacterSetupControllerOptions["onNativeConfirm"]
  >();
  const onCancel = vi.fn<CharacterSetupControllerOptions["onCancel"]>();
  const controller = requireControllerFactory()({
    scope: CURRENT_OWNER,
    catalog: catalogFixture(),
    mapRenderer: options.mapRenderer ?? "tiles",
    saveIdentities: options.saveIdentities ?? [],
    onSubmitName,
    onSubmitSelection,
    onNativeChoice,
    onNativeConfirm,
    onCancel,
  });
  return {
    controller,
    onCancel,
    onNativeChoice,
    onNativeConfirm,
    onSubmitName,
    onSubmitSelection,
  };
}

/**
 * Enter one new name and advance to the first character option.
 * @param controller - controller under test.
 */
function enterNewName(controller: CharacterSetupController): void {
  expect(controller.setName("  Nova  ", CURRENT_OWNER)).toBe(true);
  expect(controller.pressEnter(CURRENT_OWNER)).toBe(true);
}

describe("stage-four CharacterSetupController contract", () => {
  it("starts with the name focused and refuses an empty name", () => {
    const { controller, onSubmitName } = createHarness();

    expect(controller.getState()).toMatchObject({
      owner: CURRENT_OWNER,
      phase: "entering-name",
      name: "",
      normalizedName: "",
      matchedSave: null,
      selection: EMPTY_SELECTION,
      focus: "name",
      locked: false,
      canConfirm: false,
    });
    expect(controller.pressEnter(CURRENT_OWNER)).toBe(false);
    expect(onSubmitName).not.toHaveBeenCalled();
    expect(controller.getState().focus).toBe("name");
  });

  it("normalizes a new name and moves Enter focus to role", () => {
    const { controller, onSubmitName } = createHarness();

    enterNewName(controller);

    expect(onSubmitName).toHaveBeenCalledWith("Nova", CURRENT_OWNER);
    expect(controller.getState()).toMatchObject({
      phase: "selecting",
      name: "  Nova  ",
      normalizedName: "Nova",
      matchedSave: null,
      focus: "role",
      selection: EMPTY_SELECTION,
    });
  });

  it("uses current catalog accelerators through all four columns and submits on Enter", () => {
    const { controller, onSubmitSelection } = createHarness();
    enterNewName(controller);

    expect(controller.pressAccelerator("a", CURRENT_OWNER)).toBe(true);
    expect(controller.getState().focus).toBe("race");
    expect(controller.pressAccelerator("h", CURRENT_OWNER)).toBe(true);
    expect(controller.getState().focus).toBe("gender");
    expect(controller.pressAccelerator("f", CURRENT_OWNER)).toBe(true);
    expect(controller.getState().focus).toBe("alignment");
    expect(controller.pressAccelerator("l", CURRENT_OWNER)).toBe(true);
    expect(controller.getState()).toMatchObject({
      phase: "ready",
      focus: "confirm",
      canConfirm: true,
      selection: {
        role: 0,
        race: 0,
        gender: 1,
        alignment: 0,
      },
    });

    expect(controller.pressEnter(CURRENT_OWNER)).toBe(true);
    expect(onSubmitSelection).toHaveBeenCalledWith(
      { role: 0, race: 0, gender: 1, alignment: 0 },
      CURRENT_OWNER,
    );
    expect(controller.getState().phase).toBe("starting");
  });

  it("produces the same selection and focus for mouse and keyboard choices", () => {
    const keyboard = createHarness().controller;
    const pointer = createHarness().controller;
    enterNewName(keyboard);
    enterNewName(pointer);

    for (const accelerator of ["a", "e", "m", "n"]) {
      expect(keyboard.pressAccelerator(accelerator, CURRENT_OWNER)).toBe(true);
    }
    expect(pointer.selectOption("role", 0, CURRENT_OWNER)).toBe(true);
    expect(pointer.selectOption("race", 1, CURRENT_OWNER)).toBe(true);
    expect(pointer.selectOption("gender", 0, CURRENT_OWNER)).toBe(true);
    expect(pointer.selectOption("alignment", 1, CURRENT_OWNER)).toBe(true);

    expect(pointer.getState()).toMatchObject({
      phase: keyboard.getState().phase,
      focus: keyboard.getState().focus,
      selection: keyboard.getState().selection,
      canConfirm: keyboard.getState().canConfirm,
    });
  });

  it("clears an illegal suffix and disables choices with no legal completion", () => {
    const { controller } = createHarness();
    enterNewName(controller);
    controller.selectOption("role", 0, CURRENT_OWNER);
    controller.selectOption("race", 0, CURRENT_OWNER);
    controller.selectOption("gender", 1, CURRENT_OWNER);
    controller.selectOption("alignment", 0, CURRENT_OWNER);

    expect(controller.selectOption("role", 1, CURRENT_OWNER)).toBe(true);
    expect(controller.getState().selection).toEqual({
      role: 1,
      race: null,
      gender: null,
      alignment: null,
    });
    expect(
      controller.getState().candidates.race.find(({ index }) => index === 0),
    ).toMatchObject({ enabled: false, selected: false });
    expect(
      controller.getState().candidates.race.find(({ index }) => index === 1),
    ).toMatchObject({ enabled: true });
    expect(controller.selectOption("race", 0, CURRENT_OWNER)).toBe(false);
    expect(controller.getState().selection.race).toBeNull();
  });

  it("matches SaveIdentity by fileCode, locks all four choices, and continues on Enter", () => {
    const { controller, onSubmitName } = createHarness({
      saveIdentities: [saveFixture()],
    });

    expect(controller.setName(" Ada ", CURRENT_OWNER)).toBe(true);
    expect(controller.getState()).toMatchObject({
      normalizedName: "Ada",
      matchedSave: saveFixture(),
      selection: {
        role: 1,
        race: 1,
        gender: 0,
        alignment: 1,
      },
      focus: "confirm",
      locked: true,
      canConfirm: true,
      canAuto: false,
    });
    for (const aspect of [
      "role",
      "race",
      "gender",
      "alignment",
    ] as const) {
      expect(
        controller.getState().candidates[aspect]
          .filter(({ selected }) => selected),
      ).toEqual([
        expect.objectContaining({ locked: true }),
      ]);
    }
    expect(controller.selectOption("role", 0, CURRENT_OWNER)).toBe(false);
    expect(controller.requestAuto(CURRENT_OWNER)).toBe(false);

    expect(controller.pressEnter(CURRENT_OWNER)).toBe(true);
    expect(onSubmitName).toHaveBeenCalledWith("Ada", CURRENT_OWNER);
    expect(controller.getState().phase).toBe("continuing-save");
  });

  it("sends native y for Auto and stops at the unified confirmation", () => {
    const {
      controller,
      onNativeChoice,
      onNativeConfirm,
      onSubmitSelection,
    } = createHarness();
    enterNewName(controller);

    expect(controller.requestAuto(CURRENT_OWNER)).toBe(true);
    expect(onNativeChoice).toHaveBeenCalledWith("y", CURRENT_OWNER);
    expect(controller.getState().phase).toBe("auto-selecting");

    expect(controller.acceptNativeSelection(
      { role: 1, race: 1, gender: 0, alignment: 1 },
      CURRENT_OWNER,
    )).toBe(true);
    expect(controller.getState()).toMatchObject({
      phase: "ready",
      focus: "confirm",
      selection: { role: 1, race: 1, gender: 0, alignment: 1 },
    });
    expect(onSubmitSelection).not.toHaveBeenCalled();
    expect(onNativeConfirm).not.toHaveBeenCalled();

    expect(controller.pressEnter(CURRENT_OWNER)).toBe(true);
    expect(onNativeConfirm).toHaveBeenCalledWith(CURRENT_OWNER);
  });

  it("sends native a for Auto and Start without stopping for confirmation", () => {
    const {
      controller,
      onNativeChoice,
      onNativeConfirm,
      onSubmitSelection,
    } = createHarness();
    enterNewName(controller);

    expect(controller.requestAutoAndStart(CURRENT_OWNER)).toBe(true);
    expect(onNativeChoice).toHaveBeenCalledWith("a", CURRENT_OWNER);
    expect(controller.getState().phase).toBe("starting");
    expect(onNativeConfirm).not.toHaveBeenCalled();
    expect(onSubmitSelection).not.toHaveBeenCalled();
  });

  it("makes Escape and explicit cancel owner-safe exits", () => {
    const { controller, onCancel } = createHarness();
    controller.setName("Nova", CURRENT_OWNER);
    const before = controller.getState();

    expect(controller.cancel(STALE_OWNER)).toBe(false);
    expect(controller.pressEnter(STALE_OWNER)).toBe(false);
    expect(controller.getState()).toEqual(before);
    expect(onCancel).not.toHaveBeenCalled();

    expect(controller.pressEscape(CURRENT_OWNER)).toBe(true);
    expect(onCancel).toHaveBeenCalledWith(CURRENT_OWNER);
    expect(controller.getState().phase).toBe("cancelled");

    const explicit = createHarness();
    expect(explicit.controller.cancel(CURRENT_OWNER)).toBe(true);
    expect(explicit.onCancel).toHaveBeenCalledWith(CURRENT_OWNER);
    expect(explicit.controller.getState().phase).toBe("cancelled");
  });

  it("uses catalog preview tiles, uses @ for ASCII, and exposes no generated stats", () => {
    const tiles = createHarness().controller;
    const ascii = createHarness({ mapRenderer: "ascii" }).controller;
    enterNewName(tiles);
    enterNewName(ascii);

    for (const controller of [tiles, ascii]) {
      controller.selectOption("role", 0, CURRENT_OWNER);
      controller.selectOption("race", 0, CURRENT_OWNER);
      controller.selectOption("gender", 1, CURRENT_OWNER);
    }

    expect(tiles.getState().preview).toEqual({
      kind: "tiles",
      tileIndex: 101,
    });
    expect(ascii.getState().preview).toEqual({
      kind: "ascii",
      text: "@",
    });
    for (const state of [tiles.getState(), ascii.getState()]) {
      expect(state).not.toHaveProperty("hp");
      expect(state).not.toHaveProperty("energy");
      expect(state).not.toHaveProperty("attributes");
      expect(state).not.toHaveProperty("status");
    }
  });
});

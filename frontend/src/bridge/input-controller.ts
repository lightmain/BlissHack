import {
  MENU_BEHAVE_PERMINV,
  NHW_MAP,
  NHW_MENU,
  NHW_MESSAGE,
  INPUT_STATE_COMMAND,
  INPUT_STATE_OTHER,
  PICK_NONE,
  appendWindowText,
  clearModal,
  flushDisplay,
  getWindow,
  setCommandInput,
  setInputRequest,
  setInventoryWindow,
  setRuntimeSettingsSnapshot,
  setRuntimeSettingsStatus,
  showExtendedCommands,
  showHistory,
  showMenu,
  showText,
  type MenuItem,
  setCommandBoundaryGeneration,
} from "../game-state";
import type { NetHackSettingsV1 } from "../settings/profile";
import {
  decodeRuntimeSettings,
  encodeRuntimeSettings,
  runtimeSettingsFromProfile,
  type RuntimeNetHackSettings,
} from "../settings/runtime-settings-protocol";
import type { EmscriptenModule } from "./emscripten-module";
import { readExtendedCommands } from "./shim-decoders";
import {
  encodeCoreCommandRequest,
  MAX_CORE_COMMAND_NONCE,
  type CoreCommandPayload,
} from "../game-actions/core-command-protocol";
import {
  buildLegalCharacterTuples,
  decodeCharacterCatalog,
  normalizeCharacterNameInput,
  playerNameForSaveLookup,
  type CharacterSetupContext,
  type CharacterSetupOwnerToken,
  type CharacterTuple,
} from "./character-setup";
interface MenuSelection {
  itemIndex: number;
  count: number;
}

export interface CoreCommandOwner {
  moduleId: string;
  sessionId: string;
}

export type CoreCommandIntent =
  | { command: "clicklook"; x: number; y: number }
  | {
    command: "catalog";
    sessionCommandId: number;
    requestItemMenu: boolean;
  };

export interface CoreCommandReceipt {
  requestNonce: number;
  acceptedBoundaryGeneration: number | null;
}

interface QueuedCoreCommand {
  payload: CoreCommandPayload;
  receipt: CoreCommandReceipt;
  synchronizedBoundaryGeneration: number | null;
}

type PendingAction =
  | {
    kind: "key";
    resolve: (value: number) => void;
    positionPointers: { x: number; y: number; modifier: number } | null;
    module: EmscriptenModule;
    commandInput: boolean;
  }
  | {
    kind: "yn";
    resolve: (value: number) => void;
    choices: string | null;
    defaultCode: number;
  }
  | {
    kind: "message";
    resolve: (value: number) => void;
    acceptedCode: number;
  }
  | {
    kind: "line";
    resolve: () => void;
    purpose: "name" | "getlin";
    bufferPtr: number;
    module: EmscriptenModule;
  }
  | {
    kind: "menu";
    resolve: (value: number) => void;
    windowId: number;
    how: number;
    menuListPtr: number;
    module: EmscriptenModule;
  }
  | {
    kind: "display";
    resolve: () => void;
  }
  | {
    kind: "player-selection";
    resolve: (useNativeSelection: boolean) => void;
  }
  | { kind: "extcmd"; resolve: (value: number) => void };

const MENU_ITEM_SIZE = 16;
const MENU_ITEM_COUNT_OFFSET = 8;
const MENU_ITEM_FLAGS_OFFSET = 12;
const GETLIN_BUFFER_SIZE = 256;
const KEY_QUEUE_LIMIT = 2;
const SAVE_COMMAND = "S".charCodeAt(0);
const SAVE_CONFIRM_QUERY = "Really save?";
const YES_RESPONSE = "y".charCodeAt(0);

let pendingAction: PendingAction | null = null;
const queuedKeys: number[] = [];
let typeaheadEnabled = false;
let actionIntentActive = false;
let saveExitAutomation: "confirm" | "display" | null = null;
let knownSaveNames: string[] = [];
let pendingRuntimeSettings: RuntimeNetHackSettings | null = null;
let pendingCoreCommand: QueuedCoreCommand | null = null;
let activeCoreCommand: QueuedCoreCommand | null = null;
let nextCoreCommandNonce = 1;
let lastCoreCommandSyncGeneration = 0;
let characterSetupContext: CharacterSetupContext = {
  moduleId: "",
  sessionId: "",
  style: "original",
  saveIdentities: [],
};
let characterSelectionResponse: number | null = null;
let characterSelectionAutomation:
  | {
    owner: CharacterSetupOwnerToken;
    stage:
      | "initial-response"
      | "awaiting-confirmation"
      | "cancel-confirmation"
      | "confirmation";
  }
  | null = null;
let cancelAfterName = false;

/** Queue one complete dynamic settings update for the next safe boundary. */
export function queueRuntimeSettings(settings: NetHackSettingsV1): void {
  pendingRuntimeSettings = runtimeSettingsFromProfile(settings);
  setRuntimeSettingsStatus("pending");
}

/** Supply names which askname may resolve to an existing save. */
export function setKnownSaveNames(names: string[]): void {
  knownSaveNames = [...new Set(names)];
}

/**
 * Install the immutable startup inputs for the session's character flow.
 * @param context - presentation style and ready save identities.
 */
export function setCharacterSetupContext(
  context: CharacterSetupContext,
): void {
  characterSetupContext = {
    ...context,
    saveIdentities: context.saveIdentities.map((identity) => ({ ...identity })),
  };
}

/**
 * Read the startup context currently owned by the input controller.
 * @returns a defensive copy suitable for the character setup UI.
 */
export function getCharacterSetupContext(): CharacterSetupContext {
  return {
    ...characterSetupContext,
    saveIdentities: characterSetupContext.saveIdentities.map(
      (identity) => ({ ...identity }),
    ),
  };
}

/**
 * Resolve the pending BlissHack selection with four authoritative indices.
 * @param selection - complete role, race, gender, and alignment tuple.
 */
export function submitCharacterSelection(
  selection: CharacterTuple,
  owner: CharacterSetupOwnerToken,
): void {
  const pending = pendingAction;
  if (
    pending?.kind !== "player-selection"
    || !matchesCharacterSetupOwner(owner)
  ) {
    return;
  }
  writeCharacterSelection(selection);

  pendingAction = null;
  characterSelectionResponse = null;
  characterSelectionAutomation = null;
  setInputRequest(null);
  pending.resolve(false);
}

/**
 * Leave BlissHack setup and preserve the core's native q/quit path.
 */
export function cancelCharacterSelection(owner: CharacterSetupOwnerToken): void {
  const pending = pendingAction;
  if (
    pending?.kind !== "player-selection"
    || !matchesCharacterSetupOwner(owner)
  ) {
    return;
  }
  pendingAction = null;
  characterSelectionResponse = "q".charCodeAt(0);
  characterSelectionAutomation = null;
  setInputRequest(null);
  pending.resolve(true);
}

/**
 * Submit a unified-screen name only for its active session.
 * @param value - editable name after UI normalization.
 * @param owner - module and session which own the setup screen.
 */
export function submitCharacterName(
  value: string,
  owner: CharacterSetupOwnerToken,
): void {
  const pending = pendingAction;
  if (
    pending?.kind !== "line"
    || pending.purpose !== "name"
    || !matchesCharacterSetupOwner(owner)
  ) {
    return;
  }
  const name = normalizePlayerNameInput(value);
  const lookupName = playerNameForSaveLookup(name);
  const continuesSave = characterSetupContext.saveIdentities.some(
    (identity) => identity.playerName === lookupName,
  );
  if (continuesSave) {
    const globals = globalThis.nethackGlobal?.globals;
    if (!globals || !("shim_restore_required" in globals)) {
      throw new Error("NetHack restore guard is unavailable");
    }
    globals.shim_restore_required = true;
  }
  submitLine(name);
}

/**
 * Return to native setup for one core-owned random choice.
 * @param choice - y pauses at confirmation; a starts immediately.
 * @param owner - module and session which own the setup screen.
 * @returns whether the active player-selection resolver was transferred.
 */
export function requestNativeCharacterSelection(
  choice: "y" | "a",
  owner: CharacterSetupOwnerToken,
): boolean {
  const pending = pendingAction;
  if (
    pending?.kind !== "player-selection"
    || !matchesCharacterSetupOwner(owner)
  ) {
    return false;
  }
  pendingAction = null;
  characterSelectionResponse = choice.charCodeAt(0);
  characterSelectionAutomation = {
    owner: { ...owner },
    stage: "initial-response",
  };
  setInputRequest(null);
  pending.resolve(true);
  return true;
}

/**
 * Confirm one intercepted native random selection without re-entering C.
 * @param selection - possibly edited legal tuple shown by the unified screen.
 * @param owner - module and session which own the setup screen.
 */
export function confirmNativeCharacterSelection(
  selection: CharacterTuple,
  owner: CharacterSetupOwnerToken,
): void {
  const automation = characterSelectionAutomation;
  if (
    pendingAction?.kind !== "menu"
    || automation?.stage !== "confirmation"
    || !matchesCharacterSetupOwner(owner)
    || !matchesOwner(automation.owner, owner)
  ) {
    return;
  }
  writeCharacterSelection(selection);
  const yesIndex = findMenuAccelerator(pendingAction.windowId, "y");
  if (yesIndex === null) {
    throw new Error("Native character confirmation has no yes choice");
  }
  characterSelectionAutomation = null;
  setInputRequest(null);
  submitMenuSelection([{ itemIndex: yesIndex, count: 1 }]);
}

/**
 * Cancel setup from name entry, manual selection, or native confirmation.
 * @param owner - module and session which own the setup screen.
 */
export function cancelCharacterSetup(owner: CharacterSetupOwnerToken): void {
  if (!matchesCharacterSetupOwner(owner)) return;
  const pending = pendingAction;
  if (pending?.kind === "line" && pending.purpose === "name") {
    const cancelName = unusedCancellationName();
    cancelAfterName = true;
    submitLine(cancelName);
    return;
  }
  if (pending?.kind === "player-selection") {
    cancelCharacterSelection(owner);
    return;
  }
  const automation = characterSelectionAutomation;
  if (!automation || !matchesOwner(automation.owner, owner)) return;
  if (pending?.kind === "menu" && automation.stage === "confirmation") {
    const quitIndex = findMenuAccelerator(pending.windowId, "q");
    if (quitIndex === null) {
      throw new Error("Native character confirmation has no quit choice");
    }
    characterSelectionAutomation = null;
    setInputRequest(null);
    submitMenuSelection([{ itemIndex: quitIndex, count: 1 }]);
    return;
  }
  if (
    automation.stage === "initial-response"
    && characterSelectionResponse !== null
  ) {
    characterSelectionResponse = "q".charCodeAt(0);
    characterSelectionAutomation = null;
    return;
  }
  if (automation.stage === "awaiting-confirmation") {
    characterSelectionAutomation = {
      ...automation,
      stage: "cancel-confirmation",
    };
  }
}

/**
 * Read a complete legal tuple from the four core-owned flag bindings.
 * @returns the current tuple, or null before all flags are legal.
 */
export function getCurrentCharacterSelection(): CharacterTuple | null {
  const flags = globalThis.nethackGlobal?.globals?.flags;
  if (!flags) return null;
  const selection = {
    role: flags.initrole,
    race: flags.initrace,
    gender: flags.initgend,
    alignment: flags.initalign,
  };
  if (
    !Number.isInteger(selection.role)
    || !Number.isInteger(selection.race)
    || !Number.isInteger(selection.gender)
    || !Number.isInteger(selection.alignment)
  ) {
    return null;
  }
  try {
    const catalog = decodeCharacterCatalog(
      globalThis.nethackGlobal?.characterCatalog,
    );
    return buildLegalCharacterTuples(catalog).some((tuple) =>
      tuple.role === selection.role
      && tuple.race === selection.race
      && tuple.gender === selection.gender
      && tuple.alignment === selection.alignment)
      ? selection as CharacterTuple
      : null;
  } catch {
    return null;
  }
}

/**
 * Check whether a UI command still belongs to the active setup session.
 * @param owner - module and session identity supplied by the UI.
 * @returns whether both identities match the installed context.
 */
function matchesCharacterSetupOwner(owner: CharacterSetupOwnerToken): boolean {
  return owner.moduleId === characterSetupContext.moduleId
    && owner.sessionId === characterSetupContext.sessionId;
}

/** Apply exactly the same cleanup used when a player name is submitted. */
export function normalizePlayerNameInput(value: string): string {
  return normalizeCharacterNameInput(value);
}

/** Resolve the active keyboard-facing callback with one NetHack byte. */
export function sendKey(value: number): void {
  if (!Number.isInteger(value) || value <= 0 || value > 0xff) return;
  if (actionIntentActive && pendingAction === null) return;
  if (resolvePendingKey(value)) return;
  if (
    !actionIntentActive
    && !pendingAction
    && typeaheadEnabled
    && queuedKeys.length < KEY_QUEUE_LIMIT
  ) {
    queuedKeys.push(value);
  }
}

/**
 * Resolve action-owned key or yn input while ordinary typeahead is frozen.
 * @param value - one NetHack input byte.
 */
export function submitActionKey(value: number): void {
  if (
    !actionIntentActive
    || !Number.isInteger(value)
    || value <= 0
    || value > 0xff
  ) {
    return;
  }
  resolvePendingKey(value);
}

/**
 * Deliver one byte to the active keyboard-facing resolver.
 * @param value - validated NetHack input byte.
 * @returns whether a pending resolver consumed the byte.
 */
function resolvePendingKey(value: number): boolean {
  const pending = pendingAction;
  if (!pending) return false;

  if (pending.kind === "key") {
    pendingAction = null;
    typeaheadEnabled = true;
    setCommandInput(false);
    setInputRequest(null);
    pending.resolve(value);
    return true;
  }
  if (pending.kind === "yn") {
    const response = normalizeYnResponse(
      value,
      pending.choices,
      pending.defaultCode,
    );
    if (response === null) return false;
    pendingAction = null;
    setInputRequest(null);
    pending.resolve(response);
    return true;
  }
  if (pending.kind === "message") {
    const response = value === 27
      ? 27
      : value === pending.acceptedCode
        ? pending.acceptedCode
        : 0;
    pendingAction = null;
    setInputRequest(null);
    pending.resolve(response);
    return true;
  }
  if (pending.kind === "display") {
    pendingAction = null;
    clearModal();
    setInputRequest(null);
    pending.resolve();
    return true;
  }
  return false;
}

/** Send the native save command from a top-level command prompt. */
export function requestSaveAndExit(): void {
  if (pendingAction?.kind !== "key" || !pendingAction.commandInput) return;
  saveExitAutomation = "confirm";
  sendKey(SAVE_COMMAND);
}

/**
 * Queue one command and advance to the next safe core boundary.
 * @param request - internal command or opaque current-catalog identity.
 * @param owner - required module/session identity for catalog commands.
 * @returns a mutable receipt completed after the core accepts the request.
 */
export function requestCoreCommand(
  request: CoreCommandIntent,
  owner?: CoreCommandOwner,
): CoreCommandReceipt | null {
  const pending = pendingAction;
  if (
    pending?.kind !== "key"
    || !pending.commandInput
    || pendingCoreCommand !== null
    || activeCoreCommand !== null
    || (
      request.command === "catalog"
      && (
        owner === undefined
        || !matchesOwner(characterSetupContext, owner)
      )
    )
  ) {
    return null;
  }
  const requestNonce = allocateCoreCommandNonce();
  const receipt: CoreCommandReceipt = {
    requestNonce,
    acceptedBoundaryGeneration: null,
  };
  pendingCoreCommand = {
    payload: encodeCoreCommandRequest({ ...request, requestNonce }),
    receipt,
    synchronizedBoundaryGeneration: null,
  };
  pendingAction = null;
  queuedKeys.length = 0;
  typeaheadEnabled = false;
  setCommandInput(false);
  setInputRequest(null);
  pending.resolve(27);
  return receipt;
}

/** Resolve nh_poskey with a map position and mouse button modifier. */
export function sendPosition(x: number, y: number, modifier: 1 | 2): void {
  const pending = pendingAction;
  if (pending?.kind !== "key" || !pending.positionPointers) return;
  pending.module.setValue(pending.positionPointers.x, x, "i16");
  pending.module.setValue(pending.positionPointers.y, y, "i16");
  pending.module.setValue(pending.positionPointers.modifier, modifier, "i32");
  pendingAction = null;
  typeaheadEnabled = !actionIntentActive;
  setCommandInput(false);
  setInputRequest(null);
  pending.resolve(0);
}

/** Submit a name or getlin response. */
export function submitLine(value: string | null): void {
  const pending = pendingAction;
  if (pending?.kind !== "line") return;

  if (pending.purpose === "name") {
    if (value === null || value.trim() === "") return;
    const name = normalizePlayerNameInput(value);
    const globals = globalThis.nethackGlobal?.globals;
    if (globals?.svp) globals.svp.plname = name;
  } else {
    if (value === null) {
      pending.module.setValue(pending.bufferPtr, 27, "i8");
      pending.module.setValue(pending.bufferPtr + 1, 0, "i8");
    } else {
      pending.module.stringToUTF8(value, pending.bufferPtr, GETLIN_BUFFER_SIZE);
    }
  }

  pendingAction = null;
  setInputRequest(null);
  pending.resolve();
}

/** Submit selected rows from an active NetHack menu. */
export function submitMenuSelection(
  selected: MenuSelection[] | null,
): void {
  const pending = pendingAction;
  if (pending?.kind !== "menu") return;
  const window = getWindow(pending.windowId);
  const module = pending.module;
  pendingAction = null;
  clearModal();

  if (selected === null) {
    pending.resolve(-1);
    return;
  }

  const valid = selected
    .filter((selection) => selection.count !== 0)
    .map((selection) => ({
      selection,
      item: window?.menuItems[selection.itemIndex],
    }))
    .filter(
      (entry): entry is { selection: MenuSelection; item: MenuItem } =>
        entry.item?.identifier !== null && entry.item !== undefined,
    );
  const limited = pending.how === 1 ? valid.slice(0, 1) : valid;

  if (limited.length === 0) {
    pending.resolve(0);
    return;
  }

  const resultPtr = module._malloc(limited.length * MENU_ITEM_SIZE);
  limited.forEach(({ selection, item }, index) => {
    const itemPtr = resultPtr + index * MENU_ITEM_SIZE;
    module.setValue(itemPtr, item.identifier as number, "i32");
    module.setValue(itemPtr + 4, 0, "i32");
    module.setValue(itemPtr + MENU_ITEM_COUNT_OFFSET, selection.count, "i32");
    module.setValue(itemPtr + MENU_ITEM_FLAGS_OFFSET, 0, "i32");
  });
  module.setValue(pending.menuListPtr, resultPtr, "*");
  pending.resolve(limited.length);
}

/** Submit an extended-command source index, or cancel with null. */
export function submitExtendedCommand(sourceIndex: number | null): void {
  const pending = pendingAction;
  if (pending?.kind !== "extcmd") return;
  pendingAction = null;
  clearModal();
  pending.resolve(sourceIndex ?? -1);
}

/** Dismiss a blocking text/history display or a PICK_NONE menu. */
export function dismissDisplay(): void {
  const pending = pendingAction;
  if (!pending) return;
  if (pending.kind === "display") {
    pendingAction = null;
    clearModal();
    setInputRequest(null);
    pending.resolve();
  } else if (pending.kind === "menu" && pending.how === PICK_NONE) {
    pendingAction = null;
    clearModal();
    pending.resolve(0);
  }
}

/** Report whether any shim callback is waiting for user input. */
export function isWaitingForInput(): boolean {
  return pendingAction !== null;
}

/**
 * Freeze user typeahead while a multi-step UI action owns core input.
 * @param active - whether an action intent currently owns the input sequence.
 */
export function setActionIntentActive(active: boolean): void {
  actionIntentActive = active;
  queuedKeys.length = 0;
  typeaheadEnabled = false;
}

/** Reset the singleton controller for a fresh module session. */
export function resetInputController(): void {
  pendingAction = null;
  pendingRuntimeSettings = null;
  pendingCoreCommand = null;
  activeCoreCommand = null;
  nextCoreCommandNonce = 1;
  lastCoreCommandSyncGeneration = 0;
  queuedKeys.length = 0;
  typeaheadEnabled = false;
  actionIntentActive = false;
  saveExitAutomation = null;
  knownSaveNames = [];
  characterSetupContext = {
    moduleId: "",
    sessionId: "",
    style: "original",
    saveIdentities: [],
  };
  characterSelectionResponse = null;
  characterSelectionAutomation = null;
  cancelAfterName = false;
}

/** Publish the core snapshot and return one queued, versioned update. */
export function synchronizeRuntimeSettings(snapshotPayload: number): number {
  const current = decodeRuntimeSettings(snapshotPayload);
  if (current.pending) {
    throw new Error("Core runtime settings snapshot is marked pending");
  }
  const pending = pendingRuntimeSettings;
  setRuntimeSettingsSnapshot(
    current.settings,
    pending ? "pending" : "idle",
  );
  if (!pending) return 0;
  pendingRuntimeSettings = null;
  return encodeRuntimeSettings(pending, true);
}

/** Process the core's post-application status and authoritative snapshot. */
export function acceptRuntimeSettingsResult(
  success: number,
  snapshotPayload: number,
): void {
  const current = decodeRuntimeSettings(snapshotPayload);
  if (current.pending) {
    throw new Error("Core runtime settings result is marked pending");
  }
  setRuntimeSettingsSnapshot(
    current.settings,
    pendingRuntimeSettings ? "pending" : success === 1 ? "applied" : "idle",
  );
  if (success !== 1) {
    throw new Error("Core rejected a validated runtime settings update");
  }
}

/**
 * Copy at most one queued request into C-owned memory at a safe boundary.
 * @param module - active module whose memory owns the destination.
 * @param boundaryGeneration - nonzero generation published by winshim.
 * @param requestPtr - pointer to three contiguous uint32 request words.
 * @returns one when a request was copied, otherwise zero.
 */
export function synchronizeCoreCommand(
  module: EmscriptenModule,
  boundaryGeneration: number,
  requestPtr: number,
): number {
  setCommandBoundaryGeneration(boundaryGeneration);
  if (boundaryGeneration === lastCoreCommandSyncGeneration) return 0;
  lastCoreCommandSyncGeneration = boundaryGeneration;
  if (activeCoreCommand !== null || pendingCoreCommand === null) return 0;
  if (!Number.isInteger(requestPtr) || requestPtr <= 0) {
    throw new Error("Core command request destination is invalid");
  }
  activeCoreCommand = pendingCoreCommand;
  pendingCoreCommand = null;
  activeCoreCommand.synchronizedBoundaryGeneration = boundaryGeneration;
  const [header, requestNonce, argument] = activeCoreCommand.payload;
  module.setValue(requestPtr, header, "i32");
  module.setValue(requestPtr + 4, requestNonce, "i32");
  module.setValue(requestPtr + 8, argument, "i32");
  return 1;
}

/**
 * Confirm that the core consumed the exact three-word request it received.
 * @param header - original versioned command header.
 * @param requestNonce - original session-local request identity.
 * @param argument - original catalog identity or clicklook coordinates.
 * @param accepted - whether the core validated and queued the command.
 */
export function acceptCoreCommandResult(
  header: number,
  requestNonce: number,
  argument: number,
  accepted: number,
): void {
  const payload = [header >>> 0, requestNonce >>> 0, argument >>> 0] as const;
  const active = activeCoreCommand;
  if (
    active === null
    || payload.some(
      (word, index) => word !== active.payload[index],
    )
  ) {
    throw new Error("Core command result does not match the active request");
  }
  activeCoreCommand = null;
  if (accepted !== 1) {
    throw new Error("Core rejected a validated command request");
  }
  const acceptedBoundaryGeneration =
    active.synchronizedBoundaryGeneration;
  if (acceptedBoundaryGeneration === null) {
    throw new Error("Core command result has no synchronized boundary");
  }
  active.receipt.acceptedBoundaryGeneration = acceptedBoundaryGeneration;
}

/**
 * Allocate one nonzero nonce without permitting wraparound in a session.
 * @returns the next monotonically increasing uint32 request identity.
 */
function allocateCoreCommandNonce(): number {
  if (nextCoreCommandNonce === 0) {
    throw new Error("Core command request nonce space is exhausted");
  }
  const requestNonce = nextCoreCommandNonce;
  nextCoreCommandNonce = requestNonce === MAX_CORE_COMMAND_NONCE
    ? 0
    : requestNonce + 1;
  return requestNonce;
}

/** Display a window and optionally wait for user acknowledgement. */
export function displayWindow(
  winid: number,
  blocking: boolean,
): Promise<void> | undefined {
  flushDisplay();
  const window = getWindow(winid);
  if (
    saveExitAutomation === "display"
    && blocking
    && window?.type === NHW_MESSAGE
  ) {
    saveExitAutomation = null;
    return undefined;
  }
  const needsAcknowledgement = blocking
    || (window?.type !== NHW_MAP && window?.type !== NHW_MESSAGE);
  if (!needsAcknowledgement) return undefined;
  if (window?.type === NHW_MENU && window.menuItems.length > 0) {
    showMenu(winid, PICK_NONE);
  } else if (window?.type !== NHW_MAP && window?.type !== NHW_MESSAGE) {
    showText("", window?.lines ?? []);
  } else {
    setInputRequest({ kind: "message", message: "--More--", acceptedCode: 0 });
  }
  return waitForDisplay();
}

/** Install a blocking display acknowledgement. */
export function waitForDisplay(): Promise<void> {
  return new Promise<void>((resolve) => {
    setPending({ kind: "display", resolve });
  });
}

/** Display a built menu and wait for its selection result. */
export function selectMenu(
  module: EmscriptenModule,
  winid: number,
  how: number,
  menuListPtr: number,
  metadata?: {
    provenance: "none" | "action-getobj";
    requestNonce: number;
    menuGeneration: number;
  },
): Promise<number> | number {
  if (menuListPtr !== 0) module.setValue(menuListPtr, 0, "*");
  const window = getWindow(winid);
  if (window && (window.menuBehavior & MENU_BEHAVE_PERMINV) !== 0) {
    if (how !== PICK_NONE) {
      throw new Error("Permanent inventory menu requires PICK_NONE");
    }
    setInventoryWindow(winid);
    return 0;
  }

  if (
    (
      characterSelectionAutomation?.stage === "awaiting-confirmation"
      || characterSelectionAutomation?.stage === "cancel-confirmation"
    )
    && how === 1
    && isNativeCharacterConfirmation(winid)
  ) {
    const cancel = characterSelectionAutomation.stage === "cancel-confirmation";
    const selection = getCurrentCharacterSelection();
    if (selection || cancel) {
      characterSelectionAutomation = {
        ...characterSelectionAutomation,
        stage: "confirmation",
      };
      return new Promise<number>((resolve) => {
        setPending({
          kind: "menu",
          resolve,
          windowId: winid,
          how,
          menuListPtr,
          module,
        });
        if (cancel) {
          const quitIndex = findMenuAccelerator(winid, "q");
          characterSelectionAutomation = null;
          submitMenuSelection(
            quitIndex === null ? null : [{ itemIndex: quitIndex, count: 1 }],
          );
        } else {
          setInputRequest({ kind: "player-selection" });
        }
      });
    }
  }
  characterSelectionAutomation = null;
  showMenu(winid, how, metadata);
  return new Promise<number>((resolve) => {
    setPending({
      kind: "menu",
      resolve,
      windowId: winid,
      how,
      menuListPtr,
      module,
    });
  });
}

/** Implement the single-line message-menu contract. */
export function messageMenu(
  acceptedCode: number,
  how: number,
  message: string,
): Promise<number> | number {
  appendWindowText(-1, 0, message);
  if (how === PICK_NONE) return 0;
  setInputRequest({ kind: "message", message, acceptedCode });
  return new Promise<number>((resolve) => {
    setPending({ kind: "message", resolve, acceptedCode });
  });
}

/** Wait for keyboard or mouse input requested by the core. */
export function waitForKey(
  module: EmscriptenModule,
  positionPointers: { x: number; y: number; modifier: number } | null,
  inputState: number,
): Promise<number> {
  const commandInput = inputState === INPUT_STATE_COMMAND;
  if (commandInput && saveExitAutomation !== null) {
    saveExitAutomation = null;
  }
  setCommandInput(commandInput);
  const queued = queuedKeys.shift();
  if (queued !== undefined) {
    setCommandInput(false);
    return Promise.resolve(queued);
  }
  setInputRequest(
    { kind: positionPointers ? "position" : "key" },
    inputState,
  );
  return new Promise<number>((resolve) => {
    setPending({
      kind: "key",
      resolve,
      positionPointers,
      module,
      commandInput,
    });
  });
}

/** Wait for and normalize a yn_function response. */
export function waitForYn(
  query: string | null,
  choices: string | null,
  defaultCode: number,
  inputState: number = INPUT_STATE_OTHER,
): Promise<number> {
  if (characterSelectionResponse !== null) {
    if (
      characterSelectionAutomation?.stage === "initial-response"
      && choices === null
    ) {
      const response = characterSelectionResponse;
      characterSelectionResponse = null;
      characterSelectionAutomation = response === "y".charCodeAt(0)
        ? {
          ...characterSelectionAutomation,
          stage: "awaiting-confirmation",
        }
        : null;
      return Promise.resolve(response);
    }
    if (
      characterSelectionAutomation === null
      && choices === null
    ) {
      const response = characterSelectionResponse;
      characterSelectionResponse = null;
      return Promise.resolve(response);
    }
    characterSelectionResponse = null;
    characterSelectionAutomation = null;
  }
  const normalizedQuery = query ?? "";
  if (saveExitAutomation === "confirm") {
    if (normalizedQuery === SAVE_CONFIRM_QUERY && choices === "yn") {
      saveExitAutomation = "display";
      return Promise.resolve(YES_RESPONSE);
    }
    saveExitAutomation = null;
  } else if (saveExitAutomation === "display") {
    saveExitAutomation = null;
  }
  setInputRequest({
    kind: "yn",
    query: normalizedQuery,
    choices,
    defaultCode,
  }, inputState);
  return new Promise<number>((resolve) => {
    setPending({ kind: "yn", resolve, choices, defaultCode });
  });
}

/**
 * Let original setup use native menus or wait for one BlissHack selection.
 * @returns true for native setup and false after a complete custom selection.
 */
export function waitForPlayerSelection(): Promise<boolean> | boolean {
  if (characterSetupContext.style === "original") return true;
  if (cancelAfterName) {
    cancelAfterName = false;
    characterSelectionResponse = "q".charCodeAt(0);
    return true;
  }
  setInputRequest({ kind: "player-selection" });
  return new Promise<boolean>((resolve) => {
    setPending({ kind: "player-selection", resolve });
  });
}

/** Wait for player-name or getlin text entry. */
export function waitForLine(
  module: EmscriptenModule,
  purpose: "name" | "getlin",
  query: string,
  bufferPtr: number,
): Promise<void> {
  setInputRequest(
    purpose === "name" && knownSaveNames.length > 0
      ? {
        kind: "line",
        purpose,
        query,
        existingSaveNames: [...knownSaveNames],
      }
      : { kind: "line", purpose, query },
  );
  return new Promise<void>((resolve) => {
    setPending({ kind: "line", resolve, purpose, bufferPtr, module });
  });
}

/** Show message history and wait until the player dismisses it. */
export function displayHistory(): Promise<number> {
  showHistory();
  return new Promise<number>((resolve) => {
    setPending({ kind: "display", resolve: () => resolve(0) });
  });
}

/** Parse extcmdlist and wait for a command selection. */
export function waitForExtendedCommand(
  module: EmscriptenModule,
): Promise<number> | number {
  const commands = readExtendedCommands(module);
  if (commands.length === 0) return -1;
  showExtendedCommands(commands);
  return new Promise<number>((resolve) => {
    setPending({ kind: "extcmd", resolve });
  });
}

function normalizeYnResponse(
  value: number,
  choices: string | null,
  defaultCode: number,
): number | null {
  if (!Number.isInteger(value) || value < 0 || value > 0x7f) return null;
  if (choices === null) return value;
  if (value === 32 || value === 10 || value === 13) {
    return defaultCode > 0 ? defaultCode : null;
  }
  if (value === 27) {
    if (choices.includes("q")) return "q".charCodeAt(0);
    if (choices.includes("n")) return "n".charCodeAt(0);
    return defaultCode > 0 ? defaultCode : null;
  }
  if (
    choices.includes("#")
    && (value === "#".charCodeAt(0)
      || (value >= "0".charCodeAt(0) && value <= "9".charCodeAt(0)))
  ) {
    return null;
  }
  const character = String.fromCharCode(value);
  if (choices.includes(character)) return value;
  const lower = character.toLowerCase();
  return choices.includes(lower) ? lower.charCodeAt(0) : null;
}

/**
 * Validate and write all four character globals as one logical operation.
 * @param selection - complete tuple supplied by the setup controller.
 */
function writeCharacterSelection(selection: CharacterTuple): void {
  const values = [
    selection.role,
    selection.race,
    selection.gender,
    selection.alignment,
  ];
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error("Character selection must contain four valid indices");
  }
  const catalog = decodeCharacterCatalog(
    globalThis.nethackGlobal?.characterCatalog,
  );
  const legal = buildLegalCharacterTuples(catalog).some((tuple) =>
    tuple.role === selection.role
    && tuple.race === selection.race
    && tuple.gender === selection.gender
    && tuple.alignment === selection.alignment);
  if (!legal) throw new Error("Character selection is not a legal tuple");
  const flags = globalThis.nethackGlobal?.globals?.flags;
  if (!flags) throw new Error("NetHack character flags are unavailable");
  flags.initrole = selection.role;
  flags.initrace = selection.race;
  flags.initgend = selection.gender;
  flags.initalign = selection.alignment;
}

/**
 * Recognize the one native confirmation menu reached after core auto-picking.
 * @param windowId - active native menu window.
 * @returns whether its accelerator set is the expected y/n/q confirmation.
 */
function isNativeCharacterConfirmation(windowId: number): boolean {
  const window = getWindow(windowId);
  if (!window) return false;
  const accelerators = new Set(
    window.menuItems
      .filter((item) => item.identifier !== null)
      .map((item) => String.fromCharCode(item.accelerator).toLowerCase()),
  );
  return accelerators.has("y")
    && accelerators.has("n")
    && accelerators.has("q");
}

/**
 * Find one selectable row by its native accelerator.
 * @param windowId - active native menu window.
 * @param accelerator - expected one-character accelerator.
 * @returns item index, or null when the menu does not contain it.
 */
function findMenuAccelerator(
  windowId: number,
  accelerator: string,
): number | null {
  const window = getWindow(windowId);
  const index = window?.menuItems.findIndex(
    (item) =>
      item.identifier !== null
      && String.fromCharCode(item.accelerator).toLowerCase()
        === accelerator.toLowerCase(),
  ) ?? -1;
  return index >= 0 ? index : null;
}

/**
 * Produce a non-save player name used only to reach native q cancellation.
 * @returns normalized name not present in the enumerated ready saves.
 */
function unusedCancellationName(): string {
  const existing = new Set(
    characterSetupContext.saveIdentities.map((identity) => identity.playerName),
  );
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const candidate = normalizePlayerNameInput(`BlissHackCancel${suffix}`);
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("Unable to allocate character cancellation name");
}

/**
 * Compare two setup owner tokens.
 * @param left - first owner.
 * @param right - second owner.
 * @returns whether both identify the same module and session.
 */
function matchesOwner(
  left: CharacterSetupOwnerToken,
  right: CharacterSetupOwnerToken,
): boolean {
  return left.moduleId === right.moduleId && left.sessionId === right.sessionId;
}

function setPending(action: PendingAction): void {
  if (pendingAction !== null) {
    throw new Error(
      `Cannot start ${action.kind}; ${pendingAction.kind} is still pending`,
    );
  }
  if (action.kind !== "key") {
    queuedKeys.length = 0;
    typeaheadEnabled = false;
  }
  pendingAction = action;
}

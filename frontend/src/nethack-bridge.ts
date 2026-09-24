/**
 * Stable façade for the NetHack 5.0 shim_graphics callback bridge.
 * Contracts are derived from win/shim/winshim.c and doc/window.txt.
 */

import {
  ATR_BOLD,
  PICK_NONE,
  appendWindowText,
  beginMenu,
  clearWindow,
  createWindow,
  destroyWindow,
  endMenu,
  flushDisplay,
  getWindow,
  putMessageHistory,
  resetGameState,
  resetStatus,
  ringBell,
  setClipCenter,
  setCursor,
  setExitReason,
  setLastPreference,
  setNumberPad,
  setRuntimeError,
  setRuntimePhase,
  showText,
  type TextLine,
} from "./game-state";
import { readDlbEntry } from "./dlb";
import type { SaveIdentity } from "./storage/storage-service";
import type { EmscriptenModule } from "./bridge/emscripten-module";
import {
  acceptCoreCommandResult,
  acceptRuntimeSettingsResult,
  cancelCharacterSetup,
  cancelCharacterSelection,
  confirmNativeCharacterSelection,
  dismissDisplay,
  getCurrentCharacterSelection,
  displayHistory,
  displayWindow,
  getCharacterSetupContext,
  isWaitingForInput,
  messageMenu,
  normalizePlayerNameInput,
  queueRuntimeSettings,
  requestCoreCommand,
  requestNativeCharacterSelection,
  requestSaveAndExit,
  resetInputController,
  selectMenu,
  submitActionKey,
  sendKey,
  sendPosition,
  setActionIntentActive,
  setCharacterSetupContext,
  setKnownSaveNames,
  submitCharacterSelection,
  submitCharacterName,
  submitExtendedCommand,
  submitLine,
  submitMenuSelection,
  synchronizeCoreCommand,
  synchronizeRuntimeSettings,
  waitForDisplay,
  waitForExtendedCommand,
  waitForKey,
  waitForLine,
  waitForPlayerSelection,
  waitForYn,
} from "./bridge/input-controller";
import {
  addDecodedMenuItem,
  asNumber,
  asString,
  enableDecodedStatusField,
  printGlyph,
  readStringPointer,
  safeCallbackResult,
  updateDecodedStatus,
} from "./bridge/shim-decoders";
import {
  handleEndgameCollectorEvent,
  resetEndgameCollection,
  snapshotEndgameWindow,
} from "./bridge/endgame-collector";

export {
  buildLegalCharacterTuples,
  characterOptionsFor,
  completeCharacterSelection,
  createCharacterSetupController,
  decodeCharacterCatalog,
  filterCharacterTuples,
  normalizeCharacterNameInput,
  playerNameForSaveLookup,
  updateCharacterSelection,
} from "./bridge/character-setup";
export type {
  CharacterAspect,
  CharacterCandidateState,
  CharacterCatalog,
  CharacterOption,
  CharacterSelection,
  CharacterSetupController,
  CharacterSetupControllerOptions,
  CharacterSetupContext,
  CharacterSetupFocus,
  CharacterSetupOwnerToken,
  CharacterSetupPhase,
  CharacterSetupState,
  CharacterTuple,
} from "./bridge/character-setup";
export {
  createEndgameCollector,
  completeEndgameCollection,
  getEndgameCollectorState,
  handleEndgameCollectorEvent,
  resetEndgameCollection,
  setEndgameCollectorContext,
  snapshotEndgameWindow,
  updateEndgameCollectionStyle,
} from "./bridge/endgame-collector";
export type {
  EndgameCollector,
  EndgameCollectorDecision,
  EndgameCollectorEvent,
  EndgameCollectorOptions,
  EndgameCollectorOwner,
  EndgameCollectorPhase,
  EndgameCollectorResetReason,
  EndgameCollectorState,
  EndgameContentBlock,
  EndgameSection,
  EndgameStyle,
  EndgameSummary,
  EndgameWindowSnapshot,
} from "./bridge/endgame-collector";
export {
  createGameModule,
  preparePlayerNamePrompt,
} from "./bridge/emscripten-module";
export type {
  EmscriptenFactory,
  EmscriptenFileSystem,
  EmscriptenModule,
  GameModuleOptions,
} from "./bridge/emscripten-module";
export {
  validateSaveBytes,
  validateSaveMetadata,
} from "./bridge/save-validation";
export {
  cancelCharacterSetup,
  cancelCharacterSelection,
  confirmNativeCharacterSelection,
  dismissDisplay,
  getCharacterSetupContext,
  getCurrentCharacterSelection,
  isWaitingForInput,
  normalizePlayerNameInput,
  queueRuntimeSettings,
  requestCoreCommand,
  requestNativeCharacterSelection,
  requestSaveAndExit,
  submitActionKey,
  sendKey,
  sendPosition,
  setActionIntentActive,
  setCharacterSetupContext,
  setKnownSaveNames,
  submitCharacterSelection,
  submitCharacterName,
  submitExtendedCommand,
  submitLine,
  submitMenuSelection,
};

/**
 * Set the identity NetHack will use for save lookup when main starts.
 * @param module - prepared module which has not called main.
 * @param identity - validated identity read from the selected save.
 */
export function setStartupIdentity(
  module: EmscriptenModule,
  identity: SaveIdentity,
): void {
  module.ccall(
    "shim_graphics_set_player_name",
    null,
    ["string"],
    [identity.playerName],
  );
}

/**
 * Require this module to restore rather than fall through to character setup.
 * @param module - prepared module which has not called main.
 * @param required - whether player selection represents restore failure.
 */
export function setRestoreRequired(
  module: EmscriptenModule,
  required: boolean,
): void {
  module.ccall(
    "shim_graphics_set_restore_required",
    null,
    ["number"],
    [required ? 1 : 0],
  );
}

/**
 * Reset bridge state for cleanup or a future fresh game.
 * @param options - whether a completed session's render-only HUD may remain.
 */
export function resetBridgeState(
  options: { preserveGameState?: boolean } = {},
): void {
  resetEndgameCollection("bridge-reset");
  resetInputController();
  if (!options.preserveGameState) resetGameState();
}

/**
 * Dispatch a callback using the module captured by its owning session.
 * @param module - module whose memory contains all callback pointers.
 * @param name - exact function name from winshim.c.
 * @param args - values decoded by local_callback.
 * @returns the value required by the callback's C return type.
 */
export async function shimCallbackForModule(
  module: EmscriptenModule,
  name: string,
  ...args: unknown[]
): Promise<unknown> {
  try {
    return await dispatchShimCallback(module, name, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setRuntimeError(`${name}: ${message}`);
    return safeCallbackResult(name);
  }
}

/**
 * Dispatch one callback after the public boundary has installed error handling.
 * @param name - exact function name from winshim.c.
 * @param args - values decoded by local_callback.
 * @returns the value required by the callback's C return type.
 */
async function dispatchShimCallback(
  module: EmscriptenModule,
  name: string,
  args: unknown[],
): Promise<unknown> {
  switch (name) {
    case "shim_init_nhwindows": {
      const iflags = globalThis.nethackGlobal?.globals?.iflags;
      if (iflags) {
        iflags.window_inited = true;
        iflags.wc2_hitpointbar = true;
      }
      setRuntimePhase("running");
      return undefined;
    }
    case "shim_player_selection_or_tty":
      return waitForPlayerSelection();
    case "shim_askname":
      return waitForLine(module, "name", "Who are you?", 0);
    case "shim_get_nh_event":
    case "shim_suspend_nhwindows":
    case "shim_resume_nhwindows":
      return undefined;
    case "shim_settings_sync":
      return synchronizeRuntimeSettings(asNumber(args[0]));
    case "shim_settings_result":
      acceptRuntimeSettingsResult(
        asNumber(args[0]),
        asNumber(args[1]),
      );
      return undefined;
    case "shim_command_sync":
      return synchronizeCoreCommand(
        module,
        asNumber(args[0]) >>> 0,
        asNumber(args[1]),
      );
    case "shim_command_result":
      acceptCoreCommandResult(
        asNumber(args[0]),
        asNumber(args[1]),
        asNumber(args[2]),
        asNumber(args[3]),
      );
      return undefined;
    case "shim_exit_nhwindows":
      setExitReason(asString(args[0]));
      return undefined;
    case "shim_create_nhwindow": {
      const windowType = asNumber(args[0]);
      const windowId = createWindow(windowType);
      handleEndgameCollectorEvent({
        type: "window-created",
        windowId,
        windowType,
      });
      return windowId;
    }
    case "shim_clear_nhwindow":
      clearWindow(asNumber(args[0]));
      return undefined;
    case "shim_display_nhwindow": {
      const windowId = asNumber(args[0]);
      const window = getWindow(windowId);
      const decision = window
        ? handleEndgameCollectorEvent({
          type: "display-window",
          window: snapshotEndgameWindow(window),
          blocking: Boolean(args[1]),
        })
        : { kind: "pass" as const };
      if (decision.kind === "resolve") flushDisplay();
      return decision.kind === "resolve"
        ? undefined
        : displayWindow(windowId, Boolean(args[1]));
    }
    case "shim_destroy_nhwindow": {
      const windowId = asNumber(args[0]);
      handleEndgameCollectorEvent({ type: "window-destroyed", windowId });
      destroyWindow(windowId);
      return undefined;
    }
    case "shim_curs":
      setCursor(asNumber(args[0]), asNumber(args[1]), asNumber(args[2]));
      return undefined;
    case "shim_putstr":
      appendWindowText(
        asNumber(args[0]),
        asNumber(args[1]),
        asString(args[2]),
      );
      return undefined;
    case "shim_display_file":
      handleEndgameCollectorEvent({
        type: "input-request",
        inputKind: "display-file",
      });
      return displayFile(module, asString(args[0]), Boolean(args[1]));
    case "shim_start_menu":
      beginMenu(asNumber(args[0]), asNumber(args[1]));
      return undefined;
    case "shim_add_menu":
      addDecodedMenuItem(module, args);
      return undefined;
    case "shim_end_menu":
      endMenu(asNumber(args[0]), asString(args[1]));
      return undefined;
    case "shim_select_menu": {
      const windowId = asNumber(args[0]);
      const how = asNumber(args[1]);
      const window = getWindow(windowId);
      const decision = window
        ? handleEndgameCollectorEvent({
          type: "select-menu",
          window: snapshotEndgameWindow(window),
          how,
        })
        : { kind: "pass" as const };
      if (decision.kind === "resolve") {
        const menuListPtr = asNumber(args[2]);
        if (menuListPtr !== 0) module.setValue(menuListPtr, 0, "*");
        return decision.value ?? 0;
      }
      return selectMenu(
        module,
        windowId,
        how,
        asNumber(args[2]),
        args.length >= 6
          ? {
            provenance: asNumber(args[3]) === 1
              ? "action-getobj"
              : "none",
            requestNonce: asNumber(args[4]) >>> 0,
            menuGeneration: asNumber(args[5]) >>> 0,
          }
          : undefined,
      );
    }
    case "shim_message_menu":
      if (asNumber(args[1]) !== PICK_NONE) {
        handleEndgameCollectorEvent({
          type: "input-request",
          inputKind: "message-menu",
        });
      }
      return messageMenu(
        asNumber(args[0]) & 0xff,
        asNumber(args[1]),
        asString(args[2]),
      );
    case "shim_mark_synch":
    case "shim_wait_synch":
      flushDisplay();
      return undefined;
    case "shim_cliparound":
      setClipCenter(asNumber(args[0]), asNumber(args[1]));
      return undefined;
    case "shim_update_positionbar":
      return undefined;
    case "shim_print_glyph":
      printGlyph(module, args);
      return undefined;
    case "shim_raw_print": {
      const line = { text: asString(args[0]), attribute: 0 };
      handleEndgameCollectorEvent({ type: "raw-print", line });
      appendWindowText(-1, line.attribute, line.text);
      return undefined;
    }
    case "shim_raw_print_bold": {
      const line = { text: asString(args[0]), attribute: ATR_BOLD };
      handleEndgameCollectorEvent({ type: "raw-print", line });
      appendWindowText(-1, line.attribute, line.text);
      return undefined;
    }
    case "shim_nhgetch":
      handleEndgameCollectorEvent({
        type: "input-request",
        inputKind: "key",
      });
      return waitForKey(module, null, asNumber(args[0]));
    case "shim_nh_poskey":
      handleEndgameCollectorEvent({
        type: "input-request",
        inputKind: "position",
      });
      return waitForKey(module, {
        x: asNumber(args[0]),
        y: asNumber(args[1]),
        modifier: asNumber(args[2]),
      }, asNumber(args[3]));
    case "shim_nhbell":
      ringBell();
      return undefined;
    case "shim_doprev_message":
      handleEndgameCollectorEvent({
        type: "input-request",
        inputKind: "history",
      });
      return displayHistory();
    case "shim_yn_function": {
      const query = asString(args[0]) || "";
      const choices = asString(args[1]) || null;
      const defaultCode = asNumber(args[2]);
      const decision = handleEndgameCollectorEvent({
        type: "yn",
        query,
        choices,
        defaultCode,
      });
      return decision.kind === "resolve"
        ? decision.value
        : waitForYn(query || null, choices, defaultCode, asNumber(args[3]));
    }
    case "shim_getlin":
      handleEndgameCollectorEvent({
        type: "input-request",
        inputKind: "getlin",
      });
      return waitForLine(
        module,
        "getlin",
        asString(args[0]),
        asNumber(args[1]),
      );
    case "shim_get_ext_cmd":
      handleEndgameCollectorEvent({
        type: "input-request",
        inputKind: "extended-command",
      });
      return waitForExtendedCommand(module);
    case "shim_number_pad":
      setNumberPad(asNumber(args[0]) !== 0);
      return undefined;
    case "shim_delay_output":
      await delay(50);
      return undefined;
    case "shim_preference_update":
      setLastPreference(readStringPointer(module, asNumber(args[0])));
      return undefined;
    case "shim_getmsghistory":
      // Upstream's "s" return setter writes into the char* stack slot rather
      // than assigning a pointer. An empty string safely leaves that slot NULL.
      return "";
    case "shim_putmsghistory":
      putMessageHistory(
        asString(args[0]) || null,
        Boolean(args[1]),
      );
      return undefined;
    case "shim_status_init":
      resetStatus();
      return undefined;
    case "shim_status_enablefield":
      enableDecodedStatusField(module, args);
      return undefined;
    case "shim_status_update":
      updateDecodedStatus(module, args);
      return undefined;
    case "shim_change_color":
    case "shim_change_background":
      return undefined;
    case "set_shim_font_name":
      return 0;
    case "shim_get_color_string":
      return "";
    default:
      setRuntimeError(`Unsupported shim callback: ${name}`);
      return undefined;
  }
}

/**
 * Read and display one embedded NetHack data file.
 * @param name - path passed by the core.
 * @param complain - whether a missing file should produce a message.
 */
async function displayFile(
  module: EmscriptenModule,
  name: string,
  complain: boolean,
): Promise<void> {
  let content: string;
  try {
    const result = module.FS.readFile("/nhdat");
    const archive = typeof result === "string"
      ? new TextEncoder().encode(result)
      : result;
    const entry = readDlbEntry(archive, name);
    if (entry === null) throw new Error(`Missing DLB entry: ${name}`);
    content = new TextDecoder().decode(entry);
  } catch {
    if (complain) appendWindowText(-1, 0, `Cannot display file: ${name}`);
    return;
  }
  const lines = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((text): TextLine => ({ text, attribute: 0 }));
  showText(name, lines);
  await waitForDisplay();
}

/**
 * Resolve after a fixed number of milliseconds.
 * @param milliseconds - requested delay.
 */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

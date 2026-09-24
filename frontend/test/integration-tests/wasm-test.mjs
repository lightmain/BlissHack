/**
 * Integration test: loads the NetHack WASM module in Node.js,
 * registers the minimal shim callback, starts the game, and
 * verifies that essential shim events are received and input
 * handling works end-to-end.
 *
 * Run: npm run test:integration
 * Source contracts only:
 * BLISSHACK_SOURCE_CONTRACT_ONLY=1 npm run test:integration:wasm
 *
 * Requires: frontend/public/nethack.js and nethack.wasm
 * (built via `make CROSS_TO_WASM=1` and copied to frontend/public/)
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = process.env.BLISSHACK_WASM_DIR
  ? resolve(process.env.BLISSHACK_WASM_DIR)
  : join(__dirname, "..", "..", "public");
const WASM_JS = join(WASM_DIR, "nethack.js");
const WASM_BIN = join(WASM_DIR, "nethack.wasm");
const WINSHIM_SOURCE = join(
  __dirname,
  "..",
  "..",
  "..",
  "win",
  "shim",
  "winshim.c",
);
const CMD_SOURCE = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "cmd.c",
);
const HACK_SOURCE = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "hack.c",
);
const LOCK_SOURCE = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "lock.c",
);
const DO_SOURCE = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "do.c",
);
const INVENT_SOURCE = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "invent.c",
);
const SAVE_SOURCE = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "save.c",
);
const TILE_SOURCE = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "tile.c",
);
const LIBNH_MAIN_SOURCE = join(
  __dirname,
  "..",
  "..",
  "..",
  "sys",
  "libnh",
  "libnhmain.c",
);

/* ------------------------------------------------------------------ */
/*  Test harness                                                       */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

/**
 * Return the brace-delimited C block which starts at or after a marker.
 * @param {string} source - complete C source.
 * @param {RegExp} marker - expression ending before the block's opening brace.
 * @returns {string|null} the complete block, or null when it cannot be found.
 */
function cBlockAfter(source, marker) {
  const match = marker.exec(source);
  if (!match) return null;
  const start = source.indexOf("{", match.index + match[0].length);
  if (start < 0) return null;

  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  return null;
}

/**
 * Enumerate character tuples using only the copied compatibility masks.
 * @param {object} catalog - versioned metadata supplied by the WASM build.
 * @returns {object[]} complete legal tuples in stable table order.
 */
function buildCharacterTuples(catalog) {
  const tuples = [];
  for (const role of catalog.roles) {
    for (const race of catalog.races) {
      if ((role.allow & race.allow & catalog.masks.race) === 0) continue;
      for (const gender of catalog.genders) {
        if (
          (role.allow & race.allow & gender.allow & catalog.masks.gender) === 0
        ) {
          continue;
        }
        for (const alignment of catalog.alignments) {
          if (
            (
              role.allow
              & race.allow
              & alignment.allow
              & catalog.masks.alignment
            ) !== 0
          ) {
            tuples.push({
              role: role.index,
              race: race.index,
              gender: gender.index,
              alignment: alignment.index,
            });
          }
        }
      }
    }
  }
  return tuples;
}

/* ------------------------------------------------------------------ */
/*  Minimal shim callback (mirrors nethack-bridge.ts logic)            */
/* ------------------------------------------------------------------ */

let nextWindowId = 0;
let pendingInput = null;
const pendingInputWaiters = new Set();
const receivedEventNames = new Set();
const receivedEvents = [];
const callbackEvents = [];
let eventCount = 0;
let eventsWithoutInput = 0;
let ynCount = 0;
const numberPadStates = [];
const ynPrompts = [];
const rawMessages = [];
const windowMessages = [];
const inputStates = [];
const runtimeSettingsSnapshots = [];
const runtimeSettingsResults = [];
const permanentInventoryUpdates = [];
const glyphEvents = [];
const statusFieldMetadataEvents = [];
const statusUpdateEvents = [];
const coreCommandResults = [];
const publishedBoundaryGenerations = [];
const menuSelections = [];
const activeMenus = new Map();
const activeWindows = new Map();
let queuedRuntimeSettings = 0;
let queuedCoreCommand = null;
let queuedExtendedCommand = null;
let activeCommandResponses = null;
let activeModule = null;
let commandBoundaryGeneration = 0;
let selectedCharacterFixture = null;

const RUNTIME_SETTINGS_VERSION = 2 << 28;
const RUNTIME_SETTINGS_PENDING = 1 << 0;
const RUNTIME_SETTINGS_AUTOPICKUP = 1 << 1;
const RUNTIME_SETTINGS_PICKUP_ALL = 1 << 6;
const RUNTIME_SETTINGS_PERM_INVENT = 1 << 25;
const RUNTIME_SETTINGS_PERMINV_ALL = 1 << 26;
const RUNTIME_SETTINGS_PERMINV_FULL = 2 << 26;
const RUNTIME_SETTINGS_PERMINV_MODE_MASK = 3 << 26;
const CORE_COMMAND_VERSION = 2 << 28;
const CORE_COMMAND_CATALOG = 2;
const CORE_COMMAND_REQUEST_ITEM_MENU = 1 << 4;
const CORE_COMMAND_UNKNOWN_BIT = (1 << 27) >>> 0;
const MENU_BEHAVE_PERMINV = 1;
const MENU_BEHAVE_STANDARD = 0;
const PICK_ONE = 1;
const PICK_NONE = 0;
const MAX_ATLAS_TILE_INDEX = 2306;
const FIRST_OTHER_TILE_INDEX = 1272;
const LAST_LINEAR_CMAP_OFFSET = 32;
const UNEXPLORED_TILE_INDEX = 1469;
const EXTCMD_ENTRY_SIZE = 24;
const EXTCMD_KEY_OFFSET = 0;
const EXTCMD_TEXT_OFFSET = 4;
const EXTCMD_FLAGS_OFFSET = 16;
const MENU_ITEM_SIZE = 16;
const MENU_ITEM_COUNT_OFFSET = 8;
const MENU_ITEM_FLAGS_OFFSET = 12;
const WIZMODECMD = 0x0004;
const CMD_NOT_AVAILABLE = 0x0010;
const INTERNALCMD = 0x0040;
const PREFIXCMD = 0x0200;
const MOVEMENTCMD = 0x0400;
const CMD_PARAM = 0x4000;
const KNOWN_COMMAND_FLAGS = 0x7fff;
const INPUT_STATE_OTHER = 0;
const INPUT_STATE_COMMAND = 1;
const INPUT_STATE_GETPOS = 2;
const INPUT_STATE_GETDIR = 3;
const ESCAPE = 27;
const EXTENDED_COMMAND_KEY = "#".charCodeAt(0);

const EXPECTED_ACTION_COMMAND_NAMES = [
  "#",
  "?",
  "adjust",
  "annotate",
  "apply",
  "attributes",
  "autopickup",
  "call",
  "cast",
  "chat",
  "chronicle",
  "close",
  "conduct",
  "dip",
  "down",
  "drop",
  "droptype",
  "eat",
  "engrave",
  "enhance",
  "exploremode",
  "fight",
  "fire",
  "force",
  "genocided",
  "glance",
  "help",
  "herecmdmenu",
  "history",
  "inventory",
  "inventtype",
  "invoke",
  "jump",
  "kick",
  "known",
  "knownclass",
  "look",
  "lookaround",
  "loot",
  "monster",
  "name",
  "offer",
  "open",
  "options",
  "optionsfull",
  "overview",
  "pay",
  "perminv",
  "pickup",
  "pray",
  "prevmsg",
  "puton",
  "quaff",
  "quit",
  "quiver",
  "read",
  "redraw",
  "remove",
  "repeat",
  "reqmenu",
  "retravel",
  "ride",
  "rub",
  "run",
  "rush",
  "save",
  "saveoptions",
  "search",
  "seeall",
  "seeamulet",
  "seearmor",
  "seerings",
  "seetools",
  "seeweapon",
  "shell",
  "showgold",
  "showspells",
  "showtrap",
  "sit",
  "suspend",
  "swap",
  "takeoff",
  "takeoffall",
  "teleport",
  "terrain",
  "therecmdmenu",
  "throw",
  "tip",
  "toggle",
  "travel",
  "turn",
  "twoweapon",
  "untrap",
  "up",
  "vanquished",
  "version",
  "versionshort",
  "wait",
  "wear",
  "whatdoes",
  "whatis",
  "wield",
  "wipe",
  "zap",
];

const EXPECTED_MOVEMENT_COMMAND_NAMES = [
  "movewest",
  "movenorthwest",
  "movenorth",
  "movenortheast",
  "moveeast",
  "movesoutheast",
  "movesouth",
  "movesouthwest",
  "rushwest",
  "rushnorthwest",
  "rushnorth",
  "rushnortheast",
  "rusheast",
  "rushsoutheast",
  "rushsouth",
  "rushsouthwest",
  "runwest",
  "runnorthwest",
  "runnorth",
  "runnortheast",
  "runeast",
  "runsoutheast",
  "runsouth",
  "runsouthwest",
];

/**
 * Copy all commands from the current WASM extcmdlist.
 * @param {object} module - initialized Emscripten module.
 * @returns {Array<{
 * sourceIndex: number,
 * name: string,
 * defaultKey: number,
 * flags: number,
 * }>}
 * commands in authoritative source order.
 */
function readAllWasmCommands(module) {
  const listPtr = globalThis.nethackGlobal?.pointers?.extcmdlist ?? 0;
  if (listPtr === 0) return [];
  const commands = [];

  for (let sourceIndex = 0; sourceIndex < 1024; sourceIndex += 1) {
    const entryPtr = listPtr + sourceIndex * EXTCMD_ENTRY_SIZE;
    const textPtr = Number(module.getValue(entryPtr + EXTCMD_TEXT_OFFSET, "*"));
    if (textPtr === 0) break;
    const flags = Number(
      module.getValue(entryPtr + EXTCMD_FLAGS_OFFSET, "i32"),
    ) >>> 0;
    commands.push({
      sourceIndex,
      name: module.UTF8ToString(textPtr),
      defaultKey: Number(
        module.getValue(entryPtr + EXTCMD_KEY_OFFSET, "i8"),
      ) & 0xff,
      flags,
    });
  }
  return commands;
}

/**
 * Copy player-visible commands from the current WASM extcmdlist.
 * @param {object} module - initialized Emscripten module.
 * @returns {ReturnType<typeof readAllWasmCommands>} visible commands.
 */
function readVisibleWasmCommands(module) {
  return readAllWasmCommands(module).filter(
    ({ flags }) =>
      (flags & (WIZMODECMD | CMD_NOT_AVAILABLE | INTERNALCMD)) === 0,
  );
}

/**
 * Decode one glyph_info while its shim callback pointer remains valid.
 * @param {number} ptr - WASM32 pointer to a 36-byte glyph_info.
 * @returns {object|null} copied glyph fields, or null for a null pointer.
 */
function readGlyphInfo(ptr) {
  if (!activeModule || ptr === 0) return null;
  return {
    glyph: Number(activeModule.getValue(ptr, "i32")),
    ttyChar: Number(activeModule.getValue(ptr + 4, "i32")),
    frameColor: Number(activeModule.getValue(ptr + 8, "i32")) >>> 0,
    glyphFlags: Number(activeModule.getValue(ptr + 12, "i32")) >>> 0,
    color: Number(activeModule.getValue(ptr + 16, "i32")),
    symbolIndex: Number(activeModule.getValue(ptr + 20, "i32")),
    customColor: Number(activeModule.getValue(ptr + 24, "i32")) >>> 0,
    color256: Number(activeModule.getValue(ptr + 28, "i16")) & 0xffff,
    tileIndex: Number(activeModule.getValue(ptr + 30, "i16")),
    unicodePointer: Number(activeModule.getValue(ptr + 32, "*")) >>> 0,
  };
}

/**
 * Publish one keyboard-facing callback to event-driven test waiters.
 * @param {{
 * name: string,
 * inputState: number,
 * eventIndex: number,
 * resolve: (value: number) => void,
 * }} input - blocked WASM callback.
 */
function setPendingInput(input) {
  pendingInput = input;
  eventsWithoutInput = 0;
  for (const waiter of [...pendingInputWaiters]) {
    if (!waiter.predicate(input)) continue;
    pendingInputWaiters.delete(waiter);
    clearTimeout(waiter.timeout);
    waiter.resolve(input);
  }
}

/**
 * Wait for a matching keyboard-facing callback without sleep-based progress.
 * @param {number} timeoutMs - failure guard only.
 * @param {(input: object) => boolean} [predicate] - required input shape.
 * @returns {Promise<object|null>} matching callback, or null on timeout.
 */
function waitForPendingInput(timeoutMs, predicate = () => true) {
  if (pendingInput && predicate(pendingInput)) {
    return Promise.resolve(pendingInput);
  }
  return new Promise((resolve) => {
    const waiter = {
      predicate,
      resolve,
      timeout: null,
    };
    waiter.timeout = setTimeout(() => {
      pendingInputWaiters.delete(waiter);
      resolve(null);
    }, timeoutMs);
    pendingInputWaiters.add(waiter);
  });
}

/**
 * Resolve the callback currently blocking the WASM core.
 * @param {number} value - NetHack input byte.
 * @returns {boolean} whether an input was pending.
 */
function resolvePendingInput(value) {
  const input = pendingInput;
  pendingInput = null;
  if (!input) return false;
  input.resolve(value);
  return true;
}

/**
 * Send one key to the blocked core and wait for its next input callback.
 * @param {number} key - NetHack input byte.
 * @returns {Promise<boolean>} whether the next input callback arrived.
 */
async function sendKeyAndWait(key) {
  if (!resolvePendingInput(key)) return false;
  return (await waitForPendingInput(5000)) !== null;
}

/**
 * Return callback events belonging to a command flow.
 * @param {number} startIndex - callbackEvents offset before command input.
 * @returns {object[]} copied event slice.
 */
function commandTraceFrom(startIndex) {
  return callbackEvents.slice(startIndex);
}

/**
 * Resolve one core-generated menu with a structurally identified row.
 * @param {object} menu - copied menu metadata.
 * @param {number} menuListPtr - address of the core's menu_item pointer.
 * @param {number|undefined} targetGlyph - required object glyph when supplied.
 * @returns {number} number of selected rows.
 */
function selectMenuItem(menu, menuListPtr, targetGlyph) {
  const selectableItems = menu?.items.filter(
    ({ identifier }) => identifier !== 0,
  ) ?? [];
  const item = targetGlyph === undefined
    ? selectableItems.find(
      ({ accelerator }) =>
        (accelerator >= 65 && accelerator <= 90)
        || (accelerator >= 97 && accelerator <= 122),
    ) ?? selectableItems[0]
    : selectableItems.find(({ glyph }) => glyph === targetGlyph);
  if (!activeModule || !item || menuListPtr === 0) return -1;
  const resultPtr = activeModule._malloc(MENU_ITEM_SIZE);
  activeModule.setValue(resultPtr, item.identifier, "i32");
  activeModule.setValue(resultPtr + 4, 0, "i32");
  activeModule.setValue(resultPtr + MENU_ITEM_COUNT_OFFSET, -1, "i32");
  activeModule.setValue(resultPtr + MENU_ITEM_FLAGS_OFFSET, 0, "i32");
  activeModule.setValue(menuListPtr, resultPtr, "*");
  return 1;
}

/**
 * Start a real command through the current WASM extended-command picker.
 * @param {{sourceIndex: number, name: string}} command - WASM metadata row.
 * @param {{
 * ynResponses?: number[],
 * unrestrictedYnResponses?: number[],
 * menuResponses?: Array<"cancel"|"first">,
 * menuItemGlyphs?: number[],
 * }} [responses] - structured callback responses for this command only.
 * @returns {{startIndex: number, boundaryGeneration: number}}
 * trace markers captured before command input.
 */
function startExtendedCommand(command, responses = {}) {
  if (!pendingInput || pendingInput.inputState !== INPUT_STATE_COMMAND) {
    throw new Error(`Cannot start ${command.name} outside command input`);
  }
  const marker = {
    startIndex: callbackEvents.length,
    boundaryGeneration: commandBoundaryGeneration,
  };
  queuedExtendedCommand = command.sourceIndex;
  activeCommandResponses = {
    ynResponses: [...(responses.ynResponses ?? [])],
    unrestrictedYnResponses: [
      ...(responses.unrestrictedYnResponses ?? []),
    ],
    menuResponses: [...(responses.menuResponses ?? [])],
    menuItemGlyphs: [...(responses.menuItemGlyphs ?? [])],
  };
  resolvePendingInput(EXTENDED_COMMAND_KEY);
  return marker;
}

/**
 * Drive non-boundary key callbacks to cancellation and stop at a new boundary.
 * @param {{startIndex: number, boundaryGeneration: number}} marker - flow start.
 * @returns {Promise<object[]>} structured callback trace for the command.
 */
async function finishExtendedCommand(marker) {
  for (;;) {
    const input = await waitForPendingInput(5000);
    if (!input) throw new Error("Timed out waiting for command input");
    if (
      input.inputState === INPUT_STATE_COMMAND
      && commandBoundaryGeneration > marker.boundaryGeneration
    ) {
      activeCommandResponses = null;
      return commandTraceFrom(marker.startIndex);
    }
    if (input.inputState === INPUT_STATE_COMMAND) {
      const traceNames = commandTraceFrom(marker.startIndex)
        .map(({ name }) => name)
        .join(", ");
      throw new Error(
        `Unexpected command continuation before boundary: ${traceNames}`,
      );
    }
    resolvePendingInput(ESCAPE);
  }
}

/**
 * Execute one real extended command and return at the next top-level boundary.
 * @param {{sourceIndex: number, name: string}} command - WASM metadata row.
 * @param {{
 * ynResponses?: number[],
 * unrestrictedYnResponses?: number[],
 * menuResponses?: Array<"cancel"|"first">,
 * menuItemGlyphs?: number[],
 * }} [responses] - structured callback responses for this command only.
 * @returns {Promise<object[]>} structured callback trace.
 */
async function runExtendedCommand(command, responses = {}) {
  return finishExtendedCommand(startExtendedCommand(command, responses));
}

/**
 * Encode one v2 catalog command as [header, requestNonce, argument].
 * @param {number} sessionCommandId - current WASM extcmdlist index.
 * @param {number} requestNonce - nonzero session-local request identity.
 * @param {boolean} [requestItemMenu] - whether getobj should use a menu.
 * @returns {[number, number, number]} exact protocol words.
 */
function catalogCommandPayload(
  sessionCommandId,
  requestNonce,
  requestItemMenu = false,
) {
  return [
    (
      CORE_COMMAND_VERSION
      | CORE_COMMAND_CATALOG
      | (requestItemMenu ? CORE_COMMAND_REQUEST_ITEM_MENU : 0)
    ) >>> 0,
    requestNonce >>> 0,
    sessionCommandId >>> 0,
  ];
}

/**
 * Compare command identities without coercing any protocol word.
 * @param {number[]} left - first protocol tuple.
 * @param {number[]} right - second protocol tuple.
 * @returns {boolean} whether all three words match.
 */
function sameCoreCommandPayload(left, right) {
  return left.length === 3
    && right.length === 3
    && left.every((word, index) => word === right[index]);
}

/**
 * Queue one v2 request for the next real shim_get_nh_event boundary.
 * @param {[number, number, number]} payload - exact protocol tuple.
 * @param {object} [responses] - structured responses used by the command.
 * @returns {{
 * startIndex: number,
 * boundaryGeneration: number,
 * payload: [number, number, number],
 * }} trace marker.
 */
function startCoreCommand(payload, responses = {}) {
  if (!pendingInput || pendingInput.inputState !== INPUT_STATE_COMMAND) {
    throw new Error("Cannot queue a core command outside command input");
  }
  if (
    !Array.isArray(payload)
    || payload.length !== 3
    || !payload.every(
      (word) =>
        Number.isInteger(word) && word >= 0 && word <= 0xffffffff,
    )
  ) {
    throw new Error("Core command payload must contain three uint32 words");
  }
  const marker = {
    startIndex: callbackEvents.length,
    boundaryGeneration: commandBoundaryGeneration,
    payload: [...payload],
  };
  queuedCoreCommand = [...payload];
  activeCommandResponses = {
    ynResponses: [...(responses.ynResponses ?? [])],
    unrestrictedYnResponses: [
      ...(responses.unrestrictedYnResponses ?? []),
    ],
    menuResponses: [...(responses.menuResponses ?? [])],
    menuItemGlyphs: [...(responses.menuItemGlyphs ?? [])],
  };
  resolvePendingInput(ESCAPE);
  return marker;
}

/**
 * Execute one v2 request and return at the next top-level boundary.
 * @param {[number, number, number]} payload - exact protocol tuple.
 * @param {object} [responses] - structured responses used by the command.
 * @returns {Promise<object[]>} structured callback trace.
 */
async function runCoreCommand(payload, responses = {}) {
  return finishExtendedCommand(startCoreCommand(payload, responses));
}

/**
 * Test whether a trace contains one callback type.
 * @param {object[]} trace - structured command trace.
 * @param {string} name - exact shim callback name.
 * @returns {boolean} whether the callback occurred.
 */
function traceHas(trace, name) {
  return trace.some((event) => event.name === name);
}

/**
 * Test whether a trace crossed the Emscripten command-loop safe boundary.
 * @param {object[]} trace - structured command trace.
 * @returns {boolean} whether settings synchronization began a new boundary.
 */
function traceHasBoundary(trace) {
  return trace.some((event) => event.boundaryGeneration !== undefined);
}

globalThis.nethackGlobal = globalThis.nethackGlobal || {};

async function blissCallback(name, ...args) {
  receivedEventNames.add(name);
  receivedEvents.push(name);
  eventCount++;
  eventsWithoutInput++;
  const callbackEvent = { name, eventIndex: eventCount };
  callbackEvents.push(callbackEvent);

  if (eventsWithoutInput > 10000 && !pendingInput) {
    console.error(
      `ABORT: 10000+ events without input prompt. Unique: ${[...receivedEventNames].join(", ")}`
    );
    process.exit(1);
  }

  if (name === "shim_yn_function") {
    ynCount++;
    ynPrompts.push(String(args[0] ?? ""));
    const inputState = Number(args[3]);
    inputStates.push(inputState);
    callbackEvent.inputState = inputState;
    callbackEvent.choices = typeof args[1] === "string" && args[1].length > 0
      ? args[1]
      : null;
    callbackEvent.defaultCode = Number(args[2]);
    if (ynCount > 200) {
      console.error("ABORT: shim_yn_function called 200+ times (loop?)");
      process.exit(1);
    }
    const responseQueue = callbackEvent.choices === null
      && activeCommandResponses?.unrestrictedYnResponses.length > 0
      ? activeCommandResponses.unrestrictedYnResponses
      : activeCommandResponses?.ynResponses;
    const queuedResponse = responseQueue?.shift();
    if (queuedResponse !== undefined) {
      callbackEvent.response = queuedResponse;
      return queuedResponse;
    }
    const def = typeof args[2] === "number" && args[2] > 0 ? args[2] : 121;
    callbackEvent.response = def;
    return def;
  }

  switch (name) {
    case "shim_number_pad":
      numberPadStates.push(args[0]);
      return undefined;

    case "shim_raw_print":
    case "shim_raw_print_bold":
      rawMessages.push(String(args[0] ?? ""));
      return undefined;

    case "shim_putstr":
      windowMessages.push(String(args[2] ?? ""));
      return undefined;

    case "shim_create_nhwindow": {
      const windowId = nextWindowId++;
      const windowType = Number(args[0]);
      callbackEvent.windowId = windowId;
      callbackEvent.windowType = windowType;
      activeWindows.set(windowId, windowType);
      return windowId;
    }

    case "shim_display_nhwindow":
      callbackEvent.windowId = Number(args[0]);
      callbackEvent.windowType = activeWindows.get(Number(args[0])) ?? null;
      callbackEvent.blocking = Boolean(args[1]);
      return undefined;

    case "shim_destroy_nhwindow":
      callbackEvent.windowId = Number(args[0]);
      callbackEvent.windowType = activeWindows.get(Number(args[0])) ?? null;
      activeWindows.delete(Number(args[0]));
      activeMenus.delete(Number(args[0]));
      return undefined;

    case "shim_player_selection_or_tty":
      if (globalThis.nethackGlobal?.globals?.flags) {
        const f = globalThis.nethackGlobal.globals.flags;
        const catalog = globalThis.nethackGlobal.characterCatalog;
        const role = catalog?.roles.find(({ fileCode }) => fileCode === "Tou");
        const race = catalog?.races.find(({ fileCode }) => fileCode === "Hum");
        const gender = catalog?.genders.find(
          ({ fileCode }) => fileCode === "Mal",
        );
        const alignment = catalog?.alignments.find(
          ({ fileCode }) => fileCode === "Neu",
        );
        selectedCharacterFixture = { role, race, gender, alignment };
        f.initrole = role?.index ?? -1;
        f.initrace = race?.index ?? -1;
        f.initgend = gender?.index ?? -1;
        f.initalign = alignment?.index ?? -1;
      }
      return false;

    case "shim_askname":
      if (globalThis.nethackGlobal?.globals?.svp) {
        globalThis.nethackGlobal.globals.svp.plname = "TestPlayer";
      }
      return undefined;

    case "shim_settings_sync": {
      commandBoundaryGeneration += 1;
      callbackEvent.boundaryGeneration = commandBoundaryGeneration;
      runtimeSettingsSnapshots.push(args[0] >>> 0);
      const update = queuedRuntimeSettings;
      queuedRuntimeSettings = 0;
      return update;
    }

    case "shim_settings_result":
      runtimeSettingsResults.push({
        success: args[0],
        snapshot: args[1] >>> 0,
      });
      return undefined;

    case "shim_command_sync": {
      const boundaryGeneration = Number(args[0]);
      const requestPtr = Number(args[1]);
      if (Number.isInteger(boundaryGeneration) && boundaryGeneration > 0) {
        callbackEvent.commandBoundaryGeneration = boundaryGeneration;
        publishedBoundaryGenerations.push(boundaryGeneration);
      }
      const payload = queuedCoreCommand;
      queuedCoreCommand = null;
      if (payload === null) return 0;
      callbackEvent.payload = [...payload];
      if (activeModule && Number.isInteger(requestPtr) && requestPtr > 0) {
        activeModule.setValue(requestPtr, payload[0], "i32");
        activeModule.setValue(requestPtr + 4, payload[1], "i32");
        activeModule.setValue(requestPtr + 8, payload[2], "i32");
        return 1;
      }
      // Keep the old scalar callback harmless so a stale runtime can finish
      // and report the missing v2 behavior through assertions.
      return 0;
    }

    case "shim_command_result": {
      const result = {
        payload: [args[0] >>> 0, args[1] >>> 0, args[2] >>> 0],
        success: Number(args[3]),
        eventIndex: eventCount,
        boundaryGeneration: commandBoundaryGeneration,
      };
      callbackEvent.payload = [...result.payload];
      callbackEvent.success = result.success;
      callbackEvent.boundaryGeneration = result.boundaryGeneration;
      coreCommandResults.push(result);
      return undefined;
    }

    case "shim_nhgetch": {
      const inputState = Number(args[0]);
      inputStates.push(inputState);
      callbackEvent.inputState = inputState;
      return new Promise((resolve) => {
        setPendingInput({
          name,
          inputState,
          eventIndex: eventCount,
          resolve,
        });
      });
    }

    case "shim_nh_poskey": {
      const inputState = Number(args[3]);
      inputStates.push(inputState);
      callbackEvent.inputState = inputState;
      return new Promise((resolve) => {
        setPendingInput({
          name,
          inputState,
          eventIndex: eventCount,
          resolve,
        });
      });
    }

    case "shim_print_glyph":
      glyphEvents.push({
        x: Number(args[1]),
        y: Number(args[2]),
        foreground: readGlyphInfo(Number(args[3])),
        background: readGlyphInfo(Number(args[4])),
      });
      return undefined;

    case "shim_status_enablefield":
      statusFieldMetadataEvents.push({
        field: Number(args[0]),
        name: activeModule.UTF8ToString(Number(args[1])),
        format: activeModule.UTF8ToString(Number(args[2])),
        enabled: Boolean(args[3]),
      });
      return undefined;

    case "shim_status_update":
      statusUpdateEvents.push({
        field: Number(args[0]),
        percent: Number(args[3]),
      });
      return undefined;

    case "shim_start_menu": {
      const windowId = Number(args[0]);
      const behavior = Number(args[1]) >>> 0;
      callbackEvent.windowId = windowId;
      callbackEvent.behavior = behavior;
      activeMenus.set(windowId, {
        behavior,
        itemCount: 0,
        selectableItemCount: 0,
        items: [],
      });
      if ((behavior & MENU_BEHAVE_PERMINV) !== 0) {
        permanentInventoryUpdates.push({ kind: "start", windowId });
      }
      return undefined;
    }

    case "shim_add_menu": {
      const windowId = Number(args[0]);
      const identifier = Number(args[2]);
      const menu = activeMenus.get(windowId);
      callbackEvent.windowId = windowId;
      callbackEvent.identifier = identifier;
      callbackEvent.accelerator = Number(args[3]) & 0xff;
      if (menu) {
        menu.itemCount += 1;
        menu.items.push({
          identifier,
          accelerator: Number(args[3]) & 0xff,
          glyph: readGlyphInfo(Number(args[1]))?.glyph ?? null,
        });
        if (identifier !== 0) menu.selectableItemCount += 1;
      }
      if (permanentInventoryUpdates.some(
        (event) => event.kind === "start" && event.windowId === windowId,
      )) {
        permanentInventoryUpdates.push({
          kind: "item",
          windowId,
          text: String(args[7] ?? ""),
        });
      }
      return undefined;
    }

    case "shim_select_menu": {
      const windowId = Number(args[0]);
      const how = Number(args[1]);
      const menu = activeMenus.get(windowId);
      const selection = {
        windowId,
        how,
        behavior: menu?.behavior ?? null,
        itemCount: menu?.itemCount ?? 0,
        selectableItemCount: menu?.selectableItemCount ?? 0,
        provenance: Number(args[3]) === 1 ? "action-getobj" : "none",
        requestNonce: Number(args[4]) >>> 0,
        menuGeneration: Number(args[5]) >>> 0,
        eventIndex: eventCount,
        response: "cancel",
      };
      callbackEvent.windowId = windowId;
      callbackEvent.how = how;
      callbackEvent.behavior = selection.behavior;
      callbackEvent.itemCount = selection.itemCount;
      callbackEvent.selectableItemCount = selection.selectableItemCount;
      callbackEvent.provenance = selection.provenance;
      callbackEvent.requestNonce = selection.requestNonce;
      callbackEvent.menuGeneration = selection.menuGeneration;
      if (Number(args[2]) !== 0) {
        activeModule.setValue(Number(args[2]), 0, "*");
      }
      if (how === PICK_NONE) {
        selection.response = "none";
        callbackEvent.response = selection.response;
        menuSelections.push(selection);
        permanentInventoryUpdates.push({
          kind: "commit",
          windowId,
        });
        return 0;
      }
      const menuResponse = activeCommandResponses?.menuResponses.shift()
        ?? "cancel";
      if (menuResponse === "first") {
        const targetGlyph = activeCommandResponses?.menuItemGlyphs.shift();
        const selectedCount = selectMenuItem(
          menu,
          Number(args[2]),
          targetGlyph,
        );
        if (selectedCount > 0) {
          selection.response = "first";
          callbackEvent.response = selection.response;
          menuSelections.push(selection);
          return selectedCount;
        }
      }
      callbackEvent.response = selection.response;
      menuSelections.push(selection);
      return -1; // cancel/dismiss
    }

    case "shim_message_menu":
      callbackEvent.how = Number(args[1]);
      callbackEvent.response = Number(args[1]) === PICK_NONE ? 0 : ESCAPE;
      return callbackEvent.response;

    case "shim_doprev_message":
      return 0;

    case "shim_get_ext_cmd": {
      const selection = queuedExtendedCommand;
      queuedExtendedCommand = null;
      callbackEvent.sourceIndex = selection;
      return selection ?? -1;
    }

    case "shim_getlin":
      if (activeCommandResponses && activeModule && Number(args[1]) !== 0) {
        activeModule.setValue(Number(args[1]), ESCAPE, "i8");
        activeModule.setValue(Number(args[1]) + 1, 0, "i8");
        callbackEvent.cancelled = true;
      }
      return undefined;

    case "shim_getmsghistory":
    case "shim_get_color_string":
      return "";

    default:
      return undefined;
  }
}

globalThis.blissCallback = blissCallback;

/* ------------------------------------------------------------------ */
/*  Main test sequence                                                 */
/* ------------------------------------------------------------------ */

async function run() {
  console.log("=== BlissHack WASM Integration Test ===\n");

  // --- Pre-checks ---
  console.log("--- Pre-checks ---");
  assert(existsSync(WASM_JS), "nethack.js exists");
  assert(existsSync(WASM_BIN), "nethack.wasm exists");
  assert(existsSync(WINSHIM_SOURCE), "winshim.c exists");
  assert(existsSync(CMD_SOURCE), "cmd.c exists");
  assert(existsSync(HACK_SOURCE), "hack.c exists");
  assert(existsSync(LOCK_SOURCE), "lock.c exists");
  assert(existsSync(DO_SOURCE), "do.c exists");
  assert(existsSync(INVENT_SOURCE), "invent.c exists");
  assert(existsSync(SAVE_SOURCE), "save.c exists");
  assert(existsSync(TILE_SOURCE), "tile.c exists");
  assert(existsSync(LIBNH_MAIN_SOURCE), "libnhmain.c exists");
  if (
    !existsSync(WASM_JS)
    || !existsSync(WASM_BIN)
    || !existsSync(WINSHIM_SOURCE)
    || !existsSync(CMD_SOURCE)
    || !existsSync(HACK_SOURCE)
    || !existsSync(LOCK_SOURCE)
    || !existsSync(DO_SOURCE)
    || !existsSync(INVENT_SOURCE)
    || !existsSync(SAVE_SOURCE)
    || !existsSync(TILE_SOURCE)
    || !existsSync(LIBNH_MAIN_SOURCE)
  ) {
    console.error(
      "\nMissing WASM or source files. Build with `make CROSS_TO_WASM=1` first.",
    );
    process.exit(1);
  }
  const winshimSource = readFileSync(WINSHIM_SOURCE, "utf8");
  const cmdSource = readFileSync(CMD_SOURCE, "utf8");
  const hackSource = readFileSync(HACK_SOURCE, "utf8");
  const lockSource = readFileSync(LOCK_SOURCE, "utf8");
  const inventSource = readFileSync(INVENT_SOURCE, "utf8");
  const saveSource = readFileSync(SAVE_SOURCE, "utf8");
  const tileSource = readFileSync(TILE_SOURCE, "utf8");
  const libnhMainSource = readFileSync(LIBNH_MAIN_SOURCE, "utf8");
  const getdirBlock = cBlockAfter(
    cmdSource,
    /\nint\s*\ngetdir\s*\(\s*const char \*s\s*\)\s*/,
  );
  const getobjBlock = cBlockAfter(
    inventSource,
    /\nstruct obj \*\ngetobj\s*\([^;{}]*\)\s*/,
  );
  const ynFunctionWrapper = cBlockAfter(
    winshimSource,
    /\nchar\s*\nshim_yn_function\s*\([^;{}]*\)\s*/,
  );
  const selectMenuWrapper = cBlockAfter(
    winshimSource,
    /\nint\s*\nshim_select_menu\s*\([^;{}]*\)\s*/,
  );
  const characterCatalogInit = cBlockAfter(
    libnhMainSource,
    /\njs_character_catalog_init\s*\(\s*void\s*\)\s*/,
  );
  const actionCatalogInit = cBlockAfter(
    libnhMainSource,
    /\njs_action_catalog_init\s*\(\s*void\s*\)\s*/,
  );
  assert(
    /\binitoptions\s*\(\s*\)\s*;\s*#ifdef __EMSCRIPTEN__\s*js_character_catalog_init\s*\(\s*\)\s*;/.test(
      libnhMainSource,
    )
      && characterCatalogInit !== null
      && /\bvalidrace\s*\(/.test(characterCatalogInit)
      && /\bvalidgend\s*\(/.test(characterCatalogInit)
      && /\bvalidalign\s*\(/.test(characterCatalogInit),
    "character catalog is copied after options and counts core-valid tuples",
  );
  assert(
    characterCatalogInit !== null
      && /\bmonnum_to_glyph\s*\([^,]+,\s*MALE\s*\)/.test(
        characterCatalogInit,
      )
      && /\bmonnum_to_glyph\s*\([^,]+,\s*FEMALE\s*\)/.test(
        characterCatalogInit,
      )
      && [...characterCatalogInit.matchAll(/\bmap_glyphinfo\s*\(/g)].length
        === 2,
    "character previews use the initialized authoritative glyph map",
  );
  assert(
    /\binitoptions\s*\(\s*\)\s*;[\s\S]*?\bjs_action_catalog_init\s*\(\s*\)\s*;/.test(
      libnhMainSource,
    )
      && actionCatalogInit !== null
      && /\bextcmdlist\b/.test(actionCatalogInit)
      && /\bWIZMODECMD\b/.test(actionCatalogInit)
      && /\bCMD_NOT_AVAILABLE\b/.test(actionCatalogInit)
      && /\bINTERNALCMD\b/.test(actionCatalogInit)
      && /\bMOVEMENTCMD\b/.test(actionCatalogInit)
      && /\bnethackGlobal\.actionCatalog\b/.test(libnhMainSource)
      && /\bschemaVersion\s*:\s*1\b/.test(libnhMainSource)
      && /\bsessionCommandId\b/.test(libnhMainSource)
      && /\bdefaultKey\b/.test(libnhMainSource),
    "libnh copies a versioned filtered action catalog after options setup",
  );
  assert(
    getdirBlock !== null
      && /\bprogram_state\.input_state\s*=\s*getdirInp\s*;[\s\S]*?\byn_function\s*\(/.test(
        getdirBlock,
      ),
    "getdir marks getdirInp before invoking the unrestricted yn callback",
  );
  assert(
    ynFunctionWrapper !== null
      && /\bprogram_state\.input_state\b/.test(ynFunctionWrapper)
      && /\blocal_callback\s*\([\s\S]*?"shim_yn_function"[\s\S]*?\binput_state\b/.test(
        ynFunctionWrapper,
      ),
    "WASM yn_function copies the complete input_state to TypeScript",
  );
  assert(
    selectMenuWrapper !== null
      && /\bshim_action_getobj_provenance\b/.test(selectMenuWrapper)
      && /\bshim_action_getobj_request_nonce\b/.test(selectMenuWrapper)
      && /\bshim_menu_generation\b/.test(selectMenuWrapper)
      && /\blocal_callback\s*\([\s\S]*?"shim_select_menu"/.test(
        selectMenuWrapper,
      ),
    "select_menu copies provenance, request nonce, and menu generation",
  );
  assert(
    getobjBlock !== null
      && /\bshim_action_getobj_begin\s*\(\s*\)\s*;[\s\S]*?\bdisplay_pickinv\s*\([\s\S]*?\bshim_action_getobj_end\s*\(\s*\)\s*;/.test(
        getobjBlock,
      ),
    "getobj scopes action-menu provenance to the core candidate menu call",
  );
  assert(
    getobjBlock !== null
      && /\bdisplay_pickinv\s*\([^;]*?\baction_getobj\b[^;]*?\)\s*;/.test(
        getobjBlock,
      )
      && /\bn\s*==\s*1\s*&&\s*!force_menu\b/.test(inventSource),
    "action-owned getobj forces even a single candidate through select_menu",
  );
  assert(
    /\bCREATE_READONLY_GLOBAL\s*\(\s*program_state\.gameover\s*,\s*"b"\s*\)\s*;/.test(
      libnhMainSource,
    )
      && /\bObject\.defineProperty\s*\(\s*obj\s*,\s*prop\s*,\s*\{[\s\S]*?\bget\s*:[\s\S]*?\benumerable\s*:\s*true[\s\S]*?\}\s*\)\s*;/.test(
        libnhMainSource,
      ),
    "game-over state is exposed through a read-only typed global",
  );
  const statusWrapper = cBlockAfter(
    winshimSource,
    /\bshim_status_enablefield\s*\([^;{}]*\)\s*/,
  );
  const statusPercent = cBlockAfter(
    winshimSource,
    /\bshim_status_percent\s*\([^;{}]*\)\s*/,
  );
  const shimProcs = cBlockAfter(
    winshimSource,
    /\bstruct\s+window_procs\s+shim_procs\s*=\s*/,
  );
  assert(
    statusWrapper !== null
      && /\bgenl_status_enablefield\s*\(/.test(statusWrapper),
    "shim_status_enablefield preserves genl status bookkeeping",
  );
  assert(
    shimProcs !== null
      && /\bgenl_status_finish\s*,\s*shim_status_enablefield\s*,/.test(
        shimProcs,
      ),
    "shim_procs registers the status metadata wrapper",
  );
  assert(
    statusPercent !== null
      && /\bcase\s+BL_XP\s*:\s*if\s*\(\s*!flags\.showexp\s*\|\|\s*u\.ulevel\s*>=\s*MAXULEV\s*\)\s*return\s+-1\s*;/.test(
        statusPercent,
      ),
    "shim_status_percent hides XP progress when showexp is disabled"
      + " or the character is at maximum level",
  );
  const commandSync = cBlockAfter(
    winshimSource,
    /\nstatic\s+int\s*\nshim_command_sync\s*\([^;{}]*\)\s*/,
  );
  const commandResult = cBlockAfter(
    winshimSource,
    /\nstatic\s+void\s*\nshim_command_result\s*\([^;{}]*\)\s*/,
  );
  const commandQueue = cBlockAfter(
    winshimSource,
    /\nstatic\s+boolean\s*\nshim_queue_command\s*\([^;{}]*\)\s*/,
  );
  const getNhEvent = cBlockAfter(
    winshimSource,
    /\nvoid\s*\nshim_get_nh_event\s*\([^;{}]*\)\s*/,
  );
  assert(
    /#define\s+SHIM_COMMAND_VERSION\s+2U\b/.test(winshimSource)
      && /#define\s+SHIM_COMMAND_VERSION_SHIFT\s+28\b/.test(winshimSource)
      && /#define\s+SHIM_COMMAND_VERSION_MASK\s+\(7U\s*<<\s*SHIM_COMMAND_VERSION_SHIFT\)/.test(
        winshimSource,
      ),
    "winshim command protocol uses the v2 version field",
  );
  assert(
    commandQueue !== null
      && /\b(?:payload|header)\s*&\s*~SHIM_COMMAND_DEFINED_MASK\b/.test(
        commandQueue,
      )
      && /\bversion\s*!=\s*SHIM_COMMAND_VERSION\b/.test(commandQueue)
      && />=\s*extcmdlist_length\b/.test(commandQueue)
      && /\bextcmdlist\b/.test(commandQueue)
      && /!entry->ef_funct\b/.test(commandQueue)
      && [
        "INTERNALCMD",
        "WIZMODECMD",
        "CMD_NOT_AVAILABLE",
        "MOVEMENTCMD",
        "CMD_PARAM",
      ]
        .every((flag) => commandQueue.includes(flag))
      && /\bcmdq_add_ec\s*\(\s*CQ_CANNED\s*,\s*entry->ef_funct\s*\)/.test(
        commandQueue,
      ),
    "winshim v2 rejects unknown bits, versions, IDs, functions, and flags"
      + " before queueing a catalog command through CQ_CANNED",
  );
  assert(
    commandSync !== null
      && /\bcommand_boundary_generation\b/.test(commandSync)
      && /\bheader\b/.test(commandSync)
      && /\brequest_nonce\b/.test(commandSync)
      && /\bargument\b/.test(commandSync)
      && getNhEvent !== null
      && [...getNhEvent.matchAll(/\bshim_command_sync\s*\(/g)].length === 1
      && [...getNhEvent.matchAll(/\bshim_queue_command\s*\(/g)].length === 1
      && [...getNhEvent.matchAll(/\bshim_command_result\s*\(/g)].length === 1
      && [...winshimSource.matchAll(/\bshim_queue_command\s*\(/g)].length === 2,
    "one shim_get_nh_event boundary consumes and reports at most one request",
  );
  assert(
    commandResult !== null
      && /\bheader\b/.test(commandResult)
      && /\brequest_nonce\b/.test(commandResult)
      && /\bargument\b/.test(commandResult)
      && /\bsuccess\b/.test(commandResult)
      && /\bshim_command_reset\b/.test(winshimSource)
      && /\bcommand_boundary_generation\b/.test(winshimSource),
    "winshim reports exact request identity and resets request and generation state",
  );
  const thereCommandMenu = cBlockAfter(
    cmdSource,
    /\nstaticfn\s+int\s*\ndotherecmdmenu\s*\(\s*void\s*\)\s*/,
  );
  const clickToCommand = cBlockAfter(
    cmdSource,
    /\nvoid\s*\nclick_to_cmd\s*\([^;{}]*\)\s*/,
  );
  const clickLook = cBlockAfter(
    cmdSource,
    /\nstaticfn\s+int\s*\ndoclicklook\s*\(\s*void\s*\)\s*/,
  );
  const actOnAction = cBlockAfter(
    cmdSource,
    /\nstaticfn\s+void\s*\nact_on_act\s*\([^;{}]*\)\s*/,
  );
  const mouseAction = cBlockAfter(
    cmdSource,
    /\nstaticfn\s+int\s*\ndomouseaction\s*\(\s*void\s*\)\s*/,
  );
  const travelCommandBranch = mouseAction === null
    ? null
    : cBlockAfter(
      mouseAction,
      /\bif\s*\(\s*flags\.travelcmd\s*\)\s*/,
    );
  const distantTravelTarget = travelCommandBranch === null
    ? null
    : cBlockAfter(
      travelCommandBranch,
      /\bif\s*\(\s*abs\s*\(\s*x\s*\)\s*<=\s*1\s*&&\s*abs\s*\(\s*y\s*\)\s*<=\s*1\s*\)\s*\{[^{}]*\}\s*else\s*/,
    );
  const blockedMouseTarget = travelCommandBranch === null
    ? null
    : cBlockAfter(
      travelCommandBranch,
      /\bif\s*\(\s*!m_at\s*\(\s*u\.ux\s*\+\s*x\s*,\s*u\.uy\s*\+\s*y\s*\)\s*&&\s*!test_move\s*\(\s*u\.ux\s*,\s*u\.uy\s*,\s*x\s*,\s*y\s*,\s*TEST_MOVE\s*\)\s*\)\s*/,
    );
  const blockedDoorTarget = blockedMouseTarget === null
    ? null
    : cBlockAfter(
      blockedMouseTarget,
      /\bif\s*\(\s*IS_DOOR\s*\([^)]*\)\s*&&\s*\([^{};]*D_LOCKED[^{};]*D_CLOSED[^{};]*\)\s*\)\s*/,
    );
  const blockedHiddenTarget = blockedMouseTarget === null
    ? null
    : cBlockAfter(
      blockedMouseTarget,
      /\bif\s*\(\s*levl\[u\.ux\s*\+\s*x\]\[u\.uy\s*\+\s*y\]\.typ\s*<=\s*SCORR\s*\)\s*/,
    );
  const kickDoorCase = actOnAction?.match(
    /\bcase\s+MCMD_KICK_DOOR\s*:\s*([\s\S]*?)\bbreak\s*;/,
  )?.[1] ?? null;
  const setMoveCommand = cBlockAfter(
    cmdSource,
    /\nvoid\s*\nset_move_cmd\s*\([^;{}]*\)\s*/,
  );
  const commandDispatcher = cBlockAfter(
    cmdSource,
    /\nvoid\s*\nrhack\s*\([^;{}]*\)\s*/,
  );
  const moveCore = cBlockAfter(
    hackSource,
    /\nstaticfn\s+void\s*\ndomove_core\s*\(\s*void\s*\)\s*/,
  );
  const testMove = cBlockAfter(
    hackSource,
    /\nboolean\s*\ntest_move\s*\([^;{}]*\)\s*/,
  );
  const openInDirection = cBlockAfter(
    lockSource,
    /\nint\s*\ndoopen_indir\s*\([^;{}]*\)\s*/,
  );
  assert(
    commandQueue !== null
      && /\bcmdq_add_ec\s*\(\s*CQ_CANNED\s*,/.test(commandQueue)
      && commandDispatcher !== null
      && /\bcan_do_extcmd\s*\(\s*tlist\s*\)/.test(commandDispatcher),
    "catalog commands enter CQ_CANNED and retain rhack availability checks",
  );
  assert(
    clickToCommand !== null
      && /\bgc\.clicklook_cc\.x\s*=\s*x\s*;[\s\S]*?\bgc\.clicklook_cc\.y\s*=\s*y\s*;/.test(
        clickToCommand,
      )
      && /\bef_funct\s*==\s*dotherecmdmenu\b[\s\S]*?\biflags\.getdir_click\s*=\s*mod\s*;[\s\S]*?\bcmdq_add_ec\s*\(\s*CQ_CANNED\s*,\s*gc\.Cmd\.mousebtn\[mod-1\]->ef_funct\s*\)/.test(
        clickToCommand,
      ),
    "click_to_cmd preserves the real modifier for a bound therecmdmenu",
  );
  assert(
    thereCommandMenu !== null
      && /\bclick\s*=\s*iflags\.getdir_click\s*;/.test(thereCommandMenu)
      && /\bclick\s*!=\s*CLICK_1\s*&&\s*click\s*!=\s*CLICK_2\b[\s\S]*?\bclick\s*=\s*CLICK_1\s*;/.test(
        thereCommandMenu,
      )
      && /\bthere_cmd_menu\s*\(\s*x\s*,\s*y\s*,\s*click\s*\)/.test(
        thereCommandMenu,
      )
      && /\bgc\.clicklook_cc\.x\s*=\s*gc\.clicklook_cc\.y\s*=\s*-1\s*;[\s\S]*?\biflags\.getdir_click\s*=\s*0\s*;/.test(
        thereCommandMenu,
      ),
    "therecmdmenu consumes the modifier and clears its stored click request",
  );
  const clickLookReset = clickLook?.indexOf(
    "gc.clicklook_cc.x = gc.clicklook_cc.y = -1;",
  ) ?? -1;
  const clickLookValidation = clickLook?.indexOf("if (!isok(x, y))") ?? -1;
  const clickLookDescription = clickLook?.indexOf("auto_describe(x, y);") ?? -1;
  assert(
    clickLook !== null
      && /\bcoordxy\s+x\s*=\s*gc\.clicklook_cc\.x\s*,\s*y\s*=\s*gc\.clicklook_cc\.y\s*;/.test(
        clickLook,
      )
      && clickLookReset >= 0
      && clickLookReset < clickLookValidation
      && clickLookValidation < clickLookDescription,
    "clicklook clears stale coordinates before validation and uses local copies",
  );
  assert(
    mouseAction !== null
      && blockedMouseTarget !== null
      && /\bdir\s*=\s*xytodir\s*\(\s*x\s*,\s*y\s*\)\s*;/.test(mouseAction)
      && blockedDoorTarget !== null
      && /\bcmdq_add_ec\s*\(\s*CQ_CANNED\s*,\s*move_funcs\[dir\]\[MV_WALK\]\s*\)\s*;/.test(
        blockedDoorTarget,
      )
      && !/\bcmdq_add_ec\s*\(\s*CQ_CANNED\s*,\s*(?:dokick|doopen)\s*\)\s*;/.test(
        blockedDoorTarget,
      ),
    "mouseaction queues blocked adjacent doors as directional walks"
      + " without direct open or kick commands",
  );
  const blockedTargetIndex = travelCommandBranch?.indexOf(
    blockedMouseTarget ?? "",
  ) ?? -1;
  const travelBranchIndex = mouseAction?.indexOf(
    travelCommandBranch ?? "",
  ) ?? -1;
  const finalWalkIndex = mouseAction?.lastIndexOf(
    "cmdq_add_ec(CQ_CANNED, move_funcs[dir][MV_WALK]);",
  ) ?? -1;
  const occupiedTargetTail = blockedTargetIndex < 0
    ? null
    : travelCommandBranch?.slice(
      blockedTargetIndex + (blockedMouseTarget?.length ?? 0),
    ) ?? null;
  assert(
    mouseAction !== null
      && travelCommandBranch !== null
      && blockedMouseTarget !== null
      && /\bif\s*\(\s*!m_at\s*\(/.test(travelCommandBranch)
      && blockedTargetIndex >= 0
      && occupiedTargetTail !== null
      && !/\b(?:return|cmdq_add_)\b/.test(occupiedTargetTail)
      && travelBranchIndex >= 0
      && finalWalkIndex > travelBranchIndex + travelCommandBranch.length,
    "mouseaction leaves occupied adjacent targets on the final attack walk",
  );
  assert(
    blockedHiddenTarget !== null
      && /\bcmdq_add_ec\s*\(\s*CQ_CANNED\s*,\s*dosearch\s*\)\s*;/.test(
        blockedHiddenTarget,
      ),
    "mouseaction preserves searching for blocked stone and secret corridors",
  );
  assert(
    distantTravelTarget !== null
      && /\biflags\.travelcc\.x\s*=\s*u\.tx\s*=\s*u\.ux\s*\+\s*x\s*;[\s\S]*?\biflags\.travelcc\.y\s*=\s*u\.ty\s*=\s*u\.uy\s*\+\s*y\s*;[\s\S]*?\bcmdq_add_ec\s*\(\s*CQ_CANNED\s*,\s*dotravel_target\s*\)\s*;/.test(
        distantTravelTarget,
      ),
    "mouseaction preserves travel for non-adjacent primary clicks",
  );
  assert(
    kickDoorCase !== null
      && /\bcmdq_add_ec\s*\(\s*CQ_CANNED\s*,\s*dokick\s*\)\s*;/.test(
        kickDoorCase,
      )
      && /\bcmdq_add_dir\s*\(\s*CQ_CANNED\s*,\s*dx\s*,\s*dy\s*,\s*0\s*\)\s*;/.test(
        kickDoorCase,
      ),
    "therecmdmenu keeps explicit door kicks directional",
  );
  assert(
    setMoveCommand !== null
      && /\bgd\.domove_attempting\s*\|=\s*\(\s*!run\s*\?\s*DOMOVE_WALK\s*:\s*DOMOVE_RUSH\s*\)\s*;/.test(
        setMoveCommand,
      )
      && commandDispatcher !== null
      && /\bgd\.domove_attempting\s*&\s*DOMOVE_WALK\b[\s\S]*?\bdomove\s*\(\s*\)\s*;/.test(
        commandDispatcher,
      )
      && moveCore !== null
      && /\btest_move\s*\(\s*u\.ux\s*,\s*u\.uy\s*,\s*x\s*-\s*u\.ux\s*,\s*y\s*-\s*u\.uy\s*,\s*DO_MOVE\s*\)/.test(
        moveCore,
      )
      && testMove !== null
      && /\bclosed_door\s*\(\s*x\s*,\s*y\s*\)[\s\S]*?\bflags\.autoopen\b[\s\S]*?\bdoopen_indir\s*\(\s*x\s*,\s*y\s*\)/.test(
        testMove,
      )
      && openInDirection !== null
      && /\blocked\s*&&\s*flags\.autounlock\b/.test(openInDirection),
    "directional walking reaches the core autoopen and autounlock path",
  );
  if (process.env.BLISSHACK_SOURCE_CONTRACT_ONLY === "1") {
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
  }

  // --- Module loading ---
  console.log("\n--- Module loading ---");
  const factory = (await import(WASM_JS)).default;
  assert(typeof factory === "function", "WASM factory is a function");

  const module = await factory({
    noInitialRun: true,
    preRun: (runtimeModule) => {
      runtimeModule.ENV.USER = "";
      runtimeModule.ENV.LOGNAME = "";
    },
    print: () => {},
    printErr: () => {},
  });
  activeModule = module;
  assert(typeof module.ccall === "function", "module.ccall exists");
  assert(typeof module.FS === "object", "module.FS exists");

  // --- Runtime settings file before main ---
  console.log("\n--- Runtime settings file before main ---");
  const runtimeRc = [
    "OPTIONS=!autopickup",
    "OPTIONS=pickup_types:$?!",
    "OPTIONS=number_pad:1",
    "OPTIONS=safe_pet",
    "OPTIONS=sortpack",
    "OPTIONS=showexp",
    "OPTIONS=time",
    "OPTIONS=perminv_mode:all",
    "OPTIONS=perm_invent",
    "OPTIONS=!tutorial",
    "",
  ].join("\n");
  module.FS.writeFile(
    "/home/web_user/.nethackrc",
    new TextEncoder().encode(runtimeRc),
  );
  assert(
    module.FS.readFile(
      "/home/web_user/.nethackrc",
      { encoding: "utf8" },
    ) === runtimeRc,
    "runtime .nethackrc is readable before main",
  );
  const runtimeSysconf = module.FS.readFile("/sysconf", { encoding: "utf8" });
  assert(
    /^PERS_IS_UID=0$/m.test(runtimeSysconf)
      && !/^PERS_IS_UID=1$/m.test(runtimeSysconf),
    "embedded runtime sysconf ranks browser players by name",
  );
  if (!module.FS.analyzePath("/save").exists) {
    module.FS.mkdir("/save");
  }

  // --- Stage-two save helpers before main ---
  console.log("\n--- Save helpers before main ---");
  module.ccall(
    "shim_graphics_set_restore_required",
    null,
    ["number"],
    [0],
  );
  assert(true, "shim_graphics_set_restore_required is exported");
  module.ccall(
    "shim_graphics_set_player_name",
    null,
    ["string"],
    [""],
  );
  assert(true, "shim_graphics_set_player_name is exported");
  const metadataPtr = module._malloc(256);
  const fingerprintSize = module.ccall(
    "shim_graphics_get_save_fingerprint",
    "number",
    ["number", "number"],
    [metadataPtr, 256],
  );
  module._free(metadataPtr);
  assert(
    fingerprintSize > 0 && fingerprintSize < 256,
    "shim_graphics_get_save_fingerprint works before main",
  );

  // --- Callback registration ---
  console.log("\n--- Callback registration ---");
  module.ccall("shim_graphics_set_callback", null, ["string"], ["blissCallback"]);
  assert(true, "shim_graphics_set_callback succeeded");

  // --- Game startup ---
  console.log("\n--- Game startup ---");
  receivedEventNames.clear();
  receivedEvents.length = 0;
  callbackEvents.length = 0;
  eventCount = 0;
  eventsWithoutInput = 0;
  commandBoundaryGeneration = 0;
  numberPadStates.length = 0;
  ynPrompts.length = 0;
  rawMessages.length = 0;
  windowMessages.length = 0;
  inputStates.length = 0;
  runtimeSettingsSnapshots.length = 0;
  runtimeSettingsResults.length = 0;
  glyphEvents.length = 0;
  statusFieldMetadataEvents.length = 0;
  statusUpdateEvents.length = 0;
  coreCommandResults.length = 0;
  publishedBoundaryGenerations.length = 0;
  menuSelections.length = 0;
  activeMenus.clear();
  activeWindows.clear();
  queuedRuntimeSettings = 0;
  queuedCoreCommand = null;
  queuedExtendedCommand = null;
  activeCommandResponses = null;
  selectedCharacterFixture = null;

  const gamePromise = module.ccall("main", "number", [], [], { async: true });
  gamePromise.catch(() => {});

  // Wait for the game to reach the first input prompt.
  const TIMEOUT_MS = 15000;
  await waitForPendingInput(TIMEOUT_MS);

  // --- Startup event verification ---
  console.log(
    `\n--- Startup events (${eventCount} total, ${receivedEventNames.size} unique) ---`
  );
  assert(receivedEventNames.has("shim_init_nhwindows"), "received shim_init_nhwindows");
  assert(receivedEventNames.has("shim_askname"), "received shim_askname");
  assert(receivedEventNames.has("shim_create_nhwindow"), "received shim_create_nhwindow");
  assert(
    receivedEventNames.has("shim_player_selection_or_tty"),
    "received shim_player_selection_or_tty"
  );
  assert(receivedEventNames.has("shim_print_glyph"), "received shim_print_glyph (map render)");
  assert(
    receivedEventNames.has("shim_status_enablefield"),
    "received shim_status_enablefield metadata callback",
  );
  assert(
    statusFieldMetadataEvents.some(
      (event) =>
        event.field === 18
        && event.name === "hitpoints"
        && event.format === " HP:%s"
        && event.enabled,
    ),
    "received enabled hitpoints field metadata from the core",
  );
  assert(receivedEventNames.has("shim_status_update"), "received shim_status_update");
  const startupEnergyStatus = statusUpdateEvents.findLast(
    (event) => event.field === 11,
  );
  const startupExperienceStatus = statusUpdateEvents.findLast(
    (event) => event.field === 13,
  );
  const startupHitpointStatus = statusUpdateEvents.findLast(
    (event) => event.field === 18,
  );
  assert(
    startupEnergyStatus?.percent === 100,
    "initial Energy status reports 100 percent when current equals maximum",
  );
  assert(
    startupHitpointStatus?.percent === 100,
    "initial HP status reports 100 percent when current equals maximum",
  );
  assert(
    startupExperienceStatus !== undefined
      && startupExperienceStatus.percent >= 0
      && startupExperienceStatus.percent <= 100,
    "initial XP status reports a percentage in the range 0..100",
  );
  assert(
    receivedEvents.indexOf("shim_askname")
      < receivedEvents.indexOf("shim_player_selection_or_tty"),
    "asked for the player name before role selection"
  );
  assert(
    numberPadStates.includes(1),
    "number_pad from runtime .nethackrc reached the window port",
  );
  assert(
    globalThis.nethackGlobal?.globals?.flags?.showexp === true,
    "showexp from runtime .nethackrc reached NetHack globals",
  );
  assert(
    globalThis.nethackGlobal?.globals?.flags?.time === true,
    "time from runtime .nethackrc reached NetHack globals",
  );
  assert(
    globalThis.nethackGlobal?.globals?.shim_restore_required === false,
    "restore-only guard is exposed as a typed global",
  );
  const gameoverDescriptor = Object.getOwnPropertyDescriptor(
    globalThis.nethackGlobal?.globals?.program_state ?? {},
    "gameover",
  );
  assert(
    globalThis.nethackGlobal?.globals?.program_state?.gameover === false
      && typeof gameoverDescriptor?.get === "function"
      && gameoverDescriptor?.set === undefined,
    "game-over state is exposed as a read-only live boolean",
  );
  globalThis.nethackGlobal.globals.shim_restore_required = true;
  assert(
    globalThis.nethackGlobal.globals.shim_restore_required === true,
    "restore-only guard typed global accepts pending-safe writes",
  );
  globalThis.nethackGlobal.globals.shim_restore_required = false;
  assert(
    permanentInventoryUpdates.some((event) => event.kind === "start")
      && permanentInventoryUpdates.some((event) => event.kind === "item")
      && permanentInventoryUpdates.some((event) => event.kind === "commit"),
    "perm_invent creates, populates, and commits a persistent inventory menu",
  );
  assert(
    selectedCharacterFixture?.role?.fileCode === "Tou"
      && selectedCharacterFixture?.race?.fileCode === "Hum"
      && selectedCharacterFixture?.gender?.fileCode === "Mal"
      && selectedCharacterFixture?.alignment?.fileCode === "Neu",
    "command characterization uses the deterministic Tourist fixture",
  );

  // --- Character catalog ---
  console.log("\n--- Character catalog ---");
  const characterCatalog = globalThis.nethackGlobal.characterCatalog;
  assert(
    characterCatalog?.schemaVersion === 1
      && characterCatalog.roles.length > 0
      && characterCatalog.races.length > 0
      && characterCatalog.genders.length > 0
      && characterCatalog.alignments.length > 0,
    "WASM exposes a non-empty versioned character catalog",
  );
  const characterOptions = [
    ...characterCatalog.roles,
    ...characterCatalog.races,
    ...characterCatalog.genders,
    ...characterCatalog.alignments,
  ];
  assert(
    characterOptions.every(
      (option) =>
        Number.isInteger(option.index)
        && typeof option.name === "string"
        && option.name.length > 0
        && typeof option.fileCode === "string"
        && option.fileCode.length > 0
        && [...option.accelerator].length === 1
        && Number.isInteger(option.allow),
    )
      && [
        characterCatalog.roles,
        characterCatalog.races,
        characterCatalog.genders,
        characterCatalog.alignments,
      ].every((options) =>
        options.every((option, index) => option.index === index)),
    "character options have complete fields and contiguous indices",
  );
  assert(
    characterCatalog.roles.every(
      (role) =>
        Number.isInteger(role.maleGlyph)
        && Number.isInteger(role.femaleGlyph)
        && Number.isInteger(role.maleTileIndex)
        && Number.isInteger(role.femaleTileIndex)
        && role.maleTileIndex >= 0
        && role.maleTileIndex <= MAX_ATLAS_TILE_INDEX
        && role.femaleTileIndex >= 0
        && role.femaleTileIndex <= MAX_ATLAS_TILE_INDEX,
    ),
    "every role preview uses valid male and female glyph and tile indices",
  );
  const characterTuples = buildCharacterTuples(characterCatalog);
  assert(
    characterTuples.length === characterCatalog.legalTupleCount
      && new Set(characterTuples.map((tuple) =>
        `${tuple.role}:${tuple.race}:${tuple.gender}:${tuple.alignment}`))
        .size === characterTuples.length,
    "compatibility masks enumerate every core-counted legal tuple once",
  );

  // --- Action command catalog ---
  console.log("\n--- Action command catalog ---");
  const allCommands = readAllWasmCommands(module);
  const visibleCommands = readVisibleWasmCommands(module);
  const actionCommands = visibleCommands.filter(
    ({ flags }) => (flags & MOVEMENTCMD) === 0,
  );
  const movementCommands = visibleCommands.filter(
    ({ flags }) => (flags & MOVEMENTCMD) !== 0,
  );
  const copiedActionCatalog = globalThis.nethackGlobal.actionCatalog;
  const copiedActionCommands = Array.isArray(copiedActionCatalog?.commands)
    ? copiedActionCatalog.commands
    : [];
  assert(
    copiedActionCatalog?.schemaVersion === 1
      && copiedActionCommands.length === 104,
    "WASM exposes a versioned copied action catalog with 104 commands",
  );
  assert(
    JSON.stringify(copiedActionCommands) === JSON.stringify(
      actionCommands.map(({ sourceIndex, name, defaultKey, flags }) => ({
        sessionCommandId: sourceIndex,
        name,
        defaultKey,
        flags,
      })),
    ),
    "copied action catalog matches authoritative extcmd values and order",
  );
  assert(
    copiedActionCommands.length === 104
      && new Set(copiedActionCommands.map(({ sessionCommandId }) =>
        sessionCommandId)).size === copiedActionCommands.length
      && new Set(copiedActionCommands.map(({ name }) => name)).size
        === copiedActionCommands.length
      && copiedActionCommands.every(
        ({ sessionCommandId, name, defaultKey, flags }) =>
          Number.isInteger(sessionCommandId)
          && sessionCommandId >= 0
          && sessionCommandId < 1024
          && typeof name === "string"
          && name.length > 0
          && Number.isInteger(defaultKey)
          && defaultKey >= 0
          && defaultKey <= 0xff
          && Number.isInteger(flags)
          && (flags & ~KNOWN_COMMAND_FLAGS) === 0
          && (
            flags
            & (WIZMODECMD | CMD_NOT_AVAILABLE | INTERNALCMD | MOVEMENTCMD)
          ) === 0,
      ),
    "copied action catalog has unique IDs and names, bounded keys and flags,"
      + " and excludes restricted and movement commands",
  );
  const copiedToggle = copiedActionCommands.find(({ name }) => name === "toggle");
  assert(
    copiedToggle !== undefined
      && (copiedToggle.flags & CMD_PARAM) !== 0
      && copiedToggle.defaultKey === 0,
    "toggle remains visible in the catalog with CMD_PARAM and no bare key",
  );
  assert(
    actionCommands.length === 104
      && JSON.stringify(actionCommands.map(({ name }) => name))
        === JSON.stringify(EXPECTED_ACTION_COMMAND_NAMES),
    "WASM exposes the expected 104 non-directional player commands in order",
  );
  assert(
    movementCommands.length === 24
      && JSON.stringify(movementCommands.map(({ name }) => name))
        === JSON.stringify(EXPECTED_MOVEMENT_COMMAND_NAMES),
    "WASM exposes the expected 24 directional movement commands for exclusion",
  );
  assert(
    visibleCommands.length === 128
      && new Set(visibleCommands.map(({ name }) => name)).size === 128
      && actionCommands.every(({ flags }) => (flags & MOVEMENTCMD) === 0)
      && movementCommands.every(({ flags }) => (flags & MOVEMENTCMD) !== 0),
    "action and excluded movement catalogs are unique and partition all visible commands",
  );

  // --- glyph_info ABI and tile mapping ---
  console.log("\n--- glyph_info ABI and tile mapping ---");
  const foregroundGlyphs = glyphEvents
    .map((event) => event.foreground)
    .filter((glyph) => glyph !== null);
  const capturedGlyphs = glyphEvents.flatMap((event) =>
    [event.foreground, event.background].filter((glyph) => glyph !== null)
  );
  const glyphConstants = globalThis.nethackGlobal.constants.GLYPH;
  const mgConstants = globalThis.nethackGlobal.constants.MG;
  const expensiveCameraObjectIndex = Number(
    tileSource.match(/expensive camera \(onum=(\d+)\)/)?.[1],
  );
  const expensiveCameraGlyph = glyphConstants.GLYPH_OBJ_OFF
    + expensiveCameraObjectIndex;
  const unexploredGlyphs = foregroundGlyphs.filter(
    (glyph) =>
      glyph.glyph === glyphConstants.GLYPH_UNEXPLORED
      || (glyph.glyphFlags & mgConstants.MG_UNEXPL) !== 0,
  );
  const nulGlyphInfo = readGlyphInfo(
    globalThis.nethackGlobal.pointers.nul_glyphinfo,
  );
  const ordinaryGlyphs = glyphEvents
    .filter((event) => event.x > 0)
    .map((event) => event.foreground)
    .filter(
      (glyph) =>
        glyph !== null
        && glyph.glyph >= 0
        && glyph.glyph !== glyphConstants.GLYPH_UNEXPLORED
        && (glyph.glyphFlags & mgConstants.MG_UNEXPL) === 0,
    );
  const linearCmapGlyphs = ordinaryGlyphs.filter((glyph) => {
    const cmapOffset = glyph.glyph - glyphConstants.GLYPH_CMAP_OFF;
    return cmapOffset >= 0 && cmapOffset <= LAST_LINEAR_CMAP_OFFSET;
  });
  console.log(
    `  INFO: ${capturedGlyphs.length} glyph records, `
      + `${new Set(capturedGlyphs.map((glyph) => glyph.tileIndex)).size} tiles, `
      + `${new Set(ordinaryGlyphs.map((glyph) => glyph.glyph)).size} ordinary glyphs, `
      + `${new Set(ordinaryGlyphs.map((glyph) => glyph.ttyChar)).size} tty chars, `
      + `${new Set(ordinaryGlyphs.map((glyph) => glyph.symbolIndex)).size} symbols`,
  );

  assert(capturedGlyphs.length > 0, "captured glyph_info callback data");
  assert(
    capturedGlyphs.every(
      (glyph) =>
        Number.isInteger(glyph.tileIndex)
        && glyph.tileIndex >= 0
        && glyph.tileIndex <= MAX_ATLAS_TILE_INDEX,
    ),
    "all captured tile indices fit the atlas range 0..2306",
  );
  assert(
    new Set(capturedGlyphs.map((glyph) => glyph.tileIndex)).size >= 2,
    "captured tile indices have reasonable map diversity",
  );
  assert(
    unexploredGlyphs.length > 0
      && unexploredGlyphs.every(
        (glyph) => glyph.tileIndex === UNEXPLORED_TILE_INDEX,
      ),
    "unexplored glyphs use the atlas unexplored tile",
  );
  assert(
    ordinaryGlyphs.length > 0
      && ordinaryGlyphs.some((glyph) => glyph.tileIndex !== 0),
    "ordinary map glyphs are not all mapped to tile zero",
  );
  assert(
    linearCmapGlyphs.length >= 2
      && linearCmapGlyphs.every(
        (glyph) =>
          glyph.tileIndex
          === FIRST_OTHER_TILE_INDEX
            + glyph.glyph
            - glyphConstants.GLYPH_CMAP_OFF,
      ),
    "ordinary cmap glyphs match the official atlas mapping",
  );
  assert(
    nulGlyphInfo?.glyph === glyphConstants.NO_GLYPH
      && nulGlyphInfo.tileIndex === UNEXPLORED_TILE_INDEX,
    "nul_glyphinfo uses the atlas unexplored tile",
  );
  assert(
    capturedGlyphs.every(
      (glyph) =>
        Number.isInteger(glyph.glyph)
        && (
          glyph.glyph === glyphConstants.NO_GLYPH
          || (glyph.glyph >= 0 && glyph.glyph < glyphConstants.MAX_GLYPH)
        )
        && Number.isInteger(glyph.ttyChar)
        && Number.isInteger(glyph.frameColor)
        && Number.isInteger(glyph.glyphFlags)
        && Number.isInteger(glyph.color)
        && Number.isInteger(glyph.symbolIndex)
        && Number.isInteger(glyph.customColor)
        && Number.isInteger(glyph.color256)
        && Number.isInteger(glyph.unicodePointer)
        && glyph.color256 >= 0
        && glyph.color256 <= 0xffff
        && glyph.unicodePointer % 4 === 0,
    ),
    "other fields retain the 36-byte WASM32 glyph_info ABI",
  );
  assert(
    glyphConstants.GLYPH_INFO_SIZE === 36,
    "glyph_info keeps its WASM32 ABI size",
  );
  assert(
    Number.isInteger(expensiveCameraObjectIndex),
    "generated tile metadata identifies the Tourist camera object glyph",
  );
  assert(
    new Set(ordinaryGlyphs.map((glyph) => glyph.glyph)).size >= 2
      && new Set(ordinaryGlyphs.map((glyph) => glyph.ttyChar)).size >= 2
      && new Set(ordinaryGlyphs.map((glyph) => glyph.symbolIndex)).size >= 2,
    "glyph, tty character, and symbol index remain meaningfully varied",
  );

  // --- Input handling ---
  console.log("\n--- Input handling ---");
  assert(pendingInput !== null, "game is waiting for input (shim_nh_poskey blocked)");
  assert(
    inputStates.includes(1),
    "input callback identifies the top-level command state",
  );

  if (pendingInput) {
    const countBefore = eventCount;
    const experienceUpdatesBeforeCommand = statusUpdateEvents.filter(
      (event) => event.field === 13,
    ).length;
    const searchCommand = actionCommands.find(({ name }) => name === "search");
    if (!searchCommand) throw new Error("Search command metadata is missing");
    await runExtendedCommand(searchCommand);
    assert(
      eventCount > countBefore,
      `game processed input (${eventCount - countBefore} new events)`
    );
    const experienceUpdatesAfterCommand = statusUpdateEvents.filter(
      (event) => event.field === 13,
    );
    assert(
      experienceUpdatesAfterCommand.length > experienceUpdatesBeforeCommand,
      "status flush after an ordinary command re-emits BL_XP progress"
        + ` (${experienceUpdatesBeforeCommand}`
        + ` -> ${experienceUpdatesAfterCommand.length}; recent fields `
        + `${statusUpdateEvents.slice(-12).map(({ field }) => field).join(",")})`,
    );
    const refreshedExperienceStatus = experienceUpdatesAfterCommand
      .slice(experienceUpdatesBeforeCommand)
      .at(-1);
    assert(
      refreshedExperienceStatus !== undefined
        && refreshedExperienceStatus.percent >= 0
        && refreshedExperienceStatus.percent <= 100,
      "re-emitted BL_XP progress remains in the range 0..100",
    );
  }

  // --- Representative command behavior ---
  console.log("\n--- Representative command behavior ---");
  const actionCommandsByName = new Map(
    actionCommands.map((command) => [command.name, command]),
  );
  const representativeNames = [
    "#",
    "apply",
    "cast",
    "eat",
    "fight",
    "inventory",
    "kick",
    "save",
    "search",
    "throw",
    "toggle",
    "travel",
    "wield",
  ];
  const representativeCommands = Object.fromEntries(
    representativeNames.map((name) => [name, actionCommandsByName.get(name)]),
  );
  if (
    representativeNames.some((name) => !representativeCommands[name])
  ) {
    throw new Error("Representative command metadata is incomplete");
  }
  assert(
    representativeNames.every((name) =>
      Number.isInteger(representativeCommands[name].sourceIndex))
      && representativeCommands["#"].defaultKey === EXTENDED_COMMAND_KEY
      && representativeCommands.search.defaultKey === "s".charCodeAt(0)
      && representativeCommands.inventory.defaultKey === "i".charCodeAt(0)
      && representativeCommands.eat.defaultKey === "e".charCodeAt(0)
      && representativeCommands.wield.defaultKey === "w".charCodeAt(0)
      && representativeCommands.apply.defaultKey === "a".charCodeAt(0)
      && representativeCommands.throw.defaultKey === "t".charCodeAt(0)
      && representativeCommands.kick.defaultKey === 4
      && representativeCommands.travel.defaultKey === "_".charCodeAt(0)
      && representativeCommands.save.defaultKey === "S".charCodeAt(0),
    "representative commands retain their real WASM source IDs and keys",
  );

  // --- Core command protocol v2 ---
  console.log("\n--- Core command protocol v2 ---");
  const dropCommand = actionCommandsByName.get("drop");
  const internalCommand = allCommands.find(
    ({ flags }) => (flags & INTERNALCMD) !== 0,
  );
  const wizardCommand = allCommands.find(
    ({ flags }) => (flags & WIZMODECMD) !== 0,
  );
  const unavailableCommand = allCommands.find(
    ({ flags }) => (flags & CMD_NOT_AVAILABLE) !== 0,
  );
  const movementCommand = allCommands.find(
    ({ flags }) => (flags & MOVEMENTCMD) !== 0,
  );
  if (!dropCommand) throw new Error("Drop command metadata is missing");
  if (!movementCommand) throw new Error("Movement command metadata is missing");
  assert(
    internalCommand !== undefined && wizardCommand !== undefined,
    "real extcmdlist exposes internal and wizard IDs for rejection tests",
  );

  const validSearchPayload = catalogCommandPayload(
    representativeCommands.search.sourceIndex,
    101,
  );
  const rejectedRequests = [
    {
      label: "unknown header bit",
      payload: [
        (validSearchPayload[0] | CORE_COMMAND_UNKNOWN_BIT) >>> 0,
        102,
        validSearchPayload[2],
      ],
    },
    {
      label: "unknown protocol version",
      payload: [
        ((3 << 28) | CORE_COMMAND_CATALOG) >>> 0,
        103,
        validSearchPayload[2],
      ],
    },
    {
      label: "zero nonce",
      payload: catalogCommandPayload(
        representativeCommands.search.sourceIndex,
        0,
      ),
    },
    {
      label: "out-of-range command ID",
      payload: catalogCommandPayload(1024, 104),
    },
    {
      label: "internal command ID",
      payload: catalogCommandPayload(internalCommand?.sourceIndex ?? 1024, 105),
    },
    {
      label: "wizard command ID",
      payload: catalogCommandPayload(wizardCommand?.sourceIndex ?? 1024, 106),
    },
    {
      label: "CMD_PARAM command ID",
      payload: catalogCommandPayload(
        representativeCommands.toggle.sourceIndex,
        107,
      ),
    },
    {
      label: "MOVEMENTCMD command ID",
      payload: catalogCommandPayload(movementCommand.sourceIndex, 108),
    },
    ...(unavailableCommand
      ? [{
        label: "unavailable command ID",
        payload: catalogCommandPayload(unavailableCommand.sourceIndex, 109),
      }]
      : []),
  ];
  for (const { label, payload } of rejectedRequests) {
    const resultsBefore = coreCommandResults.length;
    const menusBefore = menuSelections.length;
    const rejectedTrace = await runCoreCommand(payload);
    const result = coreCommandResults.slice(resultsBefore).at(-1);
    assert(
      coreCommandResults.length === resultsBefore + 1
        && result !== undefined
        && sameCoreCommandPayload(result.payload, payload)
        && result.success === 0,
      `real WASM rejects ${label} and returns its exact three-word identity`,
    );
    assert(
      menuSelections.length === menusBefore
        && !traceHas(rejectedTrace, "shim_get_ext_cmd"),
      `${label} does not dispatch a command or enter a core menu`,
    );
  }

  const searchResultsBefore = coreCommandResults.length;
  const searchXpUpdatesBefore = statusUpdateEvents.filter(
    (event) => event.field === 13,
  ).length;
  const coreSearchTrace = await runCoreCommand(validSearchPayload);
  const searchResult = coreCommandResults.slice(searchResultsBefore).at(-1);
  const searchResultIndex = coreSearchTrace.findIndex(
    (event) =>
      event.name === "shim_command_result"
      && sameCoreCommandPayload(event.payload ?? [], validSearchPayload),
  );
  const searchCompletionBoundary = coreSearchTrace.findIndex(
    (event, index) =>
      index > searchResultIndex
      && event.boundaryGeneration !== undefined,
  );
  assert(
    searchResult !== undefined
      && sameCoreCommandPayload(searchResult.payload, validSearchPayload)
      && searchResult.success === 1
      && !traceHas(coreSearchTrace, "shim_get_ext_cmd")
      && searchResultIndex >= 0
      && searchCompletionBoundary > searchResultIndex
      && statusUpdateEvents.filter((event) => event.field === 13).length
        > searchXpUpdatesBefore,
    "search executes from a v2 catalog request through CQ_CANNED",
  );

  const inventoryPayload = catalogCommandPayload(
    representativeCommands.inventory.sourceIndex,
    109,
  );
  const inventoryResultsBefore = coreCommandResults.length;
  const inventoryMenusBefore = menuSelections.length;
  const coreInventoryTrace = await runCoreCommand(inventoryPayload);
  const inventoryResult = coreCommandResults
    .slice(inventoryResultsBefore)
    .at(-1);
  const inventorySelector = menuSelections
    .slice(inventoryMenusBefore)
    .find(
      (selection) =>
        selection.behavior === MENU_BEHAVE_STANDARD
        && selection.how === PICK_ONE
        && selection.selectableItemCount > 0,
    );
  assert(
    inventoryResult !== undefined
      && sameCoreCommandPayload(inventoryResult.payload, inventoryPayload)
      && inventoryResult.success === 1
      && !traceHas(coreInventoryTrace, "shim_get_ext_cmd"),
    "inventory executes from a v2 catalog request through CQ_CANNED",
  );
  assert(
    inventorySelector !== undefined
      && inventoryResult !== undefined
      && inventoryResult.eventIndex < inventorySelector.eventIndex,
    "v2 inventory reports acceptance before its real PICK_ONE menu",
  );

  const dropPayload = catalogCommandPayload(
    dropCommand.sourceIndex,
    110,
    true,
  );
  const dropResultsBefore = coreCommandResults.length;
  const dropMenusBefore = menuSelections.length;
  const coreDropTrace = await runCoreCommand(dropPayload);
  const dropResult = coreCommandResults.slice(dropResultsBefore).at(-1);
  const dropSelector = menuSelections.slice(dropMenusBefore).find(
    (selection) =>
      selection.behavior === MENU_BEHAVE_STANDARD
      && selection.how === PICK_ONE
      && selection.selectableItemCount > 0,
  );
  assert(
    dropResult !== undefined
      && sameCoreCommandPayload(dropResult.payload, dropPayload)
      && dropResult.success === 1
      && !traceHas(coreDropTrace, "shim_get_ext_cmd"),
    "drop executes from a v2 catalog request through CQ_CANNED",
  );
  assert(
    dropSelector !== undefined
      && dropResult !== undefined
      && dropResult.eventIndex < dropSelector.eventIndex,
    "v2 drop preserves the real request-menu inventory flow",
  );
  assert(
    dropSelector?.provenance === "action-getobj"
      && dropSelector.requestNonce === dropPayload[1]
      && Number.isInteger(dropSelector.menuGeneration)
      && dropSelector.menuGeneration > 0,
    "v2 drop identifies its core item menu with provenance, nonce, and generation",
  );
  assert(
    publishedBoundaryGenerations.length > 0
      && publishedBoundaryGenerations.every(
        (generation, index) =>
          Number.isInteger(generation)
          && generation > 0
          && (
            index === 0
            || generation > publishedBoundaryGenerations[index - 1]
          ),
      ),
    "WASM publishes strictly increasing nonzero command-boundary generations",
  );

  // Preserve the source-order contract here; the live save flow runs last
  // because successful save terminates the shared Asyncify runtime.
  const saveCommandBlock = cBlockAfter(
    saveSource,
    /\nint\s*\ndosave\s*\(\s*void\s*\)\s*/,
  );
  const saveConfirmIndex = saveCommandBlock?.indexOf("y_n(") ?? -1;
  const saveWriteIndex = saveCommandBlock?.indexOf("dosave0()") ?? -1;
  const saveSourceDisplayIndex = saveCommandBlock?.indexOf(
    "display_nhwindow(WIN_MESSAGE, TRUE)",
  ) ?? -1;
  const saveSourceExitIndex = saveCommandBlock?.indexOf(
    "exit_nhwindows(",
  ) ?? -1;
  const saveTerminateIndex = saveCommandBlock?.indexOf(
    "nh_terminate(EXIT_SUCCESS)",
  ) ?? -1;
  assert(
    representativeCommands.save.defaultKey === "S".charCodeAt(0)
      && saveCommandBlock !== null
      && saveConfirmIndex >= 0
      && saveWriteIndex > saveConfirmIndex
      && saveSourceDisplayIndex > saveWriteIndex
      && saveSourceExitIndex > saveSourceDisplayIndex
      && saveTerminateIndex > saveSourceExitIndex,
    "save combines live WASM metadata with confirm, write, blocking display,"
      + " window exit, and termination source order",
  );

  const pickerMarker = {
    startIndex: callbackEvents.length,
    boundaryGeneration: commandBoundaryGeneration,
  };
  queuedExtendedCommand = null;
  activeCommandResponses = {
    ynResponses: [],
    unrestrictedYnResponses: [],
    menuResponses: [],
  };
  resolvePendingInput(EXTENDED_COMMAND_KEY);
  const pickerTrace = await finishExtendedCommand(pickerMarker);
  assert(
    pickerTrace.some(
      (event) =>
        event.name === "shim_get_ext_cmd" && event.sourceIndex === null,
    )
      && traceHasBoundary(pickerTrace),
    "# cancellation passes through get_ext_cmd and returns at a new boundary",
  );

  const searchTrace = await runExtendedCommand(
    representativeCommands.search,
  );
  assert(
    traceHas(searchTrace, "shim_get_ext_cmd")
      && traceHasBoundary(searchTrace)
      && !traceHas(searchTrace, "shim_yn_function")
      && !traceHas(searchTrace, "shim_select_menu")
      && !searchTrace.some(
        (event) =>
          event.inputState !== undefined
          && event.inputState !== INPUT_STATE_COMMAND,
      ),
    "search completes directly between two structured command boundaries",
  );

  const inventoryTrace = await runExtendedCommand(
    representativeCommands.inventory,
  );
  assert(
    inventoryTrace.some(
      (event) =>
        event.name === "shim_select_menu"
        && event.behavior === MENU_BEHAVE_STANDARD
        && event.how === PICK_ONE
        && event.selectableItemCount > 0,
    )
      && traceHasBoundary(inventoryTrace),
    "inventory exposes a standard PICK_ONE action menu before its boundary",
  );

  const itemCommandCases = [
    { name: "eat", menuResponse: "cancel", reachesDirection: false },
    { name: "wield", menuResponse: "cancel", reachesDirection: false },
    {
      name: "apply",
      menuResponse: "first",
      menuItemGlyph: expensiveCameraGlyph,
      reachesDirection: true,
    },
    { name: "throw", menuResponse: "first", reachesDirection: true },
  ];
  for (const itemCase of itemCommandCases) {
    const itemTrace = await runExtendedCommand(
      representativeCommands[itemCase.name],
      {
        unrestrictedYnResponses: itemCase.reachesDirection
          ? ["?".charCodeAt(0), ESCAPE]
          : ["?".charCodeAt(0)],
        menuResponses: [itemCase.menuResponse],
        menuItemGlyphs: itemCase.menuItemGlyph === undefined
          ? []
          : [itemCase.menuItemGlyph],
      },
    );
    const itemPromptIndex = itemTrace.findIndex(
      (event) =>
        event.name === "shim_yn_function"
        && event.choices === null
        && event.response === "?".charCodeAt(0),
    );
    const itemMenuIndex = itemTrace.findIndex(
      (event) =>
        event.name === "shim_select_menu"
        && event.behavior === MENU_BEHAVE_STANDARD
        && event.how === PICK_ONE
        && event.selectableItemCount > 0
        && event.response === itemCase.menuResponse,
    );
    assert(
      itemPromptIndex >= 0
        && itemMenuIndex > itemPromptIndex
        && traceHasBoundary(itemTrace),
      `${itemCase.name} exposes core-filtered PICK_ONE items and returns`
        + " at a new boundary",
    );
    if (itemCase.reachesDirection) {
      assert(
        itemTrace.findIndex(
          (event, index) =>
            index > itemMenuIndex
            && event.name === "shim_yn_function"
            && event.choices === null
            && event.inputState === INPUT_STATE_GETDIR
            && event.response === ESCAPE,
        ) > itemMenuIndex,
        `${itemCase.name} reaches the getdir-backed unrestricted input after`
          + " item selection",
      );
    }
  }

  const kickTrace = await runExtendedCommand(
    representativeCommands.kick,
    { unrestrictedYnResponses: [ESCAPE] },
  );
  assert(
    kickTrace.some(
      (event) =>
        event.name === "shim_yn_function"
        && event.choices === null
        && event.inputState === INPUT_STATE_GETDIR
        && event.response === ESCAPE,
    )
      && traceHasBoundary(kickTrace),
    "kick reaches the getdir-backed unrestricted input and supports"
      + " cancellation",
  );

  const travelTrace = await runExtendedCommand(
    representativeCommands.travel,
  );
  const travelPositionIndex = travelTrace.findIndex(
    (event) =>
      event.name === "shim_nh_poskey"
      && event.inputState === INPUT_STATE_GETPOS,
  );
  const travelBoundaryIndex = travelTrace.findIndex(
    (event, index) =>
      index > travelPositionIndex
      && event.boundaryGeneration !== undefined,
  );
  assert(
    travelPositionIndex >= 0
      && travelBoundaryIndex > travelPositionIndex
      && travelTrace.some(
        (event, index) =>
          index > travelBoundaryIndex
          && event.inputState === INPUT_STATE_COMMAND,
      ),
    "travel exposes getposInp and cancellation reaches a later boundary",
  );

  const toggleTrace = await runExtendedCommand(
    representativeCommands.toggle,
  );
  assert(
    (representativeCommands.toggle.flags & CMD_PARAM) !== 0
      && representativeCommands.toggle.defaultKey === 0
      && traceHas(toggleTrace, "shim_raw_print")
      && !traceHas(toggleTrace, "shim_select_menu")
      && !traceHas(toggleTrace, "shim_yn_function")
      && traceHasBoundary(toggleTrace),
    "toggle metadata requires a parameter and bare execution returns via core"
      + " feedback",
  );

  const prefixPayload = catalogCommandPayload(
    representativeCommands.fight.sourceIndex,
    111,
  );
  const prefixMarker = startCoreCommand(prefixPayload);
  const prefixContinuation = await waitForPendingInput(5000);
  const prefixTraceBeforeContinuation = commandTraceFrom(
    prefixMarker.startIndex,
  );
  const prefixResultIndex = prefixTraceBeforeContinuation.findIndex(
    (event) =>
      event.name === "shim_command_result"
      && sameCoreCommandPayload(event.payload ?? [], prefixPayload)
      && event.success === 1,
  );
  const prefixResult = prefixResultIndex < 0
    ? undefined
    : prefixTraceBeforeContinuation[prefixResultIndex];
  const prefixContinuationReady = (
    prefixResult !== undefined
    && prefixContinuation?.inputState === INPUT_STATE_COMMAND
    && commandBoundaryGeneration === prefixResult.boundaryGeneration
    && !prefixTraceBeforeContinuation.slice(prefixResultIndex + 1).some(
      (event) => event.boundaryGeneration !== undefined,
    )
  );
  assert(
    (representativeCommands.fight.flags & PREFIXCMD) !== 0
      && prefixContinuationReady,
    "v2 fight reports acceptance, then requests commandInp without advancing"
      + " the accepted boundary generation",
  );
  let prefixTrace = prefixTraceBeforeContinuation;
  if (prefixContinuationReady) {
    resolvePendingInput(ESCAPE);
    prefixTrace = await finishExtendedCommand(prefixMarker);
  } else {
    activeCommandResponses = null;
  }
  assert(
    prefixContinuationReady
      && commandBoundaryGeneration > prefixResult.boundaryGeneration
      && prefixTrace.at(-1)?.inputState === INPUT_STATE_COMMAND,
    "cancelling the PREFIXCMD continuation reaches the next command boundary",
  );

  const rejectedTrace = await runExtendedCommand(
    representativeCommands.cast,
  );
  const rejectedSelectionIndex = rejectedTrace.findIndex(
    (event) =>
      event.name === "shim_get_ext_cmd"
      && event.sourceIndex === representativeCommands.cast.sourceIndex,
  );
  const rejectedOutputIndex = rejectedTrace.findIndex(
    (event, index) =>
      index > rejectedSelectionIndex
      && (
        event.name === "shim_putstr"
        || event.name === "shim_raw_print"
      ),
  );
  assert(
    rejectedSelectionIndex >= 0
      && rejectedOutputIndex > rejectedSelectionIndex
      && !traceHas(rejectedTrace, "shim_select_menu")
      && !traceHas(rejectedTrace, "shim_yn_function")
      && !rejectedTrace.some(
        (event) => event.inputState === INPUT_STATE_OTHER,
      )
      && traceHasBoundary(rejectedTrace),
    "the spell-less Tourist rejection stays in core and returns directly",
  );

  // --- Runtime settings protocol ---
  console.log("\n--- Runtime settings protocol ---");
  const beforeInvalidUpdate = runtimeSettingsSnapshots.at(-1);
  queuedRuntimeSettings = (
    RUNTIME_SETTINGS_VERSION
    | RUNTIME_SETTINGS_PENDING
    | RUNTIME_SETTINGS_PICKUP_ALL
    | RUNTIME_SETTINGS_PERMINV_ALL
    | (1 << 31)
  ) >>> 0;
  const resultsBeforeInvalidUpdate = runtimeSettingsResults.length;
  await sendKeyAndWait(32);
  assert(
    runtimeSettingsResults.length === resultsBeforeInvalidUpdate + 1
      && runtimeSettingsResults.at(-1)?.success === 0,
    "C shim rejects a payload containing a reserved bit",
  );
  assert(
    runtimeSettingsResults.at(-1)?.snapshot === beforeInvalidUpdate,
    "rejected payload leaves the authoritative settings unchanged",
  );

  const dynamicSettings = (
    RUNTIME_SETTINGS_VERSION
    | RUNTIME_SETTINGS_PENDING
    | RUNTIME_SETTINGS_AUTOPICKUP
    | RUNTIME_SETTINGS_PICKUP_ALL
    | RUNTIME_SETTINGS_PERM_INVENT
    | RUNTIME_SETTINGS_PERMINV_ALL
  ) >>> 0;
  const appliedSettings = (
    dynamicSettings & ~RUNTIME_SETTINGS_PENDING
  ) >>> 0;
  queuedRuntimeSettings = dynamicSettings;
  const resultsBeforeUpdate = runtimeSettingsResults.length;
  await sendKeyAndWait(32);
  assert(
    runtimeSettingsResults.length === resultsBeforeUpdate + 1,
    "C shim reported one dynamic settings application result",
  );
  assert(
    runtimeSettingsResults.at(-1)?.success === 1,
    "C shim accepted the validated dynamic settings update",
  );
  assert(
    runtimeSettingsResults.at(-1)?.snapshot === appliedSettings,
    "C shim returned the authoritative post-application snapshot",
  );
  assert(
    globalThis.nethackGlobal?.globals?.flags?.showexp === false
      && globalThis.nethackGlobal?.globals?.flags?.time === false,
    "dynamic settings reached NetHack globals through parseoptions",
  );
  assert(
    !windowMessages.some((message) => /option toggled/i.test(message)),
    "dynamic settings application emits no interactive option messages",
  );

  const fullInventorySettings = (
    (appliedSettings & ~RUNTIME_SETTINGS_PERMINV_MODE_MASK)
    | RUNTIME_SETTINGS_PERMINV_FULL
  ) >>> 0;
  let commitsBeforeUpdate = permanentInventoryUpdates.filter(
    (event) => event.kind === "commit",
  ).length;
  queuedRuntimeSettings = (
    fullInventorySettings | RUNTIME_SETTINGS_PENDING
  ) >>> 0;
  await sendKeyAndWait(32);
  assert(
    runtimeSettingsResults.at(-1)?.success === 1
      && runtimeSettingsResults.at(-1)?.snapshot === fullInventorySettings,
    "runtime perminv_mode change is accepted",
  );
  assert(
    permanentInventoryUpdates.filter(
      (event) => event.kind === "commit",
    ).length > commitsBeforeUpdate,
    "runtime perminv_mode change republishes the permanent inventory",
  );

  const disabledInventorySettings = (
    fullInventorySettings & ~RUNTIME_SETTINGS_PERM_INVENT
  ) >>> 0;
  commitsBeforeUpdate = permanentInventoryUpdates.filter(
    (event) => event.kind === "commit",
  ).length;
  queuedRuntimeSettings = (
    disabledInventorySettings | RUNTIME_SETTINGS_PENDING
  ) >>> 0;
  await sendKeyAndWait(32);
  assert(
    runtimeSettingsResults.at(-1)?.success === 1
      && runtimeSettingsResults.at(-1)?.snapshot === disabledInventorySettings,
    "runtime permanent inventory disable is accepted",
  );
  assert(
    permanentInventoryUpdates.filter(
      (event) => event.kind === "commit",
    ).length === commitsBeforeUpdate,
    "disabling permanent inventory does not publish stale menu contents",
  );

  queuedRuntimeSettings = (
    fullInventorySettings | RUNTIME_SETTINGS_PENDING
  ) >>> 0;
  await sendKeyAndWait(32);
  assert(
    runtimeSettingsResults.at(-1)?.success === 1
      && runtimeSettingsResults.at(-1)?.snapshot === fullInventorySettings,
    "runtime permanent inventory re-enable is accepted",
  );
  assert(
    permanentInventoryUpdates.filter(
      (event) => event.kind === "commit",
    ).length > commitsBeforeUpdate,
    "runtime permanent inventory re-enable republishes its menu",
  );

  await sendKeyAndWait(64); // @ toggles autopickup
  assert(
    runtimeSettingsSnapshots.at(-1)
      === (fullInventorySettings & ~RUNTIME_SETTINGS_AUTOPICKUP) >>> 0,
    "native @ command is reflected by the next settings snapshot",
  );
  assert(
    !ynPrompts.some((query) => /tutorial/i.test(query)),
    "!tutorial skipped the tutorial query",
  );
  assert(
    !rawMessages.some(
      (message) =>
        /config|syntax|unknown option|bad option|unrecognized option/i.test(
          message,
        ),
    ),
    "generated runtime options produced no configuration error",
  );

  // --- Terminal save flow ---
  console.log("\n--- Terminal save flow ---");
  const saveMarker = startExtendedCommand(representativeCommands.save, {
    ynResponses: ["y".charCodeAt(0)],
  });
  const gameExit = await Promise.race([
    gamePromise.then(
      () => true,
      (error) =>
        typeof error === "object"
        && error !== null
        && "status" in error
        && error.status === 0,
    ),
    new Promise((resolve) => {
      setTimeout(() => resolve(false), 5000);
    }),
  ]);
  const saveTrace = commandTraceFrom(saveMarker.startIndex);
  const saveConfirmEvent = saveTrace.find(
    (event) =>
      event.name === "shim_yn_function"
      && event.response === "y".charCodeAt(0),
  );
  const saveDisplayIndex = saveTrace.findIndex(
    (event) =>
      event.name === "shim_display_nhwindow"
      && event.blocking === true,
  );
  const saveExitIndex = saveTrace.findIndex(
    (event, index) =>
      index > saveDisplayIndex
      && event.name === "shim_exit_nhwindows",
  );
  assert(
    saveConfirmEvent !== undefined
      && saveDisplayIndex >= 0
      && saveExitIndex > saveDisplayIndex
      && gameExit === true,
    "save confirms, performs its blocking display, exits windows, and"
      + " terminates the real WASM session",
  );
  assert(
    module.FS.analyzePath("/save/0TestPlayer").exists,
    "save writes the deterministic character to the formal save directory",
  );

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(1);
});

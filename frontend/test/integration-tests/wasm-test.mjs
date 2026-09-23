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
const receivedEventNames = new Set();
const receivedEvents = [];
let eventCount = 0;
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
const menuSelections = [];
const activeMenus = new Map();
let queuedRuntimeSettings = 0;
let queuedCoreCommand = 0;
let activeModule = null;

const RUNTIME_SETTINGS_VERSION = 2 << 28;
const RUNTIME_SETTINGS_PENDING = 1 << 0;
const RUNTIME_SETTINGS_AUTOPICKUP = 1 << 1;
const RUNTIME_SETTINGS_PICKUP_ALL = 1 << 6;
const RUNTIME_SETTINGS_PERM_INVENT = 1 << 25;
const RUNTIME_SETTINGS_PERMINV_ALL = 1 << 26;
const RUNTIME_SETTINGS_PERMINV_FULL = 2 << 26;
const RUNTIME_SETTINGS_PERMINV_MODE_MASK = 3 << 26;
const CORE_COMMAND_VERSION = 1 << 28;
const CORE_COMMAND_INVENTORY = 2;
const CORE_COMMAND_DROP = 3;
const CORE_COMMAND_RESERVED = (1 << 31) >>> 0;
const MENU_BEHAVE_PERMINV = 1;
const MENU_BEHAVE_STANDARD = 0;
const PICK_ONE = 1;
const MAX_ATLAS_TILE_INDEX = 2306;
const FIRST_OTHER_TILE_INDEX = 1272;
const LAST_LINEAR_CMAP_OFFSET = 32;
const UNEXPLORED_TILE_INDEX = 1469;
const EXTCMD_ENTRY_SIZE = 24;
const EXTCMD_TEXT_OFFSET = 4;
const EXTCMD_FLAGS_OFFSET = 16;
const WIZMODECMD = 0x0004;
const CMD_NOT_AVAILABLE = 0x0010;
const INTERNALCMD = 0x0040;
const MOVEMENTCMD = 0x0400;

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
 * Copy visible player commands from the current WASM extcmdlist.
 * @param {object} module - initialized Emscripten module.
 * @returns {Array<{sourceIndex: number, name: string, flags: number}>}
 * visible commands in authoritative source order.
 */
function readVisibleWasmCommands(module) {
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
    if ((flags & (WIZMODECMD | CMD_NOT_AVAILABLE | INTERNALCMD)) !== 0) {
      continue;
    }
    commands.push({
      sourceIndex,
      name: module.UTF8ToString(textPtr),
      flags,
    });
  }
  return commands;
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
 * Wait until the core reaches another keyboard-facing callback.
 * @param {number} timeoutMs - maximum time to wait.
 * @returns {Promise<boolean>} whether an input callback arrived.
 */
async function waitForPendingInput(timeoutMs) {
  const start = Date.now();
  while (!pendingInput && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return pendingInput !== null;
}

/**
 * Send one key to the blocked core and wait for its next input callback.
 * @param {number} key - NetHack input byte.
 * @returns {Promise<boolean>} whether the next input callback arrived.
 */
async function sendKeyAndWait(key) {
  const resolveInput = pendingInput;
  pendingInput = null;
  if (!resolveInput) return false;
  resolveInput(key);
  return waitForPendingInput(5000);
}

globalThis.nethackGlobal = globalThis.nethackGlobal || {};

async function blissCallback(name, ...args) {
  receivedEventNames.add(name);
  receivedEvents.push(name);
  eventCount++;

  if (eventCount > 10000 && !pendingInput) {
    console.error(
      `ABORT: 10000+ events without input prompt. Unique: ${[...receivedEventNames].join(", ")}`
    );
    process.exit(1);
  }

  if (name === "shim_yn_function") {
    ynCount++;
    ynPrompts.push(String(args[0] ?? ""));
    if (ynCount > 200) {
      console.error("ABORT: shim_yn_function called 200+ times (loop?)");
      process.exit(1);
    }
    const def = typeof args[2] === "number" && args[2] > 0 ? args[2] : 121;
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

    case "shim_create_nhwindow":
      return nextWindowId++;

    case "shim_player_selection_or_tty":
      if (globalThis.nethackGlobal?.globals?.flags) {
        const f = globalThis.nethackGlobal.globals.flags;
        f.initrole = -1; // ROLE_RANDOM
        f.initrace = -1;
        f.initgend = -1;
        f.initalign = -1;
      }
      return false;

    case "shim_askname":
      if (globalThis.nethackGlobal?.globals?.svp) {
        globalThis.nethackGlobal.globals.svp.plname = "TestPlayer";
      }
      return undefined;

    case "shim_settings_sync": {
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
      const command = queuedCoreCommand;
      queuedCoreCommand = 0;
      return command;
    }

    case "shim_command_result":
      coreCommandResults.push({
        payload: args[0] >>> 0,
        success: Number(args[1]),
        eventIndex: eventCount,
      });
      return undefined;

    case "shim_nhgetch":
      inputStates.push(args[0]);
      return new Promise((resolve) => {
        pendingInput = resolve;
      });

    case "shim_nh_poskey":
      inputStates.push(args[3]);
      return new Promise((resolve) => {
        pendingInput = resolve;
      });

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
      activeMenus.set(windowId, {
        behavior,
        itemCount: 0,
        selectableItemCount: 0,
      });
      if ((behavior & MENU_BEHAVE_PERMINV) !== 0) {
        permanentInventoryUpdates.push({ kind: "start", windowId });
      }
      return undefined;
    }

    case "shim_add_menu": {
      const windowId = Number(args[0]);
      const menu = activeMenus.get(windowId);
      if (menu) {
        menu.itemCount += 1;
        if (Number(args[2]) !== 0) menu.selectableItemCount += 1;
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
      menuSelections.push({
        windowId,
        how,
        behavior: menu?.behavior ?? null,
        itemCount: menu?.itemCount ?? 0,
        selectableItemCount: menu?.selectableItemCount ?? 0,
        eventIndex: eventCount,
      });
      if (args[1] === 0) {
        permanentInventoryUpdates.push({
          kind: "commit",
          windowId,
        });
        return 0;
      }
      return -1; // cancel/dismiss
    }
    case "shim_message_menu":
    case "shim_doprev_message":
      return 0;

    case "shim_get_ext_cmd":
      return -1;

    case "shim_getlin":
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
  assert(existsSync(LIBNH_MAIN_SOURCE), "libnhmain.c exists");
  if (
    !existsSync(WASM_JS)
    || !existsSync(WASM_BIN)
    || !existsSync(WINSHIM_SOURCE)
    || !existsSync(CMD_SOURCE)
    || !existsSync(HACK_SOURCE)
    || !existsSync(LOCK_SOURCE)
    || !existsSync(DO_SOURCE)
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
  const doSource = readFileSync(DO_SOURCE, "utf8");
  const libnhMainSource = readFileSync(LIBNH_MAIN_SOURCE, "utf8");
  const characterCatalogInit = cBlockAfter(
    libnhMainSource,
    /\njs_character_catalog_init\s*\(\s*void\s*\)\s*/,
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
  const allowlistedCommands = commandQueue === null
    ? []
    : [...commandQueue.matchAll(
      /\bcase\s+(SHIM_COMMAND_[A-Z_]+)\s*:/g,
    )].map((match) => match[1]);
  assert(
    /#define\s+SHIM_COMMAND_VERSION\s+1U\b/.test(winshimSource)
      && /#define\s+SHIM_COMMAND_VERSION_SHIFT\s+28\b/.test(winshimSource)
      && /#define\s+SHIM_COMMAND_VERSION_MASK\s+\(7U\s*<<\s*SHIM_COMMAND_VERSION_SHIFT\)/.test(
        winshimSource,
      ),
    "winshim command protocol has the expected version field",
  );
  assert(
    JSON.stringify(allowlistedCommands) === JSON.stringify([
      "SHIM_COMMAND_CLICKLOOK",
      "SHIM_COMMAND_INVENTORY",
      "SHIM_COMMAND_DROP",
    ])
      && commandQueue !== null
      && /\bname\s*=\s*"clicklook"\s*;/.test(commandQueue)
      && /\bname\s*=\s*"inventory"\s*;/.test(commandQueue)
      && /\bname\s*=\s*"drop"\s*;/.test(commandQueue)
      && /\bdefault\s*:\s*return\s+FALSE\s*;/.test(commandQueue),
    "winshim command protocol allowlists only clicklook, inventory, and drop",
  );
  assert(
    commandQueue !== null
      && /\bpayload\s*&\s*~SHIM_COMMAND_DEFINED_MASK\b/.test(commandQueue)
      && /\bversion\s*!=\s*SHIM_COMMAND_VERSION\b/.test(commandQueue)
      && /\bSHIM_COMMAND_CLICKLOOK\b[\s\S]*?\bisok\s*\(\s*\(coordxy\)\s*x\s*,\s*\(coordxy\)\s*y\s*\)/.test(
        commandQueue,
      )
      && /\bSHIM_COMMAND_INVENTORY\b[\s\S]*?\bif\s*\(\s*x\s*\|\|\s*y\s*\)/.test(
        commandQueue,
      )
      && /\bSHIM_COMMAND_DROP\b[\s\S]*?\bif\s*\(\s*x\s*\|\|\s*y\s*\)/.test(
        commandQueue,
      )
      && /\bentry->flags\s*&\s*CMD_NOT_AVAILABLE\b/.test(commandQueue),
    "winshim rejects reserved bits, incompatible versions, invalid coordinates,"
      + " and unavailable commands",
  );
  assert(
    commandQueue !== null
      && /\bextcmdlist\b/.test(commandQueue)
      && /\bstrcmp\s*\(\s*entry->ef_txt\s*,\s*name\s*\)/.test(commandQueue)
      && /\bcmdq_add_ec\s*\(\s*CQ_CANNED\s*,\s*entry->ef_funct\s*\)/.test(
        commandQueue,
      ),
    "winshim resolves allowlisted names through authoritative command metadata",
  );
  assert(
    /\{\s*'d'\s*,\s*"drop"[\s\S]*?\bdodrop\s*,\s*CMD_M_PREFIX\b/.test(
      cmdSource,
    )
      && /\bif\s*\(\s*iflags\.menu_requested\s*\)\s*iflags\.force_invmenu\s*=\s*TRUE\s*;[\s\S]*?\bgetobj\s*\(\s*"drop"[\s\S]*?\biflags\.force_invmenu\s*=\s*save_force_invmenu\s*;/.test(
        doSource,
      )
      && commandQueue !== null
      && /\bcommand\s*==\s*SHIM_COMMAND_DROP\b[\s\S]*?\bcmdq_add_ec\s*\(\s*CQ_CANNED\s*,\s*do_reqmenu\s*\)[\s\S]*?\bcmdq_add_ec\s*\(\s*CQ_CANNED\s*,\s*entry->ef_funct\s*\)/.test(
        commandQueue,
      ),
    "browser drop queues a native request-menu flow through dodrop",
  );
  assert(
    commandSync !== null
      && /\brequest\s*=\s*0\s*;/.test(commandSync)
      && /\blocal_callback\s*\(\s*shim_callback_name\s*,\s*"shim_command_sync"\s*,[\s\S]*?"i"\s*,\s*NULL\s*\)/.test(
        commandSync,
      )
      && getNhEvent !== null
      && /\bcommand\s*=\s*\(unsigned int\)\s*shim_command_sync\s*\(\s*\)\s*;[\s\S]*?\baccepted\s*=\s*shim_queue_command\s*\(\s*command\s*\)\s*;[\s\S]*?\bshim_command_result\s*\(\s*\(int\)\s*command\s*,\s*accepted\s*\?\s*1\s*:\s*0\s*\)\s*;/.test(
        getNhEvent,
      )
      && [...winshimSource.matchAll(/\bshim_queue_command\s*\(/g)].length === 2,
    "winshim consumes at most one command only at shim_get_nh_event",
  );
  assert(
    commandResult !== null
      && /void\s*\*args\[\]\s*=\s*\{\s*&request\s*,\s*&success\s*\}\s*;/.test(
        commandResult,
      )
      && /\blocal_callback\s*\(\s*shim_callback_name\s*,\s*"shim_command_result"\s*,[\s\S]*?"vii"\s*,\s*args\s*\)/.test(
        commandResult,
      ),
    "winshim reports the exact command payload and acceptance result",
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
  eventCount = 0;
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
  menuSelections.length = 0;
  activeMenus.clear();
  queuedRuntimeSettings = 0;
  queuedCoreCommand = 0;

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
  const visibleCommands = readVisibleWasmCommands(module);
  const actionCommands = visibleCommands.filter(
    ({ flags }) => (flags & MOVEMENTCMD) === 0,
  );
  const movementCommands = visibleCommands.filter(
    ({ flags }) => (flags & MOVEMENTCMD) !== 0,
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
    await sendKeyAndWait(46); // ordinary wait command; cannot grant XP
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

  // --- Core command protocol ---
  console.log("\n--- Core command protocol ---");
  const invalidInventoryCommand = (
    CORE_COMMAND_VERSION
    | CORE_COMMAND_INVENTORY
    | CORE_COMMAND_RESERVED
  ) >>> 0;
  let commandResultsBefore = coreCommandResults.length;
  let menuSelectionsBefore = menuSelections.length;
  queuedCoreCommand = invalidInventoryCommand;
  await sendKeyAndWait(27);
  assert(
    coreCommandResults.length === commandResultsBefore + 1
      && coreCommandResults.at(-1)?.payload === invalidInventoryCommand
      && coreCommandResults.at(-1)?.success === 0,
    "real WASM callback rejects a command payload containing a reserved bit",
  );
  assert(
    menuSelections.length === menuSelectionsBefore,
    "rejected command payload does not enter a core menu",
  );

  const inventoryCommand = (
    CORE_COMMAND_VERSION | CORE_COMMAND_INVENTORY
  ) >>> 0;
  commandResultsBefore = coreCommandResults.length;
  menuSelectionsBefore = menuSelections.length;
  queuedCoreCommand = inventoryCommand;
  await sendKeyAndWait(27);
  const inventoryCommandResult = coreCommandResults.at(-1);
  const commandMenus = menuSelections.slice(menuSelectionsBefore);
  const inventorySelector = commandMenus.find(
    (selection) =>
      selection.behavior === MENU_BEHAVE_STANDARD
      && selection.how === PICK_ONE
      && selection.selectableItemCount > 0,
  );
  assert(
    coreCommandResults.length === commandResultsBefore + 1
      && inventoryCommandResult?.payload === inventoryCommand
      && inventoryCommandResult.success === 1,
    "real WASM callback accepts the versioned inventory command payload",
  );
  assert(
    inventorySelector !== undefined,
    "accepted inventory command enters an ordinary selectable core menu",
  );
  assert(
    inventorySelector !== undefined
      && inventoryCommandResult !== undefined
      && inventoryCommandResult.eventIndex < inventorySelector.eventIndex,
    "command result precedes the inventory select_menu callback",
  );

  const dropCommand = (CORE_COMMAND_VERSION | CORE_COMMAND_DROP) >>> 0;
  commandResultsBefore = coreCommandResults.length;
  menuSelectionsBefore = menuSelections.length;
  queuedCoreCommand = dropCommand;
  await sendKeyAndWait(27);
  const dropCommandResult = coreCommandResults.at(-1);
  const dropSelector = menuSelections.slice(menuSelectionsBefore).find(
    (selection) =>
      selection.behavior === MENU_BEHAVE_STANDARD
      && selection.how === PICK_ONE
      && selection.selectableItemCount > 0,
  );
  assert(
    coreCommandResults.length === commandResultsBefore + 1
      && dropCommandResult?.payload === dropCommand
      && dropCommandResult.success === 1,
    "real WASM callback accepts the versioned drop command payload",
  );
  assert(
    dropSelector !== undefined,
    "accepted drop command enters a native PICK_ONE inventory menu",
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

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(1);
});

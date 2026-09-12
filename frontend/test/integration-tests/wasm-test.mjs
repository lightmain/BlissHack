/**
 * Integration test: loads the NetHack WASM module in Node.js,
 * registers the minimal shim callback, starts the game, and
 * verifies that essential shim events are received and input
 * handling works end-to-end.
 *
 * Run: npm run test:integration
 *
 * Requires: frontend/public/nethack.js and nethack.wasm
 * (built via `make CROSS_TO_WASM=1` and copied to frontend/public/)
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = join(__dirname, "..", "..", "public");
const WASM_JS = join(WASM_DIR, "nethack.js");
const WASM_BIN = join(WASM_DIR, "nethack.wasm");

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
let queuedRuntimeSettings = 0;
let activeModule = null;

const RUNTIME_SETTINGS_VERSION = 2 << 28;
const RUNTIME_SETTINGS_PENDING = 1 << 0;
const RUNTIME_SETTINGS_AUTOPICKUP = 1 << 1;
const RUNTIME_SETTINGS_PICKUP_ALL = 1 << 6;
const RUNTIME_SETTINGS_PERM_INVENT = 1 << 25;
const RUNTIME_SETTINGS_PERMINV_ALL = 1 << 26;
const RUNTIME_SETTINGS_PERMINV_FULL = 2 << 26;
const RUNTIME_SETTINGS_PERMINV_MODE_MASK = 3 << 26;
const MAX_ATLAS_TILE_INDEX = 2306;

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

    case "shim_start_menu":
      if ((args[1] & 1) !== 0) {
        permanentInventoryUpdates.push({ kind: "start", windowId: args[0] });
      }
      return undefined;

    case "shim_add_menu":
      if (permanentInventoryUpdates.some(
        (event) => event.kind === "start" && event.windowId === args[0],
      )) {
        permanentInventoryUpdates.push({
          kind: "item",
          windowId: args[0],
          text: String(args[7] ?? ""),
        });
      }
      return undefined;

    case "shim_select_menu":
      if (args[1] === 0) {
        permanentInventoryUpdates.push({
          kind: "commit",
          windowId: args[0],
        });
        return 0;
      }
      return -1; // cancel/dismiss
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
  if (!existsSync(WASM_JS) || !existsSync(WASM_BIN)) {
    console.error("\nMissing WASM files. Build with `make CROSS_TO_WASM=1` first.");
    process.exit(1);
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
  queuedRuntimeSettings = 0;

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
  assert(receivedEventNames.has("shim_status_update"), "received shim_status_update");
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
    permanentInventoryUpdates.some((event) => event.kind === "start")
      && permanentInventoryUpdates.some((event) => event.kind === "item")
      && permanentInventoryUpdates.some((event) => event.kind === "commit"),
    "perm_invent creates, populates, and commits a persistent inventory menu",
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
    new Set(capturedGlyphs.map((glyph) => glyph.tileIndex)).size >= 8,
    "captured tile indices have reasonable map diversity",
  );
  assert(
    unexploredGlyphs.length > 0
      && unexploredGlyphs.some((glyph) => glyph.tileIndex !== 0),
    "unexplored glyphs use a nonzero tile index",
  );
  assert(
    ordinaryGlyphs.length > 0
      && ordinaryGlyphs.some((glyph) => glyph.tileIndex !== 0),
    "ordinary map glyphs are not all mapped to tile zero",
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
    new Set(ordinaryGlyphs.map((glyph) => glyph.glyph)).size >= 8
      && new Set(ordinaryGlyphs.map((glyph) => glyph.ttyChar)).size >= 5
      && new Set(ordinaryGlyphs.map((glyph) => glyph.symbolIndex)).size >= 5,
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
    await sendKeyAndWait(32); // space key
    assert(
      eventCount > countBefore,
      `game processed input (${eventCount - countBefore} new events)`
    );
  }

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

/**
 * nethack-bridge.ts
 *
 * Bridge between Emscripten WASM module and the React frontend.
 * Loads nethack.wasm via the Emscripten-generated nethack.js loader,
 * registers a shim_graphics callback, and dispatches game events
 * to registered handlers.
 *
 * In V1 (minimal callback), most events are no-ops or console.warn stubs.
 * The goal is to prove the WASM <-> JS bridge works end to end.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Shim event handler: receives the event name and decoded arguments. */
export type ShimEventHandler = (name: string, ...args: unknown[]) => void;

/** Resolve function for the pending input promise. */
type InputResolver = (value: number) => void;

/** The Emscripten Module instance returned by the factory. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EmscriptenModule = any;

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

let module: EmscriptenModule | null = null;
let nextWindowId = 0;
let pendingInput: InputResolver | null = null;
let eventHandler: ShimEventHandler | null = null;
const receivedEvents: Array<{ name: string; args: unknown[] }> = [];

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Register a handler that receives every shim event.
 * @param handler - called with (eventName, ...decodedArgs) for each event.
 */
export function onEvent(handler: ShimEventHandler): void {
  eventHandler = handler;
}

/**
 * Return the accumulated event log (for testing).
 */
export function getReceivedEvents(): Array<{ name: string; args: unknown[] }> {
  return receivedEvents;
}

/**
 * Send a keypress to the game. Resolves the pending shim_nhgetch / shim_nh_poskey call.
 * @param charCode - ASCII code of the key (e.g. 32 for space, 106 for 'j').
 */
export function sendKey(charCode: number): void {
  if (pendingInput) {
    const resolve = pendingInput;
    pendingInput = null;
    resolve(charCode);
  }
}

/**
 * Check whether the game is waiting for keyboard input.
 */
export function isWaitingForInput(): boolean {
  return pendingInput !== null;
}

/**
 * Load the WASM module, register the shim callback, and start the game.
 * @param wasmUrl - URL or path to the nethack.js loader (default: "/nethack.js").
 * @returns the Emscripten Module instance.
 */
export async function startGame(wasmUrl = "/nethack.js"): Promise<EmscriptenModule> {
  // Dynamically import the Emscripten-generated ES6 module.
  const factory = (await import(/* @vite-ignore */ wasmUrl)).default;

  module = await factory({
    // Silence Emscripten's default stdout/stderr printing.
    print: (text: string) => recordEvent("print", [text]),
    printErr: (text: string) => recordEvent("printErr", [text]),
  });

  // Install the callback on globalThis so winshim.c's EM_JS can find it.
  (globalThis as Record<string, unknown>).blissCallback = shimCallback;

  // Register the callback name with the WASM module.
  module.ccall("shim_graphics_set_callback", null, ["string"], ["blissCallback"]);

  // Start the game (calls main() which enters moveloop and never returns).
  // {async: true} integrates with Emscripten Asyncify so the call
  // yields to the JS event loop when C code suspends (e.g. at shim_nhgetch).
  const gamePromise = module.ccall("main", "number", [], [], { async: true });
  gamePromise.catch((e: Error) => {
    console.error("[BlissHack] game main() rejected:", e.message);
  });

  return module;
}

/* ------------------------------------------------------------------ */
/*  Shim callback implementation                                       */
/* ------------------------------------------------------------------ */

/**
 * The single shim callback. Every window_procs call from the NetHack
 * core arrives here with the function name and decoded arguments.
 * Returns a Promise whose resolved value is written back as the C return value.
 */
export async function shimCallback(name: string, ...args: unknown[]): Promise<unknown> {
  recordEvent(name, args);

  switch (name) {
    /* -- Window lifecycle -- */
    case "shim_init_nhwindows":
      return undefined;

    case "shim_create_nhwindow": {
      const id = nextWindowId++;
      return id;
    }

    case "shim_clear_nhwindow":
    case "shim_display_nhwindow":
    case "shim_destroy_nhwindow":
      return undefined;

    /* -- Player setup -- */
    case "shim_player_selection_or_tty":
      // Set all role flags to random, then return false to skip the menu.
      if (globalThis.nethackGlobal?.globals?.flags) {
        const f = globalThis.nethackGlobal.globals.flags;
        f.initrole = -1;  // ROLE_RANDOM
        f.initrace = -1;
        f.initgend = -1;
        f.initalign = -1;
      }
      return false;

    case "shim_askname":
      if (globalThis.nethackGlobal?.globals?.svp) {
        globalThis.nethackGlobal.globals.svp.plname = "BlissHack";
      }
      return undefined;

    /* -- Text output -- */
    case "shim_putstr":
      // args: [winid, attr, text]
      return undefined;

    case "shim_raw_print":
    case "shim_raw_print_bold":
      return undefined;

    /* -- Map rendering -- */
    case "shim_print_glyph":
      // args: [winid, x, y, glyphinfo_ptr, bkglyphinfo_ptr]
      return undefined;

    /* -- Input -- */
    case "shim_nhgetch":
    case "shim_nh_poskey":
      if (pendingInput) {
        console.warn("[BlissHack] overwriting pending input — previous promise will never resolve");
      }
      return new Promise<number>((resolve) => {
        pendingInput = resolve;
      });

    case "shim_yn_function": {
      // args: [query, resp, def]
      // Return the default char if valid, otherwise 'y'.
      const def = args[2];
      return (typeof def === "number" && def > 0) ? def : 121; // 'y'
    }

    case "shim_getlin":
      // args: [query, buffer_ptr]
      // Write empty string to the buffer.
      return undefined;

    case "shim_get_ext_cmd":
      return -1; // cancel

    /* -- Menus -- */
    case "shim_start_menu":
    case "shim_add_menu":
    case "shim_end_menu":
      return undefined;

    case "shim_select_menu":
      return -1; // cancel/dismiss menu

    case "shim_message_menu":
      return 0;

    /* -- Status -- */
    case "shim_status_init":
    case "shim_status_update":
      return undefined;

    /* -- Misc (void) -- */
    case "shim_nhbell":
    case "shim_mark_synch":
    case "shim_wait_synch":
    case "shim_delay_output":
    case "shim_cliparound":
    case "shim_curs":
    case "shim_number_pad":
    case "shim_get_nh_event":
    case "shim_suspend_nhwindows":
    case "shim_resume_nhwindows":
    case "shim_display_file":
    case "shim_preference_update":
    case "shim_putmsghistory":
    case "shim_update_positionbar":
    case "shim_change_color":
    case "shim_change_background":
      return undefined;

    case "shim_doprev_message":
      return 0; // int return type

    /* -- Misc (string) -- */
    case "shim_getmsghistory":
    case "shim_get_color_string":
      return "";

    case "shim_exit_nhwindows":
      return undefined;

    default:
      console.warn(`[BlissHack] unhandled shim event: ${name}`, args);
      return undefined;
  }
}

/**
 * Reset all internal state. Used by tests between runs.
 */
export function resetState(): void {
  nextWindowId = 0;
  pendingInput = null;
  eventHandler = null;
  receivedEvents.length = 0;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

const MAX_RECORDED_EVENTS = 5000;

/**
 * Record an event and forward to the registered handler.
 */
function recordEvent(name: string, args: unknown[]): void {
  if (receivedEvents.length < MAX_RECORDED_EVENTS) {
    receivedEvents.push({ name, args });
  }
  if (eventHandler) {
    eventHandler(name, ...args);
  }
}

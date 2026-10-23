import type { EmscriptenModule } from "../nethack-bridge";

const ACCEPTANCE_PARAMETER = "acceptance";
const WIZARD_ACCEPTANCE_VALUE = "wizard";
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const WIZARD_ARGUMENTS = ["nethack", "-D"] as const;
const WASM_POINTER_BYTES = 4;

/**
 * Decide whether this browser may enable the local wizard acceptance session.
 * @param development - Vite's compile-time development flag.
 * @param location - browser location whose host and query are being checked.
 * @param e2eFixtures - compile-time flag for the production E2E fixture build.
 * @returns true only for the exact opt-in query on an approved loopback host.
 */
export function isLocalWizardAcceptanceEnabled(
  development: boolean,
  location: Pick<Location, "hostname" | "search"> | undefined,
  e2eFixtures = false,
): boolean {
  if (
    (!development && !e2eFixtures)
    || !location
    || !LOOPBACK_HOSTNAMES.has(location.hostname.toLowerCase())
  ) {
    return false;
  }
  const values = new URLSearchParams(location.search).getAll(
    ACCEPTANCE_PARAMETER,
  );
  return values.length === 1 && values[0] === WIZARD_ACCEPTANCE_VALUE;
}

/**
 * Authorize wizard mode in the fresh module and start NetHack with `-D`.
 * @param module - initialized Emscripten module whose main has not run.
 * @returns the asynchronous NetHack main result.
 */
export function startWizardAcceptanceMain(
  module: EmscriptenModule,
): Promise<unknown> {
  authorizeWizardMode(module);
  Object.defineProperty(module, "blisshackWizardAcceptance", {
    value: true,
    configurable: false,
    enumerable: true,
    writable: false,
  });
  return callMainWithArguments(module, WIZARD_ARGUMENTS);
}

/**
 * Patch only the packaged WIZARDS assignment in one in-memory filesystem.
 * @param module - initialized Emscripten module with `/sysconf` available.
 */
function authorizeWizardMode(module: EmscriptenModule): void {
  const sysconf = module.FS.readFile("/sysconf", { encoding: "utf8" });
  if (typeof sysconf !== "string") {
    throw new Error("Wizard acceptance sysconf did not decode as UTF-8");
  }
  const wizardAssignments = sysconf.match(/^WIZARDS=.*$/gm);
  if (wizardAssignments?.length !== 1) {
    throw new Error(
      "Wizard acceptance requires exactly one WIZARDS assignment",
    );
  }
  module.FS.writeFile(
    "/sysconf",
    new TextEncoder().encode(sysconf.replace(/^WIZARDS=.*$/m, "WIZARDS=*")),
  );
}

/**
 * Invoke Emscripten main with a WASM32 argv kept alive until main settles.
 * @param module - initialized Emscripten module.
 * @param arguments_ - complete argv including the program name.
 * @returns a Promise which releases every argv allocation after settlement.
 */
function callMainWithArguments(
  module: EmscriptenModule,
  arguments_: readonly string[],
): Promise<unknown> {
  const argumentPointers: number[] = [];
  let argvPointer: number | null = null;
  let released = false;

  /** Release every allocation exactly once. */
  function release(): void {
    if (released) return;
    released = true;
    for (const pointer of argumentPointers) module._free(pointer);
    if (argvPointer !== null) module._free(argvPointer);
  }

  try {
    for (const argument of arguments_) {
      const size = new TextEncoder().encode(argument).byteLength + 1;
      const pointer = module._malloc(size);
      argumentPointers.push(pointer);
      module.stringToUTF8(argument, pointer, size);
    }
    argvPointer = module._malloc(
      (argumentPointers.length + 1) * WASM_POINTER_BYTES,
    );
    argumentPointers.forEach((pointer, index) => {
      module.setValue(
        argvPointer! + index * WASM_POINTER_BYTES,
        pointer,
        "*",
      );
    });
    module.setValue(
      argvPointer + argumentPointers.length * WASM_POINTER_BYTES,
      0,
      "*",
    );
  } catch (error) {
    release();
    throw error;
  }

  try {
    const result = module.ccall(
      "main",
      "number",
      ["number", "number"],
      [argumentPointers.length, argvPointer],
      { async: true },
    );
    return Promise.resolve(result).finally(release);
  } catch (error) {
    release();
    throw error;
  }
}

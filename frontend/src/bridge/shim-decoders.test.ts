import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EmscriptenModule } from "./emscripten-module";
import { readExtendedCommands } from "./shim-decoders";

const LIST_PTR = 0x1000;
const ENTRY_SIZE = 24;
const TEXT_OFFSET = 4;
const FLAGS_OFFSET = 16;
const WIZMODECMD = 0x0004;
const CMD_NOT_AVAILABLE = 0x0010;
const INTERNALCMD = 0x0040;
const previousNethackGlobal = globalThis.nethackGlobal;

interface WizardAcceptanceModule extends EmscriptenModule {
  readonly blisshackWizardAcceptance?: true;
}

/** Build the minimum module surface needed to decode the command fixture. */
function createModule(wizardAcceptance = false): WizardAcceptanceModule {
  const values = new Map<number, number>();
  const strings = new Map<number, string>();
  const commands = [
    ["adjust", 0],
    ["wizwish", WIZMODECMD],
    ["shell", CMD_NOT_AVAILABLE],
    ["internal-test", INTERNALCMD],
  ] as const;

  commands.forEach(([name, flags], index) => {
    const textPtr = 0x2000 + index * 0x20;
    const entryPtr = LIST_PTR + index * ENTRY_SIZE;
    values.set(entryPtr + TEXT_OFFSET, textPtr);
    values.set(entryPtr + FLAGS_OFFSET, flags);
    strings.set(textPtr, name);
  });
  values.set(LIST_PTR + commands.length * ENTRY_SIZE + TEXT_OFFSET, 0);

  return {
    getValue: (ptr: number) => values.get(ptr) ?? 0,
    UTF8ToString: (ptr: number) => strings.get(ptr) ?? "",
    ...(wizardAcceptance ? { blisshackWizardAcceptance: true as const } : {}),
  } as unknown as WizardAcceptanceModule;
}

beforeEach(() => {
  globalThis.nethackGlobal = {
    pointers: { extcmdlist: LIST_PTR },
  };
});

afterEach(() => {
  globalThis.nethackGlobal = previousNethackGlobal;
});

describe("readExtendedCommands", () => {
  it("exposes wizard commands only to marked acceptance modules", () => {
    expect(readExtendedCommands(createModule()).map(({ name }) => name)).toEqual(
      ["adjust"],
    );
    expect(
      readExtendedCommands(createModule(true)).map(({ name }) => name),
    ).toEqual(["adjust", "wizwish"]);
  });
});

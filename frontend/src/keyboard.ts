/** KeyboardEvent fields used by the NetHack key encoder. */
export interface KeyboardEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
  repeat: boolean;
  getModifierState(name: string): boolean;
}

/** Options which affect NetHack's movement key bindings. */
export interface KeyEncodingOptions {
  numberPad: boolean;
}

const SPECIAL_KEYS: Readonly<Record<string, number>> = {
  Escape: 27,
  Enter: 10,
  Backspace: 8,
  Delete: 127,
  Tab: 9,
};

const VI_DIRECTIONS: Readonly<Record<string, string>> = {
  ArrowLeft: "h",
  ArrowDown: "j",
  ArrowUp: "k",
  ArrowRight: "l",
  Home: "y",
  PageUp: "u",
  End: "b",
  PageDown: "n",
};

const NUMPAD_DIRECTIONS: Readonly<Record<string, string>> = {
  ArrowLeft: "4",
  ArrowDown: "2",
  ArrowUp: "8",
  ArrowRight: "6",
  Home: "7",
  PageUp: "9",
  End: "1",
  PageDown: "3",
};

const NUMPAD_CODES: Readonly<Record<string, string>> = {
  NumpadDecimal: ".",
  NumpadAdd: "+",
  NumpadSubtract: "-",
  NumpadMultiply: "*",
  NumpadDivide: "/",
  NumpadComma: ",",
  NumpadEqual: "=",
};

const SHIFTED_CODE_CHARACTERS: Readonly<Record<string, string>> = {
  Digit0: ")",
  Digit1: "!",
  Digit2: "@",
  Digit3: "#",
  Digit4: "$",
  Digit5: "%",
  Digit6: "^",
  Digit7: "&",
  Digit8: "*",
  Digit9: "(",
  Backquote: "~",
  Minus: "_",
  Equal: "+",
  BracketLeft: "{",
  BracketRight: "}",
  Backslash: "|",
  Semicolon: ":",
  Quote: "\"",
  Comma: "<",
  Period: ">",
  Slash: "?",
};

const UNSHIFTED_CODE_CHARACTERS: Readonly<Record<string, string>> = {
  Digit0: "0",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

/**
 * Convert a browser key event into NetHack's unsigned 8-bit input value.
 * @param event - browser keyboard event fields.
 * @param options - active NetHack keyboard options.
 * @returns a value in 1..255, or null when the event is not representable.
 */
export function keyboardEventToNetHackKey(
  event: KeyboardEventLike,
  options: KeyEncodingOptions,
): number | null {
  if (
    event.isComposing
    || event.getModifierState("AltGraph")
    || event.key === "Dead"
    || event.key === "Process"
  ) {
    return null;
  }
  if (event.metaKey) return null;

  const direction = getDirectionCharacter(event, options.numberPad);
  if (direction !== null) {
    return direction;
  }

  const special = SPECIAL_KEYS[event.key];
  if (special !== undefined) {
    return event.altKey ? null : special;
  }

  const usesMeta = event.altKey;
  const character = getNumpadCharacter(event.code)
    ?? getPrintableCharacter(event, usesMeta || event.ctrlKey);
  if (character === null) return null;

  let value = character.charCodeAt(0);
  if (event.ctrlKey) {
    const upper = character.toUpperCase().charCodeAt(0);
    if (upper < 0x3f || upper > 0x5f) return null;
    value = upper & 0x1f;
    if (value === 0) return null;
  }
  if (usesMeta) value |= 0x80;

  return value > 0 && value <= 0xff ? value : null;
}

/**
 * Resolve a physical numeric keypad key without depending on NumLock.
 * @param code - KeyboardEvent.code.
 * @returns the keypad character or null.
 */
function getNumpadCharacter(code: string): string | null {
  if (/^Numpad[0-9]$/.test(code)) return code.at(-1) ?? null;
  if (code === "NumpadEnter") return "\n";
  return NUMPAD_CODES[code] ?? null;
}

/**
 * Resolve directional browser keys using NetHack's vi or number-pad bindings.
 * @param event - browser keyboard event fields.
 * @param numberPad - whether NetHack's number-pad mode is active.
 * @returns an encoded NetHack byte or null when the key is not directional.
 */
function getDirectionCharacter(
  event: KeyboardEventLike,
  numberPad: boolean,
): number | null {
  const character = (numberPad ? NUMPAD_DIRECTIONS : VI_DIRECTIONS)[event.key];
  if (!character) return null;
  return character.charCodeAt(0);
}

/**
 * Resolve one printable ASCII character, with a physical-key fallback for
 * Option/Meta combinations which browser layouts expose as Unicode.
 * @param event - browser keyboard event fields.
 * @param allowCodeFallback - whether a physical-key fallback is permitted.
 * @returns one printable ASCII character or null.
 */
function getPrintableCharacter(
  event: KeyboardEventLike,
  allowCodeFallback: boolean,
): string | null {
  if (event.key.length === 1) {
    const value = event.key.charCodeAt(0);
    if (value >= 0x20 && value <= 0x7e) return event.key;
  }
  if (!allowCodeFallback) return null;

  if (/^Key[A-Z]$/.test(event.code)) {
    const letter = event.code.at(-1) ?? "";
    return event.shiftKey ? letter : letter.toLowerCase();
  }
  return (event.shiftKey
    ? SHIFTED_CODE_CHARACTERS[event.code]
    : UNSHIFTED_CODE_CHARACTERS[event.code]) ?? null;
}

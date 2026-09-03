import { describe, expect, it } from "vitest";
import {
  keyboardEventToNetHackKey,
  type KeyboardEventLike,
} from "./keyboard";

/**
 * Build the subset of KeyboardEvent used by the keyboard converter.
 * @param overrides - event fields that differ from an ordinary key press.
 * @returns a complete keyboard event fixture.
 */
function keyEvent(overrides: Partial<KeyboardEventLike>): KeyboardEventLike {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    getModifierState: () => false,
    ...overrides,
  };
}

describe("keyboardEventToNetHackKey", () => {
  it("passes every printable ASCII character through unchanged", () => {
    for (let code = 0x20; code <= 0x7e; code += 1) {
      const character = String.fromCharCode(code);
      expect(
        keyboardEventToNetHackKey(keyEvent({ key: character }), {
          numberPad: false,
        }),
      ).toBe(code);
    }
  });

  it("uses the character produced by Shift", () => {
    expect(
      keyboardEventToNetHackKey(
        keyEvent({ key: "A", code: "KeyA", shiftKey: true }),
        { numberPad: false },
      ),
    ).toBe(65);
    expect(
      keyboardEventToNetHackKey(
        keyEvent({ key: "!", code: "Digit1", shiftKey: true }),
        { numberPad: false },
      ),
    ).toBe(33);
  });

  it("maps Ctrl+A through Ctrl+Z to bytes 1 through 26", () => {
    for (let offset = 0; offset < 26; offset += 1) {
      const letter = String.fromCharCode(97 + offset);
      expect(
        keyboardEventToNetHackKey(
          keyEvent({ key: letter, code: `Key${letter.toUpperCase()}`, ctrlKey: true }),
          { numberPad: false },
        ),
      ).toBe(offset + 1);
    }
  });

  it("maps Ctrl punctuation with the C macro bit mask", () => {
    expect(
      keyboardEventToNetHackKey(
        keyEvent({ key: "[", code: "BracketLeft", ctrlKey: true }),
        { numberPad: false },
      ),
    ).toBe(27);
    expect(
      keyboardEventToNetHackKey(
        keyEvent({ key: "_", code: "Minus", ctrlKey: true, shiftKey: true }),
        { numberPad: false },
      ),
    ).toBe(31);
  });

  it("sets the high bit for Alt combinations", () => {
    expect(
      keyboardEventToNetHackKey(
        keyEvent({ key: "a", code: "KeyA", altKey: true }),
        { numberPad: false },
      ),
    ).toBe(0xe1);
    expect(
      keyboardEventToNetHackKey(
        keyEvent({ key: "A", code: "KeyA", altKey: true, shiftKey: true }),
        { numberPad: false },
      ),
    ).toBe(0xc1);
    expect(
      keyboardEventToNetHackKey(
        keyEvent({ key: "a", code: "KeyA", ctrlKey: true, altKey: true }),
        { numberPad: false },
      ),
    ).toBe(0x81);
  });

  it("falls back to the physical ASCII key for Option-generated Unicode", () => {
    expect(
      keyboardEventToNetHackKey(
        keyEvent({ key: "å", code: "KeyA", altKey: true }),
        { numberPad: false },
      ),
    ).toBe(0xe1);
    expect(
      keyboardEventToNetHackKey(
        keyEvent({ key: "¿", code: "Slash", altKey: true, shiftKey: true }),
        { numberPad: false },
      ),
    ).toBe(0xbf);
  });

  it("falls back to the physical key for macOS Option dead keys", () => {
    expect(
      keyboardEventToNetHackKey(
        keyEvent({ key: "Dead", code: "KeyU", altKey: true }),
        { numberPad: false },
      ),
    ).toBe(0xf5);
  });

  it.each([
    ["Escape", "Escape", 27],
    ["Enter", "Enter", 10],
    ["Enter", "NumpadEnter", 10],
    ["Backspace", "Backspace", 8],
    ["Delete", "Delete", 127],
    ["Tab", "Tab", 9],
    [" ", "Space", 32],
  ])("maps special key %s (%s) to %d", (key, code, expected) => {
    expect(
      keyboardEventToNetHackKey(keyEvent({ key, code }), {
        numberPad: false,
      }),
    ).toBe(expected);
  });

  it.each([
    ["ArrowLeft", "h", "4"],
    ["ArrowDown", "j", "2"],
    ["ArrowUp", "k", "8"],
    ["ArrowRight", "l", "6"],
    ["Home", "y", "7"],
    ["PageUp", "u", "9"],
    ["End", "b", "1"],
    ["PageDown", "n", "3"],
  ])("maps %s according to number-pad mode", (key, viKey, numKey) => {
    expect(
      keyboardEventToNetHackKey(keyEvent({ key }), { numberPad: false }),
    ).toBe(viKey.charCodeAt(0));
    expect(
      keyboardEventToNetHackKey(keyEvent({ key }), { numberPad: true }),
    ).toBe(numKey.charCodeAt(0));
  });

  it("keeps direction-key semantics independent of browser modifiers", () => {
    expect(
      keyboardEventToNetHackKey(
        keyEvent({ key: "ArrowLeft", shiftKey: true }),
        { numberPad: false },
      ),
    ).toBe("h".charCodeAt(0));
    expect(
      keyboardEventToNetHackKey(
        keyEvent({ key: "ArrowDown", ctrlKey: true }),
        { numberPad: false },
      ),
    ).toBe("j".charCodeAt(0));
    expect(
      keyboardEventToNetHackKey(
        keyEvent({ key: "ArrowUp", shiftKey: true }),
        { numberPad: true },
      ),
    ).toBe("8".charCodeAt(0));
  });

  it("handles NumLock-off keypad directions before physical keypad fallback", () => {
    const event = keyEvent({ key: "ArrowUp", code: "Numpad8" });
    expect(keyboardEventToNetHackKey(event, { numberPad: false })).toBe(
      "k".charCodeAt(0),
    );
    expect(keyboardEventToNetHackKey(event, { numberPad: true })).toBe(
      "8".charCodeAt(0),
    );
  });

  it("applies Meta encoding to printable keypad keys", () => {
    expect(
      keyboardEventToNetHackKey(
        keyEvent({ key: "8", code: "Numpad8", altKey: true }),
        { numberPad: true },
      ),
    ).toBe(0xb8);
  });

  it.each([
    ["Numpad0", "0"],
    ["Numpad5", "5"],
    ["Numpad9", "9"],
    ["NumpadDecimal", "."],
    ["NumpadAdd", "+"],
    ["NumpadSubtract", "-"],
    ["NumpadMultiply", "*"],
    ["NumpadDivide", "/"],
    ["NumpadComma", ","],
    ["NumpadEqual", "="],
  ])("maps physical keypad key %s to %s regardless of NumLock", (code, expected) => {
    expect(
      keyboardEventToNetHackKey(keyEvent({ key: "Unidentified", code }), {
        numberPad: true,
      }),
    ).toBe(expected.charCodeAt(0));
  });

  it("rejects events that cannot be represented by NetHack's byte input", () => {
    const rejected = [
      keyEvent({ key: "Shift", code: "ShiftLeft" }),
      keyEvent({ key: "F1", code: "F1" }),
      keyEvent({ key: "Dead", code: "Quote" }),
      keyEvent({ key: "Process", code: "KeyA" }),
      keyEvent({ key: "Unidentified", code: "" }),
      keyEvent({ key: "文", code: "KeyW" }),
      keyEvent({ key: "a", code: "KeyA", metaKey: true }),
      keyEvent({ key: "Enter", code: "NumpadEnter", metaKey: true }),
      keyEvent({ key: "a", code: "KeyA", isComposing: true }),
      keyEvent({
        key: "@",
        code: "KeyQ",
        ctrlKey: true,
        altKey: true,
        getModifierState: (name) => name === "AltGraph",
      }),
      keyEvent({ key: "Delete", code: "Delete", metaKey: true }),
    ];

    for (const event of rejected) {
      expect(
        keyboardEventToNetHackKey(event, { numberPad: false }),
      ).toBeNull();
    }
  });

  it("always returns a non-zero unsigned byte", () => {
    const candidates = [
      keyEvent({ key: "a", code: "KeyA" }),
      keyEvent({ key: "z", code: "KeyZ", ctrlKey: true }),
      keyEvent({ key: "?", code: "Slash", altKey: true, shiftKey: true }),
      keyEvent({ key: "ArrowRight" }),
    ];

    for (const event of candidates) {
      const value = keyboardEventToNetHackKey(event, { numberPad: false });
      expect(value).not.toBeNull();
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(0xff);
    }
  });
});

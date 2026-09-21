interface InterfaceShortcutEvent {
  altKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  isComposing?: boolean;
  key: string;
  metaKey: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
  repeat: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}

/**
 * Determine whether an unmodified key event can activate an interface shortcut.
 * @param event - native or React keyboard event being considered.
 * @param key - exact lowercase key or named key assigned to the action.
 * @returns whether the event belongs to the requested interface shortcut.
 */
export function matchesInterfaceShortcut(
  event: InterfaceShortcutEvent,
  key: string,
): boolean {
  return event.key === key
    && !event.altKey
    && !event.ctrlKey
    && !event.defaultPrevented
    && !event.isComposing
    && !event.nativeEvent?.isComposing
    && !event.metaKey
    && !event.repeat
    && !event.shiftKey
    && !isTextEntryTarget(event.target);
}

/**
 * Detect text-editing targets whose keystrokes must remain literal input.
 * @param target - original keyboard event target.
 * @returns whether the target is inside an editable control.
 */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(
    "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
  ) !== null;
}

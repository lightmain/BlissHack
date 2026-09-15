export interface LocalInspectActivity {
  focused: boolean;
  pointerInside: boolean;
}

export type LocalInspectActivityEvent =
  | "blur"
  | "focus"
  | "pointer-enter"
  | "pointer-leave";

/**
 * Update hover/focus ownership without closing an overlay still in use.
 * @param current - current pointer and keyboard ownership.
 * @param event - one local interaction boundary.
 * @returns the next state and whether the shared overlay can be released.
 */
export function planLocalInspectActivity(
  current: LocalInspectActivity,
  event: LocalInspectActivityEvent,
): {
  leaveSharedOverlay: boolean;
  next: LocalInspectActivity;
} {
  const next = {
    focused: event === "focus"
      ? true
      : event === "blur"
        ? false
        : current.focused,
    pointerInside: event === "pointer-enter"
      ? true
      : event === "pointer-leave"
        ? false
        : current.pointerInside,
  };
  return {
    leaveSharedOverlay:
      (current.focused || current.pointerInside)
      && !next.focused
      && !next.pointerInside,
    next,
  };
}

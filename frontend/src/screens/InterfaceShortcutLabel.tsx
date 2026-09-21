import type { ReactNode } from "react";

/**
 * Render a visible keyboard marker without changing the command's accessible name.
 * @param props - shortcut text and visible command label.
 * @returns a shared two-column shortcut label.
 */
export function InterfaceShortcutLabel({
  children,
  shortcut,
}: {
  children: ReactNode;
  shortcut: string;
}) {
  return (
    <span className="interface-shortcut-label">
      <kbd aria-hidden="true" className="interface-shortcut-key">
        {shortcut}
      </kbd>
      <span>{children}</span>
    </span>
  );
}

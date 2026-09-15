import type { ReactNode } from "react";

/**
 * Render session-owned overlays outside the inert game terminal.
 * @param props - ephemeral tooltip or context-menu content.
 * @returns the single overlay host for the active game session.
 */
export function OverlayRoot({ children }: { children?: ReactNode }) {
  return (
    <div
      aria-live="polite"
      aria-relevant="additions text"
      className="nh-overlay-root"
      data-overlay-root="true"
    >
      {children}
    </div>
  );
}

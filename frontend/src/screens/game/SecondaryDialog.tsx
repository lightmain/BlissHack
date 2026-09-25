import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";

interface SecondaryDialogProps {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  focusKey?: number | string;
  initialFocusSelector?: string;
  onCancel?(): void;
  onKeyDown?(event: KeyboardEvent<HTMLElement>): void;
  title: string;
}

/**
 * Render a compact blocking choice surface above the current action dock.
 * @param props - dialog title, option content, focus identity, and callbacks.
 * @returns a consistently positioned secondary action dialog.
 */
export function SecondaryDialog({
  ariaLabel,
  children,
  className,
  focusKey,
  initialFocusSelector,
  onCancel,
  onKeyDown,
  title,
}: SecondaryDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [dockOffset, setDockOffset] = useState(12);

  useEffect(() => {
    const dock = document.querySelector<HTMLElement>("[data-action-dock]");
    if (!dock || typeof ResizeObserver === "undefined") return undefined;

    /** Keep the dialog clear of the dock after responsive layout changes. */
    const updateOffset = (): void => {
      setDockOffset(
        Math.max(12, window.innerHeight - dock.getBoundingClientRect().top + 8),
      );
    };

    const observer = new ResizeObserver(updateOffset);
    observer.observe(dock);
    window.addEventListener("resize", updateOffset);
    updateOffset();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOffset);
    };
  }, []);

  useEffect(() => {
    const preferred = initialFocusSelector
      ? dialogRef.current?.querySelector<HTMLButtonElement>(
        initialFocusSelector,
      )
      : null;
    const fallback = dialogRef.current?.querySelector<HTMLButtonElement>(
      ".nh-secondary-dialog-option:not(:disabled)",
    );
    (preferred ?? fallback)?.focus();
  }, [focusKey, initialFocusSelector]);

  /**
   * Keep native activation of the close button out of game-level listeners.
   * @param event - keyboard event bubbling through the dialog surface.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (
      event.target instanceof Element
      && event.target.closest(".nh-secondary-dialog-close")
      && (event.key === "Enter" || event.key === " ")
    ) {
      event.stopPropagation();
      return;
    }
    onKeyDown?.(event);
  }

  return (
    <section
      aria-label={ariaLabel ?? title}
      aria-modal="true"
      className={[
        "nh-secondary-dialog",
        className,
      ].filter(Boolean).join(" ")}
      data-browser-keyboard
      onKeyDown={handleKeyDown}
      ref={dialogRef}
      role="dialog"
      style={{
        "--secondary-dialog-bottom": `${dockOffset}px`,
      } as CSSProperties}
    >
      <header className="nh-secondary-dialog-header">
        <strong>{title}</strong>
        {onCancel && (
          <button
            aria-label="Cancel"
            className="nh-secondary-dialog-close"
            onClick={onCancel}
            title="Cancel"
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

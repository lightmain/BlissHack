import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { X } from "lucide-react";
import type { ActionItemMenuPresentation } from "../../game-actions/game-action-controller";

interface ActionItemChooserProps {
  menu: ActionItemMenuPresentation;
  onCancel(): void;
  onChoose(itemIndex: number): void;
}

/**
 * Render one action-owned PICK_ONE menu without changing its core row identity.
 * @param props - current generated menu and resolver callbacks.
 * @returns a compact chooser above the action dock.
 */
export function ActionItemChooser({
  menu,
  onCancel,
  onChoose,
}: ActionItemChooserProps) {
  const chooserRef = useRef<HTMLDivElement>(null);
  const [dockOffset, setDockOffset] = useState(12);

  useEffect(() => {
    chooserRef.current
      ?.querySelector<HTMLButtonElement>("[data-action-item]")
      ?.focus();
  }, [menu.menuGeneration]);

  useEffect(() => {
    const dock = document.querySelector<HTMLElement>("[data-action-dock]");
    if (!dock || typeof ResizeObserver === "undefined") return;
    const updateOffset = (): void => {
      setDockOffset(Math.max(12, window.innerHeight - dock.getBoundingClientRect().top + 8));
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

  /** Cancel only this active core menu when Escape is pressed. */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  }

  return (
    <div
      aria-label="Choose an item"
      aria-modal="true"
      className="nh-action-item-chooser"
      data-action-menu-generation={menu.menuGeneration}
      data-browser-keyboard
      onKeyDown={handleKeyDown}
      ref={chooserRef}
      role="dialog"
      style={{ "--action-chooser-bottom": `${dockOffset}px` } as CSSProperties}
    >
      <div className="nh-action-item-chooser-header">
        <strong>Choose an item</strong>
        <button
          aria-label="Cancel item selection"
          onClick={onCancel}
          title="Cancel"
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </div>
      <div className="nh-action-item-list">
        {menu.items.map((item, itemIndex) => (
          item.identifier === null
            ? null
            : (
              <button
                data-action-item
                key={`${menu.menuGeneration}:${itemIndex}`}
                onClick={() => onChoose(itemIndex)}
                type="button"
              >
                {item.accelerator > 0 && (
                  <kbd>{String.fromCharCode(item.accelerator)}</kbd>
                )}
                <span>{item.text}</span>
              </button>
            )
        ))}
      </div>
    </div>
  );
}

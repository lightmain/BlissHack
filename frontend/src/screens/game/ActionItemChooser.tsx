import type { KeyboardEvent } from "react";
import type { ActionItemMenuPresentation } from "../../game-actions/game-action-controller";
import { SecondaryDialog } from "./SecondaryDialog";

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
  /** Cancel only this active core menu when Escape is pressed. */
  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  }

  return (
    <SecondaryDialog
      className="nh-action-item-chooser"
      focusKey={menu.menuGeneration}
      onCancel={onCancel}
      onKeyDown={handleKeyDown}
      title="Choose an item"
    >
      <div className="nh-secondary-dialog-list">
        {menu.items.map((item, itemIndex) => (
          item.identifier === null
            ? null
            : (
              <button
                className="nh-secondary-dialog-option"
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
    </SecondaryDialog>
  );
}

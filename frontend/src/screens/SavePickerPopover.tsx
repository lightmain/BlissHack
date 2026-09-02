import type { SaveListEntry } from "../storage/storage-service";

/** Properties for the saved-game popover anchored to Continue. */
interface SavePickerPopoverProps {
  id?: string;
  moduleId: string;
  onContinue: (save: SaveListEntry) => void;
  saves: SaveListEntry[];
}

/**
 * Render saves without replacing the surrounding home screen.
 * @param props - current module identity, saves, and selection handler.
 * @returns a compact saved-game popover.
 */
export function SavePickerPopover({
  id,
  moduleId,
  onContinue,
  saves,
}: SavePickerPopoverProps) {
  return (
    <div
      aria-label="Saved games"
      className="save-picker-popover"
      data-module-id={moduleId}
      id={id}
      role="dialog"
    >
      <div className="save-picker-heading">Saved games</div>
      <div className="save-picker-list">
        {saves.map((save) => {
          const ready = save.status === "ready";
          const label = ready
            ? save.identity.playerName
            : fileLabel(save.path);
          return (
            <button
              className="save-picker-entry"
              disabled={!ready}
              key={save.path}
              onClick={() => {
                if (ready) onContinue(save);
              }}
              type="button"
            >
              <span>{label}</span>
              <small>
                {ready ? "Ready to continue" : save.error}
              </small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Derive a non-authoritative label for an invalid candidate path. */
function fileLabel(path: string): string {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  return fileName.startsWith("0") ? fileName.slice(1) : fileName;
}

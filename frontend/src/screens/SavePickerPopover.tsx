import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { SaveListEntry } from "../storage/storage-service";

/** Properties for the saved-game popover anchored to Continue. */
interface SavePickerPopoverProps {
  id?: string;
  moduleId: string;
  onContinue: (save: SaveListEntry) => void;
  onDelete?: (save: SaveListEntry) => Promise<void>;
  saves: SaveListEntry[];
}

interface DeleteError {
  message: string;
  path: string;
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
  onDelete = async () => undefined,
  saves,
}: SavePickerPopoverProps) {
  const [confirmingPath, setConfirmingPath] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<DeleteError | null>(null);

  /** Confirm on the first click and delete on the second click. */
  async function requestDelete(save: SaveListEntry): Promise<void> {
    if (deletingPath !== null) return;
    setDeleteError(null);
    if (confirmingPath !== save.path) {
      setConfirmingPath(save.path);
      return;
    }

    setDeletingPath(save.path);
    try {
      await onDelete(save);
      setConfirmingPath(null);
    } catch (error) {
      setDeleteError({
        path: save.path,
        message: deleteErrorMessage(error),
      });
    } finally {
      setDeletingPath(null);
    }
  }

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
          const confirming = confirmingPath === save.path;
          const deleting = deletingPath === save.path;
          const error = deleteError?.path === save.path
            ? deleteError.message
            : null;
          return (
            <div
              className={`save-picker-entry${ready ? "" : " save-picker-entry-invalid"}`}
              key={save.path}
            >
              <button
                className="save-picker-choice"
                disabled={!ready}
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
              <div className="save-delete-control">
                {confirming && !deleting && (
                  <span className="save-delete-confirmation">Sure?</span>
                )}
                <button
                  aria-label={`Delete save ${label}`}
                  className="save-delete-button"
                  disabled={deletingPath !== null}
                  onClick={() => void requestDelete(save)}
                  title={`Delete save ${label}`}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={18} strokeWidth={2} />
                </button>
              </div>
              {error && (
                <small className="save-delete-error" role="alert">
                  {error}
                </small>
              )}
            </div>
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

/** Convert an unknown deletion failure into concise UI text. */
function deleteErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not delete save";
}

import {
  useEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import type {
  DesktopCloseChoice,
  DesktopClosePrompt,
} from "../desktop/desktop-close";

interface DesktopCloseDialogProps {
  readonly prompt: DesktopClosePrompt;
  onChoose(choice: DesktopCloseChoice): void;
}

/** Confirm an Electron close request without bypassing the game save path. */
export function DesktopCloseDialog({
  onChoose,
  prompt,
}: DesktopCloseDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const promptRef = useRef(prompt);
  const chooseRef = useRef(onChoose);

  useEffect(() => {
    promptRef.current = prompt;
    chooseRef.current = onChoose;
  }, [onChoose, prompt]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const activeDialog = dialog;
    const background = document.querySelector<HTMLElement>("body > #root");
    if (background) background.inert = true;
    activeDialog
      .querySelector<HTMLElement>("[data-modal-initial-focus]")
      ?.focus();

    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape" && promptRef.current.status !== "saving") {
        event.preventDefault();
        event.stopPropagation();
        chooseRef.current("cancel");
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(activeDialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ));
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls.at(-1) as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    activeDialog.addEventListener("keydown", handleKey);
    return () => {
      activeDialog.removeEventListener("keydown", handleKey);
      if (background) background.inert = false;
    };
  }, []);

  const saving = prompt.status === "saving";
  const saveFailed = prompt.status === "save-failed";
  const dialog = (
    <div className="settings-modal-backdrop">
      <section
        aria-labelledby="desktop-close-title"
        aria-modal="true"
        className="settings-modal desktop-close-dialog"
        ref={dialogRef}
        role="alertdialog"
      >
        <h2 id="desktop-close-title">
          {saving ? "Saving game" : "Exit BlissHack?"}
        </h2>
        <p>
          {saving
            ? "BlissHack is waiting for NetHack to finish saving."
            : saveFailed
            ? "BlissHack could not confirm that the game was saved. Keep the application open or exit without saving current progress."
            : prompt.canSaveAndExit
            ? "Save the current game before closing, or exit without saving current progress."
            : "Save and Exit is available only at the next game command prompt. Cancel closing and finish the current prompt first, or exit without saving current progress."}
        </p>
        <div className="settings-modal-actions">
          <button
            data-modal-initial-focus
            disabled={saving}
            onClick={() => onChoose("cancel")}
            type="button"
          >
            Cancel
          </button>
          <button
            className="settings-danger"
            disabled={saving}
            onClick={() => onChoose("discard")}
            type="button"
          >
            Exit Without Saving
          </button>
          <button
            className="settings-primary"
            disabled={!prompt.canSaveAndExit || prompt.status !== "confirm"}
            onClick={() => onChoose("save-and-exit")}
            type="button"
          >
            Save and Exit
          </button>
        </div>
      </section>
    </div>
  );
  return typeof document === "undefined"
    ? dialog
    : createPortal(dialog, document.body);
}

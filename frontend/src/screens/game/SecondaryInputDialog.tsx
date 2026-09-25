import {
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  INPUT_STATE_GETDIR,
  type InputRequest,
} from "../../game-state";
import { keyboardEventToNetHackKey } from "../../keyboard";
import { SecondaryDialog } from "./SecondaryDialog";
import {
  directionOptions,
  isDirectionKey,
} from "./direction-input";
import { secondaryYnChoices } from "./secondary-input";

type YnInputRequest = Extract<InputRequest, { kind: "yn" }>;

const CHOICE_LABELS: Readonly<Record<string, string>> = {
  y: "Yes",
  n: "No",
  q: "Quit",
};

interface SecondaryInputDialogProps {
  inputState: number;
  numberPad: boolean;
  onCancel(): void;
  onSubmit(value: number): void;
  request: YnInputRequest;
}

/**
 * Render a direction or confirmation request as a blocking compact dialog.
 * @param props - core request, keyboard mode, and byte submission callback.
 * @returns the secondary dialog matching the authoritative input request.
 */
export function SecondaryInputDialog({
  inputState,
  numberPad,
  onCancel,
  onSubmit,
  request,
}: SecondaryInputDialogProps) {
  const directionInput = inputState === INPUT_STATE_GETDIR;
  const choices = directionInput
    ? []
    : [...secondaryYnChoices(request)].filter((choice) =>
      Object.hasOwn(CHOICE_LABELS, choice)
    );

  /**
   * Preserve the core's existing keyboard and Escape behavior inside the dialog.
   * @param event - keyboard event from a focused secondary control.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const value = keyboardEventToNetHackKey(event.nativeEvent, { numberPad });
    if (value === null) return;
    if (
      !directionInput
      && event.target instanceof HTMLButtonElement
      && (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      event.stopPropagation();
      onSubmit(value);
      return;
    }
    const accepted = directionInput
      ? value === 27 || isDirectionKey(value, numberPad)
      : value === 27
        || choices.includes(String.fromCharCode(value).toLowerCase());
    event.stopPropagation();
    if (!accepted) return;
    event.preventDefault();
    if (value === 27) onCancel();
    else onSubmit(value);
  }

  if (directionInput) {
    return (
      <SecondaryDialog
        ariaLabel={request.query || "In what direction?"}
        focusKey={`${inputState}:${request.query}`}
        onCancel={onCancel}
        onKeyDown={handleKeyDown}
        title={request.query || "In what direction?"}
      >
        <div
          className={[
            "nh-secondary-dialog-list",
            "nh-secondary-dialog-list-direction",
          ].join(" ")}
        >
          {directionOptions(numberPad).map((direction) => (
            <button
              aria-label={direction.label}
              className="nh-secondary-dialog-option"
              key={direction.label}
              onClick={() => onSubmit(direction.key.charCodeAt(0))}
              style={{
                gridColumn: direction.xDelta + 2,
                gridRow: direction.yDelta + 2,
              } as CSSProperties}
              type="button"
            >
              <kbd>{direction.key}</kbd>
              <span>{direction.label}</span>
            </button>
          ))}
        </div>
      </SecondaryDialog>
    );
  }

  return (
    <SecondaryDialog
      ariaLabel={request.query}
      focusKey={`${inputState}:${request.query}:${request.choices}`}
      initialFocusSelector='[data-default="true"]'
      onCancel={onCancel}
      onKeyDown={handleKeyDown}
      title={request.query}
    >
      <div
        className={[
          "nh-secondary-dialog-list",
          "nh-secondary-dialog-list-confirmation",
        ].join(" ")}
      >
        {choices.map((choice) => (
          <button
            aria-label={CHOICE_LABELS[choice]}
            className="nh-secondary-dialog-option"
            data-default={
              request.defaultCode === choice.charCodeAt(0) ? "true" : undefined
            }
            key={choice}
            onClick={() => onSubmit(choice.charCodeAt(0))}
            type="button"
          >
            <kbd>{choice}</kbd>
            <span>{CHOICE_LABELS[choice]}</span>
          </button>
        ))}
      </div>
    </SecondaryDialog>
  );
}

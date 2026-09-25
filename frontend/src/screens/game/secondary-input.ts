import {
  INPUT_STATE_GETDIR,
  type InputRequest,
} from "../../game-state";

type YnInputRequest = Extract<InputRequest, { kind: "yn" }>;

/**
 * Return the visible response characters before NetHack's Escape delimiter.
 * @param request - core-authored yn request.
 * @returns the response characters represented by compact buttons.
 */
export function secondaryYnChoices(request: YnInputRequest): string {
  return request.choices?.split("\u001b")[0] ?? "";
}

/**
 * Test whether one yn request has a dedicated compact button presentation.
 * @param request - core-authored yn request.
 * @param inputState - authoritative NetHack input-state discriminator.
 * @returns whether the BlissHack action bar should own a secondary dialog.
 */
export function supportsSecondaryInputDialog(
  request: InputRequest | null,
  inputState: number,
): request is YnInputRequest {
  if (request?.kind !== "yn") return false;
  if (inputState === INPUT_STATE_GETDIR) return true;
  const choices = secondaryYnChoices(request);
  return choices === "yn" || choices === "ynq";
}

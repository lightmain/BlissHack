import { serializeProfileExport, type BlissHackProfile } from "./profile";
import {
  saveUserFile,
  type SaveUserFileResult,
} from "../desktop/save-user-file";

/** Download one validated profile as a portable .bhprofile document. */
export function downloadProfile(
  profile: BlissHackProfile,
  productVersion: string,
): Promise<SaveUserFileResult> {
  return saveUserFile({
    data: serializeProfileExport(profile, productVersion),
    fileName: "blisshack-profile.bhprofile",
    mimeType: "application/json;charset=utf-8",
  });
}

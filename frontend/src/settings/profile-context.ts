import { createContext, useContext } from "react";
import type { BlissHackProfile } from "./profile";
import type { ProfileLoadStatus } from "./profile-store";

export interface ProfileContextValue {
  profile: BlissHackProfile;
  loadStatus: ProfileLoadStatus;
  clearProfile(): BlissHackProfile;
  reloadProfile(): BlissHackProfile;
  resetProfile(): BlissHackProfile;
  replaceProfile(profile: BlissHackProfile): BlissHackProfile;
}

export const ProfileContext = createContext<ProfileContextValue | null>(null);

/** Read the current profile and fail clearly outside its application owner. */
export function useProfileSettings(): ProfileContextValue {
  const value = useContext(ProfileContext);
  if (!value) {
    throw new Error("useProfileSettings must be used inside ProfileProvider");
  }
  return value;
}

import type {
  BlissHackProfile,
  PickupTypesV1,
} from "./profile";
import { summarizeActionBarSlots } from "../action-bar/action-bar-layout";

export interface ProfileDifference {
  path: string;
  label: string;
  current: string;
  incoming: string;
}

interface FieldDefinition {
  path: string;
  label: string;
  value(profile: BlissHackProfile): unknown;
  format(value: unknown): string;
}

const BOOLEAN = (value: unknown) => value ? "On" : "Off";
const TEXT = (value: unknown) => String(value);

const PROFILE_FIELDS: readonly FieldDefinition[] = [
  {
    path: "interface.mapRenderer",
    label: "Map display",
    value: (profile) => profile.interface.mapRenderer,
    format: (value) => value === "tiles" ? "Tiles" : "ASCII",
  },
  {
    path: "interface.informationLevel",
    label: "Information level",
    value: (profile) => profile.interface.informationLevel,
    format: (value) => value === "detailed" ? "Detailed" : "Original",
  },
  {
    path: "interface.endgameStyle",
    label: "Endgame style",
    value: (profile) => profile.interface.endgameStyle,
    format: (value) => value === "blisshack" ? "BlissHack" : "Original",
  },
  {
    path: "interface.characterSetupStyle",
    label: "Character setup style",
    value: (profile) => profile.interface.characterSetupStyle,
    format: (value) => value === "blisshack" ? "BlissHack" : "Original",
  },
  {
    path: "interface.actionBarStyle",
    label: "Action bar",
    value: (profile) => profile.interface.actionBarStyle,
    format: (value) => value === "blisshack" ? "BlissHack" : "Original",
  },
  {
    path: "interface.actionBarLayout",
    label: "Action bar layout",
    value: (profile) => profile.interface.actionBarLayout,
    format: (value) => {
      const layout = value as BlissHackProfile["interface"]["actionBarLayout"];
      const category = layout.activeCategory[0].toUpperCase()
        + layout.activeCategory.slice(1);
      return [
        `${layout.rows} rows`,
        category,
        layout.locked ? "locked" : "unlocked",
        summarizeActionBarSlots(layout),
      ].join(", ");
    },
  },
  {
    path: "interface.terminalFontSize",
    label: "Terminal font size",
    value: (profile) => profile.interface.terminalFontSize,
    format: TEXT,
  },
  {
    path: "interface.messageHistoryLines",
    label: "Message history lines",
    value: (profile) => profile.interface.messageHistoryLines,
    format: TEXT,
  },
  {
    path: "interface.followPlayer",
    label: "Follow player",
    value: (profile) => profile.interface.followPlayer,
    format: BOOLEAN,
  },
  {
    path: "interface.permanentInventoryPosition",
    label: "Inventory position",
    value: (profile) => profile.interface.permanentInventoryPosition,
    format: (value) => value === "right"
      ? "Right (Long)"
      : value === "right-short"
      ? "Right (Short)"
      : "Below",
  },
  {
    path: "interface.permanentInventoryCollapsed",
    label: "Start inventory collapsed",
    value: (profile) => profile.interface.permanentInventoryCollapsed,
    format: BOOLEAN,
  },
  {
    path: "nethack.tutorial",
    label: "Offer tutorial",
    value: (profile) => profile.nethack.tutorial,
    format: BOOLEAN,
  },
  {
    path: "nethack.autopickup",
    label: "Automatic pickup",
    value: (profile) => profile.nethack.autopickup,
    format: BOOLEAN,
  },
  {
    path: "nethack.pickupTypes",
    label: "Pickup categories",
    value: (profile) => profile.nethack.pickupTypes,
    format: (value) => formatPickupTypes(value as PickupTypesV1),
  },
  {
    path: "nethack.numberPad",
    label: "Movement keys",
    value: (profile) => profile.nethack.numberPad,
    format: TEXT,
  },
  {
    path: "nethack.safePet",
    label: "Protect peaceful pets",
    value: (profile) => profile.nethack.safePet,
    format: BOOLEAN,
  },
  {
    path: "nethack.sortpack",
    label: "Sort inventory",
    value: (profile) => profile.nethack.sortpack,
    format: BOOLEAN,
  },
  {
    path: "nethack.showExperience",
    label: "Show experience",
    value: (profile) => profile.nethack.showExperience,
    format: BOOLEAN,
  },
  {
    path: "nethack.showTime",
    label: "Show turn count",
    value: (profile) => profile.nethack.showTime,
    format: BOOLEAN,
  },
  {
    path: "nethack.permInvent",
    label: "Permanent inventory",
    value: (profile) => profile.nethack.permInvent,
    format: BOOLEAN,
  },
  {
    path: "nethack.perminvMode",
    label: "Inventory contents",
    value: (profile) => profile.nethack.perminvMode,
    format: TEXT,
  },
];

/** Compare every current profile setting in stable UI order. */
export function diffProfiles(
  current: BlissHackProfile,
  incoming: BlissHackProfile,
): ProfileDifference[] {
  return PROFILE_FIELDS.flatMap((field) => {
    const currentValue = field.value(current);
    const incomingValue = field.value(incoming);
    return JSON.stringify(currentValue) === JSON.stringify(incomingValue)
      ? []
      : [{
        path: field.path,
        label: field.label,
        current: field.format(currentValue),
        incoming: field.format(incomingValue),
      }];
  });
}

function formatPickupTypes(value: PickupTypesV1): string {
  return value.mode === "all" ? "All" : value.classes.join("");
}

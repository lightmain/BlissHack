import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "./profile";
import { diffProfiles } from "./profile-diff";

describe("profile differences", () => {
  it("returns no rows for equal profiles", () => {
    expect(diffProfiles(
      createDefaultProfile(),
      createDefaultProfile(),
    )).toEqual([]);
  });

  it("reports the Map display renderer with user-facing labels", () => {
    const current = createDefaultProfile();
    const incoming = createDefaultProfile();
    (current.interface as unknown as Record<string, unknown>).mapRenderer =
      "tiles";
    (incoming.interface as unknown as Record<string, unknown>).mapRenderer =
      "ascii";

    expect(diffProfiles(current, incoming)).toContainEqual({
      path: "interface.mapRenderer",
      label: "Map display",
      current: "Tiles",
      incoming: "ASCII",
    });
  });

  it("reports all presentation settings with user-facing labels", () => {
    const current = createDefaultProfile();
    const incoming = createDefaultProfile();
    current.interface.informationLevel = "original";
    current.interface.endgameStyle = "original";
    current.interface.characterSetupStyle = "original";
    const incomingInterface = incoming.interface as unknown as
      Record<string, unknown>;
    incomingInterface.informationLevel = "detailed";
    incomingInterface.endgameStyle = "blisshack";
    incomingInterface.characterSetupStyle = "blisshack";

    expect(diffProfiles(current, incoming)).toEqual(expect.arrayContaining([
      {
        path: "interface.informationLevel",
        label: "Information level",
        current: "Original",
        incoming: "Detailed",
      },
      {
        path: "interface.endgameStyle",
        label: "Endgame style",
        current: "Original",
        incoming: "BlissHack",
      },
      {
        path: "interface.characterSetupStyle",
        label: "Character setup style",
        current: "Original",
        incoming: "BlissHack",
      },
    ]));
  });

  it("reports information level independently from Show experience", () => {
    const current = createDefaultProfile();
    const incoming = createDefaultProfile();
    current.interface.informationLevel = "original";
    (incoming.interface as unknown as Record<string, unknown>)
      .informationLevel = "detailed";
    incoming.nethack.showExperience = true;

    expect(diffProfiles(current, incoming)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "interface.informationLevel" }),
      expect.objectContaining({ path: "nethack.showExperience" }),
    ]));
  });

  it("reports the Action bar mode with user-facing labels", () => {
    const current = createDefaultProfile();
    const incoming = createDefaultProfile();
    current.interface.actionBarStyle = "original";
    (incoming.interface as unknown as Record<string, unknown>).actionBarStyle =
      "blisshack";

    expect(diffProfiles(current, incoming)).toContainEqual({
      path: "interface.actionBarStyle",
      label: "Action bar",
      current: "Original",
      incoming: "BlissHack",
    });
  });

  it("summarizes action bar layout changes without dumping slot JSON", () => {
    const current = createDefaultProfile() as any;
    const incoming = structuredClone(current);
    incoming.interface.actionBarLayout.rows = 3;
    incoming.interface.actionBarLayout.locked = false;
    incoming.interface.actionBarLayout.activeCategory = "custom";
    incoming.interface.actionBarLayout.categories.custom = [
      null,
      "future-action",
    ];

    expect(diffProfiles(current, incoming)).toContainEqual({
      path: "interface.actionBarLayout",
      label: "Action bar layout",
      current: "2 rows, All, locked, 104 actions, 0 empty",
      incoming: "3 rows, Custom, unlocked, 105 actions, 1 empty",
    });
  });

  it("detects action bar changes whose summaries are identical", () => {
    const current = createDefaultProfile();
    const incoming = structuredClone(current);
    incoming.interface.actionBarLayout.categories.common[0] = "future-action";

    expect(diffProfiles(current, incoming)).toContainEqual({
      path: "interface.actionBarLayout",
      label: "Action bar layout",
      current: "2 rows, All, locked, 104 actions, 0 empty",
      incoming: "2 rows, All, locked, 104 actions, 0 empty",
    });
  });

  it("reports changed fields in stable Settings order", () => {
    const current = createDefaultProfile();
    const incoming = createDefaultProfile();
    incoming.interface.terminalFontSize = "large";
    incoming.nethack.autopickup = false;
    incoming.nethack.pickupTypes = {
      mode: "selected",
      classes: ["$", "?", "!"],
    };
    incoming.nethack.showTime = true;

    expect(diffProfiles(current, incoming)).toEqual([
      {
        path: "interface.terminalFontSize",
        label: "Terminal font size",
        current: "medium",
        incoming: "large",
      },
      {
        path: "nethack.autopickup",
        label: "Automatic pickup",
        current: "On",
        incoming: "Off",
      },
      {
        path: "nethack.pickupTypes",
        label: "Pickup categories",
        current: "All",
        incoming: "$?!",
      },
      {
        path: "nethack.showTime",
        label: "Show turn count",
        current: "Off",
        incoming: "On",
      },
    ]);
  });
});

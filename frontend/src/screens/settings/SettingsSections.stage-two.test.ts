import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import { createDefaultProfile } from "../../settings/profile";
import { InterfaceSettingsSection } from "./SettingsSections";

interface SegmentedControlContract {
  description?: string;
  label: string;
  name: string;
  onChange(value: string): void;
  options: Array<{ label: string; value: string }>;
  value: string;
}

function profileWithActionBarStyle(style: "original" | "blisshack") {
  const profile = createDefaultProfile();
  const interfaceSettings = profile.interface as unknown as
    Record<string, unknown>;
  interfaceSettings.actionBarStyle = style;
  interfaceSettings.actionBarLayout = { retained: "layout-sentinel" };
  return profile;
}

function actionBarControl(
  isGameSettings: boolean,
  onInterfaceChange = vi.fn(),
): {
  control: SegmentedControlContract;
  onInterfaceChange: ReturnType<typeof vi.fn>;
} {
  const profile = createDefaultProfile();
  (profile.interface as unknown as Record<string, unknown>).actionBarLayout = {
    retained: "layout-sentinel",
  };
  const tree = InterfaceSettingsSection({
    draft: profile,
    isGameSettings,
    onInterfaceChange,
    onNetHackChange: vi.fn(),
  });
  const element = findElement(tree, (candidate) =>
    candidate.props.name === "action-bar-style"
  );
  expect(element, "missing Action bar segmented control").not.toBeNull();
  return {
    control: element?.props as unknown as SegmentedControlContract,
    onInterfaceChange,
  };
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | null {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    const element = child as ReactElement<Record<string, unknown>>;
    if (predicate(element)) return element;
    const nested = findElement(element.props.children as ReactNode, predicate);
    if (nested) return nested;
  }
  return null;
}

describe("stage-two Action bar Settings control", () => {
  it("renders Original and BlissHack choices with BlissHack selected by default", () => {
    const { control } = actionBarControl(false);

    expect(control).toMatchObject({
      label: "Action bar",
      name: "action-bar-style",
      value: "blisshack",
      options: [
        { value: "original", label: "Original" },
        { value: "blisshack", label: "BlissHack" },
      ],
    });
  });

  it("emits only the selected mode so the saved layout remains intact", () => {
    const { control, onInterfaceChange } = actionBarControl(false);

    control.onChange("original");

    expect(onInterfaceChange).toHaveBeenCalledOnce();
    expect(onInterfaceChange).toHaveBeenCalledWith({
      actionBarStyle: "original",
    });
    expect(onInterfaceChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ actionBarLayout: expect.anything() }),
    );
  });

  it("explains immediate application only in game Settings", () => {
    expect(actionBarControl(false).control.description).toBeUndefined();
    expect(actionBarControl(true).control.description)
      .toMatch(/applies immediately to the current game/i);
  });

  it("reflects a saved BlissHack selection without changing its options", () => {
    const tree = InterfaceSettingsSection({
      draft: profileWithActionBarStyle("blisshack"),
      onInterfaceChange: vi.fn(),
      onNetHackChange: vi.fn(),
    });
    const element = findElement(tree, (candidate) =>
      candidate.props.name === "action-bar-style"
    );
    const control = element?.props as unknown as SegmentedControlContract;

    expect(control.value).toBe("blisshack");
    expect(control.options.map(({ value }) => value)).toEqual([
      "original",
      "blisshack",
    ]);
  });
});

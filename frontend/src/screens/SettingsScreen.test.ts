import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createDefaultProfile } from "../settings/profile";
import type { ProfileLoadStatus } from "../settings/profile-store";
import { SettingsScreen } from "./SettingsScreen";

function renderSettings(loadStatus: ProfileLoadStatus = "loaded"): string {
  return renderToStaticMarkup(createElement(SettingsScreen, {
    loadStatus,
    moduleId: "module-1",
    onApply: async (profile) => profile,
    onBack: vi.fn(),
    profile: createDefaultProfile(),
  }));
}

function buttonMarkup(html: string, label: string): string {
  const match = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gi)]
    .map((entry) => entry[0])
    .find((button) => button.includes(label));
  expect(match, `missing ${label} button`).toBeDefined();
  return match ?? "";
}

function labelMarkup(html: string, text: string): string {
  const match = [...html.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/gi)]
    .map((entry) => entry[0])
    .find((label) => label.includes(text));
  expect(match, `missing ${text} field`).toBeDefined();
  return match ?? "";
}

function fieldsetMarkup(html: string, legend: string): string {
  const match = [...html.matchAll(/<fieldset\b[^>]*>[\s\S]*?<\/fieldset>/gi)]
    .map((entry) => entry[0])
    .find((fieldset) => fieldset.includes(`<legend>${legend}</legend>`));
  expect(match, `missing ${legend} fieldset`).toBeDefined();
  return match ?? "";
}

function visibleText(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("SettingsScreen", () => {
  it("renders all reviewed fields and keeps the prepared module identity", () => {
    const html = renderSettings();

    expect(html).toContain('data-module-id="module-1"');
    expect(html).toMatch(/<h2[^>]*>Interface<\/h2>/);
    expect(html).toMatch(/<h2[^>]*>Inventory<\/h2>/);
    expect(html).toMatch(/<h2[^>]*>NetHack<\/h2>/);
    expect(html).toMatch(/<h2[^>]*>Profile<\/h2>/);
    expect(html).toMatch(/<h2[^>]*>Data<\/h2>/);
    expect(html).toContain("Map display");
    expect(html).toContain("Information level");
    expect(html).toContain("Endgame style");
    expect(html).toContain("Character setup style");
    expect(html).toContain("Action bar");
    expect(html).toContain("Terminal font size");
    expect(html).toContain("Message history");
    expect(html).toContain("Follow player on the map");
    expect(html).toContain("Status display");
    expect(html).toContain("Preferred position");
    expect(html).not.toContain("Inventory width");
    expect(html).toContain("Start collapsed");
    expect(html).toContain("Offer tutorial for new games");
    expect(html).toContain("Automatic pickup");
    expect(html).toContain("Pickup categories");
    expect(html).toContain("Movement keys");
    expect(html).toContain("Protect peaceful pets");
    expect(html).toContain("Sort inventory");
    expect(html).toContain("Show experience");
    expect(html).toContain("Show turn count");
    expect(html).toContain("<legend>Permanent Inventory</legend>");
    expect(html).toContain("Enable Permanent Inventory");
    expect(html).toContain("Contents");
    expect(html).toContain("All except gold");
    expect(html).toContain("Full including gold");
    expect(html).toContain("Items in use");
    expect(html).toContain("Export Full Backup");
    expect(html).toContain("Import Full Backup");
    expect(html).toContain("Clear Local Data");
  });

  it("starts clean with the reviewed defaults selected", () => {
    const html = renderSettings();
    const mapDisplay = fieldsetMarkup(html, "Map display");

    expect(mapDisplay).toContain(">Tiles</span>");
    expect(mapDisplay).toContain(">ASCII</span>");
    expect(mapDisplay).toMatch(
      /<input(?=[^>]*checked="")(?=[^>]*value="tiles")[^>]*>/,
    );
    expect(mapDisplay).toMatch(
      /<input(?![^>]*checked="")(?=[^>]*value="ascii")[^>]*>/,
    );
    expect(html).toMatch(/<input(?=[^>]*checked="")(?=[^>]*value="medium")[^>]*>/);
    expect(html).toMatch(/<input(?=[^>]*checked="")(?=[^>]*value="5")[^>]*>/);
    expect(html).toContain("<option value=\"0\" selected=\"\">");
    expect(html).toMatch(/<input(?=[^>]*checked="")(?=[^>]*value="right")[^>]*>/);
    expect(labelMarkup(html, "Enable Permanent Inventory"))
      .not.toContain("checked");
    expect(html).toContain('<option value="all" selected="">');
    expect(labelMarkup(html, "Contents")).toContain("disabled");
    expect(labelMarkup(html, "Start collapsed")).toContain("disabled");
    expect(labelMarkup(html, "Start collapsed")).not.toContain("checked");
    expect(html).toMatch(
      /<input(?=[^>]*disabled="")(?=[^>]*value="right")[^>]*>/,
    );
    expect(html).toContain("No unsaved changes");
    expect(buttonMarkup(html, "Apply")).toMatch(/\sdisabled(?:=""|>)/i);
  });

  it("renders all four presentation settings as segmented controls defaulting to Original", () => {
    const html = renderSettings();

    for (const legend of [
      "Information level",
      "Endgame style",
      "Character setup style",
      "Action bar",
    ]) {
      const fieldset = fieldsetMarkup(html, legend);
      expect(fieldset).toContain(">Original</span>");
      expect(fieldset).toMatch(
        /<input(?=[^>]*checked="")(?=[^>]*value="original")[^>]*>/,
      );
    }

    expect(fieldsetMarkup(html, "Information level"))
      .toContain(">Detailed</span>");
    expect(fieldsetMarkup(html, "Endgame style"))
      .toContain(">BlissHack</span>");
    expect(fieldsetMarkup(html, "Character setup style"))
      .toContain(">BlissHack</span>");
    expect(fieldsetMarkup(html, "Action bar"))
      .toContain(">BlissHack</span>");
  });

  it("[defect-probing] labels all three permanent inventory positions", () => {
    const html = renderSettings();
    const positions = [...html.matchAll(
      /<label><input(?=[^>]*\bname="inventory-position")([^>]*)\/><span>([^<]+)<\/span><\/label>/g,
    )];

    expect(positions.map((match) => match[2])).toEqual([
      "Right (Long)",
      "Right (Short)",
      "Below",
    ]);
    expect(positions.map((match) => ({
      checked: match[1].includes('checked=""'),
      value: match[1].match(/\bvalue="([^"]+)"/)?.[1],
    }))).toEqual([
      { checked: true, value: "right" },
      { checked: false, value: "right-short" },
      { checked: false, value: "below" },
    ]);
  });

  it("disables persistence actions and shows a warning when storage is unavailable", () => {
    const html = renderSettings("unavailable");

    expect(html).toMatch(/storage is unavailable/i);
    expect(buttonMarkup(html, "Import Profile"))
      .toMatch(/\sdisabled(?:=""|>)/i);
    expect(buttonMarkup(html, "Restore Defaults"))
      .toMatch(/\sdisabled(?:=""|>)/i);
    expect(buttonMarkup(html, "Apply")).toMatch(/\sdisabled(?:=""|>)/i);
    expect(buttonMarkup(html, "Export Profile"))
      .not.toMatch(/\sdisabled(?:=""|>)/i);
  });

  it.each([
    ["invalid", /could not be read/i],
    ["unsupported-schema", /unsupported version/i],
  ] satisfies Array<[ProfileLoadStatus, RegExp]>)(
    "reports the %s profile recovery state",
    (status, message) => {
      expect(renderSettings(status)).toMatch(message);
    },
  );

  it("reuses the settings fields without profile transfer actions in game", () => {
    const html = renderToStaticMarkup(createElement(SettingsScreen, {
      context: "game",
      loadStatus: "loaded",
      moduleId: "module-1",
      onApply: async (profile) => profile,
      onBack: vi.fn(),
      profile: createDefaultProfile(),
    }));

    expect(html).toContain("Current game and future defaults");
    expect(html).toContain('aria-label="Back to Pause"');
    expect(html).not.toContain("<h2 id=\"profile-title\">Profile</h2>");
    expect(html).not.toContain("Import Profile");
    expect(html).not.toContain("Export Profile");
    expect(html).not.toContain("Export Full Backup");
    expect(html).not.toContain("Clear Local Data");
    expect(html).toContain("Enable Permanent Inventory");
    expect(html).toContain("Contents");
  });

  it("explains each presentation setting's game-session scope", () => {
    const html = renderToStaticMarkup(createElement(SettingsScreen, {
      context: "game",
      loadStatus: "loaded",
      moduleId: "module-1",
      onApply: async (profile) => profile,
      onBack: vi.fn(),
      profile: createDefaultProfile(),
    }));
    const information = visibleText(fieldsetMarkup(html, "Information level"));
    const endgame = visibleText(fieldsetMarkup(html, "Endgame style"));
    const character = visibleText(fieldsetMarkup(
      html,
      "Character setup style",
    ));
    const actionBar = visibleText(fieldsetMarkup(html, "Action bar"));

    expect(information).toMatch(/immediate(?:ly)?.*current game/i);
    expect(endgame).toMatch(
      /(?:current|this) game(?:'s)?(?: ending)?.*future defaults/i,
    );
    expect(character).toMatch(/next new game/i);
    expect(actionBar).toMatch(/immediate(?:ly)?.*current game/i);
  });
});

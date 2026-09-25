import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  flushStatus,
  resetGameState,
  setCommandInput,
  setRuntimePhase,
  setStatusFieldMetadata,
  setStatusValue,
  type StatusValue,
} from "../../game-state";
import {
  STATUS_FIELD_DEFINITIONS,
} from "../../status-metrics";
import {
  createDefaultProfile,
  type BlissHackProfile,
  type InformationLevel,
} from "../../settings/profile";
import { GameScreen } from "../GameScreen";

const ORIGINAL_LINE_ONE = [
  "title",
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
  "alignment",
  "score",
] as const;

const ORIGINAL_LINE_TWO = [
  "dungeon-level",
  "gold",
  "hitpoints",
  "hitpoints-max",
  "power",
  "power-max",
  "armor-class",
  "experience-level",
  "experience",
  "HD",
  "time",
  "hunger",
  "carrying-capacity",
  "condition",
  "weapon",
  "armor",
  "terrain",
  "version",
] as const;

/** Build one nonempty status value with optional core presentation metadata. */
function statusValue(
  field: number,
  overrides: Partial<StatusValue> = {},
): StatusValue {
  return {
    attributes: 0,
    change: 0,
    color: 8,
    conditionColors: [],
    percent: 50,
    text: `field-${field}`,
    ...overrides,
  };
}

/** Seed every NetHack 5.0 status field through the public game-state boundary. */
function seedAllStatusFields(): void {
  for (const definition of STATUS_FIELD_DEFINITIONS) {
    setStatusFieldMetadata(definition.field, {
      enabled: true,
      format: "%s",
      name: definition.id,
    });
    setStatusValue(
      definition.field,
      definition.field === 22
        ? statusValue(definition.field, {
          conditionColors: Object.assign(Array<number>(24).fill(0), {
            1: 0x00000002,
            10: 0x00400000,
            18: 0x00000002,
            21: 0x00400000,
          }),
          conditionMask: 0x00000002 | 0x00400000,
          text: "",
        })
        : statusValue(
          definition.field,
          definition.field === 0
            ? { attributes: 0x02, color: 1 }
            : {},
        ),
    );
  }
  flushStatus();
}

/** Render one Action bar mode with the requested information level. */
function renderStatus(
  actionBarStyle: "original" | "blisshack",
  informationLevel: InformationLevel,
): string {
  const profile = createDefaultProfile();
  profile.interface.actionBarStyle = actionBarStyle;
  profile.interface.informationLevel = informationLevel;
  return renderToStaticMarkup(createElement(GameScreen, {
    loadStatus: "loaded",
    moduleId: "module-original-status",
    sessionId: "session-original-status",
    onApplyProfile: async (candidate: BlissHackProfile) => candidate,
    profile,
  }));
}

/** Return semantic status field IDs assigned to one rendered TTY line. */
function fieldsOnLine(html: string, line: 1 | 2): string[] {
  const start = html.search(
    new RegExp(`<[^>]+data-status-line="${line}"[^>]*>`),
  );
  const next = line === 1
    ? html.search(/<[^>]+data-status-line="2"[^>]*>/)
    : html.length;
  if (start < 0 || next < 0) return [];
  return [
    ...html.slice(start, next).matchAll(/\bdata-status-field="([^"]+)"/g),
  ].map((match) => match[1]);
}

/** Return one opening tag carrying a semantic status identifier. */
function statusTag(html: string, id: string): string {
  return [...html.matchAll(/<[^>]+>/g)]
    .find((match) => match[0].includes(`data-status-field="${id}"`))?.[0]
    ?? "";
}

/** Return one opening tag carrying a semantic condition identifier. */
function conditionTag(html: string, id: string): string {
  return [...html.matchAll(/<[^>]+>/g)]
    .find((match) =>
      match[0].includes(`data-status-condition="${id}"`)
    )?.[0] ?? "";
}

beforeEach(() => {
  resetGameState();
  setRuntimePhase("running");
  setCommandInput(true);
});

describe("stage-eight Original TTY status", () => {
  it("[defect-probing] renders exactly the NetHack two-line field order without graphical bars", () => {
    seedAllStatusFields();
    const html = renderStatus("original", "original");

    expect(html.match(/\bdata-status-line="[12]"/g) ?? []).toHaveLength(2);
    expect(fieldsOnLine(html, 1)).toEqual(ORIGINAL_LINE_ONE);
    expect(fieldsOnLine(html, 2)).toEqual(ORIGINAL_LINE_TWO);
    expect(html).not.toContain("nh-status-bar");
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("nh-status-resource");
  });

  it("[defect-probing] uses metadata enablement and nonempty values for experience, time, and polymorph fields", () => {
    seedAllStatusFields();
    setStatusFieldMetadata(8, {
      enabled: false,
      format: "%s",
      name: "score",
    });
    setStatusFieldMetadata(13, {
      enabled: false,
      format: "%s",
      name: "experience-level",
    });
    setStatusFieldMetadata(15, {
      enabled: true,
      format: "%s",
      name: "HD",
    });
    setStatusFieldMetadata(16, {
      enabled: false,
      format: "%s",
      name: "time",
    });
    setStatusFieldMetadata(21, {
      enabled: false,
      format: "%s",
      name: "experience",
    });
    setStatusValue(24, statusValue(24, { text: "   " }));
    flushStatus();

    const html = renderStatus("original", "original");
    const fields = [...fieldsOnLine(html, 1), ...fieldsOnLine(html, 2)];

    expect(fields).not.toEqual(expect.arrayContaining([
      "score",
      "experience-level",
      "experience",
      "time",
      "armor",
    ]));
    expect(fields).toContain("HD");
  });

  it("[defect-probing] preserves field and condition colors and attributes independently", () => {
    seedAllStatusFields();
    const html = renderStatus("original", "original");

    expect(statusTag(html, "title")).toMatch(
      /\bclass="(?=[^"]*\bnh-color-red\b)(?=[^"]*\bnh-bold\b)[^"]*"/,
    );
    expect(conditionTag(html, "blind")).toMatch(
      /\bclass="(?=[^"]*\bnh-color-red\b)(?=[^"]*\bnh-bold\b)[^"]*"/,
    );
    expect(conditionTag(html, "stun")).toMatch(
      /\bclass="(?=[^"]*\bnh-color-bright-green\b)(?=[^"]*\bnh-underline\b)[^"]*"/,
    );
  });

  it("[defect-probing] changes only tooltip affordances across information levels and keeps BlissHack graphical", () => {
    seedAllStatusFields();
    const originalInformation = renderStatus("original", "original");
    const detailedInformation = renderStatus("original", "detailed");
    const blissHack = renderStatus("blisshack", "detailed");

    expect(originalInformation).not.toContain('role="tooltip"');
    expect(originalInformation).not.toContain("aria-describedby");
    expect(fieldsOnLine(originalInformation, 1)).toEqual(ORIGINAL_LINE_ONE);
    expect(fieldsOnLine(originalInformation, 2)).toEqual(ORIGINAL_LINE_TWO);
    expect(fieldsOnLine(detailedInformation, 1)).toEqual(ORIGINAL_LINE_ONE);
    expect(fieldsOnLine(detailedInformation, 2)).toEqual(ORIGINAL_LINE_TWO);
    expect(detailedInformation).toContain('role="tooltip"');
    expect(detailedInformation).toContain("aria-describedby");

    expect(blissHack).toContain("nh-status");
    expect(blissHack).toContain("nh-status-bar");
    expect(blissHack).toContain('role="progressbar"');
    expect(blissHack).not.toContain("nh-original-status");
  });
});

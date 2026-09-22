import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ExtendedCommand } from "../../game-state";
import * as gameModals from "./GameModals";
import { filterExtendedCommands } from "./extended-command-search";

const commands: ExtendedCommand[] = [
  {
    sourceIndex: 17,
    name: "chat",
    description: "talk to someone",
  },
  {
    sourceIndex: 23,
    name: "conduct",
    description: "list voluntary challenges",
  },
];

/**
 * Call the public extended-command filter contract expected by the overlay.
 * @param query - normalized or unnormalized player search text.
 * @param includeDescriptions - whether descriptions participate in matching.
 * @returns matching commands in source order.
 */
function filterCommands(
  query: string,
  includeDescriptions?: boolean,
): ExtendedCommand[] {
  return filterExtendedCommands(commands, query, includeDescriptions);
}

/** Return one opening tag selected by its exact accessible label. */
function openingTagForLabel(html: string, label: string): string {
  return [...html.matchAll(/<[^>]+>/g)]
    .find((match) => match[0].includes(`aria-label="${label}"`))?.[0] ?? "";
}

/** Return one attribute value from an opening HTML tag. */
function attributeValue(tag: string, attribute: string): string | null {
  return tag.match(new RegExp(`\\b${attribute}="([^"]+)"`))?.[1] ?? null;
}

describe("ExtendedCommandOverlay search", () => {
  it("includes command descriptions by default", () => {
    expect(filterCommands("talk")).toEqual([commands[0]]);
  });

  it("can exclude descriptions without disabling name-prefix matching", () => {
    expect(filterCommands("talk", false)).toEqual([]);
    expect(filterCommands("hat", false)).toEqual([]);
    expect(filterCommands("chat", false)).toEqual([commands[0]]);
    expect(filterCommands("chat", true)).toEqual([commands[0]]);
  });

  it("[defect-probing] renders an accessible custom tooltip for description search", () => {
    const renderOverlay = (): string => renderToStaticMarkup(createElement(
      gameModals.GameModalRenderer,
      {
        modal: { kind: "extcmd", commands },
      },
    ));
    const html = renderOverlay();
    const inputIndex = html.indexOf("<input");
    const toggleTag = openingTagForLabel(
      html,
      "Include descriptions in search",
    );
    const toggleIndex = html.indexOf(toggleTag);
    const tooltipId = attributeValue(toggleTag, "aria-describedby");
    const tooltip = html.match(
      /<([a-z]+)(?=[^>]*\brole="tooltip")([^>]*)>([^<]*)<\/\1>/,
    );
    const toggleEndIndex = html.indexOf("</button>", toggleIndex);
    const tooltipIndex = html.indexOf(tooltip?.[0] ?? "");

    expect(inputIndex).toBeGreaterThan(-1);
    expect(toggleIndex).toBeGreaterThan(inputIndex);
    expect(toggleTag).toMatch(/^<button\b/);
    expect(toggleTag).toContain('aria-pressed="true"');
    expect(toggleTag).not.toContain("title=");
    expect(tooltipId).toMatch(/^[A-Za-z][\w:.-]*$/);
    expect(tooltip).not.toBeNull();
    expect(toggleEndIndex).toBeGreaterThan(toggleIndex);
    expect(tooltipIndex).toBeGreaterThan(toggleEndIndex);
    expect(attributeValue(tooltip?.[0] ?? "", "id")).toBe(tooltipId);
    expect(attributeValue(tooltip?.[0] ?? "", "class")?.split(/\s+/))
      .toEqual(expect.arrayContaining(["nh-tooltip", "nh-control-tooltip"]));
    expect(tooltip?.[3]).toBe("Include descriptions in search");
    expect(
      attributeValue(
        openingTagForLabel(renderOverlay(), "Include descriptions in search"),
        "aria-describedby",
      ),
    ).toBe(tooltipId);
  });
});

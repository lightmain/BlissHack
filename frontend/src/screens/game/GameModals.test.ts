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

  it("renders the enabled description-search control beside the input", () => {
    const html = renderToStaticMarkup(createElement(
      gameModals.GameModalRenderer,
      {
        modal: { kind: "extcmd", commands },
      },
    ));
    const inputIndex = html.indexOf("<input");
    const toggleIndex = html.indexOf(
      'title="Include descriptions in search"',
    );

    expect(inputIndex).toBeGreaterThan(-1);
    expect(toggleIndex).toBeGreaterThan(inputIndex);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(
      /<button(?=[^>]*title="Include descriptions in search")(?=[^>]*aria-pressed="true")[^>]*>\?<\/button>/,
    );
  });
});

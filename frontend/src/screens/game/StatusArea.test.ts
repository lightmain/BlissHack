import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StatusMetric } from "../../status-metrics";
import { StatusArea } from "./StatusArea";

const metrics = [
  {
    id: "hitpoints",
    field: 18,
    label: "Hit points",
    text: "HP:42",
    percent: 67,
    change: -1,
    color: 9,
    attributes: 1,
    group: "resource",
    tooltip: {
      currentValue: "HP:42",
      description: "Current and maximum hit points.",
    },
  },
  {
    id: "power",
    field: 11,
    label: "Energy",
    text: "Pw:18",
    percent: 45,
    change: 1,
    color: 6,
    attributes: 0,
    group: "resource",
    tooltip: {
      currentValue: "Pw:18",
      description: "Current and maximum magical energy.",
    },
  },
  {
    id: "experience-level",
    field: 13,
    label: "Experience",
    text: "Xp:4",
    percent: 25,
    change: 0,
    color: 7,
    attributes: 0,
    group: "resource",
    tooltip: {
      currentValue: "Xp:4",
      description: "Current experience level and progress.",
    },
  },
  {
    id: "condition",
    field: 22,
    label: "Conditions",
    text: "Blind",
    change: 0,
    color: 8,
    attributes: 0,
    group: "condition",
    conditions: [
      {
        id: "blind",
        bit: 0x00000002,
        label: "Blind",
        color: 1,
        attributes: 0x02,
        tooltip: {
          currentValue: "Blind",
          description: "Sight is currently blocked.",
        },
      },
    ],
    tooltip: {
      currentValue: "Blind",
      description: "Conditions currently affecting the character.",
    },
  },
] as StatusMetric[];

describe("StatusArea", () => {
  it("statically renders compact semantic status groups and tooltips", () => {
    const html = renderToStaticMarkup(createElement(StatusArea, { metrics }));
    const progressbars = html.match(/<[^>]+role="progressbar"[^>]*>/g) ?? [];
    const primaryBars = progressbars.filter((tag) =>
      tag.includes('data-status-bar="primary"')
    );
    const secondaryBars = progressbars.filter((tag) =>
      tag.includes('data-status-bar="secondary"')
    );

    expect(progressbars).toHaveLength(3);
    expect(primaryBars).toHaveLength(2);
    expect(primaryBars.map((tag) => tag.match(/aria-valuenow="(\d+)"/)?.[1]))
      .toEqual(["67", "45"]);
    expect(secondaryBars).toHaveLength(1);
    expect(secondaryBars[0]).toContain('aria-valuenow="25"');

    expect(html).toContain('data-status-group="resource"');
    expect(html).toContain('data-status-group="condition"');
    expect(html).toContain('data-change="-1"');
    expect(html).toContain('data-change="0"');
    expect(html).toContain('data-change="1"');
    expect(html).toMatch(
      /class="(?=[^"]*\bnh-condition\b)(?=[^"]*\bnh-color-red\b)(?=[^"]*\bnh-bold\b)[^"]*"[^>]*>Blind</,
    );

    const tooltipText = [
      ...html.matchAll(
        /<([a-z]+)[^>]*role="tooltip"[^>]*>([\s\S]*?)<\/\1>/g,
      ),
    ].map((match) => match[2].replace(/<[^>]+>/g, ""));
    expect(tooltipText).toEqual([
      "HP:42Current and maximum hit points.",
      "Pw:18Current and maximum magical energy.",
      "Xp:4Current experience level and progress.",
      "BlindSight is currently blocked.",
    ]);
  });

  it("leaves Tab navigation on every focusable tooltip to the browser", () => {
    const html = renderToStaticMarkup(createElement(StatusArea, { metrics }));
    const focusableEntries = html.match(
      /<span[^>]*tabindex="0"[^>]*>/g,
    ) ?? [];

    expect(focusableEntries).toHaveLength(4);
    expect(focusableEntries.every((tag) =>
      tag.includes("data-browser-tab-navigation")
    )).toBe(true);
  });

  it("keeps maximum-level XP text without rendering a progressbar", () => {
    const html = renderToStaticMarkup(createElement(StatusArea, {
      metrics: [{
        ...metrics[2],
        text: "Xp:30",
        percent: undefined,
        tooltip: {
          ...metrics[2].tooltip,
          currentValue: "Xp:30",
        },
      }],
    }));

    expect(html).toContain("Xp:30");
    expect(html).not.toContain('role="progressbar"');
  });

  it("renders HP, Energy, and XP in semantic order regardless of input order", () => {
    const html = renderToStaticMarkup(createElement(StatusArea, {
      metrics: [metrics[1], metrics[2], metrics[0]],
    }));
    const progressbarLabels = [
      ...html.matchAll(/<[^>]+role="progressbar"[^>]*>/g),
    ].map((match) => match[0].match(/aria-label="([^"]+)"/)?.[1]);

    expect(progressbarLabels).toEqual([
      "Hit points: HP:42",
      "Energy: Pw:18",
      "Experience: Xp:4",
    ]);
  });

  it("inherits the HUD color for NetHack NO_COLOR metrics", () => {
    const html = renderToStaticMarkup(createElement(StatusArea, {
      metrics: [{ ...metrics[1], color: 8 }],
    }));
    const metricTag = html.match(
      /<span[^>]*aria-describedby="status-tooltip-power"[^>]*>/,
    )?.[0];
    const className = metricTag?.match(/class="([^"]*)"/)?.[1] ?? "";

    expect(metricTag).toBeDefined();
    expect(className).not.toMatch(/\bnh-color-/);
    expect(html).not.toContain("nh-color-dark-gray");
  });
});

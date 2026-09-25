import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { planLocalInspectActivity } from "../../interactions/local-inspect-activity";
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
  it("[defect-probing] keeps shared overlay ownership until pointer and focus both leave", () => {
    expect(planLocalInspectActivity).toBeTypeOf("function");

    const inactive = { focused: false, pointerInside: false };
    const hovered = planLocalInspectActivity(inactive, "pointer-enter").next;
    const hoveredAndFocused = planLocalInspectActivity(hovered, "focus").next;

    const afterPointerLeave = planLocalInspectActivity(
      hoveredAndFocused,
      "pointer-leave",
    );
    expect(afterPointerLeave).toEqual({
      leaveSharedOverlay: false,
      next: { focused: true, pointerInside: false },
    });

    expect(planLocalInspectActivity(afterPointerLeave.next, "blur")).toEqual({
      leaveSharedOverlay: true,
      next: { focused: false, pointerInside: false },
    });
  });

  it("statically renders compact semantic status groups and tooltips", () => {
    const html = renderToStaticMarkup(createElement(StatusArea, {
      informationLevel: "detailed",
      metrics,
    }));
    const progressbars: string[] =
      html.match(/<[^>]+role="progressbar"[^>]*>/g) ?? [];
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
    expect(html).toContain('data-status-field="hitpoints"');
    expect(html).toContain('data-status-field="condition"');
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
    const html = renderToStaticMarkup(createElement(StatusArea, {
      informationLevel: "detailed",
      metrics,
    }));
    const focusableEntries: string[] = html.match(
      /<span[^>]*tabindex="0"[^>]*>/g,
    ) ?? [];

    expect(focusableEntries).toHaveLength(4);
    expect(focusableEntries.every((tag) =>
      tag.includes("data-browser-tab-navigation")
    )).toBe(true);
  });

  it("exposes local inspect targets while retaining hidden described-by text", () => {
    const html = renderToStaticMarkup(createElement(StatusArea, {
      informationLevel: "detailed",
      metrics,
      onInspect: vi.fn(),
      onInspectLeave: vi.fn(),
    }));
    const inspectEntries = [
      ...html.matchAll(
        /<span(?=[^>]*data-inspect-target="([^"]+)")(?=[^>]*aria-describedby="([^"]+)")(?=[^>]*tabindex="0")[^>]*>/g,
      ),
    ];

    expect(inspectEntries.map((match) => match[1])).toEqual([
      "status:hitpoints",
      "status:power",
      "status:experience-level",
      "status:condition:blind",
    ]);
    expect(inspectEntries.map((match) => match[2])).toEqual([
      "status-tooltip-hitpoints",
      "status-tooltip-power",
      "status-tooltip-experience-level",
      "status-tooltip-condition-blind",
    ]);
    expect(html.match(/\bclass="nh-status-tooltip"/g) ?? []).toHaveLength(4);
    expect(html).toContain(
      '<span class="nh-status-tooltip" id="status-tooltip-hitpoints" role="tooltip">',
    );
    expect(html).toContain("HP:42");
    expect(html).toContain("Current and maximum hit points.");
    expect(html).not.toContain("nh-inspect-tooltip");
    expect(html).not.toContain("nh-overlay-root");
  });

  it("[defect-probing] omits explanatory inspection in original mode without changing status semantics", () => {
    const experience = {
      id: "experience",
      field: 21,
      label: "Experience points",
      description: "Experience points earned toward advancement.",
      text: "Exp:123",
      change: 0,
      color: 7,
      attributes: 0,
      group: "resource",
      tooltip: {
        currentValue: "Exp:123",
        description: "Experience points earned toward advancement.",
      },
    } satisfies StatusMetric;
    const original = renderToStaticMarkup(createElement(StatusArea, {
      informationLevel: "original",
      metrics: [...metrics, experience],
      onInspect: vi.fn(),
      onInspectLeave: vi.fn(),
    }));
    const detailed = renderToStaticMarkup(createElement(StatusArea, {
      informationLevel: "detailed",
      metrics: [...metrics, experience],
      onInspect: vi.fn(),
      onInspectLeave: vi.fn(),
    }));
    const progressSemantics = (html: string) =>
      [...html.matchAll(/<span(?=[^>]*role="progressbar")[^>]*>/g)]
        .map((match) => ({
          label: match[0].match(/aria-label="([^"]+)"/)?.[1],
          max: match[0].match(/aria-valuemax="([^"]+)"/)?.[1],
          min: match[0].match(/aria-valuemin="([^"]+)"/)?.[1],
          now: match[0].match(/aria-valuenow="([^"]+)"/)?.[1],
        }));

    expect(original).not.toContain('role="tooltip"');
    expect(original).not.toContain("aria-describedby");
    expect(original).not.toContain("data-inspect-target");
    expect(original).not.toContain("tabindex");
    expect(original).toContain('aria-label="Character status"');
    expect(original).toContain("HP:42");
    expect(original).toContain("Pw:18");
    expect(original).toContain("Xp:4");
    expect(original).toContain("Exp:123");
    expect(original).toContain("Blind");
    expect(progressSemantics(original)).toEqual(progressSemantics(detailed));
    expect(detailed).toContain('role="tooltip"');
    expect(detailed).toContain("Exp:123");
    expect(detailed).toContain("Experience points earned toward advancement.");
  });

  it("keeps maximum-level XP text without rendering a progressbar", () => {
    const html = renderToStaticMarkup(createElement(StatusArea, {
      informationLevel: "detailed",
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
      informationLevel: "detailed",
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
      informationLevel: "detailed",
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

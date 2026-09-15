import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InspectTooltip } from "./InspectTooltip";
import { OverlayRoot } from "./OverlayRoot";

describe("OverlayRoot and InspectTooltip", () => {
  it("exposes ephemeral inspection text without modal or focus semantics", () => {
    const html = renderToStaticMarkup(
      createElement(
        OverlayRoot,
        null,
        createElement(InspectTooltip, {
          content: {
            title: "a peaceful grid bug",
            description: "It is moving slowly.",
          },
          id: "map-inspect-tooltip",
          position: {
            horizontal: "after",
            left: 240,
            top: 168,
            vertical: "after",
          },
        }),
      ),
    );

    expect(html).toContain('data-overlay-root="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-relevant="additions text"');
    expect(html).toContain('id="map-inspect-tooltip"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("a peaceful grid bug");
    expect(html).toContain("It is moving slowly.");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("tabindex=");
    expect(html).not.toMatch(/<(?:button|input|select|textarea|a)\b/);
  });
});

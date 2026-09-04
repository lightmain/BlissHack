import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FatalScreen } from "./FatalScreen";

/** Render the fatal screen with inert actions and one ownership mode. */
function renderFatal(hasFailedSession: boolean): string {
  return renderToStaticMarkup(createElement(FatalScreen, {
    errorId: "BH-TEST0001",
    hasFailedSession,
    onExportDiagnostics: vi.fn(),
    onReload: vi.fn(),
    onReturnHome: vi.fn(),
  }));
}

describe("FatalScreen", () => {
  it("offers reload when an unsafe game session failed", () => {
    const html = renderFatal(true);

    expect(html).toContain("BH-TEST0001");
    expect(html).toContain("Export Diagnostic Log");
    expect(html).toContain("Reload Application");
    expect(html).not.toContain("Return Home");
  });

  it("offers a fresh Home module when no game session is active", () => {
    const html = renderFatal(false);

    expect(html).toContain("Export Diagnostic Log");
    expect(html).toContain("Return Home");
    expect(html).not.toContain("Reload Application");
  });
});

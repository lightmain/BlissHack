import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SavePickerPopover } from "./SavePickerPopover";

describe("SavePickerPopover", () => {
  it("renders ready saves and keeps invalid saves disabled", () => {
    const html = renderToStaticMarkup(createElement(SavePickerPopover, {
      moduleId: "module-1",
      onContinue: vi.fn(),
      saves: [
        {
          path: "/save/0Ada",
          status: "ready",
          identity: { playerName: "Ada" },
        },
        {
          path: "/save/0Broken",
          status: "invalid",
          error: "Save is incompatible or damaged",
        },
      ],
    }));

    expect(html).toMatch(/role="dialog"/);
    expect(html).toMatch(/aria-label="Saved games"/);
    expect(html).toMatch(/Ada/);
    expect(html).toMatch(/incompatible|damaged/i);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*Broken/i);
    expect(html).not.toMatch(/>\s*Back\s*</);
  });
});

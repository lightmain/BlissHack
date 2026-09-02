import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

interface SaveListEntry {
  path: string;
  status: "ready" | "invalid";
  identity?: {
    playerName: string;
  };
  error?: string;
}

interface SavePickerProps {
  moduleId: string;
  onBack: () => void;
  onContinue: (save: SaveListEntry) => void;
  saves: SaveListEntry[];
}

interface SavePickerModule {
  SavePickerScreen: ComponentType<SavePickerProps>;
}

/**
 * Load the future SavePicker screen at test execution time.
 * @returns screen module under test.
 */
async function loadSavePicker(): Promise<SavePickerModule> {
  const implementationUrl = new URL("./SavePickerScreen.tsx", import.meta.url).href;
  return import(/* @vite-ignore */ implementationUrl) as Promise<SavePickerModule>;
}

describe("SavePickerScreen", () => {
  it("renders validated identity and keeps unreadable saves disabled", async () => {
    const { SavePickerScreen } = await loadSavePicker();
    const html = renderToStaticMarkup(createElement(SavePickerScreen, {
      moduleId: "module-1",
      onBack: vi.fn(),
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

    expect(html).toMatch(/Ada/);
    expect(html).toMatch(/incompatible|damaged/i);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*Broken/i);
    expect(html).toMatch(/<button[^>]*>[\s\S]*Back[\s\S]*<\/button>/i);
  });
});

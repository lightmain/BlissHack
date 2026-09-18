import type {
  MenuItem,
  TextLine,
  WindowState,
} from "../game-state";

export type EndgameStyle = "original" | "blisshack";

export interface EndgameCollectorOwner {
  moduleId: string;
  sessionId: string;
}

export type EndgameCollectorPhase =
  | "idle"
  | "collecting-disclosure"
  | "collecting-summary"
  | "collecting-ranking"
  | "complete"
  | "fallback";

export type EndgameCollectorResetReason =
  | "bridge-reset"
  | "fatal"
  | "session-replaced";

export interface EndgameWindowSnapshot {
  id: number;
  type: number;
  lines: readonly TextLine[];
  menuItems: readonly MenuItem[];
  menuPrompt: string;
}

export type EndgameContentBlock =
  | {
    kind: "text";
    sourceWindowId: number | null;
    lines: readonly TextLine[];
  }
  | {
    kind: "menu";
    sourceWindowId: number;
    prompt: string;
    items: readonly MenuItem[];
  };

export interface EndgameSection {
  kind: "summary" | "disclosure" | "ranking";
  title: string;
  blocks: readonly EndgameContentBlock[];
}

export interface EndgameSummary {
  owner: EndgameCollectorOwner;
  sections: readonly EndgameSection[];
}

export type EndgameCollectorDecision =
  | { kind: "pass" }
  | { kind: "resolve"; value?: number };

export type EndgameCollectorEvent =
  | {
    type: "yn";
    query: string;
    choices: string | null;
    defaultCode: number;
  }
  | {
    type: "window-created";
    windowId: number;
    windowType: number;
  }
  | {
    type: "window-destroyed";
    windowId: number;
  }
  | {
    type: "display-window";
    window: EndgameWindowSnapshot;
    blocking: boolean;
  }
  | {
    type: "select-menu";
    window: EndgameWindowSnapshot;
    how: number;
  }
  | {
    type: "raw-print";
    line: TextLine;
  }
  | {
    type: "input-request";
    inputKind: "getlin" | "extended-command";
  };

export interface EndgameCollectorState {
  phase: EndgameCollectorPhase;
  owner: EndgameCollectorOwner | null;
  currentDisclosureTitle: string | null;
  fallbackReason: string | null;
  summary: EndgameSummary | null;
}

export interface EndgameCollector {
  handle(event: EndgameCollectorEvent): EndgameCollectorDecision;
  getState(): Readonly<EndgameCollectorState>;
  complete(): EndgameSummary | null;
  setStyle(style: EndgameStyle): void;
  reset(reason: EndgameCollectorResetReason): void;
}

export interface EndgameCollectorOptions {
  owner: EndgameCollectorOwner;
  style: EndgameStyle;
  isGameOver(): boolean;
}

export interface StageFiveCollectorApi {
  createEndgameCollector(options: EndgameCollectorOptions): EndgameCollector;
}

/**
 * Build a window snapshot without sharing mutable arrays with assertions.
 * @param window - partial window fields supplied by one scenario.
 * @returns a complete window snapshot for collector events.
 */
export function endgameWindowFixture(
  window: Pick<WindowState, "id" | "type">
    & Partial<Pick<WindowState, "lines" | "menuItems" | "menuPrompt">>,
): EndgameWindowSnapshot {
  return {
    id: window.id,
    type: window.type,
    lines: window.lines?.map((line) => ({ ...line })) ?? [],
    menuItems: window.menuItems?.map((item) => ({
      ...item,
      glyph: item.glyph ? { ...item.glyph } : null,
    })) ?? [],
    menuPrompt: window.menuPrompt ?? "",
  };
}

/**
 * Build one complete menu row for collector fixture windows.
 * @param text - menu text preserved in the final summary.
 * @returns a decoded menu item with deterministic metadata.
 */
export function endgameMenuItemFixture(text: string): MenuItem {
  return {
    glyph: null,
    identifier: 1,
    accelerator: "a".charCodeAt(0),
    groupAccelerator: 0,
    attribute: 0,
    color: 7,
    text,
    itemFlags: 0,
  };
}

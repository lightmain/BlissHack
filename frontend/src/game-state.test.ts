import { beforeEach, describe, expect, it, vi } from "vitest";
import * as gameState from "./game-state";
import {
  ATR_NOHISTORY,
  COLNO,
  MENU_BEHAVE_PERMINV,
  MENU_BEHAVE_STANDARD,
  NHW_MAP,
  NHW_MENU,
  NHW_MESSAGE,
  NHW_TEXT,
  ROWNO,
  addMenuItem,
  appendWindowText,
  beginMenu,
  clearModal,
  clearWindow,
  createWindow,
  destroyWindow,
  endMenu,
  flushDisplay,
  flushStatus,
  getSnapshot,
  getWindow,
  resetGameState,
  resetStatus,
  setClipCenter,
  setCursor,
  setInputRequest,
  setMapCell,
  setNumberPad,
  setInventoryWindow,
  setRuntimePhase,
  setStatusValue,
  showMenu,
  showText,
  subscribe,
} from "./game-state";

interface ExpectedStatusFieldMetadata {
  name: string;
  format: string;
  enabled: boolean;
}

const expectedGameState = gameState as typeof gameState & {
  beginMapInspectMessageCapture?: () => unknown;
  cancelMapInspectMessageCapture?: (capture: unknown) => void;
  finishMapInspectMessageCapture?: (
    capture: unknown,
  ) => readonly gameState.TextLine[] | null;
  setStatusFieldMetadata: (
    field: number,
    metadata: ExpectedStatusFieldMetadata,
  ) => void;
};

function statusMetadata(): Record<number, ExpectedStatusFieldMetadata> {
  return (getSnapshot() as ReturnType<typeof getSnapshot> & {
    statusMetadata: Record<number, ExpectedStatusFieldMetadata>;
  }).statusMetadata;
}

beforeEach(() => {
  resetGameState();
});

describe("game state windows", () => {
  it("creates unique windows and preserves their declared types", () => {
    const message = createWindow(NHW_MESSAGE);
    const map = createWindow(NHW_MAP);

    expect(message).not.toBe(map);
    expect(getWindow(message)?.type).toBe(NHW_MESSAGE);
    expect(getWindow(map)?.type).toBe(NHW_MAP);
  });

  it("routes message text to display messages and persistent history", () => {
    const message = createWindow(NHW_MESSAGE);

    appendWindowText(message, 0, "first");
    appendWindowText(message, ATR_NOHISTORY, "transient");

    expect(getSnapshot().messages.map((line) => line.text)).toEqual([
      "first",
      "transient",
    ]);
    expect(getSnapshot().messageHistory.map((line) => line.text)).toEqual([
      "first",
    ]);
  });

  it("[defect-probing] captures only clicklook no-history output while map inspection is active", () => {
    const beginCapture = expectedGameState.beginMapInspectMessageCapture;
    const finishCapture = expectedGameState.finishMapInspectMessageCapture;
    expect(beginCapture).toBeTypeOf("function");
    expect(finishCapture).toBeTypeOf("function");
    if (!beginCapture || !finishCapture) return;

    const message = createWindow(NHW_MESSAGE);
    appendWindowText(message, 0, "before inspection");
    const capture = beginCapture();

    appendWindowText(message, 0, "ordinary message during inspection");
    appendWindowText(message, ATR_NOHISTORY, "a peaceful grid bug");

    expect(getSnapshot().messages.map((line) => line.text)).toEqual([
      "before inspection",
      "ordinary message during inspection",
    ]);
    expect(getSnapshot().messageHistory.map((line) => line.text)).toEqual([
      "before inspection",
      "ordinary message during inspection",
    ]);
    expect(finishCapture(capture)).toEqual([
      { text: "a peaceful grid bug", attribute: ATR_NOHISTORY },
    ]);

    appendWindowText(message, ATR_NOHISTORY, "ordinary transient output");
    expect(getSnapshot().messages.map((line) => line.text)).toEqual([
      "before inspection",
      "ordinary message during inspection",
      "ordinary transient output",
    ]);
    expect(getSnapshot().messageHistory.map((line) => line.text)).toEqual([
      "before inspection",
      "ordinary message during inspection",
    ]);
  });

  it("clears an active map-inspect message capture on game-state reset", () => {
    const beginCapture = expectedGameState.beginMapInspectMessageCapture;
    const finishCapture = expectedGameState.finishMapInspectMessageCapture;
    expect(beginCapture).toBeTypeOf("function");
    expect(finishCapture).toBeTypeOf("function");
    if (!beginCapture || !finishCapture) return;

    const message = createWindow(NHW_MESSAGE);
    const capture = beginCapture();
    appendWindowText(message, ATR_NOHISTORY, "stale description");

    resetGameState();

    expect(finishCapture(capture)).toBeNull();
    appendWindowText(-1, ATR_NOHISTORY, "new session transient output");
    expect(getSnapshot().messages.map((line) => line.text)).toEqual([
      "new session transient output",
    ]);
  });

  it("stores text-window lines and clears or destroys the target window", () => {
    const text = createWindow(NHW_TEXT);
    appendWindowText(text, 1, "heading");
    appendWindowText(text, 0, "body");
    expect(getWindow(text)?.lines.map((line) => line.text)).toEqual([
      "heading",
      "body",
    ]);

    clearWindow(text);
    expect(getWindow(text)?.lines).toEqual([]);

    destroyWindow(text);
    expect(getWindow(text)).toBeUndefined();
  });

  it("does not publish while an undisplayed text window is being assembled", () => {
    const text = createWindow(NHW_TEXT);
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    appendWindowText(text, 1, "heading");
    appendWindowText(text, 0, "body");
    clearWindow(text);
    destroyWindow(text);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe("game state map and cursor", () => {
  it("uses the official 80 by 21 map dimensions", () => {
    expect(getSnapshot().map).toHaveLength(ROWNO);
    expect(getSnapshot().map[0]).toHaveLength(COLNO);
  });

  it("buffers glyph changes until a display flush", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    setMapCell(10, 4, {
      glyph: 12,
      ttyChar: 64,
      frameColor: 0,
      glyphFlags: 1,
      color: 15,
      symbolIndex: 0,
      customColor: 0,
      color256: 0,
      tileIndex: 0,
    }, null);
    expect(listener).not.toHaveBeenCalled();

    flushDisplay();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSnapshot().map[4][10].foreground?.ttyChar).toBe(64);

    unsubscribe();
  });

  it("replaces only dirty map rows when buffered glyphs are flushed", () => {
    const before = getSnapshot().map;
    const changedRow = before[4];
    const untouchedRow = before[5];

    setMapCell(10, 4, {
      glyph: 12,
      ttyChar: 64,
      frameColor: 0,
      glyphFlags: 1,
      color: 15,
      symbolIndex: 0,
      customColor: 0,
      color256: 0,
      tileIndex: 0,
    }, null);

    expect(before[4][10].foreground).toBeNull();
    flushDisplay();

    const after = getSnapshot().map;
    expect(after).not.toBe(before);
    expect(after[4]).not.toBe(changedRow);
    expect(after[5]).toBe(untouchedRow);
    expect(after[4][10].foreground?.ttyChar).toBe(64);
  });

  it("does not notify subscribers for an empty display flush", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    flushDisplay();

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("ignores column zero and out-of-bounds glyph coordinates", () => {
    const glyph = {
      glyph: 1,
      ttyChar: 35,
      frameColor: 0,
      glyphFlags: 0,
      color: 7,
      symbolIndex: 0,
      customColor: 0,
      color256: 0,
      tileIndex: 0,
    };

    setMapCell(0, 0, glyph, null);
    setMapCell(COLNO, 0, glyph, null);
    setMapCell(1, ROWNO, glyph, null);
    flushDisplay();

    expect(getSnapshot().map.flat().every((cell) => cell.foreground === null)).toBe(true);
  });

  it("tracks the cursor independently from map cells", () => {
    const map = createWindow(NHW_MAP);
    setCursor(map, 20, 8);
    expect(getSnapshot().cursor).toEqual({ x: 20, y: 8, visible: true });
  });

  it("does not publish an unchanged cursor position", () => {
    const map = createWindow(NHW_MAP);
    const listener = vi.fn();
    setCursor(map, 20, 8);
    const unsubscribe = subscribe(listener);

    setCursor(map, 20, 8);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("publishes repeated clip centers as distinct Follow requests", () => {
    setClipCenter(20, 8);
    const initial = getSnapshot();
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    setClipCenter(20, 8);
    const repeated = getSnapshot();
    setClipCenter(21, 9);
    const changed = getSnapshot();
    unsubscribe();

    expect(repeated).not.toBe(initial);
    expect(repeated.revision).toBe(initial.revision + 1);
    expect(repeated.clipCenter).toEqual({ x: 20, y: 8 });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(changed).not.toBe(initial);
    expect(changed.revision).toBe(initial.revision + 2);
    expect(changed.clipCenter).toEqual({ x: 21, y: 9 });
  });
});

describe("game state menus and prompts", () => {
  it("preserves menu behavior and all menu item metadata", () => {
    const menu = createWindow(NHW_MENU);

    beginMenu(menu, MENU_BEHAVE_PERMINV);
    addMenuItem(menu, {
      glyph: null,
      identifier: 7,
      accelerator: 97,
      groupAccelerator: 0,
      attribute: 1,
      color: 2,
      text: "a - a mace",
      itemFlags: 1,
    });

    expect(getWindow(menu)?.menuBehavior).toBe(MENU_BEHAVE_PERMINV);
    expect(getWindow(menu)?.menuItems[0]).toEqual({
      glyph: null,
      identifier: 7,
      accelerator: 97,
      groupAccelerator: 0,
      attribute: 1,
      color: 2,
      text: "a - a mace",
      itemFlags: 1,
    });

    beginMenu(menu, MENU_BEHAVE_STANDARD);
    expect(getWindow(menu)?.menuItems).toEqual([]);
    expect(getWindow(menu)?.menuBehavior).toBe(MENU_BEHAVE_STANDARD);
  });

  it("publishes and clears modal and input state", () => {
    const menu = createWindow(NHW_MENU);
    beginMenu(menu, MENU_BEHAVE_STANDARD);
    showMenu(menu, 1);
    expect(getSnapshot().modal).toEqual({
      kind: "menu",
      windowId: menu,
      how: 1,
    });

    showText("Help", [{ text: "line", attribute: 0 }]);
    expect(getSnapshot().modal?.kind).toBe("text");

    setInputRequest({ kind: "yn", query: "Really?", choices: "yn", defaultCode: 110 });
    expect(getSnapshot().inputRequest?.kind).toBe("yn");

    clearModal();
    setInputRequest(null);
    expect(getSnapshot().modal).toBeNull();
    expect(getSnapshot().inputRequest).toBeNull();
  });

  it("commits immutable permanent inventory snapshots with monotonic revisions", () => {
    const inventory = createWindow(NHW_MENU);
    const firstItem = {
      glyph: null,
      identifier: 41,
      accelerator: "a".charCodeAt(0),
      groupAccelerator: 0,
      attribute: 1,
      color: 2,
      text: "a - a mace",
      itemFlags: 1,
    };

    beginMenu(inventory, MENU_BEHAVE_PERMINV);
    addMenuItem(inventory, firstItem);
    endMenu(inventory, "Inventory");
    expect(getSnapshot().permanentInventory).toBeNull();

    setInventoryWindow(inventory);
    const first = getSnapshot().permanentInventory;
    expect(first).toEqual({
      revision: 1,
      windowId: inventory,
      prompt: "Inventory",
      items: [firstItem],
    });

    beginMenu(inventory, MENU_BEHAVE_PERMINV);
    addMenuItem(inventory, { ...firstItem, identifier: 99, accelerator: 98, text: "b - a wand" });
    expect(getSnapshot().permanentInventory).toBe(first);
    expect(first?.items[0]).toEqual(firstItem);

    endMenu(inventory, "Carrying");
    setInventoryWindow(inventory);
    expect(getSnapshot().permanentInventory).toEqual({
      revision: 2,
      windowId: inventory,
      prompt: "Carrying",
      items: [{ ...firstItem, identifier: 99, accelerator: 98, text: "b - a wand" }],
    });
  });

  it("keeps the last permanent inventory after destroy and clears it on reset", () => {
    const inventory = createWindow(NHW_MENU);
    beginMenu(inventory, MENU_BEHAVE_PERMINV);
    endMenu(inventory, "Inventory");
    setInventoryWindow(inventory);
    const committed = getSnapshot().permanentInventory;

    const ordinary = createWindow(NHW_MENU);
    beginMenu(ordinary, MENU_BEHAVE_STANDARD);
    endMenu(ordinary, "Choose");
    showMenu(ordinary, 1);
    expect(getSnapshot().permanentInventory).toBe(committed);

    destroyWindow(inventory);
    expect(getSnapshot().inventoryWindowId).toBeNull();
    expect(getSnapshot().permanentInventory).toBe(committed);

    beginMenu(ordinary, MENU_BEHAVE_PERMINV);
    endMenu(ordinary, "New session item");
    setInventoryWindow(ordinary);
    resetGameState();
    expect(getSnapshot().permanentInventory).toBeNull();
  });
});

describe("game state status and runtime flags", () => {
  it("commits status fields atomically on BL_FLUSH", () => {
    setStatusValue(0, {
      text: "Ada the Tourist",
      change: 0,
      percent: 0,
      color: 7,
      attributes: 0,
      conditionColors: [],
    });
    expect(getSnapshot().status).toEqual({});

    flushStatus();
    expect(getSnapshot().status[0]?.text).toBe("Ada the Tourist");

    resetStatus();
    expect(getSnapshot().status).toEqual({});
  });

  it("publishes immutable field metadata and tracks dynamic enablement", () => {
    const initialSnapshot = getSnapshot();

    expectedGameState.setStatusFieldMetadata(8, {
      name: "score",
      format: " S:%s",
      enabled: true,
    });
    const enabledSnapshot = getSnapshot();
    const enabledMetadata = statusMetadata();

    expect(
      (initialSnapshot as typeof initialSnapshot & {
        statusMetadata: Record<number, ExpectedStatusFieldMetadata>;
      }).statusMetadata,
    ).toEqual({});
    expect(enabledMetadata[8]).toEqual({
      name: "score",
      format: " S:%s",
      enabled: true,
    });

    expectedGameState.setStatusFieldMetadata(8, {
      name: "score",
      format: " S:%s",
      enabled: false,
    });

    expect(getSnapshot()).not.toBe(enabledSnapshot);
    expect(statusMetadata()).not.toBe(enabledMetadata);
    expect(enabledMetadata[8]?.enabled).toBe(true);
    expect(statusMetadata()[8]?.enabled).toBe(false);
  });

  it("clears committed and pending values when a field is disabled", () => {
    expectedGameState.setStatusFieldMetadata(8, {
      name: "score",
      format: " S:%s",
      enabled: true,
    });
    setStatusValue(8, {
      text: "S:10",
      change: 0,
      percent: 0,
      color: 7,
      attributes: 0,
      conditionColors: [],
    });
    flushStatus();
    setStatusValue(8, {
      text: "S:20",
      change: 1,
      percent: 0,
      color: 7,
      attributes: 0,
      conditionColors: [],
    });

    expectedGameState.setStatusFieldMetadata(8, {
      name: "score",
      format: " S:%s",
      enabled: false,
    });
    expect(getSnapshot().status[8]).toBeUndefined();

    flushStatus();
    expect(getSnapshot().status[8]).toBeUndefined();

    expectedGameState.setStatusFieldMetadata(8, {
      name: "score",
      format: " S:%s",
      enabled: true,
    });
    expect(getSnapshot().status[8]).toBeUndefined();

    flushStatus();
    expect(getSnapshot().status[8]).toBeUndefined();
  });

  it("leaves input state and prior snapshots unchanged when status is flushed", () => {
    setInputRequest({
      kind: "yn",
      query: "Really?",
      choices: "yn",
      defaultCode: 110,
    });
    const before = getSnapshot();
    const inputRequest = before.inputRequest;
    const value = {
      text: "Ada the Tourist",
      change: 1,
      percent: 80,
      color: 4,
      attributes: 1,
      conditionColors: [],
    };

    setStatusValue(0, value);
    flushStatus();

    expect(value).toEqual({
      text: "Ada the Tourist",
      change: 1,
      percent: 80,
      color: 4,
      attributes: 1,
      conditionColors: [],
    });
    expect(before.status).toEqual({});
    expect(before.inputRequest).toBe(inputRequest);
    expect(getSnapshot().inputRequest).toBe(inputRequest);
  });

  it("tracks phase and number-pad mode", () => {
    setRuntimePhase("running");
    setNumberPad(true);

    expect(getSnapshot().phase).toBe("running");
    expect(getSnapshot().numberPad).toBe(true);
  });
});

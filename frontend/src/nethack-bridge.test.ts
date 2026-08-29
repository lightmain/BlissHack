import { describe, it, expect, beforeEach } from "vitest";
import {
  shimCallback,
  sendKey,
  isWaitingForInput,
  onEvent,
  getReceivedEvents,
  resetState,
} from "./nethack-bridge";

beforeEach(() => {
  resetState();
  (globalThis as Record<string, unknown>).nethackGlobal = { globals: { flags: {} } };
});

describe("shimCallback: window lifecycle", () => {
  it("shim_init_nhwindows returns undefined", async () => {
    expect(await shimCallback("shim_init_nhwindows")).toBeUndefined();
  });

  it("shim_create_nhwindow returns incrementing IDs", async () => {
    expect(await shimCallback("shim_create_nhwindow", 1)).toBe(0);
    expect(await shimCallback("shim_create_nhwindow", 2)).toBe(1);
    expect(await shimCallback("shim_create_nhwindow", 3)).toBe(2);
  });

  it("shim_clear/display/destroy_nhwindow return undefined", async () => {
    expect(await shimCallback("shim_clear_nhwindow", 0)).toBeUndefined();
    expect(await shimCallback("shim_display_nhwindow", 0, 0)).toBeUndefined();
    expect(await shimCallback("shim_destroy_nhwindow", 0)).toBeUndefined();
  });
});

describe("shimCallback: player setup", () => {
  it("shim_player_selection_or_tty returns false and sets flags to random", async () => {
    const flags = { initrole: 0, initrace: 0, initgend: 0, initalign: 0 };
    (globalThis as Record<string, unknown>).nethackGlobal = { globals: { flags } };

    const result = await shimCallback("shim_player_selection_or_tty");
    expect(result).toBe(false);
    expect(flags.initrole).toBe(-1);
    expect(flags.initrace).toBe(-1);
    expect(flags.initgend).toBe(-1);
    expect(flags.initalign).toBe(-1);
  });

  it("shim_askname sets svp.plname on globals", async () => {
    const svp: Record<string, unknown> = {};
    const globals: Record<string, unknown> = { flags: {}, svp };
    (globalThis as Record<string, unknown>).nethackGlobal = { globals };

    await shimCallback("shim_askname");
    expect(svp.plname).toBe("BlissHack");
  });

  it("shim_askname is safe when globals.svp is missing", async () => {
    (globalThis as Record<string, unknown>).nethackGlobal = { globals: { flags: {} } };
    await shimCallback("shim_askname"); // should not throw
  });

  it("shim_player_selection_or_tty is safe when globals.flags is missing", async () => {
    (globalThis as Record<string, unknown>).nethackGlobal = { globals: {} };
    const result = await shimCallback("shim_player_selection_or_tty");
    expect(result).toBe(false); // still returns false
  });
});

describe("shimCallback: input handling", () => {
  it("shim_nhgetch blocks until sendKey resolves it", async () => {
    expect(isWaitingForInput()).toBe(false);

    const promise = shimCallback("shim_nhgetch");
    expect(isWaitingForInput()).toBe(true);

    sendKey(106); // 'j'
    expect(isWaitingForInput()).toBe(false);
    expect(await promise).toBe(106);
  });

  it("shim_nh_poskey also blocks until sendKey", async () => {
    const promise = shimCallback("shim_nh_poskey");
    expect(isWaitingForInput()).toBe(true);

    sendKey(32); // space
    expect(await promise).toBe(32);
  });

  it("shim_yn_function returns default char when valid", async () => {
    // def = 'n' (110)
    expect(await shimCallback("shim_yn_function", "query", "yn", 110)).toBe(110);
  });

  it("shim_yn_function returns 'y' when default is 0 or missing", async () => {
    expect(await shimCallback("shim_yn_function", "query", "yn", 0)).toBe(121);
    expect(await shimCallback("shim_yn_function", "query", "yn", undefined)).toBe(121);
  });

  it("sendKey is no-op when no input is pending", () => {
    expect(isWaitingForInput()).toBe(false);
    sendKey(65); // should not throw
    expect(isWaitingForInput()).toBe(false);
  });
});

describe("shimCallback: menus", () => {
  it("shim_select_menu returns -1 (cancel)", async () => {
    expect(await shimCallback("shim_select_menu")).toBe(-1);
  });

  it("shim_message_menu returns 0", async () => {
    expect(await shimCallback("shim_message_menu")).toBe(0);
  });

  it("shim_get_ext_cmd returns -1 (cancel)", async () => {
    expect(await shimCallback("shim_get_ext_cmd")).toBe(-1);
  });

  it("shim_start_menu/add_menu/end_menu return undefined", async () => {
    expect(await shimCallback("shim_start_menu")).toBeUndefined();
    expect(await shimCallback("shim_add_menu")).toBeUndefined();
    expect(await shimCallback("shim_end_menu")).toBeUndefined();
  });
});

describe("shimCallback: string-returning events", () => {
  it("shim_getmsghistory returns empty string", async () => {
    expect(await shimCallback("shim_getmsghistory")).toBe("");
  });

  it("shim_get_color_string returns empty string", async () => {
    expect(await shimCallback("shim_get_color_string")).toBe("");
  });
});

describe("shimCallback: misc events return undefined", () => {
  const voidEvents = [
    "shim_status_init",
    "shim_status_update",
    "shim_nhbell",
    "shim_mark_synch",
    "shim_wait_synch",
    "shim_delay_output",
    "shim_cliparound",
    "shim_curs",
    "shim_putstr",
    "shim_raw_print",
    "shim_print_glyph",
    "shim_exit_nhwindows",
  ];

  for (const name of voidEvents) {
    it(`${name} returns undefined`, async () => {
      expect(await shimCallback(name)).toBeUndefined();
    });
  }

  it("shim_doprev_message returns 0 (int return type)", async () => {
    expect(await shimCallback("shim_doprev_message")).toBe(0);
  });
});

describe("shimCallback: unknown event", () => {
  it("returns undefined for unknown events", async () => {
    expect(await shimCallback("shim_nonexistent_event")).toBeUndefined();
  });
});

describe("event recording", () => {
  it("records events in order", async () => {
    await shimCallback("shim_init_nhwindows");
    await shimCallback("shim_create_nhwindow", 1);
    await shimCallback("shim_putstr", 0, 0, "hello");

    const events = getReceivedEvents();
    expect(events).toHaveLength(3);
    expect(events[0].name).toBe("shim_init_nhwindows");
    expect(events[1].name).toBe("shim_create_nhwindow");
    expect(events[2].name).toBe("shim_putstr");
    expect(events[2].args).toEqual([0, 0, "hello"]);
  });

  it("forwards events to registered handler", async () => {
    const received: string[] = [];
    onEvent((name) => received.push(name));

    await shimCallback("shim_nhbell");
    await shimCallback("shim_mark_synch");

    expect(received).toEqual(["shim_nhbell", "shim_mark_synch"]);
  });

  it("resetState clears events and handler", async () => {
    await shimCallback("shim_init_nhwindows");
    expect(getReceivedEvents()).toHaveLength(1);

    resetState();
    expect(getReceivedEvents()).toHaveLength(0);
    expect(isWaitingForInput()).toBe(false);
  });
});

import { beforeAll, describe, expect, it } from "vitest";

type CoreCommandRequest =
  | {
    command: "clicklook";
    requestNonce: number;
    x: number;
    y: number;
  }
  | {
    command: "catalog";
    requestNonce: number;
    sessionCommandId: number;
    requestItemMenu: boolean;
  };

type CoreCommandPayload = readonly [
  header: number,
  requestNonce: number,
  argument: number,
];

interface CoreCommandProtocol {
  CORE_COMMAND_PROTOCOL_VERSION: number;
  decodeCoreCommandRequest(payload: CoreCommandPayload): CoreCommandRequest;
  encodeCoreCommandRequest(request: CoreCommandRequest): CoreCommandPayload;
}

const PROTOCOL_MODULE_PATH = "./core-command-protocol";
const VERSION_SHIFT = 28;
const VERSION_MASK = 0b111 << VERSION_SHIFT;
const UNKNOWN_HEADER_BIT = 1 << 27;
const REQUEST_ITEM_MENU_BIT = 1 << 4;
let protocol: CoreCommandProtocol | null = null;

beforeAll(async () => {
  try {
    protocol = await import(
      /* @vite-ignore */ PROTOCOL_MODULE_PATH
    ) as CoreCommandProtocol;
  } catch {
    protocol = null;
  }
});

/**
 * Require the production protocol module while keeping this contract runnable
 * before the stage-one implementation exists.
 */
function requireProtocol(): CoreCommandProtocol {
  expect(
    protocol,
    "stage one requires a versioned core-command protocol",
  ).not.toBeNull();
  const api = protocol as CoreCommandProtocol;
  expect(
    api.CORE_COMMAND_PROTOCOL_VERSION,
    "stage one requires command protocol v2",
  ).toBe(2);
  return api;
}

function replaceHeader(
  payload: CoreCommandPayload,
  header: number,
): CoreCommandPayload {
  return [header >>> 0, payload[1], payload[2]];
}

describe("core command protocol", () => {
  it("round-trips clicklook through protocol v2 with an exact nonce", () => {
    const api = requireProtocol();
    const request = {
      command: "clicklook",
      requestNonce: 0xffffffff,
      x: 79,
      y: 20,
    } as const;
    const payload = api.encodeCoreCommandRequest(request);

    expect(payload).toHaveLength(3);
    expect(payload.every(
      (word) =>
        Number.isInteger(word) && word >= 0 && word <= 0xffffffff,
    )).toBe(true);
    expect((payload[0] & VERSION_MASK) >>> VERSION_SHIFT)
      .toBe(api.CORE_COMMAND_PROTOCOL_VERSION);
    expect(api.decodeCoreCommandRequest(payload)).toEqual(request);
  });

  it.each([
    ["inventory", 29, false],
    ["drop", 15, true],
  ] as const)(
    "explicitly migrates legacy %s semantics to a catalog command",
    (_name, sessionCommandId, requestItemMenu) => {
      const api = requireProtocol();
      const request = {
        command: "catalog",
        requestNonce: sessionCommandId + 1,
        sessionCommandId,
        requestItemMenu,
      } as const;

      expect(api.decodeCoreCommandRequest(
        api.encodeCoreCommandRequest(request),
      )).toEqual(request);
    },
  );

  it("keeps the catalog ID in the argument word and menu intent in the header", () => {
    const api = requireProtocol();
    const withoutMenu = api.encodeCoreCommandRequest({
      command: "catalog",
      requestNonce: 7,
      sessionCommandId: 29,
      requestItemMenu: false,
    });
    const withMenu = api.encodeCoreCommandRequest({
      command: "catalog",
      requestNonce: 8,
      sessionCommandId: 29,
      requestItemMenu: true,
    });

    expect(withoutMenu[2]).toBe(29);
    expect(withMenu[2]).toBe(29);
    expect((withoutMenu[0] & REQUEST_ITEM_MENU_BIT) >>> 0).toBe(0);
    expect((withMenu[0] & REQUEST_ITEM_MENU_BIT) >>> 0)
      .toBe(REQUEST_ITEM_MENU_BIT);
  });

  it("rejects unknown versions, bits, command kinds, and zero nonce", () => {
    const api = requireProtocol();
    const payload = api.encodeCoreCommandRequest({
      command: "catalog",
      requestNonce: 7,
      sessionCommandId: 29,
      requestItemMenu: false,
    });

    const incompatibleVersion = (
      (payload[0] & ~VERSION_MASK)
      | (((api.CORE_COMMAND_PROTOCOL_VERSION + 1) & 0b111) << VERSION_SHIFT)
    ) >>> 0;
    expect(() => api.decodeCoreCommandRequest(
      replaceHeader(payload, incompatibleVersion),
    )).toThrow();
    expect(() => api.decodeCoreCommandRequest(
      replaceHeader(payload, payload[0] | UNKNOWN_HEADER_BIT),
    )).toThrow();
    expect(() => api.decodeCoreCommandRequest(
      replaceHeader(payload, (payload[0] & ~0b11) | 0b11),
    )).toThrow();
    expect(() => api.decodeCoreCommandRequest(
      [payload[0], 0, payload[2]],
    )).toThrow();
  });

  it("rejects out-of-range catalog IDs on encode and decode", () => {
    const api = requireProtocol();
    expect(() => api.encodeCoreCommandRequest({
      command: "catalog",
      requestNonce: 1,
      sessionCommandId: 1024,
      requestItemMenu: false,
    })).toThrow();

    const payload = api.encodeCoreCommandRequest({
      command: "catalog",
      requestNonce: 1,
      sessionCommandId: 1,
      requestItemMenu: false,
    });
    expect(() => api.decodeCoreCommandRequest(
      [payload[0], payload[1], 1024],
    )).toThrow();
  });
});

import { beforeAll, describe, expect, it } from "vitest";

interface CoreCommandProtocol {
  CORE_COMMAND_PROTOCOL_VERSION: number;
  decodeCoreCommandRequest(payload: number): {
    command: "inventory";
  };
  encodeCoreCommandRequest(request: {
    command: "inventory";
  }): number;
}

const PROTOCOL_MODULE_PATH = "./core-command-protocol";
const VERSION_SHIFT = 28;
const VERSION_MASK = 0b111 << VERSION_SHIFT;
const RESERVED_BIT = 1 << 31;
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
 * before the stage-five implementation exists.
 */
function requireProtocol(): CoreCommandProtocol {
  expect(
    protocol,
    "stage five requires a versioned core-command protocol",
  ).not.toBeNull();
  return protocol as CoreCommandProtocol;
}

describe("core command protocol", () => {
  it("[defect-probing] round-trips inventory and rejects incompatible payloads", () => {
    const api = requireProtocol();
    const payload = api.encodeCoreCommandRequest({ command: "inventory" });

    expect(Number.isInteger(payload)).toBe(true);
    expect(payload).toBeGreaterThan(0);
    expect((payload & VERSION_MASK) >>> VERSION_SHIFT)
      .toBe(api.CORE_COMMAND_PROTOCOL_VERSION);
    expect(api.decodeCoreCommandRequest(payload)).toEqual({
      command: "inventory",
    });
    expect(() => api.decodeCoreCommandRequest(payload | RESERVED_BIT))
      .toThrow();

    const incompatibleVersion = (
      (payload & ~VERSION_MASK)
      | (((api.CORE_COMMAND_PROTOCOL_VERSION + 1) & 0b111) << VERSION_SHIFT)
    ) >>> 0;
    expect(() => api.decodeCoreCommandRequest(incompatibleVersion)).toThrow();
  });
});

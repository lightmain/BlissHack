export const CORE_COMMAND_PROTOCOL_VERSION = 2;
export const MAX_SESSION_COMMAND_ID = 1023;
export const MAX_CORE_COMMAND_NONCE = 0xffffffff;

const VERSION_SHIFT = 28;
const VERSION_MASK = 0b111 << VERSION_SHIFT;
const COMMAND_KIND_MASK = 0b11;
const REQUEST_ITEM_MENU_BIT = 1 << 4;
const DEFINED_HEADER_MASK =
  VERSION_MASK | COMMAND_KIND_MASK | REQUEST_ITEM_MENU_BIT;
const CLICKLOOK_X_MASK = 0b1111111;
const CLICKLOOK_Y_MASK = 0b11111;
const CLICKLOOK_Y_SHIFT = 7;
const CLICKLOOK_ARGUMENT_MASK =
  CLICKLOOK_X_MASK | (CLICKLOOK_Y_MASK << CLICKLOOK_Y_SHIFT);

const COMMAND_KINDS = {
  clicklook: 1,
  catalog: 2,
} as const;

export type CoreCommandRequest =
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

export type CoreCommandPayload = readonly [
  header: number,
  requestNonce: number,
  argument: number,
];

/**
 * Encode one complete v2 request for the next core command boundary.
 * @param request - nonce-bearing internal or catalog command request.
 * @returns three unsigned WASM32 words with no pointer-valued fields.
 */
export function encodeCoreCommandRequest(
  request: CoreCommandRequest,
): CoreCommandPayload {
  assertUint32(request.requestNonce, "request nonce", false);
  const versionHeader = CORE_COMMAND_PROTOCOL_VERSION << VERSION_SHIFT;
  if (request.command === "clicklook") {
    assertBoundedInteger(request.x, CLICKLOOK_X_MASK, "x coordinate");
    assertBoundedInteger(request.y, CLICKLOOK_Y_MASK, "y coordinate");
    return [
      (versionHeader | COMMAND_KINDS.clicklook) >>> 0,
      request.requestNonce >>> 0,
      (request.x | (request.y << CLICKLOOK_Y_SHIFT)) >>> 0,
    ];
  }

  assertBoundedInteger(
    request.sessionCommandId,
    MAX_SESSION_COMMAND_ID,
    "session command ID",
  );
  return [
    (
      versionHeader
      | COMMAND_KINDS.catalog
      | (request.requestItemMenu ? REQUEST_ITEM_MENU_BIT : 0)
    ) >>> 0,
    request.requestNonce >>> 0,
    request.sessionCommandId >>> 0,
  ];
}

/**
 * Decode and validate one three-word command payload.
 * @param payload - exact header, nonce, and argument words from the bridge.
 * @returns the typed v2 command request.
 */
export function decodeCoreCommandRequest(
  payload: CoreCommandPayload,
): CoreCommandRequest {
  if (!Array.isArray(payload) || payload.length !== 3) {
    throw new Error("Invalid core command payload");
  }
  const [header, requestNonce, argument] = payload;
  assertUint32(header, "header");
  assertUint32(requestNonce, "request nonce", false);
  assertUint32(argument, "argument");
  if ((header & ~DEFINED_HEADER_MASK) !== 0) {
    throw new Error("Unsupported core command header bits");
  }
  const version = (header & VERSION_MASK) >>> VERSION_SHIFT;
  if (version !== CORE_COMMAND_PROTOCOL_VERSION) {
    throw new Error(`Unsupported core command protocol version: ${version}`);
  }

  const kind = header & COMMAND_KIND_MASK;
  const requestItemMenu = (header & REQUEST_ITEM_MENU_BIT) !== 0;
  if (kind === COMMAND_KINDS.clicklook) {
    if (requestItemMenu || (argument & ~CLICKLOOK_ARGUMENT_MASK) !== 0) {
      throw new Error("Invalid clicklook command payload");
    }
    return {
      command: "clicklook",
      requestNonce,
      x: argument & CLICKLOOK_X_MASK,
      y: (argument >>> CLICKLOOK_Y_SHIFT) & CLICKLOOK_Y_MASK,
    };
  }
  if (kind === COMMAND_KINDS.catalog) {
    assertBoundedInteger(
      argument,
      MAX_SESSION_COMMAND_ID,
      "session command ID",
    );
    return {
      command: "catalog",
      requestNonce,
      sessionCommandId: argument,
      requestItemMenu,
    };
  }
  throw new Error(`Unsupported core command kind: ${kind}`);
}

/**
 * Reject an integer outside one inclusive protocol range.
 * @param value - number supplied by the caller or decoded payload.
 * @param maximum - largest accepted integer.
 * @param name - field name used in diagnostics.
 */
function assertBoundedInteger(
  value: number,
  maximum: number,
  name: string,
): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`Invalid core command ${name}`);
  }
}

/**
 * Reject values which cannot be represented by one unsigned WASM32 word.
 * @param value - candidate protocol word.
 * @param name - field name used in diagnostics.
 * @param allowZero - whether zero is a valid value.
 */
function assertUint32(
  value: number,
  name: string,
  allowZero = true,
): void {
  if (
    !Number.isInteger(value)
    || value < (allowZero ? 0 : 1)
    || value > 0xffffffff
  ) {
    throw new Error(`Invalid core command ${name}`);
  }
}

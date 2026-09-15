export const CORE_COMMAND_PROTOCOL_VERSION = 1;

const VERSION_SHIFT = 28;
const VERSION_MASK = 0b111 << VERSION_SHIFT;
const RESERVED_MASK = 1 << 31;
const COMMAND_MASK = 0b1111;
const X_SHIFT = 4;
const X_MASK = 0b1111111 << X_SHIFT;
const Y_SHIFT = 11;
const Y_MASK = 0b11111 << Y_SHIFT;
const DEFINED_MASK = VERSION_MASK | COMMAND_MASK | X_MASK | Y_MASK;

const COMMAND_IDS = {
  clicklook: 1,
  inventory: 2,
  drop: 3,
} as const;

export type CoreCommandRequest =
  | { command: "clicklook"; x: number; y: number }
  | { command: "inventory" }
  | { command: "drop" };

/** Encode one allowlisted command for consumption at the next core boundary. */
export function encodeCoreCommandRequest(request: CoreCommandRequest): number {
  let payload = (
    CORE_COMMAND_PROTOCOL_VERSION << VERSION_SHIFT
  ) | COMMAND_IDS[request.command];
  if (request.command === "clicklook") {
    assertCoordinate(request.x, 0b1111111, "x");
    assertCoordinate(request.y, 0b11111, "y");
    payload |= request.x << X_SHIFT;
    payload |= request.y << Y_SHIFT;
  }
  return payload >>> 0;
}

/** Decode and validate one command payload without accepting unknown bits. */
export function decodeCoreCommandRequest(payload: number): CoreCommandRequest {
  if (!Number.isInteger(payload) || payload <= 0 || payload > 0xffffffff) {
    throw new Error("Invalid core command payload");
  }
  const unsigned = payload >>> 0;
  if ((unsigned & RESERVED_MASK) !== 0 || (unsigned & ~DEFINED_MASK) !== 0) {
    throw new Error("Unsupported core command payload bits");
  }
  const version = (unsigned & VERSION_MASK) >>> VERSION_SHIFT;
  if (version !== CORE_COMMAND_PROTOCOL_VERSION) {
    throw new Error(`Unsupported core command protocol version: ${version}`);
  }
  const command = unsigned & COMMAND_MASK;
  const x = (unsigned & X_MASK) >>> X_SHIFT;
  const y = (unsigned & Y_MASK) >>> Y_SHIFT;
  if (command === COMMAND_IDS.clicklook) return { command: "clicklook", x, y };
  if (x !== 0 || y !== 0) {
    throw new Error("Coordinates are only valid for clicklook");
  }
  if (command === COMMAND_IDS.inventory) return { command: "inventory" };
  if (command === COMMAND_IDS.drop) return { command: "drop" };
  throw new Error(`Unsupported core command identifier: ${command}`);
}

/** Reject values which cannot fit the fixed WASM32 command payload. */
function assertCoordinate(
  value: number,
  maximum: number,
  name: string,
): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`Invalid core command ${name} coordinate`);
  }
}

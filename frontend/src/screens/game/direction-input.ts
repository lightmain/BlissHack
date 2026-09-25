export interface DirectionOption {
  key: string;
  label: string;
  xDelta: number;
  yDelta: number;
}

const DIRECTIONS = [
  { key: "y", numberPadKey: "7", label: "Northwest", xDelta: -1, yDelta: -1 },
  { key: "k", numberPadKey: "8", label: "North", xDelta: 0, yDelta: -1 },
  { key: "u", numberPadKey: "9", label: "Northeast", xDelta: 1, yDelta: -1 },
  { key: "h", numberPadKey: "4", label: "West", xDelta: -1, yDelta: 0 },
  { key: "l", numberPadKey: "6", label: "East", xDelta: 1, yDelta: 0 },
  { key: "b", numberPadKey: "1", label: "Southwest", xDelta: -1, yDelta: 1 },
  { key: "j", numberPadKey: "2", label: "South", xDelta: 0, yDelta: 1 },
  { key: "n", numberPadKey: "3", label: "Southeast", xDelta: 1, yDelta: 1 },
] as const;

/**
 * List the eight adjacent directions using the active NetHack key mode.
 * @param numberPad - whether numeric movement keys are active.
 * @returns direction labels, deltas, and currently accepted key characters.
 */
export function directionOptions(numberPad: boolean): DirectionOption[] {
  return DIRECTIONS.map((direction) => ({
    ...direction,
    key: numberPad ? direction.numberPadKey : direction.key,
  }));
}

/**
 * Check whether a byte is an adjacent direction or self key.
 * @param value - encoded keyboard byte.
 * @param numberPad - active NetHack number-pad setting.
 * @returns whether the core can consume the byte as a direction.
 */
export function isDirectionKey(value: number, numberPad: boolean): boolean {
  const choices = numberPad ? "1234567895" : "hjklyubn.";
  return choices.includes(String.fromCharCode(value));
}

/**
 * Convert an adjacent map target into the active direction binding.
 * @param xDelta - target column relative to the player.
 * @param yDelta - target row relative to the player.
 * @param numberPad - active NetHack number-pad setting.
 * @returns encoded direction byte, or null outside the adjacent ring.
 */
export function directionKeyFromMapTarget(
  xDelta: number,
  yDelta: number,
  numberPad: boolean,
): number | null {
  const direction = DIRECTIONS.find(
    (candidate) =>
      candidate.xDelta === xDelta && candidate.yDelta === yDelta,
  );
  if (!direction) return null;
  return (numberPad ? direction.numberPadKey : direction.key).charCodeAt(0);
}

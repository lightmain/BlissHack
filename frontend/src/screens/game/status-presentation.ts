import { colorClass } from "../../text-styling";

/**
 * Treat NetHack's NO_COLOR sentinel as inherited HUD text color.
 * @param color - core color index.
 * @returns a color class or an empty string for NO_COLOR.
 */
export function statusColorClass(color: number): string {
  return color === 8 ? "" : colorClass(color);
}

/**
 * Convert composable NetHack HL_* bits into CSS classes.
 * @param attributes - highlight mask from status_update or cond_hilites.
 * @returns space-separated presentation classes.
 */
export function statusAttributeClass(attributes: number): string {
  const classes: string[] = [];
  if ((attributes & 0x02) !== 0) classes.push("nh-bold");
  if ((attributes & 0x04) !== 0) classes.push("nh-dim");
  if ((attributes & 0x08) !== 0) classes.push("nh-italic");
  if ((attributes & 0x10) !== 0) classes.push("nh-underline");
  if ((attributes & 0x20) !== 0) classes.push("nh-blink");
  if ((attributes & 0x40) !== 0) classes.push("nh-inverse");
  return classes.join(" ");
}

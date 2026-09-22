import type { ExtendedCommand } from "../../game-state";

/**
 * Filter extended commands by name and optionally by description.
 * @param commands - parsed extended-command entries.
 * @param query - player-entered search text.
 * @param includeDescriptions - whether description text participates in matching.
 * @returns matching commands in their original source order.
 */
export function filterExtendedCommands(
  commands: ExtendedCommand[],
  query: string,
  includeDescriptions = true,
): ExtendedCommand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return commands;
  return commands.filter((command) => {
    if (command.name.toLowerCase().startsWith(normalized)) return true;
    return includeDescriptions
      && command.description.toLowerCase().includes(normalized);
  });
}

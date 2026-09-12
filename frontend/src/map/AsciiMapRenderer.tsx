import { memo } from "react";
import type { GameSnapshot, MapCell } from "../game-state";
import { buildMapRuns } from "../map-rendering";
import { colorClass } from "../text-styling";

/** Shared immutable state required by either map renderer. */
export interface MapRendererProps {
  cursor: GameSnapshot["cursor"];
  map: readonly (readonly MapCell[])[];
}

/**
 * Render the NetHack map as fixed-width text.
 * @param props - current map and cursor state.
 * @returns the accessible ASCII map.
 */
export const AsciiMapRenderer = memo(function AsciiMapRenderer({
  cursor,
  map,
}: MapRendererProps) {
  return (
    <div
      aria-label="Dungeon map"
      className="nh-map nh-map-ascii"
    >
      {map.map((row, y) => (
        <AsciiMapRow
          cursorX={cursor.visible && cursor.y === y ? cursor.x : -1}
          key={y}
          row={row}
          y={y}
        />
      ))}
    </div>
  );
});

/**
 * Render one map row as adjacent equal-style text runs.
 * @param props - row cells, cursor column, and row coordinate.
 * @returns one fixed-width character row.
 */
const AsciiMapRow = memo(function AsciiMapRow({
  row,
  cursorX,
  y,
}: {
  row: readonly MapCell[];
  cursorX: number;
  y: number;
}) {
  return (
    <div className="nh-map-row" data-y={y}>
      {buildMapRuns(row, cursorX).map((run) => (
        <span
          className={[
            "nh-map-run",
            colorClass(run.color),
            run.cursor ? "nh-cursor" : "",
            run.pet ? "nh-pet" : "",
          ].filter(Boolean).join(" ")}
          data-start={run.start}
          key={run.start}
        >
          {run.text}
        </span>
      ))}
    </div>
  );
});

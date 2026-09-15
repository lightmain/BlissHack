import type { CSSProperties } from "react";
import type { InventoryDragState } from "./inventory-drag-controller";

/**
 * Render the pointer-following preview for an active inventory drag.
 * @param props - current pure drag-controller state.
 * @returns a non-interactive overlay, or null before the drag threshold.
 */
export function InventoryDragPreview({
  state,
}: {
  state: InventoryDragState;
}) {
  const payload = state.payload;
  const preview = state.preview;
  if (state.status !== "dragging" || !payload || !preview) return null;
  const glyph = payload.glyph?.ttyChar
    ? String.fromCodePoint(payload.glyph.ttyChar)
    : "";
  return (
    <div
      aria-label="Inventory drag preview"
      className="nh-inventory-drag-preview"
      data-drop-ready={preview.highlightedCell ? "true" : "false"}
      role="status"
      style={{
        "--drag-preview-x": `${preview.clientX}px`,
        "--drag-preview-y": `${preview.clientY}px`,
      } as CSSProperties}
    >
      <span aria-hidden="true" className="nh-inventory-drag-glyph">
        {glyph || " "}
      </span>
      <span className="nh-inventory-drag-text">
        {payload.text || "Inventory item"}
      </span>
      {preview.dropHint && (
        <strong className="nh-inventory-drop-hint">
          {preview.dropHint}
        </strong>
      )}
    </div>
  );
}

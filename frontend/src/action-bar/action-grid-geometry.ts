import type { ActionBarSection } from "./action-bar-layout";

export interface ActionGridSectionGeometry {
  category: ActionBarSection["category"];
  columns: number;
  slots: Array<string | null>;
}

export interface ActionGridGeometry {
  gridWidth: number;
  horizontalOverflow: boolean;
  sections: ActionGridSectionGeometry[];
  slotSize: number;
  totalColumns: number;
}

interface ActionGridGeometryOptions {
  availableWidth: number;
  dividerWidth: number;
  minimumSlotSize: number;
  rows: 1 | 2 | 3 | 4;
  sections: readonly ActionBarSection[];
  slotGap: number;
  targetSlotSize: number;
}

interface ActionDividerPreviewOptions {
  dividerIndex: number;
  pointerDelta: number;
  sectionColumns: readonly number[];
  slotGap: number;
  slotSize: number;
}

/**
 * Fit complete action columns into the available dock width.
 * @param options - viewport, slot, divider, row, and section constraints.
 * @returns immutable render geometry with the final section absorbing spare columns.
 */
export function calculateActionGridGeometry({
  availableWidth,
  dividerWidth,
  minimumSlotSize,
  rows,
  sections,
  slotGap,
  targetSlotSize,
}: ActionGridGeometryOptions): ActionGridGeometry {
  if (
    !Number.isFinite(availableWidth)
    || availableWidth < 0
    || !Number.isFinite(dividerWidth)
    || dividerWidth < 0
    || !Number.isFinite(minimumSlotSize)
    || minimumSlotSize <= 0
    || !Number.isFinite(slotGap)
    || slotGap < 0
    || !Number.isFinite(targetSlotSize)
    || targetSlotSize < minimumSlotSize
    || sections.length === 0
  ) {
    throw new Error("Action grid geometry options are invalid");
  }

  const required = sections.map((section, index) => {
    const occupiedColumns = Math.ceil(section.slots.length / rows);
    const trailingEditColumn = index === sections.length - 1 ? 1 : 0;
    return Math.max(section.columns, occupiedColumns + trailingEditColumn);
  });
  const requiredColumns = required.reduce((total, value) => total + value, 0);
  const fixedDividerWidth = Math.max(0, sections.length - 1) * dividerWidth;
  const fittedAtTarget = Math.max(
    1,
    Math.floor(
      (availableWidth - fixedDividerWidth + sections.length * slotGap)
      / (targetSlotSize + slotGap),
    ),
  );
  const totalColumns = Math.max(requiredColumns, fittedAtTarget);
  const gapWidth = Math.max(0, totalColumns - sections.length) * slotGap;
  const fittedSlotSize =
    (availableWidth - fixedDividerWidth - gapWidth) / totalColumns;
  const horizontalOverflow = fittedSlotSize < minimumSlotSize;
  const slotSize = horizontalOverflow
    ? minimumSlotSize
    : Math.min(targetSlotSize, fittedSlotSize);
  const gridWidth = horizontalOverflow
    ? totalColumns * slotSize + gapWidth + fixedDividerWidth
    : availableWidth;
  const columns = [...required];
  columns[columns.length - 1] += totalColumns - requiredColumns;

  return {
    gridWidth,
    horizontalOverflow,
    slotSize,
    totalColumns,
    sections: sections.map((section, index) => ({
      category: section.category,
      columns: columns[index],
      slots: Array.from(
        { length: columns[index] * rows },
        (_, slotIndex) => section.slots[slotIndex] ?? null,
      ),
    })),
  };
}

/**
 * Preview a divider drag snapped to a complete slot-column step.
 * @param options - divider index, pointer delta, and current section widths.
 * @returns a detached width array with adjacent sections rebalanced.
 */
export function previewActionDivider({
  dividerIndex,
  pointerDelta,
  sectionColumns,
  slotGap,
  slotSize,
}: ActionDividerPreviewOptions): number[] {
  if (
    !Number.isInteger(dividerIndex)
    || dividerIndex < 0
    || dividerIndex >= sectionColumns.length - 1
    || !Number.isFinite(pointerDelta)
    || !Number.isFinite(slotGap)
    || slotGap < 0
    || !Number.isFinite(slotSize)
    || slotSize <= 0
    || sectionColumns.some(
      (columns) => !Number.isInteger(columns) || columns < 1,
    )
  ) {
    throw new Error("Action divider preview options are invalid");
  }
  const next = [...sectionColumns];
  const requestedDelta = Math.round(pointerDelta / (slotSize + slotGap));
  const delta = Math.max(
    1 - next[dividerIndex],
    Math.min(next[dividerIndex + 1] - 1, requestedDelta),
  );
  next[dividerIndex] += delta;
  next[dividerIndex + 1] -= delta;
  return next;
}

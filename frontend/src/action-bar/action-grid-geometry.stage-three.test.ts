import { beforeAll, describe, expect, it } from "vitest";
import {
  createDefaultActionBarLayout,
  type ActionBarSection,
} from "./action-bar-layout";

interface ActionGridSectionGeometry {
  category: ActionBarSection["category"];
  columns: number;
  slots: Array<string | null>;
}

interface ActionGridGeometry {
  gridWidth: number;
  horizontalOverflow: boolean;
  sections: ActionGridSectionGeometry[];
  slotSize: number;
  totalColumns: number;
}

interface ActionGridGeometryApi {
  calculateActionGridGeometry(options: {
    availableWidth: number;
    dividerWidth: number;
    minimumSlotSize: number;
    rows: 1 | 2 | 3 | 4;
    sections: readonly ActionBarSection[];
    slotGap: number;
    targetSlotSize: number;
  }): ActionGridGeometry;
  previewActionDivider(options: {
    dividerIndex: number;
    pointerDelta: number;
    sectionColumns: readonly number[];
    slotGap: number;
    slotSize: number;
  }): number[];
}

const MODULE_PATH = "./action-grid-geometry";
const TARGET_SLOT_SIZE = 48;
const MINIMUM_SLOT_SIZE = 32;
const SLOT_GAP = 4;
const DIVIDER_WIDTH = 17;
let api: ActionGridGeometryApi | null = null;

beforeAll(async () => {
  try {
    api = await import(
      /* @vite-ignore */ MODULE_PATH
    ) as ActionGridGeometryApi;
  } catch {
    api = null;
  }
});

function requireApi(): ActionGridGeometryApi {
  expect(
    api,
    "stage three requires a pure action-grid geometry module",
  ).not.toBeNull();
  return api as ActionGridGeometryApi;
}

/** Return the exact width occupied by complete columns and fixed dividers. */
function widthForColumns(columns: number, sectionCount = 4): number {
  return columns * TARGET_SLOT_SIZE
    + (columns - sectionCount) * SLOT_GAP
    + (sectionCount - 1) * DIVIDER_WIDTH;
}

describe("stage-three action grid geometry", () => {
  it("fits rows 1..4 by complete columns, clamps at 32px, scrolls, and previews snapped dividers", () => {
    const geometryApi = requireApi();
    const defaults = createDefaultActionBarLayout();
    const expectedColumns = new Map([
      [1, [4, 6, 6, 7]],
      [2, [2, 3, 3, 4]],
      [3, [2, 3, 3, 3]],
      [4, [2, 3, 3, 3]],
    ] as const);

    for (const rows of [1, 2, 3, 4] as const) {
      const sectionColumns = expectedColumns.get(rows);
      expect(sectionColumns).toBeDefined();
      const totalColumns = sectionColumns!.reduce(
        (total, columns) => total + columns,
        0,
      );
      const availableWidth = widthForColumns(totalColumns);
      const geometry = geometryApi.calculateActionGridGeometry({
        availableWidth,
        dividerWidth: DIVIDER_WIDTH,
        minimumSlotSize: MINIMUM_SLOT_SIZE,
        rows,
        sections: defaults.all,
        slotGap: SLOT_GAP,
        targetSlotSize: TARGET_SLOT_SIZE,
      });

      expect(geometry).toMatchObject({
        gridWidth: availableWidth,
        horizontalOverflow: false,
        slotSize: TARGET_SLOT_SIZE,
        totalColumns,
      });
      expect(geometry.sections.map(({ category, columns }) => ({
        category,
        columns,
      }))).toEqual(
        defaults.all.map(({ category }, index) => ({
          category,
          columns: sectionColumns![index],
        })),
      );
      for (const section of geometry.sections) {
        expect(section.slots).toHaveLength(section.columns * rows);
      }
      const finalSection = geometry.sections.at(-1);
      expect(finalSection?.category).toBe("items");
      expect(finalSection?.slots.slice(0, 6)).toEqual(
        defaults.all[3].slots,
      );
      expect(finalSection?.slots.slice(6).every((slot) => slot === null))
        .toBe(true);
    }

    const twoRowRequiredColumns = 12;
    const minimumGridWidth = twoRowRequiredColumns * MINIMUM_SLOT_SIZE
      + (twoRowRequiredColumns - 4) * SLOT_GAP
      + 3 * DIVIDER_WIDTH;
    const narrow = geometryApi.calculateActionGridGeometry({
      availableWidth: minimumGridWidth - 1,
      dividerWidth: DIVIDER_WIDTH,
      minimumSlotSize: MINIMUM_SLOT_SIZE,
      rows: 2,
      sections: defaults.all,
      slotGap: SLOT_GAP,
      targetSlotSize: TARGET_SLOT_SIZE,
    });

    expect(narrow).toMatchObject({
      gridWidth: minimumGridWidth,
      horizontalOverflow: true,
      slotSize: MINIMUM_SLOT_SIZE,
      totalColumns: twoRowRequiredColumns,
    });

    const wide = geometryApi.calculateActionGridGeometry({
      availableWidth: widthForColumns(twoRowRequiredColumns + 2),
      dividerWidth: DIVIDER_WIDTH,
      minimumSlotSize: MINIMUM_SLOT_SIZE,
      rows: 2,
      sections: defaults.all,
      slotGap: SLOT_GAP,
      targetSlotSize: TARGET_SLOT_SIZE,
    });
    expect(wide.sections.map(({ columns }) => columns)).toEqual([2, 3, 3, 6]);
    expect(wide.sections.at(-1)?.slots.slice(6))
      .toEqual(Array(6).fill(null));

    const narrowCategory = geometryApi.calculateActionGridGeometry({
      availableWidth: 240,
      dividerWidth: 0,
      minimumSlotSize: MINIMUM_SLOT_SIZE,
      rows: 2,
      sections: [{
        category: "common",
        columns: 1,
        slots: defaults.categories.common,
      }],
      slotGap: SLOT_GAP,
      targetSlotSize: TARGET_SLOT_SIZE,
    });
    expect(narrowCategory.horizontalOverflow).toBe(true);
    expect(narrowCategory.sections[0].slots.slice(
      0,
      defaults.categories.common.length,
    )).toEqual(defaults.categories.common);
    expect(narrowCategory.sections[0].slots).toHaveLength(
      narrowCategory.sections[0].columns * 2,
    );

    const persistedColumns = [2, 3, 3, 3] as const;
    const preview = geometryApi.previewActionDivider({
      dividerIndex: 0,
      pointerDelta: 27,
      sectionColumns: persistedColumns,
      slotGap: SLOT_GAP,
      slotSize: TARGET_SLOT_SIZE,
    });
    expect(preview).toEqual([3, 2, 3, 3]);
    expect(persistedColumns).toEqual([2, 3, 3, 3]);
  });

  it.each([
    [1, [4, 6, 6, 7]],
    [2, [2, 3, 3, 4]],
    [3, [2, 3, 3, 3]],
    [4, [2, 3, 3, 3]],
  ] as const)(
    "keeps rows=%s in complete columns with trailing empty slots at the 32px boundary",
    (rows, expectedColumns) => {
      const geometryApi = requireApi();
      const defaults = createDefaultActionBarLayout();
      const totalColumns = expectedColumns.reduce(
        (total, columns) => total + columns,
        0,
      );
      const minimumGridWidth = totalColumns * MINIMUM_SLOT_SIZE
        + (totalColumns - defaults.all.length) * SLOT_GAP
        + (defaults.all.length - 1) * DIVIDER_WIDTH;
      const fitted = geometryApi.calculateActionGridGeometry({
        availableWidth: minimumGridWidth,
        dividerWidth: DIVIDER_WIDTH,
        minimumSlotSize: MINIMUM_SLOT_SIZE,
        rows,
        sections: defaults.all,
        slotGap: SLOT_GAP,
        targetSlotSize: TARGET_SLOT_SIZE,
      });

      expect(fitted.horizontalOverflow).toBe(false);
      expect(fitted.slotSize).toBe(MINIMUM_SLOT_SIZE);
      expect(fitted.sections.map(({ columns }) => columns))
        .toEqual(expectedColumns);
      for (const section of fitted.sections) {
        expect(section.slots).toHaveLength(section.columns * rows);
        expect(section.slots.length % rows).toBe(0);
      }
      const trailingSection = fitted.sections.at(-1);
      expect(trailingSection?.slots.at(-1)).toBeNull();
      expect(
        trailingSection?.slots.filter((slot) => slot === null).length,
      ).toBeGreaterThanOrEqual(rows);

      const overflowing = geometryApi.calculateActionGridGeometry({
        availableWidth: minimumGridWidth - 0.5,
        dividerWidth: DIVIDER_WIDTH,
        minimumSlotSize: MINIMUM_SLOT_SIZE,
        rows,
        sections: defaults.all,
        slotGap: SLOT_GAP,
        targetSlotSize: TARGET_SLOT_SIZE,
      });
      expect(overflowing).toMatchObject({
        gridWidth: minimumGridWidth,
        horizontalOverflow: true,
        slotSize: MINIMUM_SLOT_SIZE,
        totalColumns,
      });
      expect(overflowing.sections.map(({ columns }) => columns))
        .toEqual(expectedColumns);
    },
  );
});

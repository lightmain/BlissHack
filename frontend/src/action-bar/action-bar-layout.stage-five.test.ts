import { beforeAll, describe, expect, it, vi } from "vitest";
import type {
  ActionBarLayout,
  ActionBarSectionCategory,
  ActionBarSingleCategory,
} from "./action-bar-layout";

interface AllSlotAddress {
  area: "all";
  section: ActionBarSectionCategory;
  slotIndex: number;
}

interface CategorySlotAddress {
  area: "category";
  category: ActionBarSingleCategory;
  slotIndex: number;
}

type ActionBarSlotAddress = AllSlotAddress | CategorySlotAddress;

type ActionBarDragSource =
  | { kind: "dock-action"; slot: ActionBarSlotAddress }
  | { kind: "all-actions"; name: string }
  | {
    kind: "divider";
    dividerIndex: number;
    slotGap: number;
    slotSize: number;
  };

type ActionBarDropTarget =
  | { kind: "dock-slot"; slot: ActionBarSlotAddress }
  | { kind: "all-actions" }
  | { kind: "outside" };

type ActionBarLayoutEdit =
  | {
    type: "drop";
    source: Exclude<ActionBarDragSource, { kind: "divider" }>;
    target: ActionBarDropTarget;
  }
  | {
    type: "move-divider";
    columnDelta: number;
    dividerIndex: number;
  }
  | {
    type: "set-rows";
    rows: ActionBarLayout["rows"];
  };

interface ActionBarLayoutEditResult {
  layout: ActionBarLayout;
  lockFeedback: boolean;
  status: "changed" | "locked" | "unchanged";
}

interface ActionBarLayoutApi {
  createDefaultActionBarLayout(): ActionBarLayout;
  reduceActionBarLayout(
    layout: ActionBarLayout,
    edit: ActionBarLayoutEdit,
  ): ActionBarLayoutEditResult;
}

type ActionBarEditCancellationReason =
  | "blur"
  | "escape"
  | "lost-pointer-capture"
  | "pointer-cancel"
  | "session-reset"
  | "unmount";

interface ActionBarLayoutControllerState {
  error: string | null;
  lastCancellationReason: ActionBarEditCancellationReason | null;
  layout: ActionBarLayout;
  lockFeedback: boolean;
  previewLayout: ActionBarLayout | null;
  status: "idle" | "pending" | "dragging" | "committing" | "error";
}

interface ActionBarLayoutController {
  cancel(reason: ActionBarEditCancellationReason, pointerId?: number): void;
  commitLayout(layout: ActionBarLayout): Promise<boolean>;
  dispose(): void;
  getState(): ActionBarLayoutControllerState;
  pointerDown(input: {
    button: number;
    clientX: number;
    clientY: number;
    pointerId: number;
    source: ActionBarDragSource;
  }): boolean;
  pointerMove(input: {
    clientX: number;
    clientY: number;
    pointerId: number;
    target: ActionBarDropTarget;
  }): void;
  pointerUp(pointerId: number): Promise<void>;
}

interface ActionBarLayoutControllerApi {
  ACTION_BAR_EDIT_DRAG_THRESHOLD: number;
  createActionBarLayoutController(options: {
    layout: ActionBarLayout;
    onCommit(layout: ActionBarLayout): Promise<ActionBarLayout>;
  }): ActionBarLayoutController;
}

const LAYOUT_MODULE_PATH = "./action-bar-layout";
const CONTROLLER_MODULE_PATH = "./action-bar-layout-controller";
const POINTER_ID = 23;
let layoutApi: ActionBarLayoutApi | null = null;
let controllerApi: ActionBarLayoutControllerApi | null = null;

beforeAll(async () => {
  try {
    layoutApi = await import(
      /* @vite-ignore */ LAYOUT_MODULE_PATH
    ) as unknown as ActionBarLayoutApi;
  } catch {
    layoutApi = null;
  }
  try {
    controllerApi = await import(
      /* @vite-ignore */ CONTROLLER_MODULE_PATH
    ) as ActionBarLayoutControllerApi;
  } catch {
    controllerApi = null;
  }
});

/** Require the stage-five pure layout reducer. */
function requireLayoutApi(): ActionBarLayoutApi {
  expect(
    layoutApi?.reduceActionBarLayout,
    "stage five requires a pure action bar layout reducer",
  ).toBeTypeOf("function");
  return layoutApi as ActionBarLayoutApi;
}

/** Require the stage-five Pointer Events layout controller. */
function requireControllerApi(): ActionBarLayoutControllerApi {
  expect(
    controllerApi,
    "stage five requires a pure action bar layout controller",
  ).not.toBeNull();
  return controllerApi as ActionBarLayoutControllerApi;
}

/** Return an unlocked Custom layout with stable occupied and empty slots. */
function editableLayout(): ActionBarLayout {
  const layout = (
    layoutApi?.createDefaultActionBarLayout()
    ?? {
      rows: 2,
      locked: true,
      activeCategory: "all",
      all: [
        {
          category: "common",
          columns: 2,
          slots: ["eat", "quaff", "kick", "search"],
        },
        {
          category: "gear",
          columns: 3,
          slots: ["wield", "wear", "puton", "takeoff", "remove", "swap"],
        },
        {
          category: "magic",
          columns: 3,
          slots: ["cast", "zap", "read", "fire", "throw", "quiver"],
        },
        {
          category: "items",
          columns: 3,
          slots: ["apply", "engrave", "dip", "loot", "tip", "rub"],
        },
      ],
      categories: {
        common: [],
        gear: [],
        magic: [],
        items: [],
        explore: [],
        custom: [],
      },
    }
  );
  const detached = structuredClone(layout);
  detached.locked = false;
  detached.activeCategory = "custom";
  detached.categories.custom = ["search", null, "wait"];
  return detached;
}

/** Return one Custom slot address. */
function customSlot(slotIndex: number): CategorySlotAddress {
  return {
    area: "category",
    category: "custom",
    slotIndex,
  };
}

/** Begin one action drag from a stable pointer origin. */
function beginActionDrag(
  controller: ActionBarLayoutController,
  source: Exclude<ActionBarDragSource, { kind: "divider" }> = {
    kind: "dock-action",
    slot: customSlot(0),
  },
): boolean {
  return controller.pointerDown({
    button: 0,
    clientX: 100,
    clientY: 80,
    pointerId: POINTER_ID,
    source,
  });
}

/** Move an accepted gesture beyond the shared five-pixel threshold. */
function moveActionDrag(
  controller: ActionBarLayoutController,
  target: ActionBarDropTarget,
): void {
  controller.pointerMove({
    clientX: 103,
    clientY: 84,
    pointerId: POINTER_ID,
    target,
  });
}

describe("stage-five action bar layout reducer", () => {
  it("[defect-probing] rejects every mutating edit while locked", () => {
    const api = requireLayoutApi();
    const edits: ActionBarLayoutEdit[] = [
      {
        type: "drop",
        source: { kind: "dock-action", slot: customSlot(0) },
        target: { kind: "dock-slot", slot: customSlot(1) },
      },
      {
        type: "drop",
        source: { kind: "all-actions", name: "kick" },
        target: { kind: "dock-slot", slot: customSlot(1) },
      },
      { type: "move-divider", columnDelta: 1, dividerIndex: 0 },
      { type: "set-rows", rows: 4 },
    ];

    for (const edit of edits) {
      const locked = editableLayout();
      locked.locked = true;
      const original = structuredClone(locked);

      const result = api.reduceActionBarLayout(locked, edit);

      expect(result, edit.type).toMatchObject({
        layout: original,
        lockFeedback: true,
        status: "locked",
      });
      expect(locked, edit.type).toEqual(original);
    }
  });

  it("[defect-probing] moves into an empty slot and swaps occupied dock slots", () => {
    const api = requireLayoutApi();
    const emptyTarget = editableLayout();
    const emptyOriginal = structuredClone(emptyTarget);

    const moved = api.reduceActionBarLayout(emptyTarget, {
      type: "drop",
      source: { kind: "dock-action", slot: customSlot(0) },
      target: { kind: "dock-slot", slot: customSlot(1) },
    });

    expect(moved).toMatchObject({
      status: "changed",
      lockFeedback: false,
    });
    expect(moved.layout.categories.custom).toEqual([
      null,
      "search",
      "wait",
    ]);
    expect(emptyTarget).toEqual(emptyOriginal);

    const occupiedTarget = editableLayout();
    const swapped = api.reduceActionBarLayout(occupiedTarget, {
      type: "drop",
      source: { kind: "dock-action", slot: customSlot(0) },
      target: { kind: "dock-slot", slot: customSlot(2) },
    });

    expect(swapped.layout.categories.custom).toEqual([
      "wait",
      null,
      "search",
    ]);
  });

  it("[defect-probing] inserts or overwrites actions dragged from All Actions", () => {
    const api = requireLayoutApi();
    const layout = editableLayout();

    const inserted = api.reduceActionBarLayout(layout, {
      type: "drop",
      source: { kind: "all-actions", name: "kick" },
      target: { kind: "dock-slot", slot: customSlot(1) },
    });
    expect(inserted.layout.categories.custom).toEqual([
      "search",
      "kick",
      "wait",
    ]);

    const overwritten = api.reduceActionBarLayout(layout, {
      type: "drop",
      source: { kind: "all-actions", name: "kick" },
      target: { kind: "dock-slot", slot: customSlot(0) },
    });
    expect(overwritten.layout.categories.custom).toEqual([
      "kick",
      null,
      "wait",
    ]);
  });

  it("[defect-probing] removes dock actions outside or over All Actions but ignores panel drags outside", () => {
    const api = requireLayoutApi();

    for (const target of [
      { kind: "outside" },
      { kind: "all-actions" },
    ] as const) {
      const removed = api.reduceActionBarLayout(editableLayout(), {
        type: "drop",
        source: { kind: "dock-action", slot: customSlot(0) },
        target,
      });
      expect(removed.layout.categories.custom).toEqual([
        null,
        null,
        "wait",
      ]);
      expect(removed.status).toBe("changed");
    }

    const layout = editableLayout();
    const ignored = api.reduceActionBarLayout(layout, {
      type: "drop",
      source: { kind: "all-actions", name: "kick" },
      target: { kind: "outside" },
    });
    expect(ignored).toMatchObject({
      layout,
      lockFeedback: false,
      status: "unchanged",
    });
  });

  it("[defect-probing] resizes only the left section and preserves hidden slots", () => {
    const api = requireLayoutApi();
    const layout = editableLayout();
    layout.all[0].slots.splice(1, 0, null);
    const originalSlots = layout.all.map((section) => [...section.slots]);

    const moved = api.reduceActionBarLayout(layout, {
      type: "move-divider",
      columnDelta: 1,
      dividerIndex: 0,
    });
    expect(moved.layout.all.map(({ columns }) => columns))
      .toEqual([3, 3, 3, 3]);
    expect(moved.layout.all.map(({ slots }) => slots)).toEqual(originalSlots);

    const clamped = api.reduceActionBarLayout(layout, {
      type: "move-divider",
      columnDelta: -100,
      dividerIndex: 0,
    });
    expect(clamped.layout.all.map(({ columns }) => columns))
      .toEqual([1, 3, 3, 3]);
    expect(clamped.layout.all.map(({ slots }) => slots)).toEqual(originalSlots);
    expect(clamped.layout.all.every(({ columns }) =>
      columns >= 1 && columns <= 8
    )).toBe(true);

    const restored = api.reduceActionBarLayout(clamped.layout, {
      type: "move-divider",
      columnDelta: 1,
      dividerIndex: 0,
    });
    expect(restored.layout.all.map(({ columns }) => columns))
      .toEqual([2, 3, 3, 3]);
    expect(restored.layout.all.map(({ slots }) => slots)).toEqual(originalSlots);

    const full = editableLayout();
    full.all[0].columns = 8;
    full.all[1].columns = 8;
    const capacityBound = api.reduceActionBarLayout(full, {
      type: "move-divider",
      columnDelta: 1,
      dividerIndex: 0,
    });
    expect(capacityBound.layout.all.map(({ columns }) => columns))
      .toEqual([8, 8, 3, 3]);
    expect(capacityBound.status).toBe("unchanged");
  });

  it("[defect-probing] refuses dock targets beyond section capacity", () => {
    const api = requireLayoutApi();
    const layout = editableLayout();
    const original = structuredClone(layout);

    const result = api.reduceActionBarLayout(layout, {
      type: "drop",
      source: {
        kind: "dock-action",
        slot: { area: "all", section: "common", slotIndex: 0 },
      },
      target: {
        kind: "dock-slot",
        slot: { area: "all", section: "gear", slotIndex: 6 },
      },
    });

    expect(result).toMatchObject({
      layout: original,
      lockFeedback: false,
      status: "unchanged",
    });
  });

  it("keeps occupied slots editable when fewer rows expand rendered capacity", () => {
    const api = requireLayoutApi();
    const layout = editableLayout();
    layout.rows = 1;

    const removed = api.reduceActionBarLayout(layout, {
      type: "drop",
      source: {
        kind: "dock-action",
        slot: { area: "all", section: "common", slotIndex: 3 },
      },
      target: { kind: "outside" },
    });

    expect(removed.status).toBe("changed");
    expect(removed.layout.all[0].slots).toEqual([
      "eat",
      "quaff",
      "kick",
      null,
    ]);
  });

  it("expands the trailing All section for a visible edit slot", () => {
    const api = requireLayoutApi();
    const layout = editableLayout();

    const inserted = api.reduceActionBarLayout(layout, {
      type: "drop",
      source: { kind: "all-actions", name: "kick" },
      target: {
        kind: "dock-slot",
        slot: { area: "all", section: "items", slotIndex: 6 },
      },
    });

    expect(inserted.status).toBe("changed");
    expect(inserted.layout.all[3].columns).toBe(4);
    expect(inserted.layout.all[3].slots[6]).toBe("kick");
  });

  it("[defect-probing] changes rows without compacting actions or explicit empty slots", () => {
    const api = requireLayoutApi();
    const layout = editableLayout();
    layout.all[2].slots.splice(2, 0, null);
    const originalSlots = {
      all: layout.all.map((section) => [...section.slots]),
      categories: structuredClone(layout.categories),
    };

    const result = api.reduceActionBarLayout(layout, {
      type: "set-rows",
      rows: 4,
    });

    expect(result.layout.rows).toBe(4);
    expect(result.layout.all.map(({ slots }) => slots))
      .toEqual(originalSlots.all);
    expect(result.layout.categories).toEqual(originalSlots.categories);
  });
});

describe("stage-five action bar layout controller", () => {
  it("[defect-probing] reports busy and failed direct layout commits", async () => {
    const api = requireControllerApi();
    const deferred: {
      resolve?: (layout: ActionBarLayout) => void;
    } = {};
    const onCommit = vi.fn((layout: ActionBarLayout) =>
      new Promise<ActionBarLayout>((resolve) => {
        deferred.resolve = () => resolve(layout);
      }));
    const controller = api.createActionBarLayoutController({
      layout: editableLayout(),
      onCommit,
    });
    const firstCandidate = editableLayout();
    firstCandidate.rows = 3;
    const secondCandidate = editableLayout();
    secondCandidate.rows = 4;

    const first = controller.commitLayout(firstCandidate);
    expect(controller.getState().status).toBe("committing");
    await expect(controller.commitLayout(secondCandidate)).resolves.toBe(false);
    expect(onCommit).toHaveBeenCalledOnce();

    expect(deferred.resolve).toBeTypeOf("function");
    deferred.resolve?.(firstCandidate);
    await expect(first).resolves.toBe(true);

    const rejecting = api.createActionBarLayoutController({
      layout: editableLayout(),
      onCommit: async () => {
        throw new Error("quota exceeded");
      },
    });
    await expect(rejecting.commitLayout(firstCandidate)).resolves.toBe(false);
    expect(rejecting.getState().status).toBe("error");
  });

  it("[defect-probing] reports successful persistence after disposal", async () => {
    const api = requireControllerApi();
    let resolveCommit: ((layout: ActionBarLayout) => void) | undefined;
    const controller = api.createActionBarLayoutController({
      layout: editableLayout(),
      onCommit: (layout) => new Promise<ActionBarLayout>((resolve) => {
        resolveCommit = () => resolve(layout);
      }),
    });
    const candidate = editableLayout();
    candidate.rows = 3;

    const commit = controller.commitLayout(candidate);
    controller.dispose();
    resolveCommit?.(candidate);

    await expect(commit).resolves.toBe(true);
  });

  it("[defect-probing] previews after five pixels and commits exactly once on pointer up", async () => {
    const api = requireControllerApi();
    const onCommit = vi.fn(async (layout: ActionBarLayout) =>
      structuredClone(layout));
    const controller = api.createActionBarLayoutController({
      layout: editableLayout(),
      onCommit,
    });

    expect(api.ACTION_BAR_EDIT_DRAG_THRESHOLD).toBe(5);
    expect(beginActionDrag(controller)).toBe(true);
    controller.pointerMove({
      clientX: 104,
      clientY: 80,
      pointerId: POINTER_ID,
      target: { kind: "dock-slot", slot: customSlot(1) },
    });
    expect(controller.getState()).toMatchObject({
      previewLayout: null,
      status: "pending",
    });
    expect(onCommit).not.toHaveBeenCalled();

    moveActionDrag(controller, {
      kind: "dock-slot",
      slot: customSlot(1),
    });
    expect(controller.getState().previewLayout?.categories.custom).toEqual([
      null,
      "search",
      "wait",
    ]);
    expect(onCommit).not.toHaveBeenCalled();

    await controller.pointerUp(POINTER_ID);
    await controller.pointerUp(POINTER_ID);

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0][0].categories.custom).toEqual([
      null,
      "search",
      "wait",
    ]);
    expect(controller.getState()).toMatchObject({
      error: null,
      previewLayout: null,
      status: "idle",
    });
  });

  it.each([
    "pointer-cancel",
    "lost-pointer-capture",
    "escape",
    "blur",
    "session-reset",
  ] as const)(
    "[defect-probing] %s cancels without committing a preview",
    async (reason) => {
      const api = requireControllerApi();
      const onCommit = vi.fn(async (layout: ActionBarLayout) => layout);
      const controller = api.createActionBarLayoutController({
        layout: editableLayout(),
        onCommit,
      });

      beginActionDrag(controller);
      moveActionDrag(controller, {
        kind: "dock-slot",
        slot: customSlot(1),
      });
      controller.cancel(reason, POINTER_ID);
      await controller.pointerUp(POINTER_ID);

      expect(onCommit).not.toHaveBeenCalled();
      expect(controller.getState()).toMatchObject({
        lastCancellationReason: reason,
        previewLayout: null,
        status: "idle",
      });
    },
  );

  it("[defect-probing] unmount disposal cancels without committing", async () => {
    const api = requireControllerApi();
    const onCommit = vi.fn(async (layout: ActionBarLayout) => layout);
    const controller = api.createActionBarLayoutController({
      layout: editableLayout(),
      onCommit,
    });

    beginActionDrag(controller);
    moveActionDrag(controller, {
      kind: "dock-slot",
      slot: customSlot(1),
    });
    controller.dispose();
    await controller.pointerUp(POINTER_ID);

    expect(onCommit).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({
      lastCancellationReason: "unmount",
      previewLayout: null,
      status: "idle",
    });
  });

  it("[defect-probing] allows a panel drag while locked but rejects its dock drop", async () => {
    const api = requireControllerApi();
    const locked = editableLayout();
    locked.locked = true;
    const onCommit = vi.fn(async (layout: ActionBarLayout) => layout);
    const controller = api.createActionBarLayoutController({
      layout: locked,
      onCommit,
    });

    expect(beginActionDrag(controller, {
      kind: "all-actions",
      name: "kick",
    })).toBe(true);
    moveActionDrag(controller, {
      kind: "dock-slot",
      slot: customSlot(1),
    });
    await controller.pointerUp(POINTER_ID);

    expect(onCommit).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({
      layout: locked,
      lockFeedback: true,
      previewLayout: null,
      status: "idle",
    });
  });

  it("[defect-probing] restores the committed layout and exposes an error when persistence fails", async () => {
    const api = requireControllerApi();
    const committed = editableLayout();
    const onCommit = vi.fn(async () => {
      throw new Error("quota exceeded");
    });
    const controller = api.createActionBarLayoutController({
      layout: committed,
      onCommit,
    });

    beginActionDrag(controller);
    moveActionDrag(controller, {
      kind: "dock-slot",
      slot: customSlot(1),
    });
    await controller.pointerUp(POINTER_ID);

    expect(onCommit).toHaveBeenCalledOnce();
    expect(controller.getState()).toMatchObject({
      layout: committed,
      previewLayout: null,
      status: "error",
    });
    expect(controller.getState().error).toEqual(expect.any(String));
  });
});

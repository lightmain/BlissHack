import { beforeAll, describe, expect, it, vi } from "vitest";
import type { GlyphInfo } from "../game-state";

interface InventoryDragPayload {
  kind: "inventory-item";
  sessionId: string;
  inventoryRevision: number;
  identifier: number;
  accelerator: number;
  glyph: GlyphInfo | null;
}

interface InventoryDropTarget {
  kind: "map";
  playerX: number;
  playerY: number;
}

type InventoryDragCancellationReason =
  | "escape"
  | "inventory-revision-changed"
  | "lost-pointer-capture"
  | "pointer-cancel"
  | "session-reset"
  | "target-missing"
  | "unmount";

interface InventoryDragPreview {
  clientX: number;
  clientY: number;
  dropHint: "Drop at your feet" | null;
  highlightedCell: { x: number; y: number } | null;
}

interface InventoryDragState {
  status: "idle" | "pending" | "dragging";
  payload: InventoryDragPayload | null;
  pointerId: number | null;
  preview: InventoryDragPreview | null;
  lastCancellationReason: InventoryDragCancellationReason | null;
}

interface InventoryDragController {
  pointerDown(input: {
    button: number;
    clientX: number;
    clientY: number;
    payload: InventoryDragPayload;
    pointerId: number;
  }): boolean;
  pointerMove(input: {
    clientX: number;
    clientY: number;
    pointerId: number;
    target: InventoryDropTarget | null;
  }): void;
  pointerUp(pointerId: number): void;
  cancel(
    reason: InventoryDragCancellationReason,
    pointerId?: number,
  ): void;
  observe(input: {
    inventoryRevision: number;
    sessionId: string;
    target: {
      accelerator: number;
      identifier: number | null;
    } | null;
  }): void;
  dispose(): void;
  getState(): InventoryDragState;
}

interface InventoryDragControllerModule {
  INVENTORY_DRAG_THRESHOLD: number;
  createInventoryDragController(options: {
    onDrop(payload: InventoryDragPayload): void;
  }): InventoryDragController;
}

const CONTROLLER_MODULE_PATH = "./inventory-drag-controller";
const POINTER_ID = 17;
const INVENTORY_REVISION = 4;
const ITEM_ACCELERATOR = "a".charCodeAt(0);
let dragModule: InventoryDragControllerModule | null = null;

beforeAll(async () => {
  try {
    dragModule = await import(
      /* @vite-ignore */ CONTROLLER_MODULE_PATH
    ) as InventoryDragControllerModule;
  } catch {
    dragModule = null;
  }
});

/**
 * Require the production drag controller while keeping this baseline runnable
 * before the stage-six implementation exists.
 */
function requireDragModule(): InventoryDragControllerModule {
  expect(
    dragModule,
    "stage six requires a pure inventory drag controller",
  ).not.toBeNull();
  return dragModule as InventoryDragControllerModule;
}

/** Return one immutable permanent-inventory drag payload. */
function createPayload(
  overrides: Partial<InventoryDragPayload> = {},
): InventoryDragPayload {
  return {
    kind: "inventory-item",
    sessionId: "session-1",
    inventoryRevision: INVENTORY_REVISION,
    identifier: 41,
    accelerator: ITEM_ACCELERATOR,
    glyph: null,
    ...overrides,
  };
}

/** Start a primary-button gesture at a stable viewport point. */
function startGesture(
  controller: InventoryDragController,
  payload = createPayload(),
): void {
  expect(controller.pointerDown({
    button: 0,
    clientX: 100,
    clientY: 80,
    payload,
    pointerId: POINTER_ID,
  })).toBe(true);
}

/** Promote the active gesture to a drag at exactly five CSS pixels. */
function promoteGesture(
  controller: InventoryDragController,
  target: InventoryDropTarget | null = null,
): void {
  controller.pointerMove({
    clientX: 103,
    clientY: 84,
    pointerId: POINTER_ID,
    target,
  });
}

describe("inventory drag controller", () => {
  it("[defect-probing] keeps movement below five CSS pixels as a click", () => {
    const api = requireDragModule();
    const onDrop = vi.fn();
    const controller = api.createInventoryDragController({ onDrop });

    expect(api.INVENTORY_DRAG_THRESHOLD).toBe(5);
    startGesture(controller);
    controller.pointerMove({
      clientX: 104,
      clientY: 80,
      pointerId: POINTER_ID,
      target: { kind: "map", playerX: 12, playerY: 6 },
    });

    expect(controller.getState()).toMatchObject({
      status: "pending",
      preview: null,
    });

    controller.pointerUp(POINTER_ID);

    expect(onDrop).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("idle");
  });

  it("[defect-probing] shows a preview at exactly five CSS pixels", () => {
    const api = requireDragModule();
    const controller = api.createInventoryDragController({
      onDrop: vi.fn(),
    });

    startGesture(controller);
    promoteGesture(controller);

    expect(controller.getState()).toMatchObject({
      status: "dragging",
      pointerId: POINTER_ID,
      preview: {
        clientX: 103,
        clientY: 84,
        dropHint: null,
        highlightedCell: null,
      },
    });
  });

  it("[defect-probing] accepts only the map as a drop target", () => {
    const api = requireDragModule();
    const onDrop = vi.fn();
    const controller = api.createInventoryDragController({ onDrop });

    startGesture(controller);
    promoteGesture(controller, null);
    controller.pointerUp(POINTER_ID);

    expect(onDrop).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("idle");
  });

  it("[defect-probing] highlights the current player cell independently of the pointer", () => {
    const api = requireDragModule();
    const controller = api.createInventoryDragController({
      onDrop: vi.fn(),
    });
    const mapTarget: InventoryDropTarget = {
      kind: "map",
      playerX: 12,
      playerY: 6,
    };

    startGesture(controller);
    promoteGesture(controller, mapTarget);
    expect(controller.getState().preview).toMatchObject({
      dropHint: "Drop at your feet",
      highlightedCell: { x: 12, y: 6 },
    });

    controller.pointerMove({
      clientX: 640,
      clientY: 420,
      pointerId: POINTER_ID,
      target: mapTarget,
    });

    expect(controller.getState().preview).toMatchObject({
      clientX: 640,
      clientY: 420,
      dropHint: "Drop at your feet",
      highlightedCell: { x: 12, y: 6 },
    });
  });

  it("[defect-probing] emits one drop for one completed map gesture", () => {
    const api = requireDragModule();
    const onDrop = vi.fn();
    const controller = api.createInventoryDragController({ onDrop });
    const payload = createPayload();

    startGesture(controller, payload);
    promoteGesture(controller, {
      kind: "map",
      playerX: 12,
      playerY: 6,
    });
    controller.pointerUp(POINTER_ID);
    controller.pointerUp(POINTER_ID);

    expect(onDrop).toHaveBeenCalledOnce();
    expect(onDrop).toHaveBeenCalledWith(payload);
    expect(controller.getState().status).toBe("idle");
  });

  it.each([
    "pointer-cancel",
    "lost-pointer-capture",
    "escape",
  ] as const)(
    "[defect-probing] %s cancels without emitting a drop",
    (reason) => {
      const api = requireDragModule();
      const onDrop = vi.fn();
      const controller = api.createInventoryDragController({ onDrop });

      startGesture(controller);
      promoteGesture(controller, {
        kind: "map",
        playerX: 12,
        playerY: 6,
      });
      controller.cancel(reason, POINTER_ID);
      controller.pointerUp(POINTER_ID);

      expect(onDrop).not.toHaveBeenCalled();
      expect(controller.getState()).toMatchObject({
        status: "idle",
        preview: null,
        lastCancellationReason: reason,
      });
    },
  );

  it("[defect-probing] component unmount disposes the gesture without dropping", () => {
    const api = requireDragModule();
    const onDrop = vi.fn();
    const controller = api.createInventoryDragController({ onDrop });

    startGesture(controller);
    promoteGesture(controller, {
      kind: "map",
      playerX: 12,
      playerY: 6,
    });
    controller.dispose();
    controller.pointerUp(POINTER_ID);

    expect(onDrop).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({
      status: "idle",
      preview: null,
      lastCancellationReason: "unmount",
    });
  });

  it.each([
    {
      label: "inventory revision changes",
      observation: {
        inventoryRevision: INVENTORY_REVISION + 1,
        sessionId: "session-1",
        target: {
          identifier: 41,
          accelerator: ITEM_ACCELERATOR,
        },
      },
      reason: "inventory-revision-changed",
    },
    {
      label: "session changes",
      observation: {
        inventoryRevision: INVENTORY_REVISION,
        sessionId: "session-2",
        target: {
          identifier: 41,
          accelerator: ITEM_ACCELERATOR,
        },
      },
      reason: "session-reset",
    },
    {
      label: "target disappears",
      observation: {
        inventoryRevision: INVENTORY_REVISION,
        sessionId: "session-1",
        target: null,
      },
      reason: "target-missing",
    },
    {
      label: "target identifier is absent",
      observation: {
        inventoryRevision: INVENTORY_REVISION,
        sessionId: "session-1",
        target: {
          identifier: null,
          accelerator: ITEM_ACCELERATOR,
        },
      },
      reason: "target-missing",
    },
    {
      label: "target accelerator is absent",
      observation: {
        inventoryRevision: INVENTORY_REVISION,
        sessionId: "session-1",
        target: {
          identifier: 41,
          accelerator: 0,
        },
      },
      reason: "target-missing",
    },
  ] as const)(
    "[defect-probing] cancels without dropping when $label",
    ({ observation, reason }) => {
      const api = requireDragModule();
      const onDrop = vi.fn();
      const controller = api.createInventoryDragController({ onDrop });

      startGesture(controller);
      promoteGesture(controller, {
        kind: "map",
        playerX: 12,
        playerY: 6,
      });
      controller.observe(observation);
      controller.pointerUp(POINTER_ID);

      expect(onDrop).not.toHaveBeenCalled();
      expect(controller.getState()).toMatchObject({
        status: "idle",
        preview: null,
        lastCancellationReason: reason,
      });
    },
  );

  it("[defect-probing] emits the immutable payload without changing permanent inventory", () => {
    const api = requireDragModule();
    const payload = Object.freeze(createPayload());
    const inventory = Object.freeze({
      revision: INVENTORY_REVISION,
      items: Object.freeze([payload]),
    });
    const onDrop = vi.fn();
    const controller = api.createInventoryDragController({ onDrop });

    startGesture(controller, payload);
    promoteGesture(controller, {
      kind: "map",
      playerX: 12,
      playerY: 6,
    });
    controller.pointerUp(POINTER_ID);

    expect(onDrop).toHaveBeenCalledWith(payload);
    expect(inventory).toEqual({
      revision: INVENTORY_REVISION,
      items: [payload],
    });
  });
});

import type { GlyphInfo } from "../game-state";

export const INVENTORY_DRAG_THRESHOLD = 5;

export interface InventoryDragPayload {
  kind: "inventory-item";
  sessionId: string;
  inventoryRevision: number;
  identifier: number;
  accelerator: number;
  glyph: GlyphInfo | null;
  clientX?: number;
  clientY?: number;
  text?: string;
}

export interface InventoryDropTarget {
  kind: "map";
  playerX: number;
  playerY: number;
}

export type InventoryDragCancellationReason =
  | "escape"
  | "inventory-revision-changed"
  | "lost-pointer-capture"
  | "pointer-cancel"
  | "session-reset"
  | "target-missing"
  | "unmount";

export interface InventoryDragPreview {
  clientX: number;
  clientY: number;
  dropHint: "Drop at your feet" | null;
  highlightedCell: { x: number; y: number } | null;
}

export interface InventoryDragState {
  status: "idle" | "pending" | "dragging";
  payload: InventoryDragPayload | null;
  pointerId: number | null;
  preview: InventoryDragPreview | null;
  lastCancellationReason: InventoryDragCancellationReason | null;
}

interface InventoryDragControllerOptions {
  onDrop(payload: InventoryDragPayload): void;
}

export interface InventoryDragController {
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
  subscribe(listener: () => void): () => void;
}

const IDLE_DRAG_STATE: InventoryDragState = {
  status: "idle",
  payload: null,
  pointerId: null,
  preview: null,
  lastCancellationReason: null,
};

/**
 * Coordinate one inventory pointer gesture without retaining DOM nodes.
 * @param options - callback invoked after a validated map drop.
 * @returns a session-observable drag controller.
 */
export function createInventoryDragController(
  options: InventoryDragControllerOptions,
): InventoryDragController {
  let state = IDLE_DRAG_STATE;
  let start: { clientX: number; clientY: number } | null = null;
  let target: InventoryDropTarget | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();

  /** Replace the public state and notify subscribers. */
  function publish(next: InventoryDragState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  /** Finish the current gesture without invoking the drop callback. */
  function cancel(
    reason: InventoryDragCancellationReason,
    pointerId?: number,
  ): void {
    if (
      state.status === "idle"
      || (pointerId !== undefined && state.pointerId !== pointerId)
    ) {
      return;
    }
    start = null;
    target = null;
    publish({
      ...IDLE_DRAG_STATE,
      lastCancellationReason: reason,
    });
  }

  return {
    /**
     * Start tracking a primary pointer for one immutable inventory snapshot.
     * @param input - pointer origin and copied inventory payload.
     * @returns whether the controller accepted the gesture.
     */
    pointerDown(input): boolean {
      if (
        disposed
        || state.status !== "idle"
        || input.button !== 0
        || !Number.isInteger(input.pointerId)
        || input.payload.identifier === 0
        || input.payload.accelerator === 0
      ) {
        return false;
      }
      start = {
        clientX: input.clientX,
        clientY: input.clientY,
      };
      target = null;
      publish({
        status: "pending",
        payload: {
          ...input.payload,
          glyph: input.payload.glyph ? { ...input.payload.glyph } : null,
        },
        pointerId: input.pointerId,
        preview: null,
        lastCancellationReason: null,
      });
      return true;
    },

    /**
     * Update pointer position and promote to dragging at five CSS pixels.
     * @param input - current pointer position and renderer-independent target.
     */
    pointerMove(input): void {
      if (
        disposed
        || state.status === "idle"
        || state.pointerId !== input.pointerId
        || !start
      ) {
        return;
      }
      const distance = Math.hypot(
        input.clientX - start.clientX,
        input.clientY - start.clientY,
      );
      if (
        state.status === "pending"
        && distance < INVENTORY_DRAG_THRESHOLD
      ) {
        return;
      }
      target = input.target;
      publish({
        ...state,
        status: "dragging",
        preview: {
          clientX: input.clientX,
          clientY: input.clientY,
          dropHint: target ? "Drop at your feet" : null,
          highlightedCell: target
            ? { x: target.playerX, y: target.playerY }
            : null,
        },
      });
    },

    /**
     * Complete the active pointer and emit at most one validated map drop.
     * @param pointerId - pointer which is being released.
     */
    pointerUp(pointerId): void {
      if (
        disposed
        || state.status === "idle"
        || state.pointerId !== pointerId
      ) {
        return;
      }
      const payload = state.payload;
      const shouldDrop = state.status === "dragging"
        && target !== null
        && payload !== null;
      start = null;
      target = null;
      publish(IDLE_DRAG_STATE);
      if (shouldDrop) options.onDrop(payload);
    },

    cancel,

    /**
     * Revalidate the active payload against the latest session inventory.
     * @param input - current session, revision, and matching snapshot row.
     */
    observe(input): void {
      const payload = state.payload;
      if (disposed || state.status === "idle" || !payload) return;
      if (input.sessionId !== payload.sessionId) {
        cancel("session-reset");
        return;
      }
      if (input.inventoryRevision !== payload.inventoryRevision) {
        cancel("inventory-revision-changed");
        return;
      }
      if (
        input.target?.identifier !== payload.identifier
        || input.target.accelerator !== payload.accelerator
        || input.target.identifier === null
        || input.target.accelerator === 0
      ) {
        cancel("target-missing");
      }
    },

    /** Cancel active work and reject future pointer input. */
    dispose(): void {
      if (disposed) return;
      if (state.status !== "idle") cancel("unmount");
      disposed = true;
      listeners.clear();
    },

    /** Return the current immutable drag state. */
    getState(): InventoryDragState {
      return state;
    },

    /**
     * Subscribe to drag presentation changes.
     * @param listener - callback invoked after each state transition.
     * @returns cleanup function.
     */
    subscribe(listener: () => void): () => void {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

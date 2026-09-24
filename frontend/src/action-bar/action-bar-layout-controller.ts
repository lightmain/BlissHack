import {
  reduceActionBarLayout,
  validateActionBarLayout,
  type ActionBarDragSource,
  type ActionBarDropTarget,
  type ActionBarLayout,
  type ActionBarLayoutEdit,
} from "./action-bar-layout";

export const ACTION_BAR_EDIT_DRAG_THRESHOLD = 5;

export type ActionBarEditCancellationReason =
  | "blur"
  | "escape"
  | "lost-pointer-capture"
  | "pointer-cancel"
  | "session-reset"
  | "unmount";

export interface ActionBarLayoutControllerState {
  error: string | null;
  lastCancellationReason: ActionBarEditCancellationReason | null;
  layout: ActionBarLayout;
  lockFeedback: boolean;
  previewLayout: ActionBarLayout | null;
  status: "idle" | "pending" | "dragging" | "committing" | "error";
}

interface ActionBarPointerInput {
  button: number;
  clientX: number;
  clientY: number;
  pointerId: number;
  source: ActionBarDragSource;
}

interface ActionBarPointerMove {
  clientX: number;
  clientY: number;
  pointerId: number;
  target: ActionBarDropTarget;
}

interface ActionBarLayoutControllerOptions {
  layout: ActionBarLayout;
  onCommit(layout: ActionBarLayout): Promise<ActionBarLayout>;
}

export interface ActionBarLayoutController {
  cancel(
    reason: ActionBarEditCancellationReason,
    pointerId?: number,
  ): void;
  clearLockFeedback(): void;
  commit(edit: ActionBarLayoutEdit): Promise<void>;
  commitLayout(layout: ActionBarLayout): Promise<boolean>;
  dispose(): void;
  getState(): ActionBarLayoutControllerState;
  pointerDown(input: ActionBarPointerInput): boolean;
  pointerMove(input: ActionBarPointerMove): void;
  pointerUp(pointerId: number): Promise<void>;
  replaceLayout(layout: ActionBarLayout): void;
  subscribe(listener: () => void): () => void;
}

interface ActivePointer {
  clientX: number;
  clientY: number;
  pointerId: number;
  source: ActionBarDragSource;
}

/**
 * Coordinate one action-bar edit without retaining DOM nodes.
 * @param options - committed layout and sole profile persistence callback.
 * @returns observable Pointer Events and direct-edit controller.
 */
export function createActionBarLayoutController(
  options: ActionBarLayoutControllerOptions,
): ActionBarLayoutController {
  let state: ActionBarLayoutControllerState = {
    error: null,
    lastCancellationReason: null,
    layout: validateActionBarLayout(options.layout),
    lockFeedback: false,
    previewLayout: null,
    status: "idle",
  };
  let activePointer: ActivePointer | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();

  /** Replace public state and notify current subscribers. */
  function publish(next: ActionBarLayoutControllerState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  /**
   * Commit one complete candidate and restore the previous layout on failure.
   * @param layout - complete candidate layout.
   * @returns whether the candidate was unchanged or persisted successfully.
   */
  async function commitLayout(layout: ActionBarLayout): Promise<boolean> {
    if (disposed || state.status === "committing") return false;
    const committed = state.layout;
    const candidate = validateActionBarLayout(layout);
    if (JSON.stringify(candidate) === JSON.stringify(committed)) {
      publish({
        ...state,
        error: null,
        lockFeedback: false,
        previewLayout: null,
        status: "idle",
      });
      return true;
    }
    publish({
      ...state,
      error: null,
      lockFeedback: false,
      previewLayout: candidate,
      status: "committing",
    });
    try {
      const saved = validateActionBarLayout(await options.onCommit(candidate));
      if (disposed) return false;
      publish({
        error: null,
        lastCancellationReason: null,
        layout: saved,
        lockFeedback: false,
        previewLayout: null,
        status: "idle",
      });
      return true;
    } catch {
      if (disposed) return false;
      publish({
        error: "Action bar layout could not be saved. Previous layout restored.",
        lastCancellationReason: null,
        layout: committed,
        lockFeedback: false,
        previewLayout: null,
        status: "error",
      });
      return false;
    }
  }

  /** Apply one reducer edit and commit it only when it changes the layout. */
  async function commit(edit: ActionBarLayoutEdit): Promise<void> {
    if (disposed || state.status === "committing") return;
    const result = reduceActionBarLayout(state.layout, edit);
    if (result.status === "locked") {
      publish({
        ...state,
        error: null,
        lockFeedback: true,
        previewLayout: null,
        status: "idle",
      });
      return;
    }
    if (result.status === "unchanged") return;
    await commitLayout(result.layout);
  }

  /** Cancel active pointer state without persisting its preview. */
  function cancel(
    reason: ActionBarEditCancellationReason,
    pointerId?: number,
  ): void {
    if (
      activePointer === null
      || (pointerId !== undefined && activePointer.pointerId !== pointerId)
    ) {
      return;
    }
    activePointer = null;
    publish({
      ...state,
      lastCancellationReason: reason,
      previewLayout: null,
      status: "idle",
    });
  }

  return {
    cancel,

    /** Clear the transient lock rejection presentation. */
    clearLockFeedback(): void {
      if (!state.lockFeedback) return;
      publish({ ...state, lockFeedback: false });
    },

    commit,
    commitLayout,

    /** Cancel active work and reject future controller input. */
    dispose(): void {
      if (disposed) return;
      if (activePointer !== null) cancel("unmount");
      disposed = true;
      listeners.clear();
    },

    /** Return the current immutable controller snapshot. */
    getState(): ActionBarLayoutControllerState {
      return state;
    },

    /**
     * Begin one primary pointer edit.
     * @param input - pointer origin and stable action or divider source.
     * @returns whether the controller accepted ownership.
     */
    pointerDown(input: ActionBarPointerInput): boolean {
      if (
        disposed
        || activePointer !== null
        || state.status === "committing"
        || input.button !== 0
        || !Number.isInteger(input.pointerId)
      ) {
        return false;
      }
      activePointer = {
        clientX: input.clientX,
        clientY: input.clientY,
        pointerId: input.pointerId,
        source: input.source,
      };
      publish({
        ...state,
        error: null,
        lastCancellationReason: null,
        lockFeedback: false,
        previewLayout: null,
        status: "pending",
      });
      return true;
    },

    /**
     * Preview a bounded edit after the shared five-pixel threshold.
     * @param input - current pointer coordinates and resolved drop target.
     */
    pointerMove(input: ActionBarPointerMove): void {
      const pointer = activePointer;
      if (
        disposed
        || pointer === null
        || pointer.pointerId !== input.pointerId
        || state.status === "committing"
      ) {
        return;
      }
      if (
        state.status === "pending"
        && Math.hypot(
          input.clientX - pointer.clientX,
          input.clientY - pointer.clientY,
        ) < ACTION_BAR_EDIT_DRAG_THRESHOLD
      ) {
        return;
      }
      const edit: ActionBarLayoutEdit = pointer.source.kind === "divider"
        ? {
          type: "move-divider",
          columnDelta: Math.round(
            (input.clientX - pointer.clientX)
            / (pointer.source.slotSize + pointer.source.slotGap),
          ),
          dividerIndex: pointer.source.dividerIndex,
        }
        : {
          type: "drop",
          source: pointer.source,
          target: input.target,
        };
      const result = reduceActionBarLayout(state.layout, edit);
      publish({
        ...state,
        error: null,
        lockFeedback: result.lockFeedback,
        previewLayout: result.status === "changed" ? result.layout : null,
        status: "dragging",
      });
    },

    /**
     * Commit one completed drag at most once.
     * @param pointerId - pointer which owns the active edit.
     */
    async pointerUp(pointerId: number): Promise<void> {
      if (
        disposed
        || activePointer === null
        || activePointer.pointerId !== pointerId
      ) {
        return;
      }
      activePointer = null;
      const candidate = state.previewLayout;
      if (!candidate) {
        publish({
          ...state,
          previewLayout: null,
          status: "idle",
        });
        return;
      }
      await commitLayout(candidate);
    },

    /**
     * Reconcile an externally committed profile layout.
     * @param layout - latest profile-owned layout.
     */
    replaceLayout(layout: ActionBarLayout): void {
      if (disposed || state.status === "committing") return;
      const next = validateActionBarLayout(layout);
      if (JSON.stringify(next) === JSON.stringify(state.layout)) return;
      activePointer = null;
      publish({
        error: null,
        lastCancellationReason: "session-reset",
        layout: next,
        lockFeedback: false,
        previewLayout: null,
        status: "idle",
      });
    },

    /**
     * Subscribe to edit-state transitions.
     * @param listener - callback notified after every public transition.
     * @returns unsubscribe function.
     */
    subscribe(listener: () => void): () => void {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

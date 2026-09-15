import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlyphInfo, TextLine } from "../game-state";
import { createHoverInspectController } from "./hover-inspect-controller";

const BASE_GLYPH: GlyphInfo = {
  glyph: 21,
  ttyChar: "d".charCodeAt(0),
  frameColor: 0,
  glyphFlags: 0,
  color: 3,
  symbolIndex: 4,
  customColor: 0,
  color256: 0,
  tileIndex: 19,
};

type MapTarget = ReturnType<typeof mapTarget>;

function mapTarget(overrides: {
  glyph?: GlyphInfo | null;
  mapRevision?: number;
  mapX?: number;
  mapY?: number;
} = {}) {
  const mapX = overrides.mapX ?? 12;
  const mapY = overrides.mapY ?? 6;
  return {
    kind: "map" as const,
    moduleId: "module-1",
    sessionId: "session-1",
    mapRevision: overrides.mapRevision ?? 7,
    glyph: overrides.glyph === undefined ? BASE_GLYPH : overrides.glyph,
    origin: {
      kind: "map" as const,
      clientX: 240 + mapX,
      clientY: 160 + mapY,
      mapX,
      mapY,
    },
  };
}

function localTarget(kind: "inventory" | "status") {
  return {
    kind,
    moduleId: "module-1",
    sessionId: "session-1",
    key: kind === "inventory" ? "inventory:4:a" : "status:hitpoints",
    anchor: { clientX: 280, clientY: 120 },
    content: kind === "inventory"
      ? {
        title: "a blessed long sword (weapon in hand)",
        description: "Inventory item",
      }
      : {
        title: "HP:42",
        description: "Current and maximum hit points.",
      },
  };
}

function environment(overrides: {
  commandBoundary?: boolean;
  dragging?: boolean;
  mapRevision?: number;
  modalOpen?: boolean;
  moduleId?: string;
  paused?: boolean;
  sessionId?: string;
} = {}) {
  return {
    commandBoundary: true,
    dragging: false,
    mapRevision: 7,
    modalOpen: false,
    moduleId: "module-1",
    paused: false,
    sessionId: "session-1",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function createHarness() {
  const pending: Array<ReturnType<typeof deferred<readonly TextLine[]>>> = [];
  const requestMapInspect = vi.fn((_target: MapTarget) => {
    const result = deferred<readonly TextLine[]>();
    pending.push(result);
    return result.promise;
  });
  const showTooltip = vi.fn();
  const hideTooltip = vi.fn();
  const controller = createHoverInspectController({
    delayMs: 300,
    hideTooltip,
    requestMapInspect,
    showTooltip,
  });
  controller.observe(environment());
  return {
    controller,
    hideTooltip,
    pending,
    requestMapInspect,
    showTooltip,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("HoverInspectController", () => {
  it("waits 300ms and does not restart the timer for the same map target", () => {
    vi.useFakeTimers();
    const { controller, requestMapInspect } = createHarness();
    const target = mapTarget();

    controller.hover(target);
    vi.advanceTimersByTime(150);
    controller.hover(target);
    vi.advanceTimersByTime(149);
    expect(requestMapInspect).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    controller.hover(target);
    vi.advanceTimersByTime(1_000);

    expect(requestMapInspect).toHaveBeenCalledOnce();
    expect(requestMapInspect).toHaveBeenCalledWith(target);
  });

  it("cancels the old delay when the pointer crosses to another map target", () => {
    vi.useFakeTimers();
    const { controller, requestMapInspect } = createHarness();
    const first = mapTarget({ mapX: 12 });
    const second = mapTarget({ mapX: 13 });

    controller.hover(first);
    vi.advanceTimersByTime(200);
    controller.hover(second);
    vi.advanceTimersByTime(299);
    expect(requestMapInspect).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(requestMapInspect).toHaveBeenCalledOnce();
    expect(requestMapInspect).toHaveBeenCalledWith(second);
  });

  it("does not queue a replacement target behind an in-flight map inspection", async () => {
    vi.useFakeTimers();
    const {
      controller,
      pending,
      requestMapInspect,
      showTooltip,
    } = createHarness();

    controller.hover(mapTarget({ mapX: 12 }));
    vi.advanceTimersByTime(300);
    controller.hover(mapTarget({ mapX: 13 }));
    vi.advanceTimersByTime(1_000);

    expect(requestMapInspect).toHaveBeenCalledOnce();
    pending[0].resolve([
      { text: "a peaceful grid bug", attribute: 32 },
    ]);
    await pending[0].promise;
    await Promise.resolve();

    expect(requestMapInspect).toHaveBeenCalledOnce();
    expect(showTooltip).not.toHaveBeenCalled();
  });

  it("waits for a command boundary before requesting map inspection", () => {
    vi.useFakeTimers();
    const { controller, requestMapInspect } = createHarness();
    controller.observe(environment({ commandBoundary: false }));

    controller.hover(mapTarget());
    vi.advanceTimersByTime(300);
    expect(requestMapInspect).not.toHaveBeenCalled();

    controller.observe(environment({ commandBoundary: true }));
    expect(requestMapInspect).toHaveBeenCalledOnce();
  });

  it("publishes a current map result as an ephemeral tooltip", async () => {
    vi.useFakeTimers();
    const { controller, pending, showTooltip } = createHarness();
    const target = mapTarget();
    const lines = [{ text: "a peaceful grid bug", attribute: 32 }];

    controller.hover(target);
    vi.advanceTimersByTime(300);
    pending[0].resolve(lines);
    await pending[0].promise;
    await Promise.resolve();

    expect(showTooltip).toHaveBeenCalledWith(expect.objectContaining({
      kind: "map",
      lines,
      origin: target.origin,
    }));
  });

  it("drops a completed result after its map revision becomes stale", async () => {
    vi.useFakeTimers();
    const { controller, pending, showTooltip } = createHarness();

    controller.hover(mapTarget());
    vi.advanceTimersByTime(300);
    controller.observe(environment({ mapRevision: 8 }));
    pending[0].resolve([{ text: "stale terrain", attribute: 32 }]);
    await pending[0].promise;
    await Promise.resolve();

    expect(showTooltip).not.toHaveBeenCalled();
  });

  it("drops a completed result after the displayed glyph changes", async () => {
    vi.useFakeTimers();
    const {
      controller,
      pending,
      requestMapInspect,
      showTooltip,
    } = createHarness();
    const target = mapTarget();

    controller.hover(target);
    vi.advanceTimersByTime(300);
    controller.hover(mapTarget({
      glyph: { ...BASE_GLYPH, glyph: 22, tileIndex: 20 },
    }));
    vi.advanceTimersByTime(1_000);
    pending[0].resolve([{ text: "stale monster", attribute: 32 }]);
    await pending[0].promise;
    await Promise.resolve();

    expect(requestMapInspect).toHaveBeenCalledOnce();
    expect(showTooltip).not.toHaveBeenCalled();
  });

  it.each(["inventory", "status"] as const)(
    "shows %s tooltip content locally without requesting the core",
    (kind) => {
      vi.useFakeTimers();
      const {
        controller,
        requestMapInspect,
        showTooltip,
      } = createHarness();
      const target = localTarget(kind);

      controller.hover(target);
      vi.advanceTimersByTime(299);
      expect(showTooltip).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);

      expect(requestMapInspect).not.toHaveBeenCalled();
      expect(showTooltip).toHaveBeenCalledWith(expect.objectContaining({
        kind,
        content: target.content,
      }));
    },
  );

  it.each([
    {
      reason: "leave",
      clear: (controller: ReturnType<typeof createHoverInspectController>) =>
        controller.leave(),
    },
    {
      reason: "modal",
      clear: (controller: ReturnType<typeof createHoverInspectController>) =>
        controller.observe(environment({ modalOpen: true })),
    },
    {
      reason: "pause",
      clear: (controller: ReturnType<typeof createHoverInspectController>) =>
        controller.observe(environment({ paused: true })),
    },
    {
      reason: "drag",
      clear: (controller: ReturnType<typeof createHoverInspectController>) =>
        controller.observe(environment({ dragging: true })),
    },
    {
      reason: "session reset",
      clear: (controller: ReturnType<typeof createHoverInspectController>) =>
        controller.observe(environment({
          moduleId: "module-2",
          sessionId: "session-2",
        })),
    },
  ])("clears pending and visible tooltip state on $reason", ({ clear }) => {
    vi.useFakeTimers();
    const {
      controller,
      hideTooltip,
      requestMapInspect,
      showTooltip,
    } = createHarness();

    controller.hover(localTarget("status"));
    vi.advanceTimersByTime(300);
    expect(showTooltip).toHaveBeenCalledOnce();

    clear(controller);
    vi.advanceTimersByTime(1_000);

    expect(hideTooltip).toHaveBeenCalled();
    expect(requestMapInspect).not.toHaveBeenCalled();
    expect(showTooltip).toHaveBeenCalledOnce();
  });
});

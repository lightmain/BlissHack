import { describe, expect, it } from "vitest";
import {
  resolveMapSecondaryInteraction,
  type InteractionOrigin,
} from "./interaction-origin";

const origin: Extract<InteractionOrigin, { kind: "map" }> = {
  kind: "map",
  clientX: 360,
  clientY: 220,
  mapX: 24,
  mapY: 9,
};

describe("resolveMapSecondaryInteraction", () => {
  it("does not create a context intent after a right-button drag", () => {
    expect(resolveMapSecondaryInteraction({
      completion: "drag",
      commandInput: true,
      inputRequest: { kind: "position" },
      moduleId: "module-1",
      sessionId: "session-1",
      snapshotRevision: 20,
      origin,
    })).toBeNull();
  });

  it("gives an explicit position request priority over a context intent", () => {
    expect(resolveMapSecondaryInteraction({
      completion: "click",
      commandInput: false,
      inputRequest: { kind: "position" },
      moduleId: "module-1",
      sessionId: "session-1",
      snapshotRevision: 20,
      origin,
    })).toEqual({
      kind: "position",
      x: origin.mapX,
      y: origin.mapY,
      modifier: 2,
    });
  });

  it("creates a map context intent for a click at the command boundary", () => {
    expect(resolveMapSecondaryInteraction({
      completion: "click",
      commandInput: true,
      inputRequest: { kind: "position" },
      moduleId: "module-1",
      sessionId: "session-1",
      snapshotRevision: 20,
      origin,
    })).toEqual({
      kind: "intent",
      intent: {
        kind: "map-context",
        moduleId: "module-1",
        sessionId: "session-1",
        snapshotRevision: 20,
        origin,
      },
    });
  });
});

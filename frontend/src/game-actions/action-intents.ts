import type { GlyphInfo } from "../game-state";
import type { InteractionOrigin } from "./interaction-origin";

interface ActionIntentBase {
  moduleId: string;
  sessionId: string;
  snapshotRevision: number;
  origin: InteractionOrigin;
}

/** One UI request which must be coordinated with the core's input boundary. */
export type ActionIntent =
  | (ActionIntentBase & {
    kind: "catalog-action";
    actionName: string;
    sessionCommandId: number;
    requestItemMenu: boolean;
    prefix: boolean;
    origin: Extract<InteractionOrigin, { kind: "action-dock" }>;
  })
  | (ActionIntentBase & {
    kind: "map-context";
    origin: Extract<InteractionOrigin, { kind: "map" }>;
  })
  | (ActionIntentBase & {
    kind: "map-inspect";
    mapRevision: number;
    glyph: GlyphInfo | null;
    origin: Extract<InteractionOrigin, { kind: "map" }>;
  })
  | (ActionIntentBase & {
    kind: "inventory-context";
    inventoryRevision: number;
    identifier: number;
    accelerator: number;
    origin: Extract<InteractionOrigin, { kind: "inventory" }>;
  })
  | (ActionIntentBase & {
    kind: "drop-item";
    inventoryRevision: number;
    identifier: number;
    accelerator: number;
    glyph: GlyphInfo | null;
    origin: Extract<InteractionOrigin, { kind: "inventory" }>;
  });

/** Reasons an automatic UI action can stop without mutating game state. */
export type ActionIntentCancellationReason =
  | "busy"
  | "fatal"
  | "inventory-revision-changed"
  | "missing-accelerator"
  | "session-reset"
  | "target-stale"
  | "unexpected-input"
  | "unmount"
  | "user-cancelled";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  beginMapInspectMessageCapture,
  cancelMapInspectMessageCapture,
  finishMapInspectMessageCapture,
  getSnapshot,
  getWindow,
  INPUT_STATE_GETDIR,
  subscribe,
  type GameSnapshot,
  type TextLine,
} from "../game-state";
import {
  createGameActionController,
  type ActionControllerInput,
  type GameActionController,
} from "../game-actions/game-action-controller";
import {
  decodeActionCatalog,
  resolveActionCatalogName,
} from "../game-actions/action-catalog";
import {
  resolveMapPrimaryInteraction,
  resolveMapSecondaryInteraction,
} from "../game-actions/interaction-origin";
import { keyboardEventToNetHackKey } from "../keyboard";
import {
  validateProfile,
  type BlissHackProfile,
} from "../settings/profile";
import {
  validateActionBarLayout,
  type ActionBarLayout,
} from "../action-bar/action-bar-layout";
import { actionRequestsItemMenu } from "../action-bar/action-catalog-metadata";
import { runtimeSettingsFromProfile } from "../settings/runtime-settings-protocol";
import type { ProfileLoadStatus } from "../settings/profile-store";
import {
  dismissDisplay,
  getCharacterSetupContext,
  queueRuntimeSettings,
  requestCoreCommand,
  requestSaveAndExit,
  sendKey,
  sendPosition,
  setActionIntentActive,
  submitActionKey,
  submitExtendedCommand,
  submitLine,
  submitMenuSelection,
  updateEndgameCollectionStyle,
} from "../nethack-bridge";
import type { TileRendererFallbackReason } from "../map/TileMapRenderer";
import type { MapInteractionOrigin } from "../map/MapViewport";
import {
  createHoverInspectController,
  type HoverInspectTooltip,
  type MapInspectTarget,
} from "../interactions/hover-inspect-controller";
import {
  AnchoredInspectTooltip,
  type LocalInspectRequest,
} from "../interactions/InspectTooltip";
import { InventoryDragPreview } from "../interactions/InventoryDragPreview";
import { OverlayRoot } from "../interactions/OverlayRoot";
import {
  createInventoryDragController,
  type InventoryDragPayload,
} from "../interactions/inventory-drag-controller";
import { SettingsScreen } from "./SettingsScreen";
import { CharacterSetupScreen } from "./CharacterSetupScreen";
import { GameModalRenderer } from "./game/GameModals";
import { GameTerminal } from "./game/GameTerminal";
import { ActionItemChooser } from "./game/ActionItemChooser";
import { PauseOverlay } from "./game/PauseOverlay";
import { SecondaryInputDialog } from "./game/SecondaryInputDialog";
import {
  directionKeyFromMapTarget,
  isDirectionKey,
} from "./game/direction-input";
import { supportsSecondaryInputDialog } from "./game/secondary-input";
import type { InventoryContextRequest } from "./PermanentInventoryPanel";

interface GameScreenProps {
  loadStatus: ProfileLoadStatus;
  moduleId: string;
  sessionId: string;
  onMapRendererFallback?(reason: TileRendererFallbackReason): void;
  onApplyProfile(profile: BlissHackProfile): Promise<BlissHackProfile>;
  profile: BlissHackProfile;
  readOnly?: boolean;
}

interface ActiveInspectTooltip {
  anchor: { clientX: number; clientY: number };
  content: {
    title: string;
    description?: string;
    glyph?: string;
  };
  id: string;
}

interface MapInspectRuntime {
  cancel(): void;
  complete(): void;
  getSnapshot(): GameSnapshot;
  open(resolve: (lines: readonly TextLine[]) => void): boolean;
  startCapture(): void;
  updateSnapshot(snapshot: GameSnapshot): void;
}

interface InventoryDropRuntime {
  drop(payload: InventoryDragPayload): void;
  updateSnapshot(snapshot: GameSnapshot): void;
}

/**
 * Render and operate the active character-mode NetHack session.
 * @param props - active profile and persistence boundary.
 * @returns the complete game terminal.
 */
export function GameScreen({
  loadStatus,
  moduleId,
  sessionId,
  onMapRendererFallback,
  onApplyProfile,
  profile,
  readOnly = false,
}: GameScreenProps) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const snapshotRef = useRef(snapshot);
  const inspectRuntime = useMemo<MapInspectRuntime>(
    () => createMapInspectRuntime(moduleId, sessionId, getSnapshot()),
    [moduleId, sessionId],
  );
  const [inspectTooltip, setInspectTooltip] =
    useState<ActiveInspectTooltip | null>(null);
  const [allActionsOpen, setAllActionsOpen] = useState(false);
  const [pauseView, setPauseView] = useState<"pause" | "settings" | null>(null);
  const previousRuntimeSettings = useRef<string | null>(null);
  const settings = profile.interface;
  const characterSetupContext = getCharacterSetupContext();
  const ownsCharacterSetup =
    characterSetupContext.style === "blisshack"
    && characterSetupContext.moduleId === moduleId
    && characterSetupContext.sessionId === sessionId;
  const setupInput = snapshot.inputRequest?.kind === "player-selection"
    || (
      snapshot.inputRequest?.kind === "line"
      && snapshot.inputRequest.purpose === "name"
    );
  const showCharacterSetup = ownsCharacterSetup
    && snapshot.phase !== "error"
    && (
      setupInput
      || (
        snapshot.inputRequest === null
        &&
        snapshot.mapRevision === 0
        && Object.keys(snapshot.status).length === 0
        && !snapshot.commandInput
        && snapshot.modal === null
      )
    );
  const gameProfile = useMemo(
    () => profileWithRuntimeSettings(profile, snapshot.runtimeSettings),
    [profile, snapshot.runtimeSettings],
  );
  const actionCatalog = currentActionCatalog(moduleId, sessionId);
  const actionController = useMemo(
    () => createGameActionController({
      scope: { moduleId, sessionId },
      /**
       * Start map commands only after the controller reaches a safe boundary.
       */
      startCommand(intent) {
        if (intent.kind === "map-context") {
          sendPosition(intent.origin.mapX, intent.origin.mapY, 2);
          return;
        }
        if (intent.kind === "map-inspect") {
          inspectRuntime.startCapture();
          if (!requestCoreCommand({
            command: "clicklook",
            x: intent.origin.mapX,
            y: intent.origin.mapY,
          })) {
            throw new Error("Core command boundary rejected map inspection");
          }
          return;
        }
        if (intent.kind === "inventory-context") {
          if (!requestCatalogCommandByName(
            "inventory",
            false,
            moduleId,
            sessionId,
          )) {
            throw new Error("Core command boundary rejected inventory context");
          }
          return;
        }
        if (intent.kind === "drop-item") {
          if (!requestCatalogCommandByName(
            "drop",
            true,
            moduleId,
            sessionId,
          )) {
            throw new Error("Core command boundary rejected inventory drop");
          }
          return;
        }
        if (intent.kind === "catalog-action") {
          const receipt = requestCoreCommand({
            command: "catalog",
            sessionCommandId: intent.sessionCommandId,
            requestItemMenu: intent.requestItemMenu,
          }, { moduleId, sessionId });
          if (!receipt) {
            throw new Error("Core command boundary rejected catalog action");
          }
          return receipt;
        }
        throw new Error("Unsupported action intent");
      },
      submitMenuSelection,
      submitDirection: submitActionKey,
      submitPosition: sendPosition,
      cancelCoreInput(input): void {
        if (input.kind === "menu") {
          submitMenuSelection(null);
        } else if (
          input.kind === "key"
          || input.kind === "position"
          || input.kind === "yn"
          || input.kind === "command"
        ) {
          submitActionKey(27);
        } else if (input.kind === "line") {
          submitLine(null);
        } else if (input.kind === "extcmd") {
          submitExtendedCommand(null);
        } else {
          dismissDisplay();
        }
      },
      releaseInputToUi: () => {
        // Unexpected input remains published in the normal game snapshot.
      },
      onCancel: () => inspectRuntime.cancel(),
      onComplete: (intent) => {
        if (intent.kind !== "map-inspect") return;
        inspectRuntime.complete();
      },
      setActionIntentActive,
    }),
    [inspectRuntime, moduleId, sessionId],
  );
  const actionState = useSyncExternalStore(
    actionController.subscribe,
    actionController.getState,
    actionController.getState,
  );
  const secondaryInputRequest =
    settings.actionBarStyle === "blisshack"
    && supportsSecondaryInputDialog(
      snapshot.inputRequest,
      snapshot.inputState,
    )
      ? snapshot.inputRequest
      : null;
  const directionTargeting = secondaryInputRequest !== null
    && snapshot.inputState === INPUT_STATE_GETDIR;
  const inventoryDropRuntime = useMemo(
    () => createInventoryDropRuntime(
      moduleId,
      sessionId,
      actionController,
      getSnapshot(),
    ),
    [actionController, moduleId, sessionId],
  );
  const inventoryDragController = useMemo(
    () => createInventoryDragController({
      onDrop: inventoryDropRuntime.drop,
    }),
    [inventoryDropRuntime],
  );
  const inventoryDragState = useSyncExternalStore(
    inventoryDragController.subscribe,
    inventoryDragController.getState,
    inventoryDragController.getState,
  );
  const hoverController = useMemo(
    () => createHoverInspectController({
      delayMs: 300,
      hideTooltip: () => setInspectTooltip(null),
      requestMapInspect: (target) =>
        requestMapInspection(actionController, target, inspectRuntime),
      showTooltip: (tooltip) =>
        setInspectTooltip(activeTooltipFromHover(tooltip)),
    }),
    [actionController, inspectRuntime, setInspectTooltip],
  );

  useEffect(() => {
    snapshotRef.current = snapshot;
    inspectRuntime.updateSnapshot(snapshot);
    inventoryDropRuntime.updateSnapshot(snapshot);
  }, [inspectRuntime, inventoryDropRuntime, snapshot]);

  useEffect(() => () => {
    hoverController.dispose();
    inventoryDragController.dispose();
    actionController.dispose();
  }, [actionController, hoverController, inventoryDragController]);

  useEffect(() => {
    if (readOnly) return;
    actionController.observe({
      moduleId,
      sessionId,
      snapshotRevision: snapshot.revision,
      inventoryRevision: snapshot.permanentInventory?.revision ?? null,
      mapRevision: snapshot.mapRevision,
      boundaryGeneration: snapshot.commandBoundaryGeneration,
      menuGeneration: snapshot.menuGeneration,
      input: actionInputFromSnapshot(snapshot),
      fatal: snapshot.phase === "error",
    });
  }, [actionController, moduleId, readOnly, sessionId, snapshot]);

  useEffect(() => {
    if (readOnly) return;
    const payload = inventoryDragController.getState().payload;
    const inventory = snapshot.permanentInventory;
    const target = payload
      ? inventory?.items.find(
        (item) =>
          item.identifier === payload.identifier
          && item.accelerator === payload.accelerator,
      ) ?? null
      : null;
    inventoryDragController.observe({
      inventoryRevision: inventory?.revision ?? -1,
      sessionId,
      target: target
        ? {
          accelerator: target.accelerator,
          identifier: target.identifier,
        }
        : null,
    });
  }, [
    inventoryDragController,
    inventoryDragState.payload,
    readOnly,
    sessionId,
    snapshot.permanentInventory,
  ]);

  useEffect(() => {
    if (readOnly) return;
    hoverController.observe({
      commandBoundary: snapshot.commandInput,
      dragging: inventoryDragState.status === "dragging",
      mapRevision: snapshot.mapRevision,
      modalOpen: snapshot.modal !== null,
      moduleId,
      paused: pauseView !== null,
      sessionId,
    });
  }, [
    hoverController,
    inventoryDragState.status,
    moduleId,
    pauseView,
    readOnly,
    sessionId,
    snapshot.commandInput,
    snapshot.mapRevision,
    snapshot.modal,
  ]);

  useEffect(() => {
    if (readOnly) return;
    const current = snapshot.runtimeSettings;
    if (!current) return;
    const serialized = JSON.stringify(current);
    const previous = previousRuntimeSettings.current;
    previousRuntimeSettings.current = serialized;
    if (
      previous === null
      || previous === serialized
      || snapshot.runtimeSettingsStatus !== "idle"
    ) {
      return;
    }
    void onApplyProfile(profileWithRuntimeSettings(profile, current))
      .catch(() => {
        // The current core value remains authoritative for this session.
      });
  }, [
    onApplyProfile,
    profile,
    readOnly,
    snapshot.runtimeSettings,
    snapshot.runtimeSettingsStatus,
  ]);

  useEffect(() => {
    if (
      !allActionsOpen
      || (
        !readOnly
        && snapshot.phase !== "error"
        && snapshot.modal === null
        && pauseView === null
      )
    ) return undefined;
    const timeout = globalThis.setTimeout(() => setAllActionsOpen(false), 0);
    return () => globalThis.clearTimeout(timeout);
  }, [
    allActionsOpen,
    pauseView,
    readOnly,
    snapshot.modal,
    snapshot.phase,
  ]);

  useEffect(() => {
    if (!allActionsOpen) return undefined;

    /**
     * Keep Tab navigation inside the combined All Actions and dock controls.
     * @param event - document keyboard event while the panel is open.
     */
    function containAllActionsAndDockFocus(event: KeyboardEvent): void {
      const allActionsPanel = document.querySelector<HTMLElement>(
        "[data-all-actions-panel]",
      );
      const actionDock = document.querySelector<HTMLElement>(
        "[data-action-dock]",
      );
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setAllActionsOpen(false);
        return;
      }
      if (event.key !== "Tab" || !allActionsPanel || !actionDock) return;
      const focusable = [
        ...Array.from(allActionsPanel.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), "
            + "[tabindex]:not([tabindex='-1'])",
        )),
        ...Array.from(actionDock.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), "
            + "[tabindex]:not([tabindex='-1'])",
        )),
      ].filter((element) =>
        element.tabIndex >= 0
        && element.closest("[hidden]") === null
        && !element.closest("[inert]")
      );
      if (focusable.length === 0) return;
      const activeIndex = focusable.indexOf(
        document.activeElement as HTMLElement,
      );
      const nextIndex = activeIndex < 0
        ? event.shiftKey ? focusable.length - 1 : 0
        : (
          activeIndex
          + (event.shiftKey ? -1 : 1)
          + focusable.length
        ) % focusable.length;
      event.preventDefault();
      event.stopPropagation();
      focusable[nextIndex].focus();
    }

    document.addEventListener("keydown", containAllActionsAndDockFocus);
    return () =>
      document.removeEventListener("keydown", containAllActionsAndDockFocus);
  }, [allActionsOpen]);

  useEffect(() => {
    if (readOnly) return;
    /**
     * Route a browser key to the active NetHack callback.
     * @param event - browser keyboard event.
     */
    function handleKeyDown(event: KeyboardEvent): void {
      hoverController.leave();
      if (inventoryDragState.status !== "idle") {
        event.preventDefault();
        if (event.key === "Escape") {
          event.stopPropagation();
          inventoryDragController.cancel("escape");
        }
        return;
      }
      if (pauseView !== null) return;
      if (snapshot.inputRequest?.kind === "line") return;
      const value = keyboardEventToNetHackKey(event, {
        numberPad: snapshot.numberPad,
      });
      if (value === null) return;
      const currentAction = actionController.getState();
      if (currentAction.intent !== null) {
        if (
          value === 27
          && (
            currentAction.status === "presenting-item-menu"
            || currentAction.status === "targeting-direction"
            || currentAction.status === "targeting-position"
          )
        ) {
          event.preventDefault();
          actionController.cancel("user-cancelled");
          return;
        }
        if (
          currentAction.status === "targeting-direction"
          && isDirectionKey(value, snapshot.numberPad)
        ) {
          event.preventDefault();
          actionController.chooseDirection(value);
          return;
        }
        if (
          currentAction.status === "targeting-position"
          && isDirectionKey(value, snapshot.numberPad)
        ) {
          event.preventDefault();
          submitActionKey(value);
          return;
        }
      }
      if (
        event.target instanceof Element
        && event.target.closest("[data-browser-keyboard]")
      ) {
        return;
      }
      if (
        event.key === "Tab"
        && event.target instanceof Element
        && event.target.closest("[data-browser-tab-navigation]")
      ) {
        return;
      }
      if (currentAction.intent !== null) {
        if (currentAction.status === "waiting-prefix-continuation") {
          event.preventDefault();
          submitActionKey(value);
          return;
        }
        if (currentAction.status !== "handed-off-to-native-ui") {
          event.preventDefault();
          return;
        }
      }
      if (snapshot.modal?.kind === "menu" || snapshot.modal?.kind === "extcmd") {
        return;
      }
      event.preventDefault();
      if (
        value === 27
        && !event.repeat
        && snapshot.commandInput
        && snapshot.modal === null
      ) {
        setPauseView("pause");
        return;
      }
      if (snapshot.modal?.kind === "text" || snapshot.modal?.kind === "history") {
        dismissDisplay();
        return;
      }
      sendKey(value);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    pauseView,
    actionController,
    hoverController,
    inventoryDragController,
    inventoryDragState.status,
    readOnly,
    snapshot.commandInput,
    snapshot.inputRequest,
    snapshot.modal,
    snapshot.numberPad,
  ]);

  /** Persist game settings, queue the dynamic subset, and advance one safe boundary. */
  async function applyGameProfile(
    candidate: BlissHackProfile,
  ): Promise<BlissHackProfile> {
    const saved = await onApplyProfile(candidate);
    updateEndgameCollectionStyle(saved.interface.endgameStyle);
    if (
      JSON.stringify(runtimeSettingsFromProfile(saved.nethack))
      !== JSON.stringify(runtimeSettingsFromProfile(gameProfile.nethack))
    ) {
      queueRuntimeSettings(saved.nethack);
      sendKey(27);
    }
    return saved;
  }

  /** Persist the panel collapse preference without entering the WASM runtime. */
  function setInventoryCollapsed(collapsed: boolean): void {
    void onApplyProfile(validateProfile({
      ...gameProfile,
      interface: {
        ...gameProfile.interface,
        permanentInventoryCollapsed: collapsed,
      },
    })).catch(() => {
      // Keep the current profile when browser persistence rejects the update.
    });
  }

  /**
   * Persist an action bar layout without entering the WASM runtime.
   * @param layout - complete validated action bar layout.
   * @returns the profile-owned layout after persistence succeeds.
   */
  const setActionBarLayout = useCallback(
    async function setActionBarLayout(
      layout: ActionBarLayout,
    ): Promise<ActionBarLayout> {
      const saved = await onApplyProfile(validateProfile({
        ...profile,
        interface: {
          ...profile.interface,
          actionBarLayout: validateActionBarLayout(layout),
        },
      }));
      return saved.interface.actionBarLayout;
    },
    [onApplyProfile, profile],
  );

  /**
   * Start or cancel one semantic action-dock request.
   * @param request - current catalog name and opaque session command ID.
   */
  const onActionRequest = useCallback((request: {
    name: string;
    sessionCommandId: number;
  }): void => {
    const current = snapshotRef.current;
    const active = actionController.getState();
    if (
      active.intent?.kind === "catalog-action"
      && active.intent.actionName === request.name
    ) {
      actionController.cancel("user-cancelled");
      return;
    }
    const command = actionCatalog?.commands.find(
      (entry) =>
        entry.name === request.name
        && entry.sessionCommandId === request.sessionCommandId,
    );
    if (
      !command
      || readOnly
      || !current.commandInput
      || current.modal !== null
      || pauseView !== null
      || active.intent !== null
      || inventoryDragController.getState().status !== "idle"
    ) {
      return;
    }
    if (!actionController.request({
      kind: "catalog-action",
      moduleId,
      sessionId,
      snapshotRevision: current.revision,
      actionName: command.name,
      sessionCommandId: command.sessionCommandId,
      requestItemMenu: actionRequestsItemMenu(command.name),
      prefix: (command.flags & 0x0200) !== 0,
      origin: {
        kind: "action-dock",
        actionName: command.name,
      },
    })) {
      return;
    }
    setAllActionsOpen(false);
    actionController.observe({
      moduleId,
      sessionId,
      snapshotRevision: current.revision,
      inventoryRevision: current.permanentInventory?.revision ?? null,
      mapRevision: current.mapRevision,
      boundaryGeneration: current.commandBoundaryGeneration,
      menuGeneration: current.menuGeneration,
      input: actionInputFromSnapshot(current),
    });
  }, [
    actionCatalog,
    actionController,
    inventoryDragController,
    moduleId,
    pauseView,
    readOnly,
    sessionId,
  ]);

  /**
   * Return keyboard ownership to the game when its non-browser UI is clicked.
   * @param event - mouse event captured by the active game shell.
   */
  function handleGameMouseDown(event: ReactMouseEvent<HTMLElement>): void {
    if (
      event.target instanceof Element
      && event.target.closest("[data-browser-keyboard]")
    ) {
      return;
    }
    const active = document.activeElement;
    if (
      active instanceof HTMLElement
      && active.closest(
        "[data-browser-keyboard], [data-game-keyboard-pass-through]",
      )
    ) {
      active.blur();
    }
  }

  /**
   * Submit a high-level map click only while the core exposes nh_poskey.
   * @param origin - serializable pointer and map coordinates.
   * @param modifier - primary or secondary NetHack click modifier.
   */
  const handlePrimaryClick = useCallback((
    origin: MapInteractionOrigin,
  ): void => {
    hoverController.leave();
    const action = actionController.getState();
    if (action.status === "targeting-position") {
      actionController.choosePosition(origin.mapX, origin.mapY, 1);
      return;
    }
    if (action.status === "targeting-direction") {
      const current = snapshotRef.current;
      const key = directionKeyFromMapTarget(
        origin.mapX - current.cursor.x,
        origin.mapY - current.cursor.y,
        current.numberPad,
      );
      if (key !== null) actionController.chooseDirection(key);
      return;
    }
    const current = snapshotRef.current;
    if (
      settings.actionBarStyle === "blisshack"
      && current.inputState === INPUT_STATE_GETDIR
      && current.inputRequest?.kind === "yn"
    ) {
      const key = directionKeyFromMapTarget(
        origin.mapX - current.cursor.x,
        origin.mapY - current.cursor.y,
        current.numberPad,
      );
      if (key !== null) sendKey(key);
      return;
    }
    const resolution = resolveMapPrimaryInteraction({
      commandInput: current.commandInput,
      inputRequest: current.inputRequest,
      moduleId,
      sessionId,
      snapshotRevision: current.revision,
      origin,
    });
    if (resolution) {
      sendPosition(resolution.x, resolution.y, resolution.modifier);
    }
  }, [
    actionController,
    hoverController,
    moduleId,
    sessionId,
    settings.actionBarStyle,
  ]);

  /**
   * Route a secondary click through explicit-position priority and the intent owner.
   * @param origin - serializable pointer and map coordinates.
   * @returns whether the click was accepted as core input.
   */
  const handleContextClick = useCallback((
    origin: MapInteractionOrigin,
  ): boolean => {
    hoverController.leave();
    const action = actionController.getState();
    if (action.status === "targeting-position") {
      return actionController.choosePosition(origin.mapX, origin.mapY, 2);
    }
    if (action.status === "targeting-direction") {
      const current = snapshotRef.current;
      const key = directionKeyFromMapTarget(
        origin.mapX - current.cursor.x,
        origin.mapY - current.cursor.y,
        current.numberPad,
      );
      return key !== null && actionController.chooseDirection(key);
    }
    const current = snapshotRef.current;
    if (
      settings.actionBarStyle === "blisshack"
      && current.inputState === INPUT_STATE_GETDIR
      && current.inputRequest?.kind === "yn"
    ) {
      const key = directionKeyFromMapTarget(
        origin.mapX - current.cursor.x,
        origin.mapY - current.cursor.y,
        current.numberPad,
      );
      if (key === null) return false;
      sendKey(key);
      return true;
    }
    const resolution = resolveMapSecondaryInteraction({
      completion: "click",
      commandInput: current.commandInput,
      inputRequest: current.inputRequest,
      moduleId,
      sessionId,
      snapshotRevision: current.revision,
      origin,
    });
    if (!resolution) return false;
    if (resolution.kind === "position") {
      sendPosition(resolution.x, resolution.y, resolution.modifier);
      return true;
    }
    if (!actionController.request(resolution.intent)) return false;
    actionController.observe({
      moduleId,
      sessionId,
      snapshotRevision: current.revision,
      inventoryRevision: current.permanentInventory?.revision ?? null,
      mapRevision: current.mapRevision,
      input: { kind: "command" },
    });
    return true;
  }, [
    actionController,
    hoverController,
    moduleId,
    sessionId,
    settings.actionBarStyle,
  ]);

  /**
   * Start itemactions only for the exact permanent-inventory snapshot shown.
   * @param request - snapshot-local identifier, accelerator, and viewport anchor.
   */
  const handleInventoryContext = useCallback((
    request: InventoryContextRequest,
  ): void => {
    hoverController.leave();
    const current = snapshotRef.current;
    const inventory = current.permanentInventory;
    const target = inventory?.items.find(
      (item) =>
        item.identifier === request.identifier
        && item.accelerator === request.origin.accelerator,
    );
    if (
      !current.commandInput
      || current.modal !== null
      || !inventory
      || inventory.revision !== request.origin.inventoryRevision
      || !target
    ) {
      return;
    }
    if (!actionController.request({
      kind: "inventory-context",
      moduleId,
      sessionId,
      snapshotRevision: current.revision,
      inventoryRevision: inventory.revision,
      identifier: request.identifier,
      accelerator: request.origin.accelerator,
      origin: request.origin,
    })) {
      return;
    }
    actionController.observe({
      moduleId,
      sessionId,
      snapshotRevision: current.revision,
      inventoryRevision: inventory.revision,
      mapRevision: current.mapRevision,
      input: { kind: "command" },
    });
  }, [actionController, hoverController, moduleId, sessionId]);

  /**
   * Debounce one map cell before requesting its core-authoritative description.
   * @param origin - current pointer and map coordinates.
   */
  const handleMapHover = useCallback((origin: MapInteractionOrigin): void => {
    const current = snapshotRef.current;
    const cell = current.map[origin.mapY]?.[origin.mapX];
    hoverController.hover({
      kind: "map",
      moduleId,
      sessionId,
      mapRevision: current.mapRevision,
      glyph: cell?.foreground ?? cell?.background ?? null,
      origin,
    });
  }, [hoverController, moduleId, sessionId]);

  /** Clear the current inspect target without cancelling an in-flight command. */
  const handleInspectLeave = useCallback((key?: string): void => {
    hoverController.leave(key);
  }, [hoverController]);

  /**
   * Keep the hover owner synchronized with the map's pointer-capture state.
   * @param dragging - whether a secondary gesture has crossed the pan threshold.
   */
  const handleMapDragChange = useCallback((dragging: boolean): void => {
    const current = snapshotRef.current;
    hoverController.observe({
      commandBoundary: current.commandInput,
      dragging,
      mapRevision: current.mapRevision,
      modalOpen: current.modal !== null,
      moduleId,
      paused: pauseView !== null,
      sessionId,
    });
  }, [hoverController, moduleId, pauseView, sessionId]);

  /**
   * Publish a local inventory or status target through the shared hover owner.
   * @param request - serializable tooltip content and viewport anchor.
   */
  const handleLocalInspect = useCallback((
    request: LocalInspectRequest,
  ): void => {
    hoverController.hover({
      ...request,
      moduleId,
      sessionId,
    });
  }, [hoverController, moduleId, sessionId]);

  return (
    <main
      className={`nh-shell nh-font-${settings.terminalFontSize}`}
      data-command-input={snapshot.commandInput ? "ready" : "busy"}
      data-number-pad={snapshot.numberPad ? "on" : "off"}
      data-read-only={readOnly ? "true" : "false"}
      data-snapshot-revision={snapshot.revision}
      data-settings-status={snapshot.runtimeSettingsStatus}
      aria-label="BlissHack"
      onMouseDownCapture={handleGameMouseDown}
    >
      {snapshot.phase === "error" ? (
        <section className="nh-fatal" role="alert">
          {snapshot.error}
        </section>
      ) : showCharacterSetup ? (
        <CharacterSetupScreen
          inputRequest={snapshot.inputRequest}
          mapRenderer={settings.mapRenderer}
          moduleId={moduleId}
          sessionId={sessionId}
        />
      ) : (
        <GameTerminal
          activeActionName={
            actionState.intent?.kind === "catalog-action"
            && (
              actionState.status === "presenting-item-menu"
              || actionState.status === "targeting-direction"
              || actionState.status === "targeting-position"
            )
              ? actionState.intent.actionName
              : null
          }
          allActionsOpen={allActionsOpen}
          actionBarLayout={settings.actionBarLayout}
          actionBarStyle={settings.actionBarStyle}
          actionBlocked={
            readOnly
            || !snapshot.commandInput
            || snapshot.modal !== null
            || pauseView !== null
            || actionState.intent !== null
            || inventoryDragState.status !== "idle"
          }
          actionCatalog={actionCatalog}
          clipCenter={snapshot.clipCenter}
          commandInput={snapshot.commandInput}
          cursor={snapshot.cursor}
          directionTargeting={directionTargeting}
          followPlayer={settings.followPlayer}
          historyLines={settings.messageHistoryLines}
          informationLevel={settings.informationLevel}
          inert={readOnly || snapshot.modal !== null || pauseView !== null}
          inputRequest={secondaryInputRequest ? null : snapshot.inputRequest}
          inventoryDragController={inventoryDragController}
          inventoryDragState={inventoryDragState}
          layoutKey={[
            settings.terminalFontSize,
            settings.messageHistoryLines,
            settings.mapRenderer,
            settings.actionBarStyle,
            settings.actionBarLayout.rows,
          ].join(":")}
          map={snapshot.map}
          mapRenderer={settings.mapRenderer}
          messages={snapshot.messages}
          onContextClick={handleContextClick}
          onContextItem={handleInventoryContext}
          onDragChange={handleMapDragChange}
          onHoverLeave={handleInspectLeave}
          onHoverTarget={handleMapHover}
          onInspect={handleLocalInspect}
          onInspectLeave={handleInspectLeave}
          onInventoryCollapsedChange={setInventoryCollapsed}
          onMapRendererFallback={onMapRendererFallback}
          onActionRequest={onActionRequest}
          onActionBarLayoutChange={setActionBarLayout}
          onAllActionsOpenChange={setAllActionsOpen}
          onPrimaryClick={handlePrimaryClick}
          permanentInventory={snapshot.permanentInventory}
          permanentInventoryCollapsed={settings.permanentInventoryCollapsed}
          permanentInventoryEnabled={gameProfile.nethack.permInvent}
          permanentInventoryPosition={settings.permanentInventoryPosition}
          sessionId={sessionId}
          status={snapshot.status}
          statusMetadata={snapshot.statusMetadata}
        />
      )}

      <OverlayRoot>
        <InventoryDragPreview state={inventoryDragState} />
        {inspectTooltip && (
          <AnchoredInspectTooltip
            anchor={inspectTooltip.anchor}
            content={inspectTooltip.content}
            id={inspectTooltip.id}
          />
        )}
        {!readOnly
          && snapshot.modal?.kind === "menu"
          && actionState.contextMenu?.windowId === snapshot.modal.windowId
          && (
            <GameModalRenderer
              actionBarStyle={settings.actionBarStyle}
              contextMenu={actionState.contextMenu}
              modal={snapshot.modal}
            />
          )}
        {!readOnly
          && actionState.status === "presenting-item-menu"
          && actionState.itemMenu
          && (
            <ActionItemChooser
              menu={actionState.itemMenu}
              onCancel={() => actionController.cancel("user-cancelled")}
              onChoose={(itemIndex) => {
                actionController.chooseItem(
                  actionState.itemMenu?.menuGeneration ?? 0,
                  itemIndex,
                );
              }}
            />
          )}
        {!readOnly && secondaryInputRequest && (
          <SecondaryInputDialog
            inputState={snapshot.inputState}
            numberPad={snapshot.numberPad}
            onCancel={() => {
              if (
                snapshot.inputState === INPUT_STATE_GETDIR
                && actionController.getState().status === "targeting-direction"
              ) {
                actionController.cancel("user-cancelled");
              } else {
                sendKey(27);
              }
            }}
            onSubmit={(value) => {
              if (
                snapshot.inputState === INPUT_STATE_GETDIR
                && actionController.getState().status === "targeting-direction"
              ) {
                actionController.chooseDirection(value);
              } else {
                sendKey(value);
              }
            }}
            request={secondaryInputRequest}
          />
        )}
      </OverlayRoot>
      {!readOnly
        && snapshot.modal
        && !(
          snapshot.modal.kind === "menu"
          && actionState.intent !== null
          && actionState.status !== "handed-off-to-native-ui"
        )
        && (
          <GameModalRenderer
            actionBarStyle={settings.actionBarStyle}
            modal={snapshot.modal}
          />
        )}
      {!readOnly && pauseView === "pause" && (
        <PauseOverlay
          ready={
            snapshot.commandInput
            && snapshot.runtimeSettingsStatus !== "pending"
          }
          onResume={() => setPauseView(null)}
          onSaveAndExit={() => {
            setPauseView(null);
            requestSaveAndExit();
          }}
          onSettings={() => setPauseView("settings")}
        />
      )}
      {!readOnly && pauseView === "settings" && (
        <SettingsScreen
          context="game"
          loadStatus={loadStatus}
          moduleId={moduleId}
          onApply={applyGameProfile}
          onBack={() => setPauseView("pause")}
          profile={gameProfile}
        />
      )}
    </main>
  );
}

/**
 * Decode the copied action catalog for the current render and session owner.
 * @param moduleId - module generation owning the catalog.
 * @param sessionId - active session owning the command identifiers.
 * @returns a validated session catalog, or null before publication.
 */
function currentActionCatalog(moduleId: string, sessionId: string) {
  try {
    return decodeActionCatalog(
      globalThis.nethackGlobal?.actionCatalog,
      { moduleId, sessionId },
    );
  } catch {
    return null;
  }
}

/**
 * Resolve a persisted command name to the current session's opaque ID.
 * @param name - authoritative extcmd name.
 * @param requestItemMenu - whether the core should request item-menu input.
 * @param moduleId - module generation which owns the catalog.
 * @param sessionId - active session which owns the catalog.
 * @returns whether the bridge accepted the catalog command.
 */
function requestCatalogCommandByName(
  name: string,
  requestItemMenu: boolean,
  moduleId: string,
  sessionId: string,
): boolean {
  const owner = { moduleId, sessionId };
  try {
    const catalog = decodeActionCatalog(
      globalThis.nethackGlobal?.actionCatalog,
      owner,
    );
    const command = resolveActionCatalogName(catalog, name, owner);
    return requestCoreCommand({
      command: "catalog",
      sessionCommandId: command.sessionCommandId,
      requestItemMenu,
    }, owner) !== null;
  } catch {
    return false;
  }
}

/**
 * Keep drop validation at the session boundary without exposing React refs.
 * @param moduleId - module generation which owns the action controller.
 * @param sessionId - active session which owns the permanent inventory.
 * @param controller - sole high-level game action coordinator.
 * @param initialSnapshot - authoritative snapshot at runtime creation.
 * @returns a mutable snapshot façade used only by pointer completion callbacks.
 */
function createInventoryDropRuntime(
  moduleId: string,
  sessionId: string,
  controller: GameActionController,
  initialSnapshot: GameSnapshot,
): InventoryDropRuntime {
  let snapshot = initialSnapshot;

  return {
    /**
     * Start one core drop only for the exact current inventory row.
     * @param payload - immutable item data captured at pointer down.
     */
    drop(payload): void {
      const inventory = snapshot.permanentInventory;
      const target = inventory?.items.find(
        (item) =>
          item.identifier === payload.identifier
          && item.accelerator === payload.accelerator,
      );
      if (
        payload.sessionId !== sessionId
        || !snapshot.commandInput
        || snapshot.modal !== null
        || !inventory
        || inventory.revision !== payload.inventoryRevision
        || !target
      ) {
        return;
      }
      if (!controller.request({
        kind: "drop-item",
        moduleId,
        sessionId,
        snapshotRevision: snapshot.revision,
        inventoryRevision: inventory.revision,
        identifier: payload.identifier,
        accelerator: payload.accelerator,
        glyph: payload.glyph,
        origin: {
          kind: "inventory",
          clientX: payload.clientX ?? 0,
          clientY: payload.clientY ?? 0,
          inventoryRevision: payload.inventoryRevision,
          accelerator: payload.accelerator,
        },
      })) {
        return;
      }
      controller.observe({
        moduleId,
        sessionId,
        snapshotRevision: snapshot.revision,
        inventoryRevision: inventory.revision,
        mapRevision: snapshot.mapRevision,
        input: { kind: "command" },
      });
    },

    /**
     * Refresh the authoritative state used by the next pointer completion.
     * @param nextSnapshot - latest bridge snapshot for this session.
     */
    updateSnapshot(nextSnapshot): void {
      snapshot = nextSnapshot;
    },
  };
}

/**
 * Request clicklook through the existing command-boundary action controller.
 * @param controller - active session action owner.
 * @param target - current map revision, glyph, and coordinates.
 * @param runtime - latest snapshot plus sole capture resolver for this session.
 * @returns lines captured until the next command boundary.
 */
function requestMapInspection(
  controller: GameActionController,
  target: MapInspectTarget,
  runtime: MapInspectRuntime,
): Promise<readonly TextLine[]> {
  return new Promise((resolve) => {
    if (!runtime.open(resolve)) {
      resolve([]);
      return;
    }
    const current = runtime.getSnapshot();
    const accepted = controller.request({
      kind: "map-inspect",
      moduleId: target.moduleId,
      sessionId: target.sessionId,
      snapshotRevision: current.revision,
      mapRevision: target.mapRevision,
      glyph: target.glyph,
      origin: target.origin,
    });
    if (!accepted) {
      runtime.cancel();
      return;
    }
    controller.observe({
      moduleId: target.moduleId,
      sessionId: target.sessionId,
      snapshotRevision: current.revision,
      inventoryRevision: current.permanentInventory?.revision ?? null,
      mapRevision: current.mapRevision,
      input: actionInputFromSnapshot(current),
      fatal: current.phase === "error",
    });
  });
}

/**
 * Own the mutable capture details which never participate in React rendering.
 * @param moduleId - module generation which owns the runtime.
 * @param sessionId - active session which owns the runtime.
 * @param initialSnapshot - authoritative snapshot at controller creation.
 * @returns an imperative coordinator with one pending map-inspect request.
 */
function createMapInspectRuntime(
  moduleId: string,
  sessionId: string,
  initialSnapshot: GameSnapshot,
): MapInspectRuntime {
  let snapshot = initialSnapshot;
  let pending: {
    capture: symbol | null;
    resolve(lines: readonly TextLine[]): void;
  } | null = null;

  /** Resolve and clear the pending request with the supplied lines. */
  function settle(lines: readonly TextLine[]): void {
    const current = pending;
    if (!current) return;
    pending = null;
    current.resolve(lines);
  }

  return {
    /** Discard captured output and resolve the pending request as empty. */
    cancel(): void {
      if (!pending) return;
      if (pending.capture) cancelMapInspectMessageCapture(pending.capture);
      settle([]);
    },
    /** Finish capture and resolve the pending request with copied lines. */
    complete(): void {
      if (!pending) return;
      const lines = pending.capture
        ? finishMapInspectMessageCapture(pending.capture) ?? []
        : [];
      settle(lines);
    },
    /** Return the latest snapshot published for this session. */
    getSnapshot(): GameSnapshot {
      return snapshot;
    },
    /**
     * Reserve the sole pending request.
     * @param resolve - callback settled on completion or cancellation.
     * @returns whether the request acquired the runtime.
     */
    open(resolve): boolean {
      if (pending) return false;
      pending = { capture: null, resolve };
      return true;
    },
    /** Start transient message capture at the core command boundary. */
    startCapture(): void {
      if (!pending) {
        throw new Error(
          `Missing map inspection request for ${moduleId}/${sessionId}`,
        );
      }
      pending.capture = beginMapInspectMessageCapture();
    },
    /**
     * Refresh the authoritative snapshot used when a delayed request begins.
     * @param nextSnapshot - latest external-store value.
     */
    updateSnapshot(nextSnapshot): void {
      snapshot = nextSnapshot;
    },
  };
}

/**
 * Normalize map and local hover results for the shared tooltip renderer.
 * @param tooltip - controller output which already passed staleness checks.
 * @returns one anchored, presentation-only tooltip.
 */
function activeTooltipFromHover(
  tooltip: HoverInspectTooltip,
): ActiveInspectTooltip {
  if (tooltip.kind !== "map") {
    return {
      anchor: tooltip.anchor,
      content: tooltip.content,
      id: `inspect-${tooltip.kind}-tooltip`,
    };
  }
  const text = tooltip.lines
    .map((line) => line.text.trim())
    .filter(Boolean);
  return {
    anchor: {
      clientX: tooltip.origin.clientX,
      clientY: tooltip.origin.clientY,
    },
    content: {
      title: text[0] ?? "Unknown location",
      description: text.slice(1).join(" ") || undefined,
    },
    id: "map-inspect-tooltip",
  };
}

/**
 * Convert the current game snapshot into the controller's narrow input view.
 * @param snapshot - authoritative bridge snapshot.
 * @returns the current input boundary without WASM pointer details.
 */
function actionInputFromSnapshot(
  snapshot: GameSnapshot,
): ActionControllerInput | null {
  if (snapshot.commandInput) {
    return { kind: "command", inputState: snapshot.inputState };
  }
  if (snapshot.modal?.kind === "menu") {
    const window = getWindow(snapshot.modal.windowId);
    return {
      kind: "menu",
      items: window?.menuItems ?? [],
      windowId: snapshot.modal.windowId,
      how: snapshot.modal.how,
      provenance: snapshot.modal.provenance,
      requestNonce: snapshot.modal.requestNonce,
      menuGeneration: snapshot.modal.menuGeneration,
    };
  }
  if (snapshot.modal?.kind === "extcmd") {
    return { kind: "extcmd", inputState: snapshot.inputState };
  }
  if (snapshot.modal !== null) {
    return { kind: "display", inputState: snapshot.inputState };
  }
  const request = snapshot.inputRequest;
  if (request === null) return null;
  if (request.kind === "player-selection") return null;
  if (request.kind === "message") {
    return { kind: "display", inputState: snapshot.inputState };
  }
  return { ...request, inputState: snapshot.inputState };
}

/**
 * Replace dynamic NetHack fields with the core's authoritative current values.
 * @param profile - persisted personal defaults.
 * @param runtimeSettings - current core snapshot, or null before startup.
 * @returns a complete profile suitable for the shared Settings form.
 */
function profileWithRuntimeSettings(
  profile: BlissHackProfile,
  runtimeSettings: GameSnapshot["runtimeSettings"],
): BlissHackProfile {
  if (!runtimeSettings) return validateProfile(profile);
  return validateProfile({
    ...profile,
    nethack: {
      tutorial: profile.nethack.tutorial,
      ...runtimeSettings,
    },
  });
}

export default GameScreen;

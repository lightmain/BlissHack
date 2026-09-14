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
  getSnapshot,
  getWindow,
  subscribe,
  type GameSnapshot,
} from "../game-state";
import {
  createGameActionController,
  type ActionControllerInput,
} from "../game-actions/game-action-controller";
import {
  resolveMapPrimaryInteraction,
  resolveMapSecondaryInteraction,
} from "../game-actions/interaction-origin";
import { keyboardEventToNetHackKey } from "../keyboard";
import {
  validateProfile,
  type BlissHackProfile,
} from "../settings/profile";
import type { ProfileLoadStatus } from "../settings/profile-store";
import {
  dismissDisplay,
  queueRuntimeSettings,
  requestSaveAndExit,
  sendKey,
  sendPosition,
  setActionIntentActive,
  submitMenuSelection,
} from "../nethack-bridge";
import type { TileRendererFallbackReason } from "../map/TileMapRenderer";
import type { MapInteractionOrigin } from "../map/MapViewport";
import { SettingsScreen } from "./SettingsScreen";
import { GameModalRenderer } from "./game/GameModals";
import { GameTerminal } from "./game/GameTerminal";
import { PauseOverlay } from "./game/PauseOverlay";

interface GameScreenProps {
  loadStatus: ProfileLoadStatus;
  moduleId: string;
  sessionId: string;
  onMapRendererFallback?(reason: TileRendererFallbackReason): void;
  onApplyProfile(profile: BlissHackProfile): Promise<BlissHackProfile>;
  profile: BlissHackProfile;
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
}: GameScreenProps) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const snapshotRef = useRef(snapshot);
  const [pauseView, setPauseView] = useState<"pause" | "settings" | null>(null);
  const previousRuntimeSettings = useRef<string | null>(null);
  const settings = profile.interface;
  const gameProfile = useMemo(
    () => profileWithRuntimeSettings(profile, snapshot.runtimeSettings),
    [profile, snapshot.runtimeSettings],
  );
  const actionController = useMemo(
    () => createGameActionController({
      scope: { moduleId, sessionId },
      /**
       * Start only the map command supported by the current stage.
       * Later phases add safe-boundary inventory and inspect commands.
       */
      startCommand(intent): void {
        if (intent.kind !== "map-context") {
          throw new Error(`Unsupported action intent: ${intent.kind}`);
        }
        sendPosition(intent.origin.mapX, intent.origin.mapY, 2);
      },
      submitMenuSelection,
      releaseInputToUi: () => {
        // Unexpected input remains published in the normal game snapshot.
      },
      setActionIntentActive,
    }),
    [moduleId, sessionId],
  );

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => () => actionController.dispose(), [actionController]);

  useEffect(() => {
    actionController.observe({
      moduleId,
      sessionId,
      snapshotRevision: snapshot.revision,
      inventoryRevision: snapshot.permanentInventory?.revision ?? null,
      mapRevision: snapshot.mapRevision,
      input: actionInputFromSnapshot(snapshot),
      fatal: snapshot.phase === "error",
    });
  }, [actionController, moduleId, sessionId, snapshot]);

  useEffect(() => {
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
    snapshot.runtimeSettings,
    snapshot.runtimeSettingsStatus,
  ]);

  useEffect(() => {
    /**
     * Route a browser key to the active NetHack callback.
     * @param event - browser keyboard event.
     */
    function handleKeyDown(event: KeyboardEvent): void {
      if (pauseView !== null) return;
      if (snapshot.inputRequest?.kind === "line") return;
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
      if (snapshot.modal?.kind === "menu" || snapshot.modal?.kind === "extcmd") {
        return;
      }
      if (actionController.getState().intent !== null) {
        event.preventDefault();
        return;
      }
      const value = keyboardEventToNetHackKey(event, {
        numberPad: snapshot.numberPad,
      });
      if (value === null) return;
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
    queueRuntimeSettings(saved.nethack);
    sendKey(27);
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
      && active.closest("[data-browser-keyboard]")
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
    const current = snapshotRef.current;
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
  }, [moduleId, sessionId]);

  /**
   * Route a secondary click through explicit-position priority and the intent owner.
   * @param origin - serializable pointer and map coordinates.
   * @returns whether the click was accepted as core input.
   */
  const handleContextClick = useCallback((
    origin: MapInteractionOrigin,
  ): boolean => {
    const current = snapshotRef.current;
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
  }, [actionController, moduleId, sessionId]);

  return (
    <main
      className={`nh-shell nh-font-${settings.terminalFontSize}`}
      data-command-input={snapshot.commandInput ? "ready" : "busy"}
      data-number-pad={snapshot.numberPad ? "on" : "off"}
      data-snapshot-revision={snapshot.revision}
      data-settings-status={snapshot.runtimeSettingsStatus}
      aria-label="BlissHack"
      onMouseDownCapture={handleGameMouseDown}
    >
      {snapshot.phase === "error" ? (
        <section className="nh-fatal" role="alert">
          {snapshot.error}
        </section>
      ) : (
        <GameTerminal
          clipCenter={snapshot.clipCenter}
          commandInput={snapshot.commandInput}
          cursor={snapshot.cursor}
          followPlayer={settings.followPlayer}
          historyLines={settings.messageHistoryLines}
          inert={snapshot.modal !== null || pauseView !== null}
          inputRequest={snapshot.inputRequest}
          layoutKey={[
            settings.terminalFontSize,
            settings.messageHistoryLines,
            settings.mapRenderer,
          ].join(":")}
          map={snapshot.map}
          mapRenderer={settings.mapRenderer}
          messages={snapshot.messages}
          onContextClick={handleContextClick}
          onInventoryCollapsedChange={setInventoryCollapsed}
          onMapRendererFallback={onMapRendererFallback}
          onPrimaryClick={handlePrimaryClick}
          permanentInventory={snapshot.permanentInventory}
          permanentInventoryCollapsed={settings.permanentInventoryCollapsed}
          permanentInventoryEnabled={gameProfile.nethack.permInvent}
          permanentInventoryPosition={settings.permanentInventoryPosition}
          status={snapshot.status}
          statusMetadata={snapshot.statusMetadata}
        />
      )}

      {snapshot.modal && <GameModalRenderer modal={snapshot.modal} />}
      {pauseView === "pause" && (
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
      {pauseView === "settings" && (
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
 * Convert the current game snapshot into the controller's narrow input view.
 * @param snapshot - authoritative bridge snapshot.
 * @returns the current input boundary without WASM pointer details.
 */
function actionInputFromSnapshot(
  snapshot: GameSnapshot,
): ActionControllerInput | null {
  if (snapshot.commandInput) return { kind: "command" };
  if (snapshot.modal?.kind === "menu") {
    const window = getWindow(snapshot.modal.windowId);
    return {
      kind: "menu",
      items: window?.menuItems ?? [],
      windowId: snapshot.modal.windowId,
      how: snapshot.modal.how,
    };
  }
  if (snapshot.modal?.kind === "extcmd") return { kind: "extcmd" };
  if (snapshot.modal !== null) return { kind: "display" };
  const request = snapshot.inputRequest;
  if (request === null) return null;
  if (request.kind === "message") return { kind: "display" };
  return request;
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

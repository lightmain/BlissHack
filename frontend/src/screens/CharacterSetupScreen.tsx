import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from "react";
import { Play, Shuffle, X } from "lucide-react";
import type { GameSnapshot } from "../game-state";
import { loadTileAtlas } from "../map/tile-assets";
import {
  cancelCharacterSetup,
  characterOptionsFor,
  completeCharacterSelection,
  confirmNativeCharacterSelection,
  createCharacterSetupController,
  decodeCharacterCatalog,
  getCharacterSetupContext,
  getCurrentCharacterSelection,
  requestNativeCharacterSelection,
  submitCharacterName,
  submitCharacterSelection,
  type CharacterAspect,
  type CharacterOption,
  type CharacterSetupController,
  type CharacterSetupOwnerToken,
} from "../nethack-bridge";
import type { MapRenderer } from "../settings/profile";

interface CharacterSetupScreenProps {
  inputRequest: GameSnapshot["inputRequest"];
  mapRenderer: MapRenderer;
  moduleId: string;
  sessionId: string;
}

const ASPECTS: readonly CharacterAspect[] = [
  "role",
  "race",
  "gender",
  "alignment",
];

const ASPECT_LABELS: Record<CharacterAspect, string> = {
  role: "Role",
  race: "Race",
  gender: "Gender",
  alignment: "Alignment",
};

/**
 * Render the session-owned unified name and character selection experience.
 * @param props - current input boundary, renderer, and ownership scope.
 * @returns the full startup screen shown in place of the uninitialized HUD.
 */
export function CharacterSetupScreen({
  inputRequest,
  mapRenderer,
  moduleId,
  sessionId,
}: CharacterSetupScreenProps) {
  const owner = useMemo<CharacterSetupOwnerToken>(
    () => ({ moduleId, sessionId }),
    [moduleId, sessionId],
  );
  const [context] = useState(
    () => getCharacterSetupContext(),
  );
  const [catalog] = useState(
    () => decodeCharacterCatalog(globalThis.nethackGlobal?.characterCatalog),
  );
  const [controller] = useState(() => {
    let created: CharacterSetupController;
    created = createCharacterSetupController({
      scope: owner,
      catalog,
      mapRenderer,
      saveIdentities: context.saveIdentities,
      initialSelection: getCurrentCharacterSelection(),
      onSubmitName: submitCharacterName,
      onSubmitSelection: submitCharacterSelection,
      onNativeChoice: requestNativeCharacterSelection,
      onNativeConfirm: (activeOwner) => {
        const selection = completeCharacterSelection(
          created.getState().selection,
        );
        if (selection) {
          confirmNativeCharacterSelection(selection, activeOwner);
        }
      },
      onCancel: cancelCharacterSetup,
    });
    return created;
  });
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const nameInputRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<HTMLElement>(null);
  const raceRef = useRef<HTMLElement>(null);
  const genderRef = useRef<HTMLElement>(null);
  const alignmentRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const skipNextNameBlurRef = useRef(false);
  const suppressNextColumnFocusRef = useRef(false);
  const isNameRequest = inputRequest?.kind === "line"
    && inputRequest.purpose === "name";
  const isSelectionRequest = inputRequest?.kind === "player-selection";
  const confirmAvailable = state.canConfirm
    && (
      (state.locked && isNameRequest)
      || (!state.locked && isSelectionRequest)
    );
  const autoAvailable = state.canAuto && isSelectionRequest;

  useEffect(() => {
    if (!isSelectionRequest) return;
    const current = getCurrentCharacterSelection();
    if (!current) return;
    if (controller.getState().phase === "auto-selecting") {
      controller.acceptNativeSelection(current, owner);
    } else if (controller.getState().phase === "selecting") {
      controller.applyCoreSelection(current, owner);
    }
  }, [controller, isSelectionRequest, owner]);

  useEffect(() => {
    if (suppressNextColumnFocusRef.current) {
      suppressNextColumnFocusRef.current = false;
      return;
    }
    if (state.focus === "name") {
      nameInputRef.current?.focus({ preventScroll: true });
    } else if (state.focus === "confirm") {
      confirmRef.current?.focus({ preventScroll: true });
    } else {
      const target = {
        role: roleRef,
        race: raceRef,
        gender: genderRef,
        alignment: alignmentRef,
      }[state.focus];
      target.current?.focus({ preventScroll: true });
    }
  }, [state.focus]);

  /**
   * Submit the name editor without allowing an empty value through.
   * @param event - browser form submission.
   */
  function handleNameSubmit(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): void {
    event.preventDefault();
    if (isNameRequest) controller.pressEnter(owner);
  }

  /**
   * Treat leaving a non-empty name editor as Enter unless Cancel owns the click.
   * @param event - focus transition leaving the name editor.
   */
  function handleNameBlur(event: ReactFocusEvent<HTMLInputElement>): void {
    const explicitCancel = skipNextNameBlurRef.current
      || (
        event.relatedTarget instanceof Element
        && event.relatedTarget.closest("[data-character-cancel]") !== null
      );
    skipNextNameBlurRef.current = false;
    if (explicitCancel) return;
    if (isNameRequest) controller.pressEnter(owner);
  }

  /**
   * Select an option while preserving the activation method's focus behavior.
   * @param event - click synthesized by a pointer or keyboard activation.
   * @param aspect - option column being activated.
   * @param index - authoritative catalog index being selected.
   */
  function handleOptionActivation(
    event: ReactMouseEvent<HTMLButtonElement>,
    aspect: CharacterAspect,
    index: number,
  ): void {
    suppressNextColumnFocusRef.current = event.detail > 0;
    if (!controller.selectOption(aspect, index, owner)) {
      suppressNextColumnFocusRef.current = false;
    }
  }

  /** Let an explicit pointer Cancel take precedence over the input blur. */
  function handleCancelPointerDown(): void {
    skipNextNameBlurRef.current =
      document.activeElement === nameInputRef.current;
  }

  /** Clear transient blur ownership and cancel the active setup flow. */
  function handleCancel(): void {
    skipNextNameBlurRef.current = false;
    controller.cancel(owner);
  }

  /**
   * Own setup accelerators and Escape before the game keyboard layer sees them.
   * @param event - keyboard event within the setup surface.
   */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    suppressNextColumnFocusRef.current = false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      controller.pressEscape(owner);
      return;
    }
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "Enter") {
      if (confirmAvailable && controller.pressEnter(owner)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (
      event.key.length === 1
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && controller.pressAccelerator(event.key, owner)
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <section
      aria-label="Character setup"
      className="character-setup"
      data-browser-keyboard
      data-character-focus={state.focus}
      data-character-phase={state.phase}
      data-character-setup="true"
      onKeyDown={handleKeyDown}
    >
      <header className="character-setup-header">
        <p>New game</p>
        <h1>Create your character</h1>
      </header>

      <div className="character-setup-grid">
        <section className="character-identity">
          <CharacterPreview
            catalog={catalog}
            preview={state.preview}
            selection={state.selection}
          />
          <form className="character-name-form" onSubmit={handleNameSubmit}>
            <label htmlFor="character-name">Name</label>
            <input
              autoComplete="off"
              autoFocus
              disabled={state.phase !== "entering-name"}
              id="character-name"
              onBlur={handleNameBlur}
              onChange={(event) => controller.setName(event.target.value, owner)}
              ref={nameInputRef}
              spellCheck={false}
              value={state.name}
            />
          </form>
          <CharacterIdentitySummary
            catalog={catalog}
            selection={state.selection}
          />
        </section>

        {ASPECTS.map((aspect) => (
          <section
            aria-label={ASPECT_LABELS[aspect]}
            className="character-option-column"
            data-character-column={aspect}
            key={aspect}
            ref={{
              role: roleRef,
              race: raceRef,
              gender: genderRef,
              alignment: alignmentRef,
            }[aspect]}
            tabIndex={-1}
          >
            <h2>{ASPECT_LABELS[aspect]}</h2>
            <div className="character-option-list">
              {characterOptionsFor(catalog, aspect).map((option) => {
                const candidate = state.candidates[aspect].find(
                  (entry) => entry.index === option.index,
                );
                const selected = candidate?.selected ?? false;
                return (
                  <button
                    aria-pressed={selected}
                    className="character-option"
                    data-character-option={`${aspect}:${option.index}`}
                    disabled={!candidate?.enabled}
                    key={option.index}
                    onClick={(event) =>
                      handleOptionActivation(event, aspect, option.index)}
                    type="button"
                  >
                    <kbd>{option.accelerator}</kbd>
                    <span>{characterOptionName(
                      option,
                      aspect,
                      state.selection.gender,
                      catalog,
                    )}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <footer className="character-setup-footer">
        <p aria-live="polite" className="character-setup-status">
          {setupStatusText(state.phase, state.locked)}
        </p>
        <div className="character-setup-actions">
          <button
            disabled={!autoAvailable}
            onClick={() => controller.requestAuto(owner)}
            type="button"
          >
            <Shuffle aria-hidden="true" size={16} />
            Auto
          </button>
          <button
            disabled={!autoAvailable}
            onClick={() => controller.requestAutoAndStart(owner)}
            type="button"
          >
            <Play aria-hidden="true" size={16} />
            Auto &amp; Start
          </button>
          <button
            className="character-confirm"
            disabled={!confirmAvailable}
            onClick={() => controller.pressEnter(owner)}
            ref={confirmRef}
            type="button"
          >
            Confirm
          </button>
          <button
            aria-label="Cancel character setup"
            className="character-cancel"
            data-character-cancel
            onClick={handleCancel}
            onPointerDown={handleCancelPointerDown}
            title="Cancel"
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </div>
      </footer>
    </section>
  );
}

/**
 * Render either an atlas-backed role tile or the retained ASCII hero.
 * @param props - current preview and catalog selection.
 * @returns stable preview frame without generated character statistics.
 */
function CharacterPreview({
  catalog,
  preview,
  selection,
}: {
  catalog: ReturnType<typeof decodeCharacterCatalog>;
  preview: ReturnType<CharacterSetupController["getState"]>["preview"];
  selection: ReturnType<CharacterSetupController["getState"]>["selection"];
}) {
  const role = selection.role === null ? null : catalog.roles[selection.role];
  const gender = selection.gender === null
    ? null
    : catalog.genders[selection.gender];
  const label = role
    ? characterOptionName(role, "role", selection.gender, catalog)
    : "Unselected adventurer";

  return (
    <div className="character-preview" aria-label={`${label} preview`}>
      {preview.kind === "ascii" ? (
        <span
          aria-hidden="true"
          className="character-preview-ascii"
          data-preview-glyph="@"
          data-preview-renderer="ascii"
        >
          @
        </span>
      ) : (
        <CharacterTile
          label={`${gender?.name ?? ""} ${label}`.trim()}
          tileIndex={preview.tileIndex}
        />
      )}
    </div>
  );
}

/**
 * Draw one authoritative role tile from the generated classic atlas.
 * @param props - tile index and accessible role label.
 * @returns a fixed-size canvas with a text fallback while assets load.
 */
function CharacterTile({
  label,
  tileIndex,
}: {
  label: string;
  tileIndex: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || tileIndex === null) {
      setReady(false);
      return;
    }
    let active = true;
    void loadTileAtlas().then((atlas) => {
      if (!active) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      const { width, height } = atlas.manifest.tile;
      const sourceX = (tileIndex % atlas.manifest.atlas.columns) * width;
      const sourceY = Math.floor(
        tileIndex / atlas.manifest.atlas.columns,
      ) * height;
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, width, height);
      context.drawImage(
        atlas.image,
        sourceX,
        sourceY,
        width,
        height,
        0,
        0,
        width,
        height,
      );
      setReady(true);
    }, () => setReady(false));
    return () => {
      active = false;
    };
  }, [tileIndex]);

  return (
    <div
      data-preview-renderer="tiles"
      data-preview-tile-index={tileIndex ?? ""}
    >
      <canvas
        aria-label={label}
        className="character-preview-tile"
        height={16}
        hidden={!ready}
        ref={canvasRef}
        role="img"
        width={16}
      />
      {!ready && (
        <span aria-hidden="true" className="character-preview-ascii">@</span>
      )}
    </div>
  );
}

/**
 * Summarize selected identity fields without exposing uninitialized status.
 * @param props - catalog and current partial selection.
 * @returns a compact identity line.
 */
function CharacterIdentitySummary({
  catalog,
  selection,
}: {
  catalog: ReturnType<typeof decodeCharacterCatalog>;
  selection: ReturnType<CharacterSetupController["getState"]>["selection"];
}) {
  const values = ASPECTS.map((aspect) => {
    const index = selection[aspect];
    if (index === null) return null;
    const option = characterOptionsFor(catalog, aspect)[index];
    return option
      ? characterOptionName(option, aspect, selection.gender, catalog)
      : null;
  }).filter((value): value is string => value !== null);
  return (
    <p className="character-identity-summary">
      {values.length > 0 ? values.join(" · ") : "Identity not yet selected"}
    </p>
  );
}

/**
 * Resolve a role's gendered display label when the catalog provides one.
 * @param option - current catalog option.
 * @param aspect - option category.
 * @param genderIndex - selected gender index.
 * @param catalog - authoritative metadata.
 * @returns the player-facing label.
 */
function characterOptionName(
  option: CharacterOption,
  aspect: CharacterAspect,
  genderIndex: number | null,
  catalog: ReturnType<typeof decodeCharacterCatalog>,
): string {
  if (aspect !== "role" || !option.femaleName || genderIndex === null) {
    return option.name;
  }
  const gender = catalog.genders[genderIndex];
  return gender?.fileCode.toLocaleLowerCase() === "fem"
    || gender?.name.toLocaleLowerCase() === "female"
    ? option.femaleName
    : option.name;
}

/**
 * Describe only the current setup outcome, not keyboard instructions.
 * @param phase - current controller phase.
 * @param locked - whether an existing save identity is selected.
 * @returns short live-region status text.
 */
function setupStatusText(
  phase: ReturnType<CharacterSetupController["getState"]>["phase"],
  locked: boolean,
): string {
  if (locked) return "Existing save found. This character will continue.";
  switch (phase) {
    case "auto-selecting":
      return "Choosing a character";
    case "starting":
      return "Entering the dungeon";
    case "cancelled":
      return "Leaving character setup";
    default:
      return "";
  }
}

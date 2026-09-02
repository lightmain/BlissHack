import type { SaveListEntry } from "../storage/storage-service";

/** Properties for the saved-game selection screen. */
interface SavePickerScreenProps {
  moduleId: string;
  onBack: () => void;
  onContinue: (save: SaveListEntry) => void;
  saves: SaveListEntry[];
}

/**
 * Render saves which were enumerated by the current home module.
 * @param props - current module identity, saves, and navigation handlers.
 * @returns the saved-game selection screen.
 */
export function SavePickerScreen({
  moduleId,
  onBack,
  onContinue,
  saves,
}: SavePickerScreenProps) {
  return (
    <main
      className="save-picker-screen"
      data-module-id={moduleId}
      aria-labelledby="save-picker-title"
    >
      <header className="save-picker-header">
        <p className="screen-kicker">Saved games</p>
        <h1 id="save-picker-title">Continue</h1>
      </header>

      <div className="save-picker-list">
        {saves.map((save) => {
          const ready = save.status === "ready";
          const label = ready
            ? save.identity.playerName
            : fileLabel(save.path);
          return (
            <button
              className="save-picker-entry"
              disabled={!ready}
              key={save.path}
              onClick={() => {
                if (ready) onContinue(save);
              }}
              type="button"
            >
              <span>{label}</span>
              <small>
                {ready ? "Ready to continue" : save.error}
              </small>
            </button>
          );
        })}
      </div>

      <button className="save-picker-back" onClick={onBack} type="button">
        Back
      </button>
    </main>
  );
}

/** Derive a non-authoritative label for an invalid candidate path. */
function fileLabel(path: string): string {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  return fileName.startsWith("0") ? fileName.slice(1) : fileName;
}

import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveListEntry } from "../storage/storage-service";
import { SavePickerPopover } from "./SavePickerPopover";

const hooks = vi.hoisted(() => {
  let cursor = 0;
  let states: unknown[] = [];

  return {
    beginRender(): void {
      cursor = 0;
    },
    reset(): void {
      cursor = 0;
      states = [];
    },
    useState<T>(
      initial: T | (() => T),
    ): [T, (next: T | ((current: T) => T)) => void] {
      const index = cursor++;
      if (!(index in states)) {
        states[index] = typeof initial === "function"
          ? (initial as () => T)()
          : initial;
      }
      return [
        states[index] as T,
        (next) => {
          const current = states[index] as T;
          states[index] = typeof next === "function"
            ? (next as (value: T) => T)(current)
            : next;
        },
      ];
    },
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: hooks.useState,
  };
});

interface DeletableSavePickerProps {
  moduleId: string;
  onContinue: (save: SaveListEntry) => void;
  onDelete: (save: SaveListEntry) => Promise<void>;
  onExport: (save: SaveListEntry) => Promise<void>;
  onImport: (
    request: {
      bytes: Uint8Array;
      modifiedAt: number | null;
      overwrite: boolean;
    },
  ) => Promise<{ status: "imported" }>;
  saves: SaveListEntry[];
}

type DeletableSavePicker = (
  props: DeletableSavePickerProps,
) => ReactElement;

const saves: SaveListEntry[] = [
  {
    path: "/save/0Ada",
    modifiedAt: 1_700_000_000_000,
    status: "ready",
    identity: {
      playerName: "Ada",
      role: "Wiz",
      race: "Hum",
      gender: "Fem",
      alignment: "Neu",
    },
  },
  {
    path: "/save/0Bob",
    modifiedAt: 1_710_000_000_000,
    status: "ready",
    identity: {
      playerName: "Bob",
      role: "Arc",
      race: "Hum",
      gender: "Mal",
      alignment: "Law",
    },
  },
];

/** Render one Popover pass while retaining hook state between passes. */
function renderPicker(
  onDelete: DeletableSavePickerProps["onDelete"],
  onExport: DeletableSavePickerProps["onExport"] = async () => undefined,
  onImport: DeletableSavePickerProps["onImport"] = async () => ({
    status: "imported",
  }),
): ReactElement {
  hooks.beginRender();
  const Component = SavePickerPopover as unknown as DeletableSavePicker;
  return Component({
    moduleId: "module-1",
    onContinue: vi.fn(),
    onDelete,
    onExport,
    onImport,
    saves,
  });
}

/** Return every React element nested below a test-rendered tree. */
function allElements(node: ReactNode): ReactElement[] {
  if (
    node === null
    || node === undefined
    || typeof node === "boolean"
    || typeof node === "string"
    || typeof node === "number"
  ) {
    return [];
  }
  if (Array.isArray(node)) return node.flatMap(allElements);

  const element = node as ReactElement<{ children?: ReactNode }>;
  return [element, ...allElements(element.props.children)];
}

/** Find a delete button by its explicit accessible name. */
function deleteButton(tree: ReactElement, playerName: string): ReactElement<{
  "aria-label": string;
  disabled?: boolean;
  onClick?: () => unknown;
}> {
  const label = `Delete save ${playerName}`;
  const button = allElements(tree).find((element) => {
    const props = element.props as Record<string, unknown>;
    return element.type === "button" && props["aria-label"] === label;
  });
  expect(button, `missing ${label} button`).toBeDefined();
  return button as ReturnType<typeof deleteButton>;
}

/** Invoke one test-rendered delete button without a browser DOM. */
function clickDelete(tree: ReactElement, playerName: string): unknown {
  return deleteButton(tree, playerName).props.onClick?.();
}

/** Allow Promise continuations triggered by an event handler to settle. */
async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Find the raw save file input. */
function importInput(tree: ReactElement): ReactElement<{
  onChange?: (event: {
    currentTarget: {
      files: Array<{
        name: string;
        size: number;
        lastModified: number;
        arrayBuffer(): Promise<ArrayBuffer>;
      }>;
      value: string;
    };
  }) => unknown;
}> {
  const input = allElements(tree).find((element) => {
    const props = element.props as Record<string, unknown>;
    return element.type === "input"
      && props["aria-label"] === "Import save file";
  });
  expect(input, "missing Import save input").toBeDefined();
  return input as ReturnType<typeof importInput>;
}

beforeEach(() => {
  hooks.reset();
});

describe("SavePickerPopover deletion confirmation", () => {
  it("requires a second click and keeps confirmation exclusive to one item", () => {
    const onDelete = vi.fn(async () => undefined);
    let tree = renderPicker(onDelete);

    clickDelete(tree, "Ada");
    tree = renderPicker(onDelete);
    let html = renderToStaticMarkup(tree);
    expect(onDelete).not.toHaveBeenCalled();
    expect(html.match(/Sure\?/g)).toHaveLength(1);
    expect(html).toMatch(
      /class="save-delete-control"><span class="save-delete-confirmation">Sure\?<\/span><button aria-label="Delete save Ada"/,
    );

    clickDelete(tree, "Bob");
    tree = renderPicker(onDelete);
    html = renderToStaticMarkup(tree);
    expect(onDelete).not.toHaveBeenCalled();
    expect(html.match(/Sure\?/g)).toHaveLength(1);
    expect(html).toMatch(
      /class="save-delete-control"><span class="save-delete-confirmation">Sure\?<\/span><button aria-label="Delete save Bob"/,
    );
  });

  it("calls async deletion once and disables repeat deletion while pending", async () => {
    let resolveDelete!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    const onDelete = vi.fn(() => pending);
    let tree = renderPicker(onDelete);

    clickDelete(tree, "Ada");
    tree = renderPicker(onDelete);
    clickDelete(tree, "Ada");
    tree = renderPicker(onDelete);

    const deletingButton = deleteButton(tree, "Ada");
    expect(deletingButton.props.disabled).toBe(true);
    clickDelete(tree, "Ada");
    expect(onDelete).toHaveBeenCalledOnce();

    resolveDelete();
    await flushPromises();
  });

  it("shows a deletion error and keeps the save after rejection", async () => {
    const onDelete = vi.fn(async () => {
      throw new Error("Could not delete save");
    });
    let tree = renderPicker(onDelete);

    clickDelete(tree, "Ada");
    tree = renderPicker(onDelete);
    clickDelete(tree, "Ada");
    await flushPromises();
    tree = renderPicker(onDelete);
    const html = renderToStaticMarkup(tree);

    expect(onDelete).toHaveBeenCalledOnce();
    expect(html).toMatch(/Could not delete save/);
    expect(html).toMatch(/>Ada</);
    expect(deleteButton(tree, "Ada")).toBeDefined();
  });
});

describe("SavePickerPopover raw save transfer", () => {
  it("routes export through the ready save action", () => {
    const onExport = vi.fn(async () => undefined);
    const tree = renderPicker(async () => undefined, onExport);
    const button = allElements(tree).find((element) => {
      const props = element.props as Record<string, unknown>;
      return props["aria-label"] === "Export save Ada";
    }) as ReactElement<{ onClick?: () => unknown }> | undefined;

    expect(button).toBeDefined();
    button?.props.onClick?.();
    expect(onExport).toHaveBeenCalledWith(saves[0]);
  });

  it("reads one file, ignores its name for identity, and shows success", async () => {
    const bytes = Uint8Array.of(0x68, 0x01, 0x02);
    const onImport = vi.fn(async () => ({ status: "imported" as const }));
    let tree = renderPicker(async () => undefined, undefined, onImport);
    const input = importInput(tree);
    const currentTarget = {
      files: [{
        name: "renamed.bin",
        size: bytes.length,
        lastModified: 1_725_000_000_000,
        arrayBuffer: async () => bytes.buffer,
      }],
      value: "renamed.bin",
    };

    await input.props.onChange?.({ currentTarget });
    await flushPromises();
    tree = renderPicker(async () => undefined, undefined, onImport);

    expect(onImport).toHaveBeenCalledWith({
      bytes,
      modifiedAt: 1_725_000_000_000,
      overwrite: false,
    });
    expect(currentTarget.value).toBe("");
    expect(renderToStaticMarkup(tree)).toMatch(/Import successful/);
  });

  it("reports a browser file read failure without starting an import", async () => {
    const onImport = vi.fn(async () => ({ status: "imported" as const }));
    let tree = renderPicker(async () => undefined, undefined, onImport);
    const input = importInput(tree);
    const currentTarget = {
      files: [{
        name: "unreadable.bin",
        size: 4,
        lastModified: 1_725_000_000_000,
        arrayBuffer: async (): Promise<ArrayBuffer> => {
          throw new Error("browser file read failed");
        },
      }],
      value: "unreadable.bin",
    };

    input.props.onChange?.({ currentTarget });
    await vi.waitFor(() => {
      tree = renderPicker(async () => undefined, undefined, onImport);
      expect(renderToStaticMarkup(tree)).toMatch(
        /Import failed[\s\S]*browser file read failed/,
      );
    });

    expect(onImport).not.toHaveBeenCalled();
    expect(currentTarget.value).toBe("");
  });
});

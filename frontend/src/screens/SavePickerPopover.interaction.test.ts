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
  saves: SaveListEntry[];
}

type DeletableSavePicker = (
  props: DeletableSavePickerProps,
) => ReactElement;

const saves: SaveListEntry[] = [
  {
    path: "/save/0Ada",
    status: "ready",
    identity: { playerName: "Ada" },
  },
  {
    path: "/save/0Bob",
    status: "ready",
    identity: { playerName: "Bob" },
  },
];

/** Render one Popover pass while retaining hook state between passes. */
function renderPicker(
  onDelete: DeletableSavePickerProps["onDelete"],
): ReactElement {
  hooks.beginRender();
  const Component = SavePickerPopover as unknown as DeletableSavePicker;
  return Component({
    moduleId: "module-1",
    onContinue: vi.fn(),
    onDelete,
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

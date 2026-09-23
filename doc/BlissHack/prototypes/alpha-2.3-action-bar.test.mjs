import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const prototypeDirectory = dirname(fileURLToPath(import.meta.url));
const prototypePath = join(prototypeDirectory, "alpha-2.3-action-bar.html");
const indexCssPath = join(prototypeDirectory, "../../../frontend/src/index.css");
const prototypeExists = existsSync(prototypePath);
const html = prototypeExists ? readFileSync(prototypePath, "utf8") : "";
const indexCss = readFileSync(indexCssPath, "utf8");
const expectedCategoryTags = [
  "all",
  "common",
  "gear",
  "magic",
  "items",
  "explore",
  "custom",
];
const requiredDefaultActions = [
  "eat",
  "quaff",
  "kick",
  "wield",
  "wear",
  "puton",
  "takeoff",
  "remove",
  "cast",
  "zap",
  "read",
  "fire",
  "throw",
  "apply",
  "engrave",
  "dip",
  "loot",
];
const forbiddenDefaultActions = ["open", "close", "drop"];
let wasmActionsPromise;

/**
 * Skip content assertions until the prototype exists.
 * @param {import("node:test").TestContext} context Node test context.
 * @returns {boolean} whether the prototype can be inspected.
 */
function requirePrototype(context) {
  if (!prototypeExists) {
    context.skip(`Missing prototype: ${prototypePath}`);
    return false;
  }
  return true;
}

/**
 * Read one machine-readable JSON script embedded in the prototype.
 * @param {string} id script element id.
 * @returns {Record<string, unknown>} parsed JSON object.
 */
function readJsonScript(id) {
  const pattern = new RegExp(
    `<script\\b(?=[^>]*\\bid=["']${id}["'])`
      + `(?=[^>]*\\btype=["']application/json["'])[^>]*>`
      + "([\\s\\S]*?)<\\/script>",
    "i",
  );
  const match = html.match(pattern);
  assert.ok(match, `prototype must embed #${id} application/json`);
  return JSON.parse(match[1]);
}

/**
 * Return opening tags which declare one machine-readable attribute.
 * @param {string} attribute attribute name.
 * @returns {string[]} matching opening tags in source order.
 */
function openingTagsWithAttribute(attribute) {
  return html.match(
    new RegExp(
      `<[^>]+\\b${attribute}(?:=["'][^"']*["'])?[^>]*>`,
      "gi",
    ),
  ) ?? [];
}

/**
 * Read an attribute value from an opening tag.
 * @param {string} tag opening HTML tag.
 * @param {string} attribute attribute name.
 * @returns {string|null} attribute value or null when absent.
 */
function readAttribute(tag, attribute) {
  return tag.match(
    new RegExp(`\\b${attribute}=["']([^"']*)["']`, "i"),
  )?.[1] ?? null;
}

/**
 * Read the machine-checkable action bar configuration.
 * @returns {Record<string, unknown>} parsed action bar configuration.
 */
function readActionBarConfig() {
  return readJsonScript("action-bar-config");
}

/**
 * Flatten the default All layout from its vertical sections.
 * @param {Record<string, unknown>} config action bar configuration.
 * @returns {string[]} action names in visual order.
 */
function readDefaultAllActions(config) {
  const sections = config.layouts?.all;
  assert.ok(
    Array.isArray(sections) && sections.length >= 2,
    "config.layouts.all must contain multiple vertical sections",
  );
  return sections.flatMap((section) => {
    assert.ok(
      Array.isArray(section.actions),
      "each default All section must expose an actions array",
    );
    return section.actions;
  });
}

/**
 * Decode the authoritative visible player commands from the checked-in WASM.
 * @returns {Promise<Array<{name: string, flags: number}>>} commands in source
 * order.
 */
function readWasmActions() {
  wasmActionsPromise ??= (async () => {
    const runtimeUrl = new URL(
      "../../../frontend/public/nethack.js",
      import.meta.url,
    );
    const factory = (await import(runtimeUrl.href)).default;
    const module = await factory({
      noInitialRun: true,
      print: () => {},
      printErr: () => {},
    });
    globalThis.actionBarCatalogProbe = () => new Promise(() => {});
    module.ccall(
      "shim_graphics_set_callback",
      null,
      ["string"],
      ["actionBarCatalogProbe"],
    );
    module.ccall("main", "number", [], [], { async: true }).catch(() => {});

    const listPtr = globalThis.nethackGlobal?.pointers?.extcmdlist ?? 0;
    assert.notEqual(listPtr, 0, "WASM runtime must expose extcmdlist");
    const actions = [];
    for (let index = 0; index < 1024; index += 1) {
      const entryPtr = listPtr + index * 24;
      const namePtr = Number(module.getValue(entryPtr + 4, "*"));
      if (namePtr === 0) break;
      const flags = Number(module.getValue(entryPtr + 16, "i32")) >>> 0;
      if ((flags & (0x0004 | 0x0010 | 0x0040)) !== 0) continue;
      actions.push({
        name: module.UTF8ToString(namePtr),
        flags,
      });
    }
    return actions;
  })();
  return wasmActionsPromise;
}

test("prototype HTML exists", () => {
  assert.ok(
    prototypeExists,
    `expected ${prototypePath} to exist before checking its contract`,
  );
});

test("uses the alpha-2.2 real game HUD context", (context) => {
  if (!requirePrototype(context)) return;

  assert.match(html, /\bclass=["'][^"']*\bnh-messages\b[^"']*["']/i);
  assert.match(
    html,
    /<div\b[^>]*\bclass=["'][^"']*\bnh-map-scroll\b[^"']*["'][^>]*>[\s\S]*?<canvas\b/i,
  );
  assert.match(html, /\bclass=["'][^"']*\bpermanent-inventory\b[^"']*["']/i);
});

test("places status left of a two-row dock with independent controls", (context) => {
  if (!requirePrototype(context)) return;

  const [dock] = openingTagsWithAttribute("data-action-dock");
  assert.ok(dock, "prototype must expose data-action-dock");
  assert.equal(readAttribute(dock, "data-row-count"), "2");

  const statusIndex = html.search(/\bdata-dock-region=["']status["']/i);
  const gridIndex = html.search(/\bdata-action-grid(?:=["'][^"']*["'])?/i);
  assert.ok(
    statusIndex >= 0 && gridIndex > statusIndex,
    "status region must precede the action grid inside the dock",
  );
  assert.match(html, /<button\b(?=[^>]*\bdata-row-action=["']decrease["'])[^>]*>/i);
  assert.match(html, /<button\b(?=[^>]*\bdata-row-action=["']increase["'])[^>]*>/i);
  assert.match(html, /<button\b(?=[^>]*\bdata-action-bar-lock\b)[^>]*>/i);
  assert.match(
    html,
    /<button\b(?=[^>]*\bdata-all-actions-trigger\b)(?=[^>]*\baria-label=["']All Actions["'])[^>]*>\s*(?:\.\.\.|&#8943;|&hellip;)\s*<\/button>/i,
  );
});

test("stacks four fixed circular dock controls with flexible spacing", (context) => {
  if (!requirePrototype(context)) return;

  const dockToolsMarkup = html.match(
    /<div\b[^>]*\bclass=["'][^"']*\bdock-tools\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  )?.[1];
  assert.ok(dockToolsMarkup, "prototype must expose the dock tools container");
  assert.equal(
    (dockToolsMarkup.match(/<button\b/gi) ?? []).length,
    4,
    "dock tools must contain exactly four buttons",
  );

  const dockToolsRule = html.match(/\.dock-tools\s*\{([^}]*)\}/i)?.[1];
  assert.ok(dockToolsRule, "prototype must style .dock-tools");
  assert.match(dockToolsRule, /\bdisplay:\s*flex\s*;/i);
  assert.match(dockToolsRule, /\bflex-direction:\s*column\s*;/i);
  assert.match(dockToolsRule, /\bjustify-content:\s*space-between\s*;/i);

  const toolButtonRule = html.match(/\.tool-button\s*\{([^}]*)\}/i)?.[1];
  assert.ok(toolButtonRule, "prototype must style .tool-button");
  const width = toolButtonRule.match(/\bwidth:\s*([^;]+)\s*;/i)?.[1].trim();
  const height = toolButtonRule.match(/\bheight:\s*([^;]+)\s*;/i)?.[1].trim();
  assert.ok(width && height, "tool buttons must declare fixed width and height");
  assert.equal(width, height, "tool buttons must have equal fixed dimensions");
  assert.match(
    width,
    /^(?:\d+(?:\.\d+)?px|var\(\s*--[a-z0-9-]*tool[a-z0-9-]*size\s*\))$/i,
    "tool button size must be a fixed pixel value or fixed tool-size variable",
  );
  assert.match(toolButtonRule, /\bborder-radius:\s*50%\s*;/i);
});

test("places the ordered category tags below the action grid", (context) => {
  if (!requirePrototype(context)) return;

  const categoryTags = openingTagsWithAttribute("data-category-tag");
  assert.deepEqual(
    categoryTags.map((tag) => readAttribute(tag, "data-category-tag")),
    expectedCategoryTags,
  );
  assert.ok(
    html.search(/\bdata-category-tags\b/i)
      > html.search(/\bdata-action-grid(?:=["'][^"']*["'])?/i),
    "category tags must follow the action grid",
  );
});

test("defines draggable vertical grid-snapped dividers for the All layout", (context) => {
  if (!requirePrototype(context)) return;

  const dividers = openingTagsWithAttribute("data-section-divider");
  assert.ok(
    dividers.length >= 2,
    "the combined All layout must expose multiple section dividers",
  );
  for (const divider of dividers) {
    assert.equal(readAttribute(divider, "data-layout-category"), "all");
    assert.equal(readAttribute(divider, "data-orientation"), "vertical");
    assert.equal(readAttribute(divider, "data-snap"), "grid");
    assert.equal(readAttribute(divider, "draggable"), "true");
  }
});

test("fills the final All section with complete slots across the available width", (context) => {
  if (!requirePrototype(context)) return;

  const [grid] = openingTagsWithAttribute("data-action-grid");
  assert.ok(grid, "prototype must expose data-action-grid");
  assert.equal(
    readAttribute(grid, "data-last-section-fill"),
    "empty-slots",
    "the final All section must absorb remaining width with empty slots",
  );
  assert.equal(
    readAttribute(grid, "data-column-fit"),
    "available-width-integer",
    "available width must resolve to an integer column count",
  );
  assert.equal(
    readAttribute(grid, "data-slot-sizing"),
    "dynamic",
    "slot size must adapt to the available width",
  );
  assert.equal(
    readAttribute(grid, "data-grid-width"),
    "complete-slots",
    "the fitted grid width must contain only complete slots",
  );
});

test("catalog is exactly the 104 current non-directional WASM commands", async (context) => {
  if (!requirePrototype(context)) return;

  const wasmActions = await readWasmActions();
  const wasmCatalog = wasmActions.filter(({ flags }) => (flags & 0x0400) === 0);
  const wasmMovement = wasmActions.filter(({ flags }) => (flags & 0x0400) !== 0);
  const { catalog } = readActionBarConfig();

  assert.equal(wasmCatalog.length, 104);
  assert.equal(wasmMovement.length, 24);
  assert.ok(Array.isArray(catalog), "action-bar-config.catalog must be an array");
  assert.equal(catalog.length, 104);
  assert.equal(new Set(catalog.map(({ name }) => name)).size, 104);
  assert.deepEqual(
    catalog.map(({ name }) => name),
    wasmCatalog.map(({ name }) => name),
    "catalog names and order must match the checked-in WASM",
  );
  assert.deepEqual(
    catalog
      .map(({ name }) => name)
      .filter((name) => wasmMovement.some((action) => action.name === name)),
    [],
    "catalog must exclude all move/rush/run direction variants",
  );
});

test("default All sections contain the required actions without unsafe defaults", async (context) => {
  if (!requirePrototype(context)) return;

  const config = readActionBarConfig();
  const defaultActions = readDefaultAllActions(config);
  const wasmMovementNames = new Set(
    (await readWasmActions())
      .filter(({ flags }) => (flags & 0x0400) !== 0)
      .map(({ name }) => name),
  );

  for (const action of requiredDefaultActions) {
    assert.ok(defaultActions.includes(action), `default All must include ${action}`);
  }
  for (const action of forbiddenDefaultActions) {
    assert.ok(!defaultActions.includes(action), `default All must exclude ${action}`);
  }
  assert.ok(
    defaultActions.every((action) => !wasmMovementNames.has(action)),
    "default All must exclude every directional movement action",
  );
});

test("All Actions is a non-fullscreen scrolling vertical section grid", (context) => {
  if (!requirePrototype(context)) return;

  const [panel] = openingTagsWithAttribute("data-all-actions-panel");
  assert.ok(panel, "prototype must expose data-all-actions-panel");
  assert.equal(readAttribute(panel, "data-fullscreen"), "false");
  assert.equal(readAttribute(panel, "data-layout"), "vertical-sections");
  assert.equal(readAttribute(panel, "data-overlap-action-dock"), "false");
  assert.notEqual(readAttribute(panel, "aria-modal"), "true");

  assert.ok(
    openingTagsWithAttribute("data-all-actions-section").length >= 2,
    "All Actions must contain multiple category sections",
  );
  assert.match(
    html,
    /\.all-actions-panel\s*\{[\s\S]*?overflow-y:\s*auto/i,
  );
  assert.match(
    html,
    /\.all-actions-sections\s*\{[\s\S]*?flex-direction:\s*column/i,
  );
  assert.match(
    html,
    /\.all-actions-grid\s*\{[\s\S]*?display:\s*grid/i,
  );
  assert.match(
    html,
    /\.all-actions-slot\s*\{[\s\S]*?aspect-ratio:\s*1(?:\s*\/\s*1)?/i,
  );
});

test("action tooltip data contains only WASM name and key", (context) => {
  if (!requirePrototype(context)) return;

  const config = readActionBarConfig();
  assert.deepEqual(config.tooltipFields, ["name", "key"]);
  assert.ok(
    config.catalog.every(
      (action) =>
        typeof action.name === "string"
        && typeof action.key === "string"
        && !Object.hasOwn(action, "description"),
    ),
    "catalog tooltip sources must expose name/key without authored descriptions",
  );
  assert.doesNotMatch(html, /\baction\.description\b|\bcatalog-description\b/i);
});

test("missing icons use a dashed square with a corner X", (context) => {
  if (!requirePrototype(context)) return;

  assert.match(html, /\bdata-icon-state=["']missing["']/i);
  assert.match(html, /\bsquare-dashed\b/i);
  assert.match(
    html,
    /\.square-dashed\s*\{[\s\S]*?\bborder\b[^;]*\bdashed\b/i,
  );
  assert.match(html, /\bcorner-x\b/i);
});

test("supports reorder, remove, panel insertion, and locked rejection", (context) => {
  if (!requirePrototype(context)) return;

  assert.match(html, /\bdraggable=["']true["']/i);
  assert.match(html, /\b(?:dragstart|ondragstart)\b/i);
  assert.match(html, /\b(?:dragover|ondragover)\b/i);
  assert.match(html, /\b(?:drop|ondrop)\b/i);
  assert.match(html, /\bdata-action-drop-zone=["']reorder["']/i);
  assert.match(html, /\bdata-action-drop-zone=["']remove["']/i);
  assert.match(html, /\bdata-action-drag-source=["']all-actions["']/i);
  assert.match(html, /\bdata-lock-rejection=["']red-glow["']/i);
});

test("limits row adjustment to one through four rows", (context) => {
  if (!requirePrototype(context)) return;

  const config = readActionBarConfig();
  assert.deepEqual(config.rows, {
    min: 1,
    max: 4,
    default: 2,
  });
  assert.match(html, /\bdata-row-action=["']decrease["']/i);
  assert.match(html, /\bdata-row-action=["']increase["']/i);
});

test("models chooser, targeting cancellation, and retained disabled slots", (context) => {
  if (!requirePrototype(context)) return;

  const config = readActionBarConfig();
  assert.equal(config.disabledBehavior, "retain-slot");
  assert.match(html, /\bdata-item-chooser(?:=["'][^"']*["'])?/i);
  assert.match(html, /\bdata-targeting-mode(?:=["'][^"']*["'])?/i);
  assert.match(html, /\b(?:event|keyboardEvent)\.key\s*===?\s*["']Escape["']/i);
  assert.match(html, /\bcancelTargeting(?:Mode)?\b/i);
  assert.match(html, /\bdata-disabled-action(?:=["'][^"']*["'])?/i);
});

test("persists action bar state through localStorage", (context) => {
  if (!requirePrototype(context)) return;

  const config = readActionBarConfig();
  assert.equal(typeof config.storageKey, "string");
  assert.ok(config.storageKey.length > 0, "storageKey must not be empty");
  assert.match(html, /\blocalStorage\.getItem\s*\(/i);
  assert.match(html, /\blocalStorage\.setItem\s*\(/i);
});

test("uses every scrollbar variable name from index.css", (context) => {
  if (!requirePrototype(context)) return;

  const scrollbarVariables = [
    ...new Set(
      [...indexCss.matchAll(/--blisshack-scrollbar-[a-z-]+/g)]
        .map(([variable]) => variable),
    ),
  ];
  assert.ok(scrollbarVariables.length > 0);
  for (const variable of scrollbarVariables) {
    assert.match(
      html,
      new RegExp(`${variable.replaceAll("-", "\\-")}\\s*:`),
      `prototype must declare ${variable}`,
    );
    assert.match(
      html,
      new RegExp(`var\\(\\s*${variable.replaceAll("-", "\\-")}\\s*\\)`),
      `prototype must use ${variable}`,
    );
  }
});

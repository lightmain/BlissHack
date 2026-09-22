import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const prototypePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "alpha-2.3-action-bar.html",
);
const prototypeExists = existsSync(prototypePath);
const html = prototypeExists ? readFileSync(prototypePath, "utf8") : "";

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
 * Read the machine-checkable action catalog embedded in the prototype.
 * @returns {Record<string, unknown>} parsed action catalog.
 */
function readActionCatalog() {
  const match = html.match(
    /<script\b[^>]*\bid=["']action-catalog["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  assert.ok(match, "prototype must embed #action-catalog JSON");
  return JSON.parse(match[1]);
}

/**
 * Decode the authoritative extcmdlist from the checked-in WASM runtime.
 * @returns {Promise<Array<{id: string, description: string, flags: number}>>}
 * visible player commands in source order.
 */
async function readWasmActions() {
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
  globalThis.actionCatalogProbe = () => new Promise(() => {});
  module.ccall(
    "shim_graphics_set_callback",
    null,
    ["string"],
    ["actionCatalogProbe"],
  );
  module.ccall("main", "number", [], [], { async: true }).catch(() => {});

  const listPtr = globalThis.nethackGlobal?.pointers?.extcmdlist ?? 0;
  assert.notEqual(listPtr, 0, "WASM runtime must expose extcmdlist");
  const actions = [];
  for (let index = 0; index < 1024; index += 1) {
    const entryPtr = listPtr + index * 24;
    const textPtr = Number(module.getValue(entryPtr + 4, "*"));
    if (textPtr === 0) break;
    const descriptionPtr = Number(module.getValue(entryPtr + 8, "*"));
    const flags = Number(module.getValue(entryPtr + 16, "i32")) >>> 0;
    if ((flags & (0x0004 | 0x0010 | 0x0040)) !== 0) continue;
    actions.push({
      id: module.UTF8ToString(textPtr),
      description: descriptionPtr === 0
        ? ""
        : module.UTF8ToString(descriptionPtr),
      flags,
    });
  }
  return actions;
}

test("prototype HTML exists", () => {
  assert.ok(
    prototypeExists,
    `expected ${prototypePath} to exist before checking its contract`,
  );
});

test("declares the current WASM command counts", (context) => {
  if (!requirePrototype(context)) return;

  const { counts } = readActionCatalog();
  assert.deepEqual(counts, {
    wasmCommands: 169,
    playerVisibleActions: 128,
    nonDirectionalActions: 104,
    directionalMovementActions: 24,
    wizardCommands: 35,
    internalCommands: 6,
  });
});

test("models 104 visible commands plus 24 generated movement actions", (context) => {
  if (!requirePrototype(context)) return;

  const catalog = readActionCatalog();
  assert.equal(catalog.nonDirectionalActions.length, 104);
  assert.equal(
    new Set(catalog.nonDirectionalActions.map(({ id }) => id)).size,
    104,
    "non-directional command ids must be unique",
  );
  assert.ok(
    catalog.nonDirectionalActions.every(
      ({ playerVisible, directional }) =>
        playerVisible === true && directional !== true,
    ),
    "all catalog commands must be visible and non-directional",
  );

  const generatedMovementCount =
    catalog.directionalMovement.modes.length *
    catalog.directionalMovement.directions.length;
  assert.equal(generatedMovementCount, 24);
  assert.equal(catalog.nonDirectionalActions.length + generatedMovementCount, 128);
});

test("matches the checked-in WASM command ids and descriptions", async (context) => {
  if (!requirePrototype(context)) return;

  const catalog = readActionCatalog();
  const wasmActions = await readWasmActions();
  const wasmCommands = wasmActions.filter(({ flags }) => (flags & 0x0400) === 0);
  const wasmMovements = wasmActions.filter(({ flags }) => (flags & 0x0400) !== 0);
  const modeledMovements = catalog.directionalMovement.modes.flatMap(
    (mode) => catalog.directionalMovement.directions.map(
      (direction) => `${mode.id}${direction.id}`,
    ),
  );

  assert.deepEqual(
    catalog.nonDirectionalActions.map(({ id, description }) => ({ id, description })),
    wasmCommands.map(({ id, description }) => ({ id, description })),
  );
  assert.deepEqual(modeledMovements, wasmMovements.map(({ id }) => id));
});

test("provides two shortcut rows, category controls, and a searchable drawer", (context) => {
  if (!requirePrototype(context)) return;

  const shortcutRows = html.match(/\bdata-shortcut-row=["'][^"']+["']/gi) ?? [];
  const categoryControls =
    html.match(/\bdata-deck=["'][^"']+["'][^>]*\baria-pressed=/gi) ?? [];
  assert.equal(shortcutRows.length, 2, "action bar must expose two shortcut rows");
  assert.ok(
    categoryControls.length >= 2,
    "action bar must expose pressed-state category controls",
  );
  assert.match(html, /\bdata-catalog-category=["']all["'][^>]*\baria-pressed=/i);
  assert.match(html, /\bdata-all-actions-drawer(?:=["'][^"']*["'])?/i);
  assert.match(html, />\s*All Actions\s*</i);
  assert.match(
    html,
    /<input\b(?=[^>]*\btype=["']search["'])(?=[^>]*\b(?:aria-label|placeholder)=["'][^"']+["'])[^>]*>/i,
  );
});

test("defines three icon states and a narrow-screen action-bar rule", (context) => {
  if (!requirePrototype(context)) return;

  const catalog = readActionCatalog();
  assert.deepEqual(
    new Set(catalog.nonDirectionalActions.map(({ iconState }) => iconState)),
    new Set(["direct", "metaphor", "custom"]),
  );
  assert.ok(
    catalog.nonDirectionalActions.every(
      ({ icon, iconState }) =>
        typeof icon === "string"
        && icon.length > 0
        && ["direct", "metaphor", "custom"].includes(iconState),
    ),
    "every command must declare an icon and a recognized readiness state",
  );
  assert.match(html, /@media\s*\(\s*max-width\s*:\s*760px\s*\)/i);
  assert.match(html, /\.shortcut-viewport\s*\{[\s\S]*?overflow-x:\s*auto/i);
  assert.match(html, /\.all-actions-drawer\s*\{[\s\S]*?inset:\s*8px 8px 170px/i);
});

test("contains no hand-authored inline SVG", (context) => {
  if (!requirePrototype(context)) return;
  assert.doesNotMatch(html, /<svg\b/i);
});

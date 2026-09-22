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
    internalCommands: 35,
    debugCommands: 6,
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

test("provides two shortcut rows, category tabs, and a searchable drawer", (context) => {
  if (!requirePrototype(context)) return;

  const shortcutRows = html.match(/\bdata-shortcut-row=["'][^"']+["']/gi) ?? [];
  const categoryTabs = html.match(/\brole=["']tab["']/gi) ?? [];
  assert.equal(shortcutRows.length, 2, "action bar must expose two shortcut rows");
  assert.match(html, /\brole=["']tablist["']/i);
  assert.ok(categoryTabs.length >= 2, "action drawer must expose category tabs");
  assert.match(html, /\bdata-all-actions-drawer(?:=["'][^"']*["'])?/i);
  assert.match(html, />\s*All Actions\s*</i);
  assert.match(
    html,
    /<input\b(?=[^>]*\btype=["']search["'])(?=[^>]*\b(?:aria-label|placeholder)=["'][^"']+["'])[^>]*>/i,
  );
});

test("defines three icon states and a narrow-screen action-bar rule", (context) => {
  if (!requirePrototype(context)) return;

  const iconStates = new Set(
    [...html.matchAll(/\bdata-icon-state=["']([^"']+)["']/gi)].map(
      ([, state]) => state,
    ),
  );
  assert.equal(iconStates.size, 3, "prototype must demonstrate three icon states");

  const narrowRule = html.search(
    /@media[^{]*\(\s*max-width\s*:\s*\d+(?:\.\d+)?(?:px|rem|em)\s*\)/i,
  );
  assert.notEqual(narrowRule, -1, "prototype must define a max-width media query");
  assert.match(
    html.slice(narrowRule),
    /(?:action-bar|shortcut-row|all-actions)/i,
    "narrow-screen rule must affect the action bar",
  );
});

test("contains no hand-authored inline SVG", (context) => {
  if (!requirePrototype(context)) return;
  assert.doesNotMatch(html, /<svg\b/i);
});

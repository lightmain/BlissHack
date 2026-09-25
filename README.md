# BlissHack

[English](README.md) | [简体中文](README-cn.md)

> **Upstream and license notice**
>
> BlissHack is an unofficial modified distribution of NetHack 5.0.0. The
> original NetHack README is preserved unchanged as
> [README-NetHack](README-NetHack). NetHack's license is preserved in
> [dat/license](dat/license). BlissHack is not produced or supported by the
> NetHack DevTeam; issues specific to this browser frontend should be reported
> to this project rather than upstream.

BlissHack runs a more modern NetHack experience in a web
browser. The NetHack C core is compiled to WebAssembly and connected to a
React/TypeScript terminal through the upstream shim window interface.
BlissHack makes a small number of targeted changes to the NetHack C code,
primarily to fix missing shim interface behavior required by the browser
frontend. These changes are documented in
[Current project modifications to the shim interface](doc/BlissHack/shim-interface-reference.md#6-当前项目对-shim-接口的修改).

## Project Status

**Alpha-2.3 implementation, automated gates, and independent review are
complete. Manual acceptance is pending.**

Alpha-2.3 adds profile v4 and an optional BlissHack action bar backed by the
core's command catalog. The Original mode now uses a structured two-line TTY
status display, while BlissHack keeps the graphical status presentation.
Core-authored item, direction, confirmation, and ordinary single-choice inputs
use compact secondary dialogs when the BlissHack action bar is enabled. The
deployment branch and GitHub Pages may lag; use the version displayed by the
site as the authority.

The current milestone provides:

- An 80x21 Canvas map using the official tiles by default, with the ASCII
  renderer retained.
- A viewport-owned HUD with fixed message and status regions plus Right and
  Below permanent-inventory layouts.
- Original two-line TTY status and BlissHack graphical HP, Energy, XP,
  attributes, conditions, location, and turn status, both driven by structured
  core fields.
- An optional, persistent action bar covering the core's visible command
  catalog, with configurable rows, categories, locking, drag layout editing,
  import/export, and searchable All Actions.
- Compact secondary dialogs for item selection, direction selection,
  `yn`/`ynq` confirmation, and ordinary single-choice menus. Direction input
  highlights and accepts clicks on the eight adjacent map cells even when the
  command was started with a keyboard shortcut.
- Shared delayed tooltips for status, inventory, and authoritative core map
  inspection without adding inspection text to message history.
- Core-generated map and inventory context menus, with mouse actions routed
  through a fail-closed high-level action controller.
- Pointer Events inventory drag and drop to the player's current cell, using
  the native core drop flow and permanent-inventory revisions.
- Hidden native map scrollbars without removing scrolling; right-drag pans the
  viewport, ordinary right-click opens core actions, and explicit position
  input retains its existing mouse semantics.
- Manual browsing while Follow is enabled; right-click inspection and
  same-coordinate turns preserve the camera, while valid Follow target
  coordinate changes recenter it.
- Authoritative WASM `tileIndex` values and layered background, foreground,
  pet/pile marker, and cursor rendering.
- Automatic ASCII fallback for atlas or Canvas failures without changing the
  saved display preference.
- Immediate Tiles/ASCII switching in Settings and strict
  v1-to-v2-to-v3-to-v4 profile migration.
- Message history from both the core command and the Messages-region button,
  plus text windows, menus, prompts, extended commands, and position input.
- A choice of the original sequential character flow or a unified name, role,
  race, gender, and alignment screen with direct same-name save continuation.
- Accurate ASCII, Control, Alt/Meta, direction, and numeric keypad input.
- Browser-local save and restore through Emscripten IDBFS.
- Unit, WASM, Chromium, Firefox, WebKit, performance, and long-flow tests.
- Automated deployment to GitHub Pages.

This is still an early alpha release. Save compatibility, UI details, and
window-port coverage may change before a stable release.

## Play Online

<https://lightmain.github.io/BlissHack/>

Saved games are stored in the current browser profile. They are not uploaded
to a server and do not automatically move between browsers or devices.

The Home footer and fatal-error screen can export the local diagnostic log.
The log is never uploaded automatically and excludes player names, keys,
game messages, and save contents.

## Controls

BlissHack uses NetHack's standard keyboard commands:

- Arrow keys or `h`, `j`, `k`, `l` move the character.
- `Ctrl` combinations are encoded as ASCII control characters.
- `Alt` combinations produce NetHack Meta commands.
- The operating-system `Command`/`Meta` key is left to the browser.
- Numeric keypad input follows NetHack's active number-pad mode.

See [the key input reference](doc/BlissHack/key-input-reference.md) for the
complete encoding table and source references.

## Local Development

The product version is defined by the root `VERSION` file. Frontend
development and CI use the Node.js major version selected by the root
`.nvmrc`.

The checked-in `frontend/public/nethack.js`, `nethack.wasm`, and
`nethack-runtime.json` files are the Emscripten runtime triplet used by the
frontend. Generated official tile assets live under `frontend/public/tiles/`.

```sh
cd frontend
npm ci
npm run dev
```

Production build:

```sh
cd frontend
npm run build
npm run preview
```

Rebuilding the WebAssembly core requires the pinned Emscripten version.
Follow the [WASM build process](doc/BlissHack/build-process.md) and always
commit the complete runtime triplet together. `npm run check:toolchain`
validates the pinned environment without cleaning or compiling. Regenerate
tiles explicitly with `npm run generate:tiles`; `npm run verify:tiles` checks
the committed assets.

## Tests

```sh
cd frontend
npm test
npm run lint
npm run test:integration
npm run test:integration:compat
npm run test:performance
npm run test:long
```

The integration command exercises the real WASM callback chain and a production
browser build, including startup, keyboard input, status rendering, save, and
restore. The compatibility suite covers critical Firefox and WebKit flows, the
performance suite checks Canvas map and permanent-inventory rendering, and the
long suite repeatedly checks session lifecycle, save restoration, and raw save
transfer. Chromium visual baselines cover the Tiles/ASCII and Right/Below HUD
combinations at 1280x900 and 900x700.

## Repository Guide

- [prealpha-1 plan](doc/BlissHack/plans/prealpha-1.md)
- [prealpha-2 plan](doc/BlissHack/plans/prealpha-2.md)
- [prealpha-3 plan](doc/BlissHack/plans/prealpha-3.md)
- [prealpha-4 refactoring plan](doc/BlissHack/plans/prealpha-4.md)
- [alpha-1 tileset plan](doc/BlissHack/plans/alpha-1.md)
- [alpha-1.1 map interaction and infrastructure plan](doc/BlissHack/plans/alpha-1.1.md)
- [alpha-2.0 interactive HUD plan](doc/BlissHack/plans/alpha-2.0.md)
- [alpha-2.1 focus and Below HUD plan](doc/BlissHack/plans/alpha-2.1.md)
- [alpha-2.2 information and workflow plan](doc/BlissHack/plans/alpha-2.2.md)
- [alpha-2.3 action bar plan](doc/BlissHack/plans/alpha-2.3.md)
- [alpha-1 rendering architecture](doc/BlissHack/plans/in-alpha-1/rendering-architecture.md)
- [alpha-1 profile v2](doc/BlissHack/plans/in-alpha-1/profile-v2.md)
- [alpha-1 release acceptance](doc/BlissHack/plans/in-alpha-1/release-acceptance.md)
- [alpha-1.1 release acceptance](doc/BlissHack/plans/in-alpha-1.1/release-acceptance.md)
- [alpha-2.0 release acceptance](doc/BlissHack/plans/in-alpha-2.0/release-acceptance.md)
- [alpha-2.1 release acceptance](doc/BlissHack/plans/in-alpha-2.1/release-acceptance.md)
- [alpha-2.2 release acceptance](doc/BlissHack/plans/in-alpha-2.2/release-acceptance.md)
- [alpha-2.3 release acceptance](doc/BlissHack/plans/in-alpha-2.3/release-acceptance.md)
- [Upstream modification inventory](doc/BlissHack/upstream-modifications.md)
- [Fatal errors and diagnostic log design](doc/BlissHack/plans/in-prealpha-2/fatal-errors-and-diagnostics.md)
- [Browser end-to-end test design](doc/BlissHack/plans/in-prealpha-2/browser-end-to-end-tests.md)
- [WASM build process](doc/BlissHack/build-process.md)
- [Shim interface reference](doc/BlissHack/shim-interface-reference.md)
- [Key input reference](doc/BlissHack/key-input-reference.md)
- [Chinese Guidebook index](doc/BlissHack/guidebook-index-cn.md)
- [Frontend source](frontend/src)

## Known Interface Limits

The current upstream shim ABI cannot safely return non-empty message history
strings and does not expose `yn_number`. The extended `getdir` callback exposes
that direction input is active, but not whether the originating operation is
adjacent or ranged, nor its obstruction and visibility semantics. BlissHack
therefore shows the reliable eight-direction target UI and does not infer a
ray from prompt text, action names, or item names. Details are recorded in the
[shim interface reference](doc/BlissHack/shim-interface-reference.md).

## License

BlissHack contains and is derived from NetHack. It is distributed at no charge
under the terms of the
[NetHack General Public License](dat/license), without warranty as described
there. The complete corresponding source used to build the browser executable
is available in this repository.

The original NetHack copyright and license notices are retained. Third-party
frontend dependencies remain subject to their respective licenses.

BlissHack modifications documented in this repository were added in 2026.
Most changes are confined to the browser frontend, tests, documentation, and
deployment configuration. The small number of modifications to NetHack C code
carry file-level modification notices and are documented in the
[shim interface reference](doc/BlissHack/shim-interface-reference.md#6-当前项目对-shim-接口的修改).

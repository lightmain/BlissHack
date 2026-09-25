# BlissHack Frontend

React and TypeScript frontend for the NetHack WebAssembly build.

## Architecture

- `src/App.tsx` composes the application state machine and screens.
- `src/app/app-state.ts` owns top-level UI lifecycle state.
- `src/session/session-manager.ts` is the stable session API facade.
- `src/session/session-lifecycle.ts` owns module and active-session lifecycle.
- `src/session/home-operations.ts` owns Home save, backup, and data operations.
- `src/storage/storage-service.ts` persists saves and mirrors the core `/record`
  ranking file through the bounded `/save/.ranking-record` IDBFS sidecar.
- `src/nethack-bridge.ts` is the stable shim callback facade.
- `src/bridge/` contains Emscripten loading, WASM decoding, save validation,
  and the single input controller.
- `src/game-actions/` owns high-level UI intents and advances them only from
  authoritative command, menu, snapshot, and inventory observations.
- `src/interactions/` owns shared anchored overlays, hover inspection, and the
  Pointer Events permanent-inventory drag controller.
- `src/map/` contains the shared `MapViewport`, camera and right-drag hooks,
  retained ASCII renderer, Canvas tile renderer, atlas loader, and
  renderer-independent draw primitives.
- `src/map-rendering.ts` owns pure pointer-coordinate, follow-offset, and
  normalized scroll-anchor calculations.
- `src/settings/profile.ts` owns the explicit strict v1-to-v2-to-v3-to-v4
  migration chain; `interface` contains map, information, endgame,
  character-setup, and action-bar presentation preferences.
- `interface.informationLevel` controls only explanatory status inspection;
  map and inventory inspection remain available in both modes.
- `src/screens/game/` contains the fullscreen HUD layout, the Original
  two-line status, the BlissHack graphical status and action dock, shared
  secondary input dialogs, fixed messages, and modal presentation.
  `src/screens/settings/` contains the profile and in-game Settings
  presentation.
- `src/styles/` contains page-scoped global styles loaded through `src/App.css`.

The checked-in `public/nethack.js`, `public/nethack.wasm`, and
`public/nethack-runtime.json` files form one verified runtime triplet. Follow
the repository [WASM build process](../doc/BlissHack/build-process.md) before
changing them.

The checked-in `public/tiles/nethack-classic.png` and
`public/tiles/nethack-classic.json` are generated together from NetHack's
official `win/share` tile sources. Regenerate them explicitly and verify them
without rewriting the worktree:

```sh
npm run generate:tiles
npm run verify:tiles
```

## Development

Install dependencies and start Vite:

```sh
npm ci
npm run dev
```

Run the standard checks:

```sh
npm run lint
npm test
npm run build
npm run test:integration
npm run test:integration:compat
npm run test:performance
npm run test:long
```

The Chromium browser suite includes screenshot baselines for Tiles/ASCII and
Right/Below HUD layouts at 1280x900 and 900x700, including both Original and
BlissHack action-bar modes. Firefox and WebKit run the same geometry and
overflow contracts without comparing Chromium pixels.

Check the pinned Node.js and Emscripten environment without building:

```sh
npm run check:toolchain
```

Install the browser binaries once before running Playwright:

```sh
npx playwright install chromium firefox webkit
```

## GitHub Pages

The deployment workflow builds this directory and publishes `dist`. It derives
the Vite base path from the repository name.

```sh
VITE_BASE_PATH=/BlissHack/ npm run build
VITE_BASE_PATH=/BlissHack/ npm run preview
```

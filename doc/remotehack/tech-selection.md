# RemoteHack Technology Selection Discussion

This document records the technology selection discussion for RemoteHack.
Each section presents the problem, candidate options, trade-offs, and a recommended choice.

---

## 1. Backend: HTTP Server Embedding Strategy

### Problem

NetHack is a C program. We need to serve HTTP+JSON to a browser-based frontend.
There are two broad approaches: embed an HTTP library into the NetHack process,
or run a separate server process that communicates with NetHack via IPC.

### Option A: Embedded C HTTP Library (Recommended)

Embed a lightweight HTTP server directly into the NetHack binary as a new
`window_procs` interface (following the pattern of `win/tty`, `win/Qt`, etc.).

**Candidate libraries:**

| Library | License | Footprint | Features | Notes |
|---------|---------|-----------|----------|-------|
| **civetweb** | MIT | ~3 files | HTTP/1.1, WebSocket, HTTPS | Active, easy to embed, single-header option |
| **mongoose** | GPLv2 / Commercial | 2 files | HTTP, WebSocket, MQTT | Dual license may conflict with NetHack's NHPL |
| **libmicrohttpd** | LGPL | System lib | HTTP/1.1, HTTPS | Heavier dependency, less portable |
| **facil.io** | MIT | Multi-file | HTTP, WebSocket, Pub/Sub | More complex, async-first |

**Recommendation: civetweb**

- MIT license is compatible with NetHack's permissive license (NHPL).
- Can be embedded as 2-3 source files directly into `win/http/`.
- Supports both synchronous handler registration (fits NetHack's blocking model)
  and WebSocket (for future enhancements).
- Well-tested, production-used (e.g., MongoDB used it).
- Cross-platform (Linux, macOS, Windows).

**Architecture with civetweb:**

```
NetHack core
    |
    v
win/http/winhttp.c  (implements window_procs, converts calls to JSON)
    |
    v
civetweb (embedded)  <--HTTP+JSON-->  Browser (React frontend)
```

The game loop calls `win_nhgetch()` / `win_nh_poskey()` which blocks waiting
for the next HTTP request from the frontend. Other `window_procs` functions
(putstr, print_glyph, display_nhwindow, etc.) buffer their output as JSON,
which is returned as the response to the previous input request.

### Option B: Separate Server Process + IPC

Run NetHack as a subprocess; a server written in Go/Rust/Python/Node sits
in front and translates between HTTP and stdin/stdout (or Unix socket).

**Pros:**
- Freedom to use any language for the HTTP layer.
- NetHack process is unmodified.

**Cons:**
- The existing tty interface's stdout is not structured — parsing terminal
  escape codes to reconstruct game state is fragile and lossy.
- Loses access to internal game state (glyph info, menu structures, etc.).
- Two-process management adds deployment complexity.
- Latency overhead from IPC serialization.

**Verdict:** Not recommended. The `window_procs` interface gives us structured
access to all display information. Bypassing it to parse terminal output is
strictly worse.

### Option C: SHIM_GRAPHICS + External Process

NetHack already has `win/shim/winshim.c` — a minimal stub interface.
We could extend the shim to pipe structured data to an external process.

**Pros:**
- Builds on existing code.

**Cons:**
- The shim is intentionally minimal; it would need the same amount of work
  as writing a dedicated HTTP interface from scratch.
- Still requires IPC, adding complexity vs. direct embedding.

**Verdict:** Could be used as a starting point for reference, but a dedicated
`win/http` implementation is cleaner.

---

## 2. Communication Protocol

### Problem

How does the frontend communicate with the backend? NetHack's game loop is
fundamentally synchronous: it processes one input at a time and blocks until
the next input arrives.

### Option A: Pure HTTP Request-Response (Recommended for V1)

```
Frontend                          Backend
   |                                 |
   |--- POST /input {key: "j"} ---->|
   |                                 |  (process input, generate output)
   |<-- 200 {map:[], msgs:[], ...} --|
   |                                 |
   |--- POST /input {key: "i"} ---->|
   |<-- 200 {menu: {...}} ----------|
```

Each request sends one player action; the response contains the complete
updated game state (map, messages, status bar, menus, etc.).

**Pros:**
- Maps perfectly to NetHack's blocking game loop.
- Simple to implement, debug (can use curl/browser DevTools).
- Stateless protocol — easy to reason about.

**Cons:**
- No server-push capability (not needed for turn-based game).
- Slight overhead per request (negligible for turn-based game).

### Option B: WebSocket

Persistent bidirectional connection.

**Pros:**
- Lower per-message overhead.
- Server can push updates (useful for future multiplayer/spectator).

**Cons:**
- More complex state management.
- Overkill for a strictly turn-based game.
- Connection lifecycle management adds complexity.

### Option C: HTTP + Server-Sent Events (SSE)

HTTP for input, SSE for output stream.

**Pros:**
- Server can stream updates.

**Cons:**
- Same overhead as WebSocket without full bidirectionality.
- Unnecessary complexity for turn-based model.

### Recommendation

**Start with pure HTTP for V1.** The turn-based nature of NetHack maps
perfectly to HTTP request-response. We can add WebSocket support later
(civetweb supports it) if we need spectator mode or animations that
require server-push.

---

## 3. JSON API Structure

### Problem

What does the JSON data exchanged between frontend and backend look like?

### Proposed Design

**Input (Frontend → Backend):**

```json
{
  "type": "key",
  "key": "j",
  "mod": 0
}
```

```json
{
  "type": "click",
  "x": 30,
  "y": 10
}
```

```json
{
  "type": "line",
  "text": "Excalibur"
}
```

```json
{
  "type": "menu_select",
  "selections": [{"item": "a", "count": -1}]
}
```

**Output (Backend → Frontend):**

The response is an array of "display events" accumulated since the last input:

```json
{
  "events": [
    {
      "type": "map_update",
      "cells": [
        {"x": 30, "y": 10, "glyph": 2041, "symbol": "@", "color": 7,
         "bg_glyph": 1923, "bg_symbol": ".", "bg_color": 0}
      ]
    },
    {
      "type": "message",
      "text": "You hit the goblin!",
      "attr": 0
    },
    {
      "type": "status",
      "fields": {
        "hp": 15, "hpmax": 16, "pw": 3, "pwmax": 5,
        "ac": 7, "level": 1, "gold": 42, "dlevel": 1,
        "name": "Player", "title": "Rambler"
      }
    }
  ],
  "prompt": {
    "type": "getkey",
    "message": null
  }
}
```

The `prompt` field tells the frontend what type of input the backend is
waiting for: `getkey` (single keystroke), `getline` (text input),
`yn` (yes/no/other), or `menu` (menu selection).

### Discussion Points

1. **Full state vs. delta updates:** V1 should send full map state each time
   (simpler, ~80x21 = 1680 cells, ~50KB as JSON — fast enough). Can optimize
   to delta later.

2. **Glyph encoding:** NetHack uses integer glyph IDs internally. The backend
   should send both the glyph ID and a human-readable symbol/color so the
   frontend can work with either text or tile rendering.

3. **Multi-layer cells:** A key RemoteHack feature. Each cell should include
   a foreground (monster/object) and background (terrain) glyph, so the
   frontend can render layers. This data is already available in
   `win_print_glyph()` via the `glyph_info` parameters.

---

## 4. Frontend Technology Stack

### Already Decided
- **Framework:** React (per project requirements)

### 4a. Build Tool

| Option | Pros | Cons |
|--------|------|------|
| **Vite** (Recommended) | Fast HMR, modern defaults, lightweight | — |
| Next.js | SSR, file-based routing | Overkill — no SEO/SSR needed for a game |
| Webpack (manual) | Maximum control | Verbose config, slow |

**Recommendation: Vite** — fastest DX, zero config for React+TS.

### 4b. Language

| Option | Pros | Cons |
|--------|------|------|
| **TypeScript** (Recommended) | Type safety for complex game state, better IDE support | Slight learning curve |
| JavaScript | Simpler | Loses type safety for complex game model |

**Recommendation: TypeScript** — the game state model (map, inventory, status)
is complex enough to benefit from types.

### 4c. Map Rendering

| Option | Pros | Cons |
|--------|------|------|
| **HTML Canvas** (Recommended for V1) | Good performance for grid rendering, tile support, simple API | Need to handle text rendering carefully |
| Pure DOM / CSS Grid | Easiest to start with, accessible | Poor performance for 80x21 grid updates |
| WebGL (PixiJS / Three.js) | Best performance, animation support | Complexity overkill for V1 |

**Recommendation: Start with Canvas.** The map is a fixed-size grid (typically
80x21 or COLNO x ROWNO). Canvas can efficiently render this as either ASCII
text or tiles. If we need complex animations later, PixiJS can be layered in.

**Fallback consideration:** A hybrid approach — Canvas for the map area,
React DOM for UI panels (messages, status bar, inventory menus) — gives the
best of both worlds. The map needs efficient batch rendering; the UI panels
benefit from React's component model.

### 4d. State Management

| Option | Pros | Cons |
|--------|------|------|
| **Zustand** (Recommended) | Minimal boilerplate, React-native, small | Less structure for very large apps |
| React Context + useReducer | No extra dependency | Rerenders, scales poorly for game state |
| Redux Toolkit | Structured, mature | Heavy boilerplate for this use case |
| Jotai / Recoil | Atomic state | Learning curve, less conventional |

**Recommendation: Zustand** — lightweight, TypeScript-friendly, and well-suited
for a single-page game UI where we need a global game state store (map, messages,
inventory, status) that updates on each server response.

### 4e. UI Component Library

| Option | Pros | Cons |
|--------|------|------|
| **Custom / Headless** (Recommended) | Full control over game aesthetic | More initial work |
| MUI / Ant Design | Ready-made components | Generic look, heavy bundle, fights game aesthetic |

**Recommendation: Custom components.** A game UI should have its own visual
identity. Generic component libraries impose an aesthetic that doesn't fit a
dungeon crawler. Headless UI libraries (e.g., Radix, Headless UI) can provide
accessibility primitives without visual constraints if needed.

---

## 5. Build System Integration

### Problem

How do we integrate the new `win/http` backend and the React frontend into
NetHack's existing build system?

### Proposed Approach

1. **Backend (`win/http/`):** Add to the existing Makefile system with a new
   `HTTP_GRAPHICS` compile flag (following the pattern of `TTY_GRAPHICS`,
   `QT_GRAPHICS`, etc.). The civetweb source files are compiled alongside
   the NetHack window interface code.

2. **Frontend (`frontend/`):** Built separately with Vite. In development,
   Vite dev server runs on a separate port and proxies API requests to the
   NetHack HTTP backend. In production, `vite build` produces static files
   that can be served by civetweb's built-in static file serving.

3. **Development workflow:**
   ```
   Terminal 1: make (builds NetHack with HTTP interface) && ./nethack
   Terminal 2: cd frontend && npm run dev  (Vite dev server with proxy)
   ```

---

## 6. Development Phases

### Phase 1: Minimal Playable (MVP)

- [ ] Implement `win/http` window interface with core `window_procs`
- [ ] Embed civetweb for HTTP serving
- [ ] JSON API for map, messages, status, and key input
- [ ] React frontend: map display (ASCII in Canvas), message area, status bar
- [ ] Basic keyboard input forwarding
- [ ] Build system integration (Makefile + Vite)

### Phase 2: Full Vanilla Feature Parity

- [ ] Menu system (inventory, spellbook, etc.)
- [ ] yn_function and getlin prompts
- [ ] Player selection screen
- [ ] Option configuration
- [ ] Save/load game support

### Phase 3: RemoteHack Enhancements

- [ ] Multi-layer cell rendering (monster + terrain)
- [ ] Tooltip system for game elements
- [ ] Mouse-based interaction (click to examine, click to move)
- [ ] Improved inventory UI
- [ ] Enhanced message area (no manual "more" paging)
- [ ] Operation hints and action suggestions
- [ ] Tile-based rendering option

---

## Summary of Recommendations

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| HTTP server | civetweb (embedded) | MIT license, minimal footprint, cross-platform |
| Architecture | New `window_procs` in `win/http/` | Clean integration, full access to game state |
| Protocol (V1) | HTTP request-response | Perfect fit for turn-based game loop |
| Build tool | Vite | Fast, modern, zero-config React+TS |
| Language | TypeScript | Type safety for complex game state |
| Map rendering | Canvas (hybrid with React DOM) | Performance + React component benefits |
| State management | Zustand | Lightweight, TypeScript-friendly |
| UI components | Custom / headless | Game-specific aesthetic |

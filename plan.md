# GodotHack Development Plan

Status date: 2026-06-13

This plan tracks the current route for moving GodotHack from the initial Godot
TCP demo toward a browser-based frontend connected to a NetHack 5.0.0 backend.

## Current Baseline

- Branch: `AIGodotHack`.
- Backend source base: NetHack 5.0.0.
- Historical server artifact: `binary\NetHackServer.exe` from NetHack 3.6.7.
  Treat it as reference only, not as a valid 5.0.0 build product.
- Verified original NetHack 5.0.0 build:
  `nmake /f ..\sys\windows\Makefile.nmake GIT_AVAILABLE=N TARGET_CPU=x64 CURSES_CONSOLE=N CURSES_GRAPHICAL=N package`
- Baseline build documentation:
  `godothack-docs\BUILDING.md`
- Protocol source of truth:
  `godothack-docs\PROTOCOL.md`

## Guiding Constraints

- Keep upstream NetHack source layout recognizable.
- Put GodotHack-specific backend integration in clearly named files or sections.
- When protocol behavior changes, update backend code, frontend code, and
  `godothack-docs\PROTOCOL.md` together.
- Do not depend on the old NetHack 3.6.7 `NetHackServer.exe` object or binary
  for NetHack 5.0.0 development.
- Use the verified minimal backend build before and after significant backend
  changes.
- Do not fix `sys\windows\fetch.cmd` as part of the current plan; it is outside
  the immediate project path.

## Phase 1: Baseline And Build Hygiene

Status: complete.

1. Verify the original NetHack 5.0.0 Windows build in the MSVC environment.
2. Record the verified build path in `godothack-docs\BUILDING.md`.
3. Point `AGENTS.md` at the project-specific build documentation.
4. Keep generated binaries and packages out of unrelated source changes unless
   explicitly needed.

Exit criteria:

- `binary\NetHack.exe`, `binary\NetHackW.exe`, and
  `package\nethack-500-win-x64.zip` can be produced from the documented command.

## Phase 2: Backend Integration Reconnaissance

Status: initial pass complete.

1. Read NetHack 5.0.0 startup, main loop, command input, display, and window
   procedure integration points.
2. Identify the safest boundary for a GodotHack/web server mode:
   - standalone server executable,
   - alternate window port,
   - or command-line mode inside the existing executable.
3. Compare the old 3.6.7 `NetHackServer` concept with the 5.0.0 source layout.
4. Decide where TCP session ownership belongs in 5.0.0.
5. Document the chosen backend approach before implementing broad changes.

Exit criteria:

- A concrete backend integration design exists with file-level targets and build
  targets identified.

Decision:

- The first 5.0.0 server target is a standalone executable:
  `binary\NetHackServer.exe`.
- The build target is `godothack-server` in `sys\windows\Makefile.nmake`.
- TCP session ownership starts in `src\godothack_server.cpp`.
- Full game-state integration should later use NetHack's `window_procs`
  boundary or a closely related server window port instead of scattering UI
  hooks through gameplay code.

## Phase 3: Minimal NetHack 5.0.0 Server Target

Status: complete for the transport-only slice.

1. Add a small, buildable 5.0.0 server entry point.
2. Add a Windows `nmake` target in `sys\windows\Makefile.nmake`.
3. Link only the minimum required libraries at first, including Winsock when
   TCP is introduced.
4. Implement newline-delimited JSON framing for the first protocol slice.
5. Send `session.welcome` on client connection.
6. Accept `session.hello` from a TCP client and respond deterministically.
7. Keep this stage independent of full game-state extraction until the transport
   path is proven.

Exit criteria:

- `NetHackServer.exe` builds from NetHack 5.0.0 source.
- A local TCP client can connect and exchange at least `session.hello` /
  `session.welcome`.

Result:

- Added `src\godothack_server.cpp`.
- Added `godothack-server` to `sys\windows\Makefile.nmake`.
- Verified a smoke test on `127.0.0.1:17777`:
  - server sends `session.welcome` on connect,
  - server responds to `session.hello` with `status: ready`,
  - server returns `game.error` / `not_implemented` for `game.start`.

## Phase 4: First Game-State Slice

Status: pending.

1. Start a new NetHack session from the server mode.
2. Capture enough state to publish:
   - map dimensions and visible cells,
   - player position,
   - recent message text,
   - basic status fields.
3. Define exact JSON payloads in `godothack-docs\PROTOCOL.md`.
4. Emit initial `game.started`, `view.map`, `view.player`, and `view.messages`
   messages.
5. Accept a minimal movement command and advance the backend state through
   existing NetHack logic.

Exit criteria:

- A client can start a game, render initial state, send one movement command,
  and receive updated state from the authoritative backend.

## Phase 5: Browser Web Client Foundation

Status: pending.

1. Inspect `godothack-webclient\` and choose the smallest practical frontend
   stack for local development.
2. Implement connection controls for the backend endpoint.
3. Implement newline-delimited JSON transport handling.
4. Show connection state, raw protocol log, and parsed protocol events.
5. Render the first map/player/messages view from backend messages.
6. Add keyboard movement input mapped to protocol commands.

Exit criteria:

- The browser client connects to the 5.0.0 server and drives the first
  end-to-end game-state slice.

## Phase 6: Protocol Hardening

Status: pending.

1. Add protocol version handshake.
2. Add sequence numbers for debugging and request/response correlation.
3. Define error messages and disconnect behavior.
4. Decide whether newline-delimited JSON remains sufficient or whether to move
   to length-prefixed frames.
5. Add focused protocol tests or scripted smoke tests.

Exit criteria:

- Protocol behavior is stable enough for iterative UI work.

## Phase 7: Playable New-Player UI

Status: pending.

1. Replace raw protocol log as the primary UI with a usable game layout.
2. Add visual map styling suitable for a beginner-friendly NetHack interface.
3. Add message history, status panels, command buttons, and context prompts.
4. Add menus and text input prompts.
5. Add inventory and item interaction flows.
6. Keep NetHack rules authoritative in the backend.

Exit criteria:

- A new player can start, move, inspect messages/status, and respond to common
  prompts through the browser UI.

## Immediate Next Actions

1. Design the first real game-state slice around NetHack's window procedure
   boundary.
2. Decide whether the current standalone server becomes a NetHack window port
   executable or hosts a narrow adapter around one.
3. Capture initial map, player position, messages, and status fields.
4. Extend `godothack-docs\PROTOCOL.md` with exact `game.started` and `view.*`
   payloads.
5. Start the browser client foundation once the backend can emit the first
   authoritative state.

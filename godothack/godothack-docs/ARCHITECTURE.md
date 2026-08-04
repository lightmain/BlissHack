# Architecture

GodotHack is a modernized NetHack project with two cooperating applications:

- A modified NetHack backend that owns the canonical game state and game rules.
- A Godot frontend that renders the player experience and sends user intent to
  the backend.

The two sides communicate through a TCP session carrying JSON messages.

## Goals

- Preserve NetHack's game logic and behavior as the authoritative backend.
- Build a richer modern UI in Godot without rewriting NetHack rules in GDScript.
- Keep the frontend/backend protocol explicit enough that AI agents can modify
  both sides safely.
- Keep the upstream NetHack tree recognizable so future upstream merges remain
  practical.

## Repository Shape

The repository keeps the original NetHack source tree at the root. GodotHack
adds project-specific material around it:

```text
godothack-client/   Godot client project
godothack-docs/     GodotHack-specific docs, protocol notes, and AI guidance
external/           Vendored third-party backend dependencies
doc/                Upstream NetHack documentation
src/, include/, ... Upstream-style NetHack backend source tree
```

## Backend

The backend should remain responsible for:

- Game rules and state transitions.
- Randomness, dungeon generation, monsters, items, turns, and persistence.
- Translating game state changes into protocol events for the client.
- Validating incoming player commands before applying them.

Prefer keeping NetHack-specific behavior in existing NetHack modules, and adding
GodotHack transport/session code in clearly named integration modules.

## Frontend

The Godot client should remain responsible for:

- Rendering map, entities, inventory, messages, menus, and UI state.
- Capturing player input and converting it into protocol commands.
- Maintaining only the client-side state needed for presentation.
- Handling connection lifecycle, reconnect UX, and protocol error display.

The client should not become a second implementation of NetHack rules.

## Protocol Boundary

The TCP JSON protocol is the contract between the two sides. The current source
of truth is `PROTOCOL.md`.

Protocol changes should be made deliberately. A complete protocol change usually
updates:

- Backend message serialization/parsing.
- Godot client message serialization/parsing.
- `PROTOCOL.md`.
- Tests or manual verification notes.


## Input bridge and 0.1 boundary

GodotHack uses enhanced option 2. The client sends protocol input. The backend owns active prompt state, validates each response, and translates validated input to either the NetHack core or the test core.

The NetHack bridge belongs in clearly named integration code next to NetHack input and window-port callbacks. The test core uses the same dispatcher and message contract. This prevents a second command interpreter in Godot.

The backend generates opaque prompt ids and menu item ids. An accelerator is only a display hint. MVP-0.1.md defines the 0.1 inputs, outputs, ordering, acceptance scenario, and exclusions.

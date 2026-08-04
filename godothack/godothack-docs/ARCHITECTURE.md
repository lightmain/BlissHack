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
godothack-server/   GodotHack backend transport, session, and test-core code
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

## NetHack Window Port Bridge and Map Rendering

NetHack's window port is its primary interface to the player-facing user
interface during normal play. `include/winprocs.h` defines the
`window_procs` function table for that interface. The table covers logical
window lifetime, text output, map glyph output, menus, status updates,
inventory updates, and player input such as keys, map positions,
confirmations, text, and menu selections.

GodotHack's backend TCP adapter implements the selected window port. The
NetHack core calls those backend functions directly in the backend process:

- An output callback serializes an appropriate JSON output message.
- An input callback sends a typed input request, waits for the matching JSON
  response, validates it, and returns the value required by the NetHack core.

Every function-table field enabled by the backend build must have a callable
implementation. An MVP may give low-value capabilities a documented no-op or
minimal behavior, but it must implement every input capability reachable in
the supported gameplay flows.

The window port is the primary user-interface boundary, not a strict
encapsulation boundary for all of NetHack. The backend remains able to add
small, clearly named GodotHack integration code when a graphical feature
requires information that the standard window-port callbacks do not expose.
Such code must preserve the game's knowledge rules and must not disclose
unseen monsters, undiscovered traps, or other hidden state.

### Input ownership and request types

The NetHack core controls when input is needed and what form that input must
take. The frontend must not infer that form from the current map or message
text. Each input request therefore has an explicit kind and an opaque request
id. Examples of kinds are a command key, a key-or-map-position request, a
confirmation, a line of text, and a menu selection. The frontend replies only
to the active request id. This prevents a stale key, a map click, or a menu
selection from being interpreted as input for a different core request.

### Standard map glyphs and rich map rendering

`print_glyph` supplies a player-visible display result, not the complete game
state for a map square. It has a foreground `glyph_info` and a background
`glyph_info`. The foreground is the current primary display glyph after
NetHack has applied its display priority. The background is an optional
terrain-oriented glyph intended for graphical window ports. It cannot
reconstruct every independent state that may coexist on a square, such as a
fixed feature, engraving, known trap, object pile, and creature.

The upstream ports demonstrate two different uses of this interface:

- The Qt port accepts both arguments but currently stores and draws only the
  foreground glyph; it uses only the background frame color. It is therefore
  a useful reference for the window-port boundary, but not for multi-layer
  tile rendering.
- The Windows graphical port used by `NetHackW.exe` stores foreground and
  background glyphs separately. When a usable background glyph is present,
  it draws the background tile first and draws the foreground tile over it
  with the tile transparency color. This supports effects such as a creature
  over water, ice, or lava.

The standard background-glyph calculation does not provide every fixed
feature as a background. In particular, it does not preserve a fountain as a
background below a hero. The core knows that the hero stands on a fountain,
but the normal `print_glyph` result can contain only the hero as the primary
glyph and no fountain background glyph.

GodotHack has two distinct rendering levels:

- For terminal-faithful rendering, consume the standard window-port map
  output.
- For rich layered rendering, add a GodotHack-specific backend map-view
  builder that produces the player-visible layers required by the renderer,
  such as terrain, fixed feature, engraving, known trap, visible object pile,
  creature, and memory state.

The rich map-view format is a protocol extension. Its exact message schema
belongs in `PROTOCOL.md`; the frontend must render only the information that
the backend has explicitly supplied.

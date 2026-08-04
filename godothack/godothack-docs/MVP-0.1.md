# GodotHack 0.1 Minimum Vertical Slice

This document defines the mandatory GodotHack 0.1 scope. Version 0.1 proves one
complete and testable frontend/backend path; it is not a complete NetHack UI.

## Decision

Version 0.1 uses enhanced option 2. The Godot client sends protocol input, the
backend owns active prompt state and validation, and a NetHack bridge or test
core bridge consumes validated input. The client uses opaque backend prompt ids
and stable menu item ids. A temporary terminal accelerator is never identity.

## Required input

| Message | Required use |
|---|---|
| session.hello | Protocol negotiation and client identity. |
| game.start | Start one new game in the session. |
| input.key | h, j, k, l, y, u, b, n, period, less-than, greater-than, s, comma, i, ESC, ENTER, and SPACE. |
| input.menu_choice | Single selection, multiple selection, and cancellation. |
| input.text | Player name and test-core text prompt. |
| input.choice | Finite choices such as y and n. |

Version 0.1 excludes Ctrl and Meta combinations, number-pad mode, mouse map
targeting, travel, extended-command text, counts, command rebinding, gamepad,
touch gestures, save/resume, spectators, and multiple sessions.

## Required output

| Message | Required content |
|---|---|
| session.welcome and game.started | Selected protocol and core kind. |
| view.map | Full rectangle with x, y, final symbol, color, and visibility. |
| view.player | Name, role, dungeon level, gold, HP, Pw, AC, experience level, turn, and conditions. |
| view.messages | Chronological retained messages and more_pending. |
| view.inventory | Read-only inventory letter and description. |
| prompt.key, prompt.menu, prompt.text, prompt.choice | One active prompt with an opaque prompt id. |
| prompt.closed | The prompt id which ended. |
| game.error and game.ended | Error or ending code with player-visible text. |

The map sends final display-layer symbols only. Item descriptions are display
text, not a client-side rules API. The backend sends complete menu item lists;
the client scrolls locally and submits opaque item ids.

## Required order

After accepting input, send prompt.closed when applicable, then view.map,
view.player, view.messages, view.inventory, and the next prompt. game.ended
replaces the next prompt when the game ends.

## Test-core scenario

The test core must demonstrate handshake, a player-name text prompt, movement
that changes map position and turn count, a multi-select floor-item menu with
at least two items, inventory and message updates after pickup, a finite
choice prompt, and stale-prompt rejection without a view change.

## Acceptance

0.1 is complete only when Godot runs this test-core flow, renders every
required view and prompt, scrolls a multi-select menu while preserving choices,
rejects invalid prompt responses in the backend, and shares one protocol with
the NetHack bridge.

The detailed Chinese implementation specification is MVP-0.1-cn.md. The wire
schema is defined by PROTOCOL.md.

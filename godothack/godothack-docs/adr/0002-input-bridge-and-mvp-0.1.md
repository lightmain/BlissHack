# ADR 0002: Backend Input Bridge and the 0.1 Vertical Slice

Status: accepted

Date: 2026-08-04

## Context

NetHack uses character input, prompts, and menus. GodotHack needs a modern
Godot UI while preserving the NetHack backend as the rules authority.

Making the Godot client translate every UI action into a legacy NetHack
character stream would duplicate knowledge of command bindings, prompt order,
and temporary menu letters in the client.

## Decision

Use enhanced option 2. The client sends protocol input. The backend input
dispatcher owns the active prompt, validates responses, and passes them to a
NetHack bridge or a test-core bridge. Menus use backend-generated prompt ids
and stable item ids.

Version 0.1 uses full view snapshots, four prompt types, and a deterministic
test-core scenario. MVP-0.1.md and PROTOCOL.md define the required details.

## Consequences

- Command semantics, rules, turn cost, and final validation remain in the backend.
- Godot can use modern controls without depending on terminal layout.
- The test core reuses the same client and protocol.
- The backend must implement an explicit prompt state machine and NetHack input bridge.
- Future Ctrl, Meta, map-target, and complex-command support requires a deliberate protocol and scope update.

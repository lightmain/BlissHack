# AI Collaboration Guide

GodotHack is intended to be developed with heavy AI assistance. This file gives
agents the project context that should remain stable across sessions.

## Mental Model

Think of this repository as a NetHack fork with a Godot frontend added to it.
The backend is not a generic server; it is the authoritative NetHack game. The
client is not a rules engine; it is the presentation and input layer.

## High-Value Context

- `godothack-client/` is the Godot project.
- `godothack-docs/PROTOCOL.md` is the frontend/backend protocol source of truth.
- `doc/` belongs to upstream NetHack.
- The root NetHack source layout should remain recognizable.
- The repository may have upstream NetHack remotes and branches; avoid changes
  that make future upstream merges unnecessarily painful.

## Preferred Workflow

1. Read `AGENTS.md`.
2. Read the relevant file in `godothack-docs/`.
3. Inspect the smallest relevant area of backend and client code.
4. Make scoped changes.
5. Update protocol/docs when behavior crosses the frontend/backend boundary.
6. Verify with the most local practical test or manual run.

## Documentation Discipline

Use `godothack-docs/WORKLOG.md` for curated progress notes. Do not paste raw AI
conversation logs into the repository. If a decision matters long-term, add an
ADR under `godothack-docs/adr/`.

## Common Mistakes To Avoid

- Do not put GodotHack planning docs into upstream `doc/`.
- Do not duplicate NetHack rules in the Godot client.
- Do not change the wire protocol without updating `PROTOCOL.md`.
- Do not commit Godot cache files from `.godot/`.
- Do not make broad formatting or cleanup changes in upstream NetHack files
  while working on integration code.


## Version 0.1 guardrails

Read MVP-0.1.md before protocol work. The client must not use a temporary menu letter as stable identity, predict game state, or add a game-affecting input type outside the documented 0.1 scope.

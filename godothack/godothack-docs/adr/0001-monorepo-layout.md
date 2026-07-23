# ADR 0001: Keep Godot Client In The NetHack Fork Repository

Status: accepted

Date: 2026-06-09

## Context

GodotHack combines a modified NetHack backend with a Godot frontend. The two
parts communicate over a TCP JSON session and are expected to evolve together.

The repository is also a NetHack fork, so keeping the upstream source layout
recognizable matters for future upstream merges.

## Decision

Keep the Godot client inside the main GodotHack repository under
`godothack-client/`.

Keep the NetHack backend source tree at the repository root instead of moving it
under a new `server/` directory.

Keep GodotHack-specific docs under `godothack-docs/`, not under upstream
NetHack `doc/`.

## Consequences

- Frontend, backend, and protocol changes can be committed together.
- AI agents can inspect the full project context in one repository.
- The upstream NetHack layout remains familiar and easier to compare with
  upstream.
- The repository needs clear documentation so `doc/` and `godothack-docs/` are
  not confused.


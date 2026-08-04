# Work Log

This is a curated work log for GodotHack. Keep entries short and useful for
future development. Raw AI chat transcripts should stay out of the repository.

## 2026-06-09

- Adopted a monorepo layout that keeps the upstream NetHack source tree at the
  repository root.
- Added the Godot client under `godothack-client/`.
- Added `godothack-docs/` for GodotHack-specific documentation, separate from
  upstream NetHack `doc/`.
- Established `godothack-docs/PROTOCOL.md` as the source of truth for the TCP
  JSON session protocol.


## 2026-08-04

- Adopted the backend input bridge and enhanced option 2.
- Defined protocol version 1 and the 0.1 vertical-slice scope.
- Added ADR 0002 for the durable input architecture decision.

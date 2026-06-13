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

## 2026-06-13

- Verified the original NetHack 5.0.0 Windows baseline build with MSVC using
  `sys\windows\Makefile.nmake`, x64 target, and curses disabled.
- Recorded the baseline flow in `godothack-docs/BUILDING.md` before porting the
  GodotHack server integration to NetHack 5.0.0.
- Added a minimal NetHack 5.0.0 `godothack-server` nmake target that builds
  `binary\NetHackServer.exe`.
- Implemented the first backend TCP/JSON transport slice with newline-delimited
  JSON, `session.welcome`, `session.hello`, and deterministic
  `not_implemented` errors for later game messages.
- Added `tools\smoke-test-nethack-server.ps1` as the first repeatable backend
  protocol smoke test.

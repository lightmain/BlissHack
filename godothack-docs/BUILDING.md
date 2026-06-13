# Building NetHack 5.0.0 Baseline

This document records the verified baseline build flow for the NetHack 5.0.0
Windows backend and the first GodotHack-specific server target.

Use this as the first check before changing backend integration code. The goal
is to keep a known-good upstream build path separate from GodotHack-specific
`NetHackServer.exe` work.

## Environment

- Run commands from an MSVC developer prompt, preferably:
  `x64 Native Tools Command Prompt for VS 2022`.
- Repository root:
  `E:\Develop\Game\GodotHackProject\GodotHack`
- Build template:
  `sys\windows\Makefile.nmake`

## Verified Minimal Build

This flow builds the original NetHack 5.0.0 Windows executables without curses
support. It keeps the dependency surface small and has been verified to produce
working build output in this workspace.

```bat
cd /d E:\Develop\Game\GodotHackProject\GodotHack

sys\windows\fetch.cmd lua

cd src
nmake /f ..\sys\windows\Makefile.nmake GIT_AVAILABLE=N TARGET_CPU=x64 CURSES_CONSOLE=N CURSES_GRAPHICAL=N package
```

Expected outputs include:

```text
binary\NetHack.exe
binary\NetHackW.exe
package\nethack-500-win-x64.zip
```

## GodotHack Server Target

The first NetHack 5.0.0 `NetHackServer.exe` target is intentionally minimal. It
only proves the TCP newline-delimited JSON transport and does not start a game
yet.

```bat
cd /d E:\Develop\Game\GodotHackProject\GodotHack\src
nmake /f ..\sys\windows\Makefile.nmake GIT_AVAILABLE=N TARGET_CPU=x64 CURSES_CONSOLE=N CURSES_GRAPHICAL=N godothack-server
```

Expected output:

```text
binary\NetHackServer.exe
```

If a sandboxed automation session reports `LINK : fatal error LNK1104` when
overwriting `binary\NetHackServer.exe`, retry the same command from a normal
MSVC developer prompt. The command has been verified outside the sandbox.

## Current Pre-Commit Backend Checks

For changes touching the current backend server slice, run these checks before
committing:

```bat
cd /d E:\Develop\Game\GodotHackProject\GodotHack\src
nmake /f ..\sys\windows\Makefile.nmake GIT_AVAILABLE=N TARGET_CPU=x64 CURSES_CONSOLE=N CURSES_GRAPHICAL=N godothack-server

cd ..
powershell -ExecutionPolicy Bypass -File .\tools\smoke-test-nethack-server.ps1

cd src
nmake /f ..\sys\windows\Makefile.nmake GIT_AVAILABLE=N TARGET_CPU=x64 CURSES_CONSOLE=N CURSES_GRAPHICAL=N package
```

## Notes

- Use `/f ..\sys\windows\Makefile.nmake` so the authoritative Windows build
  template is used directly.
- Do not rely on the existing `src\Makefile` as the source of truth. It may
  contain old local GodotHack server edits and can be overwritten by
  `sys\windows\nhsetup.bat`.
- The upstream NetHack 5.0.0 package build produces `NetHack.exe` and
  `NetHackW.exe`. GodotHack's `NetHackServer.exe` is built by the separate
  `godothack-server` target.
- `NetHackServer.exe` from older NetHack 3.6.7 work is historical output only;
  it should not be treated as a valid 5.0.0 build product.

## Full Curses Build

The default full package enables curses support and therefore needs
`pdcursesmod` in addition to Lua. This was not part of the verified baseline
above.

The local `sys\windows\fetch.cmd pdcursesmod` command failed because its batch
variables expand to empty values inside the parenthesized block. Do not fix that
script as part of the baseline record. Use the minimal build above until the
project explicitly decides how to manage curses dependencies.

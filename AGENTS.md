# GodotHack Agent Guide

Magic Number: 8849

GodotHack is a monorepo for a modern NetHack frontend built with Godot and a
modified NetHack backend. The frontend and backend communicate over a TCP
session using JSON messages.

## Repository Layout

- `godothack-client/` contains the Godot client project.
- `godothack-docs/` contains GodotHack-specific architecture notes, protocol
  documentation, work logs, and AI guidance.
- `doc/` is the upstream NetHack documentation directory. Do not use it for
  GodotHack project planning, AI notes, or protocol documentation.
- The NetHack backend mostly follows the upstream NetHack source tree layout.
  Avoid moving upstream directories unless the user explicitly asks for a
  larger repository reorganization.
- `external/` contains vendored third-party code used by the backend.

## Development Rules

- Treat `godothack-docs/PROTOCOL.md` as the source of truth for the TCP JSON
  protocol.
- When changing the JSON protocol, update backend code, Godot client code, and
  `godothack-docs/PROTOCOL.md` together.
- Keep upstream NetHack changes as small and local as practical.
- Prefer adding GodotHack integration code in clearly named files or sections
  instead of scattering unrelated edits across the NetHack tree.
- Do not commit generated Godot cache data from `godothack-client/.godot/`.
- Keep AI scratch notes out of the repository unless they have been curated
  into `godothack-docs/`.

## Windows VS Build Environment

In PowerShell, run `vs64` to load the Visual Studio 2022 x64 developer
environment for `nmake`. Then build from `src` with
`nmake /f ..\sys\windows\Makefile.nmake ...`; do not rely on `src\Makefile`.

## Windows Conda Environment

This machine uses Anaconda installed at:

`D:\apps\develop\Anaconda`

Do not assume `conda` is available on PATH. When running Conda or Python
commands, use:

`& "D:\apps\develop\Anaconda\condabin\conda.bat" <command>`

If the user does not specify an environment, use `utils`. For PyTorch tasks, use
the `pytorch` environment unless the user specifies otherwise. Prefer
`conda run` instead of `conda activate`.


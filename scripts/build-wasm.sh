#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
FRONTEND_ROOT="$REPOSITORY_ROOT/frontend"
PUBLIC_DIR="$FRONTEND_ROOT/public"
EXPECTED_NODE_MAJOR=$(tr -d '[:space:]' < "$REPOSITORY_ROOT/.nvmrc")
EXPECTED_EMSCRIPTEN_VERSION=$(
  tr -d '[:space:]' < "$REPOSITORY_ROOT/.emscripten-version"
)

# Print an error and stop the build.
fail()
{
    printf 'WASM build error: %s\n' "$*" >&2
    exit 1
}

# Require one executable to be available before any build files are changed.
require_command()
{
    command -v "$1" >/dev/null 2>&1 \
        || fail "required command not found: $1"
}

# Return the first line printed by a version command.
first_line()
{
    "$@" 2>&1 | sed -n '1p'
}

# Resolve one command through symlinks for toolchain provenance checks.
resolved_command_path()
{
    python3 - "$1" <<'PY'
import os
import shutil
import sys

print(os.path.realpath(shutil.which(sys.argv[1])))
PY
}

case $# in
0)
    case $(uname -s) in
    Darwin)
        HINTS_FILE="sys/unix/hints/macOS.500"
        ;;
    Linux)
        HINTS_FILE="sys/unix/hints/linux.500"
        ;;
    *)
        fail "unsupported host; pass --hints explicitly"
        ;;
    esac
    ;;
2)
    [ "$1" = "--hints" ] || fail "usage: $0 [--hints <hints-file>]"
    HINTS_FILE=$2
    ;;
*)
    fail "usage: $0 [--hints <hints-file>]"
    ;;
esac

case "$HINTS_FILE" in
sys/unix/hints/macOS.500|sys/unix/hints/linux.500)
    ;;
*)
    fail "unsupported hints file: $HINTS_FILE"
    ;;
esac

for tool in node npm emcc emar emranlib cc make sh awk sed curl tar python3
do
    require_command "$tool"
done

ACTUAL_NODE_VERSION=$(node --version)
ACTUAL_NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$ACTUAL_NODE_MAJOR" = "$EXPECTED_NODE_MAJOR" ] \
    || fail "Node.js version mismatch: expected major $EXPECTED_NODE_MAJOR, got $ACTUAL_NODE_VERSION"

EMCC_PATH=$(resolved_command_path emcc)
EMSCRIPTEN_BIN_DIR=$(dirname "$EMCC_PATH")
for wrapper in emar emranlib
do
    WRAPPER_PATH=$(resolved_command_path "$wrapper")
    [ "$(dirname "$WRAPPER_PATH")" = "$EMSCRIPTEN_BIN_DIR" ] \
        || fail "$wrapper is not from the same Emscripten SDK as emcc"
done

EMCC_VERSION_OUTPUT=$(emcc --version 2>&1)
ACTUAL_EMSCRIPTEN_VERSION=$(
  printf '%s\n' "$EMCC_VERSION_OUTPUT" \
    | awk '{
        for (i = 1; i <= NF; ++i) {
            if ($i ~ /^[0-9]+\.[0-9]+\.[0-9]+$/) {
                print $i;
                exit;
            }
        }
    }'
)
[ -n "$ACTUAL_EMSCRIPTEN_VERSION" ] \
    || fail "could not parse Emscripten version from emcc --version"
[ "$ACTUAL_EMSCRIPTEN_VERSION" = "$EXPECTED_EMSCRIPTEN_VERSION" ] \
    || fail "Emscripten version mismatch: expected $EXPECTED_EMSCRIPTEN_VERSION, got $ACTUAL_EMSCRIPTEN_VERSION"

MAKE_VERSION=$(first_line make --version)
HOST_COMPILER=$(first_line cc --version)
LUA_VERSION=$(
  awk '/^LUA_VERSION[[:space:]]*=/{ print $3; exit }' \
    "$REPOSITORY_ROOT/sys/unix/Makefile.top"
)
[ -n "$LUA_VERSION" ] || fail "could not determine Lua version"

printf '%s\n' \
    "Node.js: $ACTUAL_NODE_VERSION" \
    "npm: $(npm --version)" \
    "Emscripten: $ACTUAL_EMSCRIPTEN_VERSION" \
    "Make: $MAKE_VERSION" \
    "Host compiler: $HOST_COMPILER" \
    "Lua: $LUA_VERSION" \
    "Hints: $HINTS_FILE"

cd "$REPOSITORY_ROOT"
if [ -f Makefile ]; then
    make spotless
fi
rm -rf "$REPOSITORY_ROOT/targets/wasm"

HINTS_SETUP_PATH=${HINTS_FILE#sys/unix/}
(
    cd sys/unix
    sh setup.sh "$HINTS_SETUP_PATH"
)

if [ ! -f "lib/lua-$LUA_VERSION/src/lua.h" ]; then
    make fetch-Lua
fi
[ -f "lib/lua-$LUA_VERSION/src/lua.h" ] \
    || fail "Lua source is missing after make fetch-Lua"

make CROSS_TO_WASM=1

for runtime_file in nethack.js nethack.wasm
do
    [ -f "targets/wasm/$runtime_file" ] \
        || fail "missing build output: targets/wasm/$runtime_file"
    [ -s "targets/wasm/$runtime_file" ] \
        || fail "empty build output: targets/wasm/$runtime_file"
done

STAGING_DIR=$(mktemp -d "${TMPDIR:-/tmp}/blisshack-runtime.XXXXXX")
PUBLISH_DIR=""
BACKUP_DIR=""
PUBLISH_STARTED=0

# Restore the previously published triplet after a failed replacement or test.
restore_public_runtime()
{
    [ -n "$BACKUP_DIR" ] || return
    for runtime_file in nethack.js nethack.wasm nethack-runtime.json
    do
        if [ -f "$BACKUP_DIR/$runtime_file" ]; then
            cp -p "$BACKUP_DIR/$runtime_file" "$PUBLIC_DIR/$runtime_file"
        else
            rm -f "$PUBLIC_DIR/$runtime_file"
        fi
    done
    PUBLISH_STARTED=0
}

# Restore published files when needed and remove all temporary directories.
cleanup()
{
    set +e
    if [ "$PUBLISH_STARTED" -eq 1 ]; then
        restore_public_runtime
    fi
    rm -rf "$STAGING_DIR"
    [ -z "$PUBLISH_DIR" ] || rm -rf "$PUBLISH_DIR"
    [ -z "$BACKUP_DIR" ] || rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

cp targets/wasm/nethack.js "$STAGING_DIR/nethack.js"
cp targets/wasm/nethack.wasm "$STAGING_DIR/nethack.wasm"
node frontend/scripts/generate-runtime-manifest.mjs \
    "$STAGING_DIR" \
    "$ACTUAL_EMSCRIPTEN_VERSION" \
    "$ACTUAL_NODE_VERSION" \
    "$MAKE_VERSION" \
    "$HOST_COMPILER" \
    "$LUA_VERSION" \
    "$HINTS_FILE"
node frontend/scripts/verify-runtime-assets.mjs "$STAGING_DIR"

PUBLISH_DIR=$(mktemp -d "$PUBLIC_DIR/.runtime-publish.XXXXXX")
BACKUP_DIR=$(mktemp -d "$PUBLIC_DIR/.runtime-backup.XXXXXX")
for runtime_file in nethack.js nethack.wasm nethack-runtime.json
do
    cp "$STAGING_DIR/$runtime_file" "$PUBLISH_DIR/$runtime_file"
    chmod 0644 "$PUBLISH_DIR/$runtime_file"
    if [ -e "$PUBLIC_DIR/$runtime_file" ]; then
        cp -p "$PUBLIC_DIR/$runtime_file" "$BACKUP_DIR/$runtime_file"
    fi
done

PUBLISH_STARTED=1
for runtime_file in nethack.js nethack.wasm nethack-runtime.json
do
    mv "$PUBLISH_DIR/$runtime_file" "$PUBLIC_DIR/$runtime_file"
done

node frontend/scripts/verify-runtime-assets.mjs "$PUBLIC_DIR"
(
    cd frontend
    npm run test:integration:wasm
)
PUBLISH_STARTED=0

#!/bin/bash
# Integration test for RemoteHack HTTP server ping endpoint.
# Usage: ./test_ping.sh
# Requires: nethack built with WANT_WIN_HTTP=1, curl
# Exit code: 0 = all tests passed, 1 = failure

set -e

NETHACK="${NETHACK:-$HOME/nethackdir/nethack}"
PORT="${PORT:-8080}"
PING_URL="http://localhost:$PORT/api/ping"
TIMEOUT=5
PASSED=0
FAILED=0

fail() {
    echo "FAIL: $1"
    FAILED=$((FAILED + 1))
}

pass() {
    echo "PASS: $1"
    PASSED=$((PASSED + 1))
}

cleanup() {
    if [ -n "$NH_PID" ] && kill -0 "$NH_PID" 2>/dev/null; then
        kill "$NH_PID" 2>/dev/null
        wait "$NH_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# --- Pre-checks ---

if [ ! -x "$NETHACK" ]; then
    echo "ERROR: nethack binary not found at $NETHACK"
    exit 1
fi

if ! strings "$NETHACK" | grep -q "RemoteHack"; then
    echo "ERROR: binary does not contain HTTP interface"
    exit 1
fi

# Check port is free
if curl -s --connect-timeout 1 "$PING_URL" >/dev/null 2>&1; then
    echo "ERROR: port $PORT already in use"
    exit 1
fi

# --- Start server ---

"$NETHACK" --windowtype:http 2>/dev/null &
NH_PID=$!

# Wait for server to be ready
WAITED=0
while [ $WAITED -lt $TIMEOUT ]; do
    if curl -s --connect-timeout 1 "$PING_URL" >/dev/null 2>&1; then
        break
    fi
    sleep 1
    WAITED=$((WAITED + 1))
done

if [ $WAITED -ge $TIMEOUT ]; then
    echo "ERROR: server did not start within ${TIMEOUT}s"
    exit 1
fi

echo "Server started (PID $NH_PID)"
echo ""

# --- Test 1: ping returns 200 ---

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$PING_URL")
if [ "$HTTP_CODE" = "200" ]; then
    pass "ping returns HTTP 200 (got $HTTP_CODE)"
else
    fail "ping returns HTTP 200 (got $HTTP_CODE)"
fi

# --- Test 2: ping returns valid JSON with correct fields ---

RESPONSE=$(curl -s "$PING_URL")

echo "$RESPONSE" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null
if [ $? -eq 0 ]; then
    pass "response is valid JSON"
else
    fail "response is valid JSON (got: $RESPONSE)"
fi

# --- Test 3: status field is "ok" ---

STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)
if [ "$STATUS" = "ok" ]; then
    pass "status is 'ok'"
else
    fail "status is 'ok' (got: $STATUS)"
fi

# --- Test 4: server field is "RemoteHack" ---

SERVER=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['server'])" 2>/dev/null)
if [ "$SERVER" = "RemoteHack" ]; then
    pass "server is 'RemoteHack'"
else
    fail "server is 'RemoteHack' (got: $SERVER)"
fi

# --- Test 5: version field exists ---

VERSION=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])" 2>/dev/null)
if [ -n "$VERSION" ]; then
    pass "version is present (value: $VERSION)"
else
    fail "version is present"
fi

# --- Test 6: Content-Type is application/json ---

CONTENT_TYPE=$(curl -s -o /dev/null -w "%{content_type}" "$PING_URL")
if echo "$CONTENT_TYPE" | grep -q "application/json"; then
    pass "Content-Type is application/json (got: $CONTENT_TYPE)"
else
    fail "Content-Type is application/json (got: $CONTENT_TYPE)"
fi

# --- Test 7: unknown endpoint returns 404 ---

HTTP_CODE_404=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/nonexistent")
if [ "$HTTP_CODE_404" = "404" ]; then
    pass "unknown endpoint returns 404 (got $HTTP_CODE_404)"
else
    fail "unknown endpoint returns 404 (got $HTTP_CODE_404)"
fi

# --- Test 8: multiple rapid pings succeed ---

ALL_OK=true
for i in 1 2 3 4 5; do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" "$PING_URL")
    if [ "$CODE" != "200" ]; then
        ALL_OK=false
        break
    fi
done
if $ALL_OK; then
    pass "5 rapid sequential pings all return 200"
else
    fail "5 rapid sequential pings (failed at request $i with code $CODE)"
fi

# --- Summary ---

echo ""
echo "=== Results: $PASSED passed, $FAILED failed ==="

if [ $FAILED -gt 0 ]; then
    exit 1
fi
exit 0

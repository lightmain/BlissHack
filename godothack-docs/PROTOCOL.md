# TCP JSON Protocol

This document is the source of truth for the GodotHack frontend/backend protocol.

Status: draft, first transport slice implemented in `NetHackServer.exe`

## Transport

- The backend and Godot client communicate over TCP.
- Messages are encoded as JSON.
- The first implemented transport uses newline-delimited JSON, one JSON object
  per line.
- Each JSON message must fit on one line and is terminated by `\n`.
- Length-prefixed frames may replace this later if formatted text or binary-like
  payloads make newline framing too fragile.

## Message Shape

All protocol messages should use an object at the top level.

Recommended common fields:

```json
{
  "type": "message.type",
  "seq": 1,
  "payload": {}
}
```

- `type` identifies the message kind.
- `seq` is optional at first, but useful for debugging and request/response
  correlation.
- `payload` contains message-specific data.

## Direction

Client-to-backend messages represent player intent, not direct state mutation.
For example, the client may send "move north", but it should not send "set
player position to x,y".

Backend-to-client messages represent accepted state changes, view updates,
prompts, errors, and lifecycle events.

## Draft Message Categories

Client to backend:

- `session.hello`
- `game.start`
- `game.resume`
- `command.move`
- `command.action`
- `command.menu_choice`
- `command.text_input`

Backend to client:

- `session.welcome`
- `game.started`
- `view.map`
- `view.player`
- `view.messages`
- `prompt.menu`
- `prompt.text`
- `game.error`
- `game.ended`

These names are placeholders until the implementation settles.

## Versioning

The initial protocol version is `1`.

Client handshake:

```json
{
  "type": "session.hello",
  "seq": 1,
  "payload": {
    "client": "godothack-webclient",
    "protocol_version": 1
  }
}
```

Server welcome, sent once immediately after TCP connection and again as the
deterministic response to `session.hello`:

```json
{
  "type": "session.welcome",
  "seq": 1,
  "payload": {
    "server": "NetHackServer",
    "backend": "NetHack 5.0.0",
    "protocol_version": 1,
    "transport": "ndjson",
    "status": "connected"
  }
}
```

For the `session.hello` response, `status` is `ready`; the server also echoes
the client `seq` as `payload.client_seq` when present.

## Current Backend Slice

The current `NetHackServer.exe` target only proves the TCP/JSON transport. It
does not start a NetHack game yet. Non-handshake messages receive `game.error`
with `payload.code` set to `not_implemented`.

## Update Rule

When a protocol field or message type changes, update this document in the same
change as the backend and client code.

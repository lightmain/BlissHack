# TCP JSON Protocol

This document is the source of truth for the GodotHack frontend/backend protocol.

Status: draft

## Transport

- The backend and Godot client communicate over TCP.
- Messages are encoded as JSON.
- The message framing format is not finalized yet. Once chosen, document it here
  before expanding the protocol.

Open framing options:

- Newline-delimited JSON, one JSON object per line.
- Length-prefixed JSON frames.

Length-prefixed frames are usually safer once messages may contain formatted
text, but newline-delimited JSON is simpler for early manual testing.

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

The protocol should eventually include a version handshake. Until then, any
breaking change should update this document and the work log.

Potential handshake:

```json
{
  "type": "session.hello",
  "payload": {
    "client": "godothack-client",
    "protocol_version": 1
  }
}
```

## Update Rule

When a protocol field or message type changes, update this document in the same
change as the backend and client code.


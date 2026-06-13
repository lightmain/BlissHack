# TCP JSON 协议

本文档是 GodotHack 前后端协议的事实来源。

状态：草案，第一段传输已经在 `NetHackServer.exe` 中实现

## 传输

- 后端和前端客户端通过 TCP 通信。
- 消息编码为 JSON。
- 第一段已实现传输使用 newline-delimited JSON，每行一个 JSON 对象。
- 每条 JSON 消息必须在一行内，并以 `\n` 结束。
- 如果后续格式化文本或类二进制 payload 让换行 framing 变脆弱，可以再改为
  length-prefixed frame。

## 消息形态

所有协议消息的顶层都应该是一个对象。

推荐的通用字段：

```json
{
  "type": "message.type",
  "seq": 1,
  "payload": {}
}
```

- `type` 标识消息种类。
- `seq` 初期可以是可选字段，但它对调试和请求/响应关联很有用。
- `payload` 包含特定消息的数据。

## 方向

客户端发给后端的消息表达玩家意图，而不是直接修改状态。例如，客户端可以发送“向北移动”，但不应该发送“把玩家位置设置为 x,y”。

后端发给客户端的消息表达已接受的状态变化、视图更新、提示、错误和生命周期事件。

## 草案消息类别

客户端到后端：

- `session.hello`
- `game.start`
- `game.resume`
- `command.move`
- `command.action`
- `command.menu_choice`
- `command.text_input`

后端到客户端：

- `session.welcome`
- `game.started`
- `view.map`
- `view.player`
- `view.messages`
- `prompt.menu`
- `prompt.text`
- `game.error`
- `game.ended`

这些名称都是占位符，等实现稳定后再最终确定。

## 版本

初始协议版本是 `1`。

客户端握手：

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

服务端 welcome 会在 TCP 连接建立后立即发送一次，也会作为 `session.hello`
的确定性响应再次发送：

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

响应 `session.hello` 时，`status` 为 `ready`；如果客户端提供了 `seq`，
服务端会在 `payload.client_seq` 中回显。

## 当前后端切片

当前 `NetHackServer.exe` 目标只验证 TCP/JSON 传输，还不会启动 NetHack 游戏。
非握手消息会收到 `game.error`，其中 `payload.code` 为 `not_implemented`。

## 更新规则

当协议字段或消息类型发生变化时，应该在同一次变更中同时更新本文档、后端代码和客户端代码。

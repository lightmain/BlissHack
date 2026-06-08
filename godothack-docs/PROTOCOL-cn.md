# TCP JSON 协议

本文档是 GodotHack 前后端协议的事实来源。

状态：草案

## 传输

- 后端和 Godot 客户端通过 TCP 通信。
- 消息编码为 JSON。
- 消息 framing 格式尚未最终确定。选定之后，应先在这里记录，再继续扩展协议。

待选 framing 方案：

- Newline-delimited JSON，每行一个 JSON 对象。
- Length-prefixed JSON frame。

一旦消息中可能包含格式化文本，length-prefixed frame 通常更安全；但在早期手动测试时，newline-delimited JSON 更简单。

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

协议最终应该包含版本握手。在此之前，任何破坏性变更都应该更新本文档和 work log。

潜在握手格式：

```json
{
  "type": "session.hello",
  "payload": {
    "client": "godothack-client",
    "protocol_version": 1
  }
}
```

## 更新规则

当协议字段或消息类型发生变化时，应该在同一次变更中同时更新本文档、后端代码和客户端代码。


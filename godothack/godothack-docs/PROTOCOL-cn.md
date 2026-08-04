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

客户端发给后端的消息表达玩家输入事件，而不直接修改状态。例如，客户端可以发送按键 `l`，但不应该发送“把玩家位置设置为 x,y”。

后端通过 NetHack 现有命令处理流程解释输入事件。这样可以继续由后端负责按键绑定、规则、回合消耗和最终状态变化。

后端发给客户端的消息表达已接受的状态变化、视图更新、提示、错误和生命周期事件。

## 草案消息类别

客户端到后端：

- `session.hello`
- `game.start`
- `game.resume`
- `input.key`
- `input.menu_choice`
- `input.text`

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


## 版本 1 实现基线

版本 1 是 0.1 纵向切片使用的协议。它使用 UTF-8 编码的换行分隔 JSON。序列号必须存在，并且在每个发送方、每条连接上严格递增。

后端只维护一个活动提示。客户端使用后端给出的提示标识回答。菜单选择始终使用后端的不透明菜单项标识；终端字母和显示位置不能作为稳定身份。

MVP-0.1-cn.md 定义强制输入和输出范围。其 0.1 要求覆盖本文档中较早的草案占位说明。修改协议时，必须同步更新本文档、MVP-0.1-cn.md、后端、Godot 客户端和测试。

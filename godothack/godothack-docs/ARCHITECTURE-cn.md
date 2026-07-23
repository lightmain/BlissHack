# 架构

GodotHack 是一个现代化 NetHack 项目，由两个协作的应用组成：

- 一个经过修改的 NetHack 后端，负责维护权威游戏状态和游戏规则。
- 一个 Godot 前端，负责渲染玩家体验，并向后端发送玩家意图。

两端通过承载 JSON 消息的 TCP session 通信。

## 目标

- 保留 NetHack 的游戏逻辑和行为，让它作为权威后端。
- 在 Godot 中构建更丰富的现代 UI，而不是用 GDScript 重写 NetHack 规则。
- 让前后端协议足够明确，使 AI agent 能安全地同时修改两端。
- 保持上游 NetHack 源码树易于识别，让后续合并上游更新仍然可行。

## 仓库形态

仓库在根目录保留原始 NetHack 源码树。GodotHack 在它周围新增项目专属内容：

```text
godothack-client/   Godot 客户端项目
godothack-docs/     GodotHack 专属文档、协议说明和 AI 指南
external/           后端使用的 vendored 第三方依赖
doc/                上游 NetHack 文档
src/, include/, ... 上游风格的 NetHack 后端源码树
```

## 后端

后端应该继续负责：

- 游戏规则和状态转换。
- 随机性、地牢生成、怪物、物品、回合和存档。
- 将游戏状态变化转换成协议事件发送给客户端。
- 在应用玩家命令之前校验传入命令。

优先把 NetHack 专属行为保留在现有 NetHack 模块中，并把 GodotHack 的传输/session 代码放在命名清晰的集成模块里。

## 前端

Godot 客户端应该继续负责：

- 渲染地图、实体、物品栏、消息、菜单和 UI 状态。
- 捕获玩家输入，并转换成协议命令。
- 只维护表现层所需的客户端状态。
- 处理连接生命周期、重连体验和协议错误展示。

客户端不应该变成第二套 NetHack 规则实现。

## 协议边界

TCP JSON 协议是两端之间的契约。当前的事实来源是 `PROTOCOL.md`。

协议变更应该谨慎进行。一次完整的协议变更通常需要更新：

- 后端消息序列化/解析。
- Godot 客户端消息序列化/解析。
- `PROTOCOL.md`。
- 测试或手动验证记录。


# ADR 0001：将 Godot 客户端保留在 NetHack Fork 仓库中

状态：已接受

日期：2026-06-09

## 背景

GodotHack 结合了经过修改的 NetHack 后端和 Godot 前端。两部分通过 TCP JSON session 通信，并且预计会一起演进。

这个仓库同时也是一个 NetHack fork，因此保持上游源码布局可识别，对未来合并上游更新很重要。

## 决策

将 Godot 客户端放在 GodotHack 主仓库内的 `godothack-client/` 下。

将 NetHack 后端源码树保留在仓库根目录，而不是移动到新的 `server/` 目录下。

将 GodotHack 专属文档放在 `godothack-docs/` 下，而不是放进上游 NetHack 的 `doc/`。

## 影响

- 前端、后端和协议变更可以一起提交。
- AI agent 可以在一个仓库里检查完整项目上下文。
- 上游 NetHack 布局保持熟悉，也更容易和上游比较。
- 仓库需要清晰的文档，避免混淆 `doc/` 和 `godothack-docs/`。


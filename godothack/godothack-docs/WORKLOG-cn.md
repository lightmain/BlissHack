# 工作日志

这是 GodotHack 的整理版工作日志。条目应短小，并且对未来开发有用。原始 AI 聊天记录不应该进入仓库。

## 2026-06-09

- 采用 monorepo 布局，在仓库根目录保留上游 NetHack 源码树。
- 将 Godot 客户端加入 `godothack-client/`。
- 新增 `godothack-docs/`，用于存放 GodotHack 专属文档，并与上游 NetHack 的 `doc/` 分开。
- 确立 `godothack-docs/PROTOCOL.md` 作为 TCP JSON session 协议的事实来源。


## 2026-08-04

- 采用后端输入桥接层和加强版方案二作为前后端通信方式。
- 定义协议版本 1 和 0.1 纵向切片范围。
- 新增 ADR 0002，记录长期输入架构决策。

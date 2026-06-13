# 工作日志

这是 GodotHack 的整理版工作日志。条目应短小，并且对未来开发有用。原始 AI 聊天记录不应该进入仓库。

## 2026-06-09

- 采用 monorepo 布局，在仓库根目录保留上游 NetHack 源码树。
- 将 Godot 客户端加入 `godothack-client/`。
- 新增 `godothack-docs/`，用于存放 GodotHack 专属文档，并与上游 NetHack 的 `doc/` 分开。
- 确立 `godothack-docs/PROTOCOL.md` 作为 TCP JSON session 协议的事实来源。

## 2026-06-13

- 已验证原版 NetHack 5.0.0 Windows 基线构建：使用 MSVC、
  `sys\windows\Makefile.nmake`、x64 目标，并关闭 curses。
- 在移植 GodotHack 服务端集成到 NetHack 5.0.0 前，将该基线流程记录到
  `godothack-docs/BUILDING.md`。
- 新增最小 NetHack 5.0.0 `godothack-server` nmake 目标，用于构建
  `binary\NetHackServer.exe`。
- 实现第一段后端 TCP/JSON 传输：newline-delimited JSON、`session.welcome`、
  `session.hello`，以及对后续游戏消息返回确定性的 `not_implemented` 错误。
- 新增 `tools\smoke-test-nethack-server.ps1`，作为第一条可重复执行的后端协议
  smoke test。

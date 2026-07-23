# AI 协作指南

GodotHack 计划大量借助 AI 辅助开发。这个文件为 agent 提供跨 session 也应该保持稳定的项目上下文。

## 心智模型

把这个仓库理解为一个加入了 Godot 前端的 NetHack fork。后端不是通用服务器，而是权威的 NetHack 游戏。客户端不是规则引擎，而是表现层和输入层。

## 高价值上下文

- `godothack-client/` 是 Godot 项目。
- `godothack-docs/PROTOCOL.md` 是前后端协议的事实来源。
- `doc/` 属于上游 NetHack。
- 根目录的 NetHack 源码布局应该保持可识别。
- 仓库可能包含上游 NetHack remote 和分支；避免做出让未来合并上游变得不必要困难的修改。

## 推荐工作流

1. 阅读 `AGENTS.md`。
2. 阅读 `godothack-docs/` 中相关文件。
3. 检查最小相关范围内的后端和客户端代码。
4. 做范围明确的修改。
5. 当行为跨越前后端边界时，更新协议和文档。
6. 使用最局部、最实际的测试或手动运行方式进行验证。

## 文档纪律

用 `godothack-docs/WORKLOG.md` 记录整理后的进展。不要把原始 AI 对话日志粘进仓库。如果某个决策具有长期意义，在 `godothack-docs/adr/` 下新增一条 ADR。

## 常见错误

- 不要把 GodotHack 规划文档放进上游 `doc/`。
- 不要在 Godot 客户端里复制实现 NetHack 规则。
- 不要修改 wire protocol 却不更新 `PROTOCOL.md`。
- 不要提交 `.godot/` 中的 Godot 缓存文件。
- 在处理集成代码时，不要对上游 NetHack 文件做大范围格式化或清理。


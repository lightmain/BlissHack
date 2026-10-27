# BlissHack 文档索引

这里是 BlissHack 自有文档的唯一入口。默认只阅读“当前有效文档”；版本计划、
设计评审和发布验收属于历史证据，只有调查设计来源或回归问题时才进入发布归档。

## 当前有效文档

| 需要了解的内容 | 权威入口 |
| --- | --- |
| 当前版本和发布状态 | [当前项目状态](current/status.md) |
| 当前系统边界和模块所有权 | [当前架构](current/architecture.md) |
| Agent 启动和任务路由 | [Session 启动清单](session-start.md) |
| WASM 构建和运行时三件套 | [WASM 构建流程](build-process.md) |
| shim ABI、回调和已知限制 | [Shim 接口参考](shim-interface-reference.md) |
| BlissHack 对上游源码的修改 | [上游修改清单](upstream-modifications.md) |
| 浏览器按键编码 | [按键输入参考](key-input-reference.md) |
| NetHack Guidebook 定位 | [Guidebook 中文索引](guidebook-index-cn.md) |
| 尚未完成的工作 | [TODO](TODOs.md) |

## 决策和历史

- [架构决策记录](decisions/0001-documentation-knowledge-architecture.md)解释“为什么”
  采用当前设计。已接受的 ADR 不改写结论；后续决定通过新 ADR 取代。
- [发布归档](releases/index.md)保存已经完成版本的计划、阶段设计、验收记录和
  发布证据。归档内容不是当前实现的默认规范。

## 维护规则

1. 同一项当前事实只能有一个权威来源；其他页面使用链接，不复制正文。
2. 可从源码、schema、测试或清单确定的内容应生成并在 CI 中校验。
3. 新设计先写 ADR 或当前文档；实施计划随版本完成后移入发布归档。
4. `README` 面向玩家和贡献者，`AGENTS` 面向 Agent 规则，两者不承载完整架构。
5. 修改文档后运行 `cd frontend && npm run docs:check`。

机器可读的活跃文档列表见
[`knowledge-map.json`](knowledge-map.json)，发布目录见
[`releases/manifest.json`](releases/manifest.json)。

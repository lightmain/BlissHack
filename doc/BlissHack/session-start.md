# BlissHack Agent Session 启动清单

本文只负责建立可靠现场并把 Agent 路由到权威资料，不复制版本状态或架构正文。

## 1. 每次必读

按顺序完成：

1. 完整阅读根目录 `AGENTS.md` 和 `AGENTS-cn.md`。
2. 阅读 `README-cn.md`、[文档索引](index.md)、
   [当前项目状态](current/status.md)和[当前架构](current/architecture.md)。
3. 检查仓库现场：

   ```bash
   git status --short
   git log -5 --oneline --decorate
   git remote -v
   ```

4. 打开任务直接涉及的实现文件和测试。不得仅根据文档推断当前行为。

如果工作树已有改动，先判断归属，不得覆盖或回退用户及其他 Agent 的修改。
开始新修改前执行 `AGENTS-cn.md` 规定的检查点提交。

## 2. 按任务读取

### React、界面或应用状态

- `frontend/package.json`
- `frontend/src/App.tsx`
- `frontend/src/app/app-state.ts`
- `frontend/src/session/session-manager.ts`
- 任务相关模块及同目录测试

先检查[当前架构](current/architecture.md)声明的 owner，不建立重复状态或生命周期。

### shim、WASM 或 C/TypeScript 桥接

- `sys/libnh/README.md`
- `doc/window.txt` 的相关接口段落
- [Shim 接口参考](shim-interface-reference.md)
- [上游修改清单](upstream-modifications.md)
- `win/shim/winshim.c`
- `sys/libnh/libnhmain.c`
- `frontend/src/nethack-bridge.ts` 和 `frontend/src/bridge/` 的相关模块

文档与行为冲突时检查实际 C 调用链；确认文档过时后才以源码为准。

### 游戏规则或玩家交互

先用 [Guidebook 中文索引](guidebook-index-cn.md)定位章节，再分段读取
`doc/Guidebook.txt`。涉及行为差异时同时检查对应 C 源码。

### WASM 构建

- [WASM 构建流程](build-process.md)
- `sys/unix/hints/include/cross-pre2.500`
- `frontend/scripts/verify-runtime-assets.mjs`
- [上游修改清单](upstream-modifications.md)

先运行 `cd frontend && npm run check:toolchain`。重新构建后必须验证并一起更新
运行时三件套。

### GitHub Pages 和 CI

- `.github/workflows/`
- `frontend/package.json`
- `frontend/vite.config.ts`

不得根据 README 猜测 workflow 分支、路径或触发条件。

### 存档、IDBFS 或历史契约

先读当前 storage 实现和测试。需要调查设计来源时，再从
[发布归档](releases/index.md)进入对应版本；归档内容不能替代当前源码验证。

### 文档和发布状态

- [文档索引](index.md)
- `doc/BlissHack/knowledge-map.json`
- `doc/BlissHack/releases/manifest.json`
- `scripts/docs/documentation-health.mjs`

修改清单后运行 `cd frontend && npm run docs:generate`，再运行
`npm run docs:check`。

## 3. 修改与验证

- 修改前搜索调用点和现有测试，优先复用当前模块边界。
- 普通前端改动至少运行相关测试、lint 和生产构建。
- shim/WASM 改动还必须重新编译 WASM，并运行 WASM 与浏览器集成测试。
- 完成后运行 `git diff --check` 并报告实际执行的验证。
- 除非用户明确要求提交，否则实现完成后保留改动供审核；稳定阶段按仓库规则
  进行检查点提交。

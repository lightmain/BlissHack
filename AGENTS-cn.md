# BlissHack

## 新 Session 启动

每个 Agent 在新 session 开始工作时，必须完整阅读
`doc/BlissHack/session-start.md` 并执行其中的检查。不得默认沿用上一 session
的仓库状态、当前版本、架构事实或测试结果。

## 项目目的

BlissHack 是基于 NetHack 5.0 的独立浏览器衍生项目。NetHack C 核心编译为
WebAssembly，通过 `shim_graphics`、Emscripten Asyncify 和 TypeScript façade
连接 React 前端。

当前系统边界和模块所有权只在
`doc/BlissHack/current/architecture.md` 维护。文档入口见
`doc/BlissHack/index.md`，当前版本状态见
`doc/BlissHack/current/status.md`。完成版本的计划和验收位于
`doc/BlissHack/releases/`，不属于默认实现规范。

## 工具链

仓库固定使用 `targets/emsdk-6.0.9` 中的 Emscripten 6.0.9。用户目录
`~/emsdk` 中的 6.0.8 不用于本项目。构建前必须显式激活并检查：

```bash
source ./targets/emsdk-6.0.9/emsdk_env.sh
cd frontend
npm run check:toolchain
```

`frontend/public/nethack.js`、`nethack.wasm` 和
`nethack-runtime.json` 是必须一起更新的运行时三件套。

## 开发约束

- 优先通过 shim 回调在 TypeScript 侧实现功能，不修改 NetHack 游戏逻辑核心。
- 只有官方接口和实际调用链共同证明 shim C 实现缺失或错误，且前端无法修复时，
  才允许最小修改 C 侧 shim。
- 不得猜测未暴露的 WASM 地址、结构布局或回调语义。文档与源码冲突时必须检查
  实际调用链。
- 修改任何上游 NetHack 文件时，必须按 NetHack General Public License 在文件
  中注明 BlissHack 修改者、日期和目的，并同步更新
  `doc/BlissHack/shim-interface-reference.md` 和
  `doc/BlissHack/upstream-modifications.md`。
- 新函数必须说明用途、参数和返回值；代码注释使用英文。
- 修改范围应服从现有模块所有权，不建立重复状态机、生命周期管理器或协议层。

每个开发阶段必须依次执行：

1. 由 subagent 编写或补充测试；新增行为优先建立预期失败测试，重构建立
   characterization tests。
2. 主 Agent 在测试基线确定后实现。
3. 实现完成后由 subagent 独立代码审查。
4. 主 Agent 修复 findings，再运行该阶段完整验证。

如果环境无法创建 subagent，必须暂停并说明，不能静默跳过。每完成稳定阶段及
其他适合存档的时机进行 Git commit。

## 文档约束

- 当前事实、决策原因和发布历史必须分别进入 `current/`、`decisions/` 和
  `releases/`。
- 同一当前事实只维护一个权威来源；其他页面只链接，不复制正文。
- `doc/BlissHack/current/status.md` 和 `doc/BlissHack/releases/index.md`
  是生成文件，不得手工编辑。
- 修改文档结构、版本或链接后运行 `cd frontend && npm run docs:check`。

## 语言和 Git

用户使用中文；对话和项目自有文档使用中文，代码注释使用英文。

每次对话开始进行修改之前必须先创建 Git commit，供用户审核。commit message
使用英文标准格式。不得覆盖或回退用户及其他 Agent 的现有改动。

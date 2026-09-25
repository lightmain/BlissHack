# BlissHack Agent Session 启动清单

本文是每个新 Agent session 的最小启动入口。目标是先建立可靠的当前上下文，
再按任务加载资料，避免凭上一 session 的记忆工作或一次性读取大型文档。

## 1. 每次必读

开始分析或修改前，按顺序完成：

1. 完整阅读仓库根目录的 `AGENTS.md` 和 `AGENTS-cn.md`。
2. 阅读 `README-cn.md`，确认当前产品定位、运行方式、测试入口和许可证说明。
3. `BlissHack` 已包含完成人工验收的 alpha-1.1 Tileset、地图交互和定向基建；
   alpha-2.1 的焦点与 Below HUD 调整、alpha-2.2 的 profile v3、信息量、统一
   角色选择、终局结果页和本地 Ranking 也已完成人工验收。alpha-2.3 的
   profile v4、动作栏、动作次级弹窗和 Original TTY 两行状态已完成实现、
   自动门禁、独立复审和人工验收。当前 `VERSION` 为 `alpha-2.4`，处于范围
   尚未确定的规划准备阶段；先阅读
   `doc/BlissHack/plans/alpha-2.4.md`，不得把候选需求直接当作已确认范围。
   alpha-2.3 最终验收记录见
   `doc/BlissHack/plans/in-alpha-2.3/release-acceptance.md`。
   GitHub Pages 可能落后，应以页面版本为准。维护当前架构时阅读
   `doc/BlissHack/plans/prealpha-4.md`；进行 tileset、Canvas 地图、
   `TILES_IN_GLYPHMAP` 或 profile v2 工作时完整阅读
   `doc/BlissHack/plans/alpha-1.md`、`doc/BlissHack/plans/alpha-1.1.md` 及
   `plans/in-alpha-1/` 下的对应文档；进行 HUD、悬停、右键菜单、状态栏或永久
   背包操作时同时阅读 `doc/BlissHack/plans/alpha-2.0.md` 和
   `doc/BlissHack/plans/alpha-2.1.md`。
   涉及现有功能契约时再读取对应的 prealpha-2 或 prealpha-3 设计文档，不需要
   无目的地加载全文。
4. 检查仓库现场：

   ```bash
   git status --short
   git log -5 --oneline --decorate
   git remote -v
   ```

5. 打开当前任务直接涉及的实现文件及其测试。不得只根据计划或旧文档推断现状。

如果工作树中已有改动，应先判断其归属，不得覆盖或回退用户及其他 Agent 的
修改。按照 `AGENTS-cn.md` 的提交规则，在开始新修改前处理需要保留的现有改动。

## 2. 当前架构事实

- NetHack C 核心编译为 WebAssembly，通过 `win/shim/winshim.c`、
  Emscripten Asyncify 和 `frontend/src/nethack-bridge.ts` façade 与 React
  通信；module、ABI 解码和输入状态实现在 `frontend/src/bridge/`。
- `frontend/src/app/app-state.ts` 是顶层应用生命周期的唯一状态机。
- `frontend/src/map/` 同时保留 ASCII renderer 和 Canvas tile renderer；
  `MapCell` 与核心提供的 `tileIndex` 是两条渲染路径的共同输入。
- `frontend/src/map/MapViewport.tsx` 是地图 scroll container、camera 和
  pointer 生命周期的唯一 owner；普通命令下左右短按产生核心动作 intent，
  右键达到 5 CSS px 后切换为 viewport drag，显式位置输入仍优先。
- `frontend/src/game-actions/game-action-controller.ts` 是地图检查、地图/背包右键
  菜单和背包 drop 等高层 `ActionIntent` 的唯一 owner；它只根据核心实际
  command/menu/snapshot/inventory 观察推进，不使用盲目按键宏。
- `frontend/src/interactions/` 统一管理 anchored overlay、hover inspect 和
  永久背包 Pointer Events 拖动。拖放目标只接受地图区域，最终动作仍由核心
  原生 drop 流程决定。
- `frontend/src/screens/game/GameHudLayout.tsx` 拥有 viewport HUD Grid；
  消息、地图、状态和永久背包分别拥有自己的区域和 overflow。
- `frontend/src/screens/game/SecondaryDialog.tsx` 统一提供 BlissHack 动作栏的
  物品、方向、`yn`/`ynq` 和普通 `PICK_ONE` 次级弹窗；真实
  `program_state.input_state == getdirInp` 是方向 UI 的唯一识别依据。
- Original 使用结构化 BL 字段绘制 TTY 风格两行状态；BlissHack 继续在动作栏
  内使用图形状态。两者不切换 window port。
- 当前个人配置是严格 profile schema v4，持久 key 为
  `blisshack.profile.v4`；仅在没有 v4 时依次读取 v3、v2、v1，v1 迁移后
  保持 ASCII 显示，旧版本的新展示设置均迁移为 `original`。新建 profile
  默认使用 `detailed` 信息量以及 BlissHack 终局、角色创建和动作栏。
- `interface.informationLevel` 只控制状态栏的解释性 Tooltip；地图、背包和
  `nethack.showExperience` 不受其影响。
- `frontend/src/session/session-manager.ts` 是稳定 façade；
  `session-lifecycle.ts` 管理唯一活动 WASM session、module、callback 和清理，
  `home-operations.ts` 管理 Home 数据操作，两者共享一个显式 context。
- 每局 game module 在进入首页读取存档时创建；首页没有活动 session，也不调用
  `main()`。用户开始或继续游戏时，新 session 认领同一个 module。
- 本地 Ranking 仍由核心读写根目录 `/record`；storage service 在 module
  初始化和最终 flush 时通过 `/save/.ranking-record` sidecar 与 IDBFS
  双向同步。完整备份 schema v2 包含该记录，schema v1 导入时保留当前 Ranking。
- module、session 和首页之间的权威生命周期见
  `doc/BlissHack/plans/in-prealpha-2/module-lifecycle.md`。
- 项目主要在 TypeScript 侧开发，但允许对 C 侧 shim 做少量、经过源码验证且
  有测试覆盖的功能补全。
- shim ABI 有已知限制。不得假定它能无损表达全部 `window_procs` 契约，也不得
  猜测未公开的 WASM 地址或结构布局。
- `frontend/public/nethack.js`、`frontend/public/nethack.wasm` 和
  `frontend/public/nethack-runtime.json` 是必须一起更新的运行时三件套。

## 3. 按任务读取

### React、界面或应用状态

读取：

- `frontend/package.json`
- `frontend/README.md`
- `frontend/src/App.tsx`
- `frontend/src/app/app-state.ts`
- `frontend/src/session/session-manager.ts`
- `frontend/src/session/session-lifecycle.ts` 或 `home-operations.ts`
- 任务相关 screen、辅助模块及同目录测试

先检查现有组件和 CSS 约定，不另建重复状态或生命周期管理器。

### shim、WASM 或 C/TypeScript 桥接

读取：

- `sys/libnh/README.md`
- `doc/window.txt` 的相关接口段落
- `doc/BlissHack/shim-interface-reference.md` 的勘误、目标接口和
  “当前项目对 shim 接口的修改”章节
- `win/shim/winshim.c`
- `sys/libnh/libnhmain.c`
- `frontend/src/nethack-bridge.ts` 及其测试
- `frontend/src/bridge/` 下与任务对应的实现模块

文档与行为冲突时必须检查实际 C 调用链。只有能确认文档过时，才以当前代码为准。

### 游戏规则或玩家交互

先用 `doc/BlissHack/guidebook-index-cn.md` 定位章节，再分段读取
`doc/Guidebook.txt`。涉及行为差异时同时检查对应 C 源码，不把索引文档当作
最终规范。

### WASM 构建

读取：

- `doc/BlissHack/build-process.md`
- `sys/unix/hints/include/cross-pre2.500`
- `frontend/scripts/verify-runtime-assets.mjs`
- `doc/BlissHack/upstream-modifications.md`

先运行 `cd frontend && npm run check:toolchain`，确认固定 Node、Emscripten、
同源 wrappers、hints 和目标路径；该命令只预检，不清理或编译。

重新构建后必须验证并一起更新运行时三件套。

### GitHub Pages 和 CI

读取：

- `.github/workflows/deploy-pages.yml`
- `frontend/package.json`
- `frontend/vite.config.ts`

不要根据 README 猜测 workflow 的分支、路径或触发条件。

### 存档与 IDBFS

读取：

- `doc/BlissHack/plans/prealpha-2.md` 的阶段二至四相关部分
- `doc/BlissHack/plans/in-prealpha-2/save-format-review.md`
- `doc/BlissHack/plans/in-prealpha-2/module-lifecycle.md`
- `sys/libnh/README.md`
- 当前 storage 实现和测试
- NetHack 保存、恢复调用链的相关 C 源码

阶段二的浏览器内存储和读取方案评审是强制门禁；获得用户确认前不得实现
存档列表元数据或继续游戏。导入、导出和覆盖策略在阶段三开始前另行评审。

## 4. 修改与验证

- 修改前先搜索调用点和现有测试，优先复用当前模块边界。
- 新函数按项目约定说明用途、参数和返回值；代码注释使用英文。
- 修改上游 NetHack 文件时，在文件中显著注明修改者、日期和目的，并更新 shim
  修改记录。
- 测试范围按风险决定。普通前端改动至少运行相关单元测试、lint 和生产构建；
  shim/WASM 改动还必须重新编译 WASM，并运行 WASM 与浏览器集成测试。
- 完成后运行 `git diff --check` 并报告实际执行的测试。
- 除非用户明确要求提交，否则实现完成后保留改动供审核。

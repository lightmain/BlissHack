# BlissHack 当前架构

本文只描述当前实现的稳定边界。设计过程和历史方案位于
[发布归档](../releases/index.md)，重要取舍位于
[架构决策记录](../decisions/0001-documentation-knowledge-architecture.md)。

## 运行链路

```text
NetHack C 核心
    ↓ window_procs
win/shim/winshim.c
    ↓ EM_JS + Asyncify
frontend/src/nethack-bridge.ts
    ↓
React 前端
```

NetHack C 核心编译为 WebAssembly，通过上游 shim 窗口接口与 React/TypeScript
前端通信。module、ABI 解码和输入状态实现在 `frontend/src/bridge/`。

## 应用和会话所有权

- `frontend/src/app/app-state.ts` 是顶层应用生命周期的唯一状态机。
- `frontend/src/session/session-manager.ts` 是稳定 façade。
- `frontend/src/session/session-lifecycle.ts` 管理唯一活动 WASM session、
  module、callback 和清理。
- `frontend/src/session/home-operations.ts` 管理首页数据操作。
- 每局 game module 在进入首页读取存档时创建；首页没有活动 session，也不调用
  `main()`。开始或继续游戏时，新 session 认领同一个 module。

## 地图、HUD 和交互

- `frontend/src/map/` 同时保留 ASCII renderer 和 Canvas tile renderer；
  `MapCell` 与核心提供的 `tileIndex` 是两条路径的共同输入。
- `frontend/src/map/MapViewport.tsx` 是地图 scroll container、camera 和
  pointer 生命周期的唯一 owner。
- `frontend/src/screens/game/GameHudLayout.tsx` 拥有 viewport HUD Grid；
  消息、地图、状态和永久背包分别拥有自己的区域和 overflow。
- `frontend/src/game-actions/game-action-controller.ts` 是地图检查、地图和背包
  右键菜单、背包 drop 等高层 `ActionIntent` 的唯一 owner。它只根据核心实际
  command、menu、snapshot 和 inventory 观察推进，不使用盲目按键宏。
- `frontend/src/interactions/` 统一管理 anchored overlay、hover inspect 和
  永久背包 Pointer Events 拖动。
- `frontend/src/screens/game/SecondaryDialog.tsx` 统一提供物品、方向、
  `yn`/`ynq` 和普通 `PICK_ONE` 次级弹窗。

## 展示和资料

- Original 使用结构化 BL 字段绘制 TTY 风格两行状态；BlissHack 在动作栏内
  使用图形状态。两者不切换 window port。
- 当前个人配置使用严格 profile schema v4，持久 key 为
  `blisshack.profile.v4`；旧 schema 只在缺少 v4 时按顺序迁移。
- `interface.informationLevel` 控制状态解释和合成 `Examine` 入口，不影响地图
  与背包 hover。
- `frontend/src/encyclopedia/` 只根据最终 glyph 或已公开的有界物品身份
  token 解析可见身份。核心资料和 Wiki 节选保持目录、类型、来源与许可分离。
- `Examine` 不伪造核心 item index。控制器先结束核心菜单，在新的 command
  boundary 到达后才发布本地窗口请求；打开、滚动和关闭均不消耗回合。

## 存储和运行时

- 游戏状态通过 Emscripten IDBFS 保存在浏览器本地。
- 本地 Ranking 由核心读写 `/record`；storage service 通过
  `/save/.ranking-record` sidecar 与 IDBFS 同步。
- 完整备份 schema v2 包含 profile、存档和 Ranking，并兼容 schema v1 导入。
- `frontend/public/nethack.js`、`nethack.wasm` 和
  `nethack-runtime.json` 是必须一起更新的运行时三件套。
- 前端校验 loader 和 WASM bytes 后，通过临时 Blob URL 导入 loader；部署
  CSP 必须在 `script-src` 中允许 `blob:`。

## 接口约束

- 项目优先在 TypeScript 侧实现功能，只允许对 C 侧 shim 做少量、经过源码验证
  且有测试覆盖的补全。
- 不得假设 shim ABI 能无损表达全部 `window_procs` 契约。
- 不得猜测未公开的 WASM 地址、结构布局或回调语义。
- 当前上游修改和行为差异以
  [Shim 接口参考](../shim-interface-reference.md)与
  [上游修改清单](../upstream-modifications.md)为准。

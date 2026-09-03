# BlissHack Game Module 生命周期

本文定义 prealpha-2 起的 Emscripten game module 生命周期，并区分 module、
session 和正在运行的游戏。

## 1. 术语

### Module factory

`nethack.js` 导出的异步工厂。调用一次会创建一个新的
`EmscriptenModule`。

### Game module

一套独立的 NetHack WASM 运行环境，包括：

- WebAssembly 实例和线性内存；
- C 全局变量、栈和堆；
- Emscripten `FS`、`IDBFS` 和 `ENV`；
- 函数导出、callback table 和 Asyncify 状态。

一个 game module 近似一个 NetHack 进程。它可以在 `main()` 调用前完成
文件系统初始化，但最多只能运行一局游戏。

### Session

从用户选择 New Game 或 Continue，到 NetHack 核心退出并完成 flush 和清理
的一次活动游戏。session 有唯一 ID，并独占当前 game module。

### Home

没有正在运行的 session 的应用界面。Home 持有为下一局创建的 game module，
以便初始化 IDBFS、枚举存档，并在用户选择后启动同一个 module。

## 2. 权威生命周期

```text
APP_BOOT
  |
  v
MODULE_LOADING
  |
  v
STORAGE_LOADING --失败--> HOME_READY(storageAvailable=false)
  |
  v
HOME_READY(storageAvailable=true)
  |
  +-- Delete save --> 备份 bytes --> unlink --> flush --> HOME_READY
  |
  +-- Import save --> 校验 bytes --> 冲突确认 --> replace --> flush --> HOME_READY
  |
  +-- Export save --> 读取原始 bytes --> browser download --> HOME_READY
  |
  +-- New Game ----+
  |                |
  +-- Continue ----+--> SESSION_STARTING
                           |
                           v
                       MAIN_RUNNING
                           |
                           v
                     SESSION_EXITING
                           |
                           v
                    STORAGE_FLUSHING
                           |
                           v
                     MODULE_RETIRED
                           |
                           v
                   创建下一 game module
```

module 生命周期从 `MODULE_LOADING` 开始，早于 session。两段准备状态对应
`booting/loading-module` 和 `booting/loading-storage`。session 只在用户
选择新游戏或继续游戏后开始。

## 3. 首页初始化

每次进入首页前：

1. 确认上一 module 已完成退出、flush 和清理。
2. 调用 factory 创建下一局的 game module。
3. 创建绑定该 module 的 storage service。
4. 创建 `/save` 并挂载 IDBFS；同一 module 只挂载一次。
5. 执行 `syncfs(true)`，把 IndexedDB 内容载入当前 module 的内存 FS。
6. 枚举并校验存档。
7. 显示 Home；根据结果启用或禁用 Continue。

这里的 module 不是临时扫描器。玩家开始游戏时直接复用它，避免重复实例化、
两个 FS 快照不一致，以及并发 IDBFS 操作。

Home 可以使用同一个 module 删除当前已经枚举的 save。删除前复制原始 bytes，
成功 `unlink` 后等待 `syncfs(false)`，再重新枚举并更新 Home；同步失败时写回
原始 bytes 并再次同步。删除事务结束前，New Game 或 Continue 的 session
启动等待该事务完成。

Home 也使用同一个 module 导入和导出 raw save。导入在正式路径外写入并验证
临时文件，同名覆盖前保留旧 bytes，rename 后只有 `syncfs(false)` 成功才
重新枚举；失败时恢复旧 bytes 或删除新增文件并再次同步。导出只读取当前列表
中的 ready save，不修改或 flush 文件。导入、导出、删除和 session 启动使用
同一个 Home operation 门禁。

## 4. 新游戏与继续游戏

New Game：

1. 保持角色身份为空。
2. 创建唯一 session ID。
3. 注册绑定 module 和 session ID 的 shim callback。
4. 调用一次 `main()`，由核心进入角色命名和选择。

Continue：

1. 从已经校验的存档记录取得角色身份。
2. 在 `main()` 前设置核心会读取的启动身份。
3. 创建唯一 session ID 并注册 shim callback。
4. 调用一次 `main()`，由核心执行 `restore_saved_game()`。

任何路径都不得为了开始游戏再创建第二个 module。

## 5. 退出与下一局

退出顺序必须是：

1. `shim_exit_nhwindows` 报告核心退出。
2. session 进入 `exiting`，拒绝新的游戏输入。
3. 等待 `main()` 正常结束。
4. 等待 storage queue 中的 `syncfs(false)` 完成。
5. 移除全局 callback，清除 pending input、按键队列和单局 UI 数据。
6. 清除对旧 module 的强引用，把它标记为 retired。
7. 创建下一局的新 game module，重新 populate 并枚举。
8. 新首页准备完成。

不得在旧 module flush 期间创建或挂载下一 module。旧 module 不得再次调用
`main()`，也不得作为第二局的存档扫描器。

## 6. 并发与过期结果

- 同一时间最多有一个当前 module。
- module 创建、populate、session 启动、退出和 flush 使用 generation 或
  session ID 防止过期 Promise 接管 UI。
- 重复点击 New Game 或 Continue 只能认领同一个 ready module 一次。
- 同一时间只执行一个 Home 存档操作；导入、导出、删除和 session 启动不能
  并发访问 FS。
- HMR、React Strict Mode 重复 effect 和页面卸载不得创建第二个当前 module。
- 当前版本不支持同一站点的多个标签页同时运行游戏；后续若支持，需要单独设计
  跨标签页锁。

## 7. 失败状态

- module 加载失败：进入 fatal，不显示可用游戏按钮。
- IndexedDB 不可用或 populate 失败：允许使用同一 module 运行临时新游戏，
  Continue 禁用，并明确提示无法持久保存。
- 存档枚举失败：不猜测列表，Continue 禁用。
- 删除 flush 失败：恢复原始 bytes，保留列表项并显示可恢复错误。
- 导入校验失败：不创建正式文件，确认错误后返回 Home。
- 导入覆盖 flush 失败：恢复旧 bytes 并再次 flush，不更新列表。
- 导出失败：不修改 save，并在 Home 显示可理解错误。
- `main()` 失败：隔离当前 session，仍先处理可安全完成的 flush 和清理。
- flush 失败：不得报告保存成功，也不得立即创建下一 module 覆盖现场。

## 8. 不变量

1. 一个 module 最多对应一局游戏。
2. 一局游戏只使用一个 module。
3. 首页枚举与随后游戏使用同一个 module 和同一个 FS 视图。
4. module 的创建早于 session，`main()` 的调用标志游戏运行开始。
5. 旧 module 完成 flush 和清理后，下一 module 才能访问 IDBFS。
6. IndexedDB 持久化不改变 NetHack save payload 的内部格式。

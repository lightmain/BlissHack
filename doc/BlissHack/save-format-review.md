# BlissHack 存档存储与读取方案评审

本文记录 prealpha-2 阶段二开始前的存档调查、已确认决策和待讨论问题。
结论依据当前 NetHack 5.0 源码、WASM 构建配置和 Emscripten 运行时。

阶段二只处理浏览器内的保存、枚举和继续游戏。阶段三的导入、导出格式、
扩展名、完整性校验、大小限制和覆盖策略留到阶段三开始前单独评审，本文件
不预设 BlissHack 容器或原始文件导出方案。

## 1. 原版 NetHack 的文件模型

TTY 只是 NetHack 的窗口端口，不定义存档格式。TTY、curses、X11 和当前
BlissHack shim 都调用同一套 `save.c`、`restore.c`、`files.c` 和
`version.c`。

原版运行期间存在两类不同文件：

1. 正式 save file：玩家确认保存后，核心把整局状态写入一个二进制文件并退出。
2. level/checkpoint files：活动游戏使用的锁和分层文件；崩溃时可由
   `recover` 重组，不等同于玩家正常保存产生的 save file。

正式 save file 是顺序二进制流，主要顺序为：

```text
格式与兼容性 header
角色身份块
当前地牢层
全局游戏状态
其他地牢层，直到 EOF
```

当前核心使用 historical binary struct-level 格式。header 包含格式标志、
关键 C 类型和结构的尺寸、NetHack 版本、feature set、实体数量校验值，以及
固定 49 bytes 的角色信息块。正文包含地图、怪物、物品、陷阱、玩家状态、
背包、地牢拓扑、计时器、消息历史和其他层等完整游戏状态。

这不是稳定的跨平台交换格式。即使 NetHack 版本相同，32/64 位数据模型、
编译 feature、结构尺寸或实体数量不同也可能使存档不兼容。核心
`validate()` 是兼容性判断的权威。

## 2. 当前 WASM 文件与命名

WASM 构建沿用 Unix 文件逻辑。当前 Emscripten 运行时的 `getuid()` 返回
`0`，`set_savefile_name()` 因此构造：

```text
save/0<角色名>
```

在浏览器虚拟文件系统中对应：

```text
/save/0<角色名>
```

角色名最长 31 bytes，文件名中的 UID 和角色名之间没有分隔符。

仓库的 Unix 配置默认定义外部 `/usr/bin/compress` 和 `.Z`。浏览器不能按
本地 Unix 方式执行该程序，因此不能只根据宏定义判断结果。阶段二使用当前
生成的 `nethack.js`/`nethack.wasm` 实际保存后，确认 IDBFS 中的正式文件为
未带 `.Z` 后缀的 `/save/0<角色名>`，payload 首字节为 historical binary
格式标志 `h`。

## 3. 保存与恢复生命周期

- 新游戏开始时不会创建正式 save file，只创建运行期锁和关卡文件。
- 玩家确认保存后，核心创建或截断目标 save，写入 header、角色信息、当前层、
  全局状态和其他层；成功后删除运行期关卡文件并退出。
- 创建或中途读取关卡失败时，核心可能删除不完整 save。
- 启动时，核心根据 UID 和角色名构造路径并调用 `restore_saved_game()`。
- 恢复前，`validate()` 校验格式、关键尺寸、版本、feature set 和实体数量。
- 普通模式恢复成功后，核心删除正式 save；后续再次保存时重新创建。
- 部分深层恢复失败路径也可能删除原 save，并继续进入同名新游戏流程。
- 死亡、逃离、飞升等游戏结束不会留下可继续的正式存档。

阶段二通过“原始 bytes 备份 + 必须恢复标志”阻止“用户选择继续，但恢复失败
后静默开始同名新游戏”，具体见第 7 节。

## 4. IndexedDB 中实际保存的内容

### 4.1 已确认结论

阶段二不会把正式存档转换成 JSON，也不会包装成 BlissHack 容器。

NetHack 核心仍向 `/save/...` 写入原版 historical binary save bytes。
Emscripten IDBFS 把虚拟文件系统节点同步到 IndexedDB。IndexedDB 中会有
IDBFS 自己的 object store、路径、时间戳、权限和文件内容记录，因此数据库
记录本身不是一个可直接下载的裸文件；但其中的文件内容 payload 与 NetHack
写入虚拟文件的 bytes 一致。

分层关系是：

```text
NetHack 原版二进制 save bytes
        ↓ 写入
Emscripten 虚拟文件 /save/0<角色名>
        ↓ IDBFS syncfs(false)
IndexedDB 中的 IDBFS 记录
```

读取方向相反：

```text
IndexedDB 中的 IDBFS 记录
        ↓ IDBFS syncfs(true)
Emscripten 虚拟文件 /save/0<角色名>
        ↓
NetHack 原版 restore_saved_game()
```

BlissHack 不直接把 IndexedDB 的私有 schema 当作应用数据格式。storage
service 通过 Emscripten `FS` 和 `IDBFS` 操作文件。

### 4.2 WASM 与桌面存档

“原版 bytes”表示由未经修改的 NetHack 存档代码生成，不表示与任意桌面
NetHack 文件逐字兼容。当前 WASM32 的 pointer、`long` 和 `size_t` 通常是
4 bytes，而常见 64 位 Unix 构建通常是 8 bytes。historical binary 格式会
把这些 ABI 差异反映到 header 和正文中，因此桌面与 WASM 默认视为不兼容。

## 5. Game module 生命周期

`nethack.js` 是 Emscripten module factory。每次调用 factory 都会创建一套
独立的 `EmscriptenModule`，其中包含 WASM 实例、线性内存、C 全局变量、
虚拟文件系统、环境变量和 Asyncify 状态。一个 module 近似浏览器中的一个
NetHack 进程。

不再使用“候选 module”一词。每一局的 game module 生命周期从进入首页、
读取已有存档时开始，而不是从点击 New Game 或 Continue 时开始：

```text
进入首页
创建下一局的 game module
挂载 /save 并执行 syncfs(true)
枚举存档，展示首页
玩家选择 New Game 或 Continue
同一个 module 调用一次 main()
核心退出
等待 syncfs(false) 和清理完成
废弃旧 module
创建下一局的新 game module
```

首页存在一个已经加载但尚未调用 `main()` 的 game module；此时没有正在运行
的 NetHack 游戏。玩家开始或继续时复用这个 module，不额外创建临时 module。

每个 module 必须遵守：

1. 最多调用一次 `main()`。
2. 首页枚举和随后的一局游戏使用同一个 FS 视图。
3. 上一 module 完成所有 flush 和清理后，才能创建下一 module。
4. 同一时间最多有一个当前 module；过期异步结果不得接管 UI。
5. 退出后移除 callback、pending input 和所有强引用，让运行时可被回收。

完整状态定义见 `doc/BlissHack/module-lifecycle.md`。

## 6. 阶段二 Storage Service 边界

storage service 位于 `frontend/src/storage/`，拥有 Emscripten FS 适配器和
单一 Promise 队列，预期提供：

```text
initialize()
listSaves()
readSave(path)
restoreOriginalSave(path, bytes)
flush()
```

阶段二没有导入、导出、覆盖和用户删除，因此暂不要求公开 `writeSave()`、
`deleteSave()` 或 `rename()`。核心仍负责创建和删除正式 save。

`initialize()` 对同一 module 幂等，只挂载 `/save` 一次，并在首次枚举前
执行 `syncfs(true)`。所有 `syncfs` 操作进入同一异步队列。核心退出后必须
等待 `syncfs(false)` 成功，才能废弃 module 并显示下一次首页。

IndexedDB 缺失、挂载或首次同步失败时，应用仍可用内存 FS 开始临时新游戏，
但必须禁用 Continue，并明确提示本次游戏无法持久保存。

## 7. 阶段二读取与恢复方案

阶段二采用“C 生成当前构建 fingerprint，TypeScript 最小解析 header，
核心最终恢复”的组合：

1. shim 的 `shim_graphics_get_save_fingerprint()` 从当前构建的
   `critical_sizes` 和 `nomakedefs` 生成预期 header 前缀。
2. TypeScript 从 Emscripten `FS` 读取原始 bytes，逐字节比较 fingerprint。
3. fingerprint 后读取 4-byte little-endian 角色块长度，只接受 49。
4. 从固定 49-byte 块读取 NUL 结尾的角色名，并要求它与 `0<角色名>` 文件名
   一致。
5. 列表校验不打开、写入、删除、解压或重新压缩原文件。
6. 用户选择 Continue 后，仍由原版 `restore_saved_game()` 和 `validate()`
   执行最终完整校验与恢复。

没有在 `main()` 前直接调用 `validate()`：该函数的错误和截断路径可能调用
尚未初始化的窗口函数。fingerprint 由 C 生成，避免 TypeScript 硬编码当前
80 项结构尺寸和版本三元组，同时保持列表扫描只读。

Continue 启动流程：

1. 在调用 `main()` 前复制原始 save bytes。
2. 通过 `shim_graphics_set_player_name()` 设置 C `USER`、`LOGNAME` 和启动
   名字。
3. 通过 `shim_graphics_set_restore_required(1)` 标记本次启动只能恢复。
4. 如果核心恢复失败并进入 `shim_player_selection()`，shim 立即以失败状态
   结束，不能进入 `genl_player_setup()`。
5. session manager 把备份写回原路径并成功 flush 后才进入错误状态。
6. 成功恢复并进入第一次游戏按键等待后，释放内存中的备份。

真实 `/save` 文件仍是唯一事实来源，不引入 sidecar index。

## 8. 阶段三边界

阶段三开始前重新讨论：

- 下载的是裸 NetHack save 还是带 manifest 的容器；
- 扩展名和 MIME type；
- checksum、build ID 和兼容性信息；
- 导入大小限制；
- 文件名、冲突、替换和回滚策略；
- 是否需要可重建的 sidecar index。

本阶段不对这些问题作决定。

## 9. 阶段二确认结果

1. IndexedDB 中由 IDBFS 持久化的文件内容是原版 NetHack 二进制 save bytes。
2. 不修改 NetHack 内部存档格式。
3. 每局 game module 在进入首页读取存档时创建，随后由同一局调用一次
   `main()`。
4. 阶段三导入导出方案推迟到阶段三评审。
5. 当前 WASM 生成 `/save/0<角色名>`，没有 `.Z` 后缀。
6. 列表校验使用 C fingerprint 和 TypeScript 最小 header 解析；核心恢复
   仍是最终校验。
7. 恢复失败会终止该 module，并在 flush 后保留原始 bytes。

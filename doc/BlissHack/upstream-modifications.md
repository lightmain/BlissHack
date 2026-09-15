# BlissHack 上游修改清单

本文记录 BlissHack 相对于 `upstream/NetHack-5.0` 的上游源码修改。目标是让
后续上游合并能够逐项复查本地调用链、许可证标记、导出接口和回归测试。

本文只列出对 NetHack 上游文件的修改。`frontend/`、`.github/` 和
`doc/BlissHack/` 下的 BlissHack 自有文件不属于这份清单。

## 1. 当前比较方法

更新本地 upstream 引用后运行：

```bash
git fetch upstream NetHack-5.0
git diff --name-status upstream/NetHack-5.0...HEAD -- \
  include src sys/libnh sys/unix/hints win/shim
git diff upstream/NetHack-5.0...HEAD -- \
  src/cmd.c \
  src/exper.c \
  sys/libnh/libnhmain.c \
  sys/unix/hints/include/cross-pre2.500 \
  sys/unix/hints/include/cross-post.500 \
  win/shim/winshim.c
```

截至 alpha-2.0 阶段五，相关 diff 只应包含：

```text
M src/cmd.c
M src/exper.c
M sys/libnh/libnhmain.c
M sys/unix/hints/include/cross-pre2.500
M sys/unix/hints/include/cross-post.500
M win/shim/winshim.c
```

## 2. 修改记录

### 2.1 角色选择退出语义

- **文件**：`win/shim/winshim.c`
- **引入提交**：`2f1688501 fix: honor quit during character selection`
- **目的**：保留 `genl_player_setup()` 返回 false 时的退出语义，避免玩家在
  `[ynaq]` 提示中选择 `q` 或 Escape 后仍进入 `newgame()`。
- **行为依据**：
  `doc/BlissHack/shim-interface-reference.md` 第 6.1 节。
- **回归测试**：
  - `frontend/src/nethack-bridge.test.ts`
  - `frontend/src/session/session-lifecycle.test.ts`
  - `frontend/test/integration-tests/browser/playable-frontend.spec.ts`

### 2.2 浏览器存档启动 helper

- **文件**：`win/shim/winshim.c`
- **引入提交**：
  `be7b8d035 feat: add browser save continuation`
- **目的**：增加设置玩家名、要求只能恢复已有存档和读取存档 fingerprint 的
  三个窄接口。接口只在启动前使用，不允许 React 在 Asyncify 等待期间重入
  NetHack。
- **导出函数**：
  - `shim_graphics_set_player_name`
  - `shim_graphics_set_restore_required`
  - `shim_graphics_get_save_fingerprint`
- **行为依据**：
  `doc/BlissHack/shim-interface-reference.md` 第 6.2 节。
- **回归测试**：
  - `frontend/test/integration-tests/wasm-test.mjs`
  - `frontend/src/nethack-bridge.test.ts`
  - `frontend/src/storage/storage-service.test.ts`
  - `frontend/src/session/home-ownership.test.ts`
  - Continue 相关 Playwright 流程

### 2.3 Emscripten 导出列表

- **文件**：`sys/unix/hints/include/cross-pre2.500`
- **引入提交**：
  `be7b8d035 feat: add browser save continuation`
- **目的**：把第 2.2 节的三个 helper 和配对释放内存所需的 `_free` 加入
  `EXPORTED_FUNCTIONS`。
- **行为依据**：
  `doc/BlissHack/shim-interface-reference.md` 第 6.2 节。
- **回归测试**：
  - `frontend/test/integration-tests/wasm-test.mjs`
  - `frontend/src/nethack-bridge.test.ts`

### 2.4 许可证和源码修改标记

- **文件**：`win/shim/winshim.c`
- **引入提交**：
  `18d0818bb docs: mark BlissHack shim modification`
- **目的**：在上游文件头显著记录 BlissHack 修改者、日期和修改范围。
- **验收**：人工检查文件头、本文和 shim 接口参考三处描述一致。

### 2.5 游戏内 Settings 安全边界协议

- **文件**：`win/shim/winshim.c`
- **引入提交**：本阶段提交 `feat: add runtime settings shim protocol`
- **目的**：
  - 在 WASM 输入回调末尾附加 `program_state.input_state`，让前端只在
    `commandInp` 时提供暂停入口。
  - 在 `get_nh_event()` 命令边界交换七项动态配置的版本化 32-bit 快照。
  - 只接受经过位级校验的固定字段，并在当前 C 调用栈内使用
    `parseoptions()` 应用，避免 Asyncify 等待期间从 React 重入 WASM。
  - 使用无交互消息的解析上下文并补做必要刷新，避免批量应用触发
    `--More--`。
- **ABI 范围**：只修改 Emscripten 回调参数；原生 `libnethack.a` ABI
  保持不变。
- **行为依据**：
  `doc/BlissHack/shim-interface-reference.md` 第 6.3 节。
- **回归测试**：
  - `frontend/src/settings/runtime-settings-protocol.test.ts`
  - `frontend/src/nethack-bridge.test.ts`
  - `frontend/test/integration-tests/wasm-test.mjs`
  - Settings 与暂停相关 Playwright 流程

### 2.6 永久背包能力与运行时配置

- **文件**：`win/shim/winshim.c`
- **引入提交**：阶段五提交 `feat: add permanent inventory panel`
- **目的**：
  - 只在 Emscripten shim window capability 中声明 `WC_PERM_INVENT`。
  - 把 `perm_invent` 和 `perminv_mode` 加入 32-bit Settings 协议版本 2。
  - 在命令边界通过 `parseoptions()` 应用选项，并以 `update_inventory()`
    触发开启和模式变化后的同步重填。
  - 保留 `shim_update_inventory()` 直接调用 `repopulate_perminvent()` 的
    Asyncify 非重入路径。
- **源码范围**：不修改 `src/options.c`、`src/invent.c` 或 raw save 格式。
- **行为依据**：
  `doc/BlissHack/shim-interface-reference.md` 第 2.15 节和
  `doc/BlissHack/plans/in-prealpha-3/permanent-inventory.md`。
- **回归测试**：
  - `frontend/src/settings/runtime-settings-protocol.test.ts`
  - `frontend/src/game-state.test.ts`
  - `frontend/src/nethack-bridge.test.ts`
  - `frontend/test/integration-tests/wasm-test.mjs`

### 2.7 WASM 官方 tile index

- **文件**：
  - `sys/libnh/libnhmain.c`
  - `sys/unix/hints/include/cross-pre2.500`
  - `sys/unix/hints/include/cross-post.500`
- **引入提交**：alpha-1 阶段二提交 `build: enable authoritative WASM tile mapping`
- **目的**：
  - 只在 WASM 构建中启用 `TILES_IN_GLYPHMAP`。
  - 使用 host `tilemap` 生成 `src/tile.c`。
  - 使用 Emscripten 编译 target `tile.o` 并链接到最终 WASM。
  - 让 `glyph_info.gm.tileidx` 与仓库内官方 atlas 使用同一映射。
  - 暴露 `GLYPH_INFO_SIZE`，供集成测试校验 WASM32 ABI。
- **ABI 范围**：不改变 `glyph_info` 的 WASM32 36-byte 布局；此前保留的
  16-bit `tileidx` 字段现在包含权威索引。
- **行为依据**：
  `doc/BlissHack/plans/alpha-1.md` 第 6 节。
- **回归测试**：
  - `frontend/scripts/build-wasm-toolchain.test.mjs`
  - `frontend/test/integration-tests/wasm-test.mjs`

### 2.8 图形化状态数据补全

- **文件**：
  - `src/exper.c`
  - `win/shim/winshim.c`
- **引入提交**：alpha-2.0 阶段三提交
  `feat: add graphical character status HUD`
- **目的**：
  - 把 `shim_procs` 的 status enablefield 槽位从
    `genl_status_enablefield` 改为 `shim_status_enablefield`。
  - wrapper 先调用 `genl_status_enablefield()`，保留通用状态缓存，再通过
    既有 `"vippb"` shim ABI 转发字段名、格式和动态启停状态。
  - 让 React 状态语义层无需解析显示文本即可隐藏已停用字段。
  - `shim_status_update` wrapper 使用核心当前 HP、Energy 和经验值补齐资源
    百分比，避免前端从格式化文本反推；其余字段保持核心传入值。
  - 满级没有下一等级进度区间，wrapper 以 `-1` 标记 XP 百分比不可用，使
    React 保留等级数值但不显示误导性的 0% 进度条。
  - 在等级不变但经验变化时，wrapper 会在 `BL_RESET` 或 `BL_FLUSH` 前补发
    缓存的 `BL_XP` 显示值和当前百分比；动态禁用 XP 字段时同步丢弃缓存。
  - `showexp=false` 时，`src/exper.c` 仅为 shim 窗口端口请求一次
    `BL_RESET` 状态周期，保证经验变化仍能送达图形 XP 进度条。
- **ABI 范围**：不新增 callback 或导出函数；只恢复已经声明但上游未注册的
  callback 路径。
- **行为依据**：
  `doc/BlissHack/shim-interface-reference.md` 第 2.10 节和第 6.4 节。
- **回归测试**：
  - `frontend/src/game-state.test.ts`
  - `frontend/src/nethack-bridge.test.ts`
  - `frontend/test/integration-tests/wasm-test.mjs`

### 2.9 浏览器 command intent 与右键菜单坐标

- **文件**：
  - `src/cmd.c`
  - `src/do.c`
  - `win/shim/winshim.c`
- **引入提交**：alpha-2.0 阶段五提交
  `feat: add core-driven context action menus`
- **目的**：
  - 在 `shim_get_nh_event()` 的安全命令边界消费一个版本化 32-bit command
    intent，按 `extcmdlist` 中的固定名称把 `clicklook`、`inventory` 或
    `drop` 排入核心命令队列。
  - 用独立 result callback 确认原始 payload 是否通过版本、未知位、坐标和
    command allowlist 校验。
  - 浏览器 drop intent 先排入原生 `do_reqmenu` 前缀，再执行声明
    `CMD_M_PREFIX` 的 `drop`；`dodrop()` 在该前缀存在时临时启用并随后恢复
    `force_invmenu`，使 `getobj()` 直接提供可验证的 `PICK_ONE` 菜单，而不
    由前端盲发字符提示响应。
  - 保留 `therecmdmenu` 预置地图坐标对应的真实鼠标 modifier，使右键菜单只
    使用核心为 secondary click 提供的动作。
  - 在 `doclicklook()` 消费后清除预置坐标，避免后续键盘命令复用旧目标。
- **ABI 范围**：不导出新的 C 函数，不暴露对象指针；仅在 Emscripten
  `shim_get_nh_event()` 中增加 `shim_command_sync` 和
  `shim_command_result` 私有回调。原生 `libnethack.a` ABI 保持不变。
- **行为依据**：
  `doc/BlissHack/shim-interface-reference.md` 第 6.5 节。
- **回归测试**：
  - `frontend/src/game-actions/core-command-protocol.test.ts`
  - `frontend/src/nethack-bridge.test.ts`
  - `frontend/test/integration-tests/wasm-test.mjs`
  - `frontend/test/integration-tests/browser/context-actions.spec.ts`

## 3. 上游合并检查

每次从 `upstream/NetHack-5.0` 合并后必须：

1. 重新运行第 1 节的比较命令，确认没有本地修改被静默丢失。
2. 检查 `shim_player_selection()`、`genl_player_setup()`、存档 header 生成和
   `EXPORTED_FUNCTIONS` 的调用链。
3. 确认每个修改过的上游 C 文件仍保留 BlissHack 许可证标记。
4. 使用 `.emscripten-version` 指定的工具链运行 `npm run build:wasm`。
5. 一起更新并审核 `nethack.js`、`nethack.wasm` 和
   `nethack-runtime.json`。
6. 运行 WASM 集成测试、Chromium 浏览器测试和受影响的专项测试。

新增上游修改时，必须在同一阶段补充文件、目的、提交、调用链依据和测试，
不得只在提交信息中记录。

# BlissHack TODO

## 为 WASM shim 补充永久背包支持

**状态：暂缓，非当前优先事项。**

### 背景

NetHack 的普通背包是阻塞式菜单；可选的 `perm_invent` 功能则会把背包
持续显示在侧边，并在物品状态变化后主动刷新。

当前 `shim_graphics` 对该功能只有部分支持：

- `shim_start_menu` 能传递 `MENU_BEHAVE_PERMINV`。
- `shim_update_inventory()` 包含永久背包更新逻辑。
- `shim_procs.wincap` 没有声明 `WC_PERM_INVENT`，所以核心不会正常启用
  `perm_invent`。
- Emscripten 版本的 `shim_ctrl_nhwindow()` 始终返回 `NULL`，无法向核心
  提供 `maxslot` 等窗口信息。

BlissHack 前端已经能够识别 `MENU_BEHAVE_PERMINV`，并确保这类更新不会
打开普通菜单或阻塞 Asyncify；但 React 暂未渲染永久背包侧栏。

### 不采用的临时绕过

- 不在 React 中自动注入 `i` 命令来反复读取普通背包。
- 不直接遍历 NetHack WASM 内存中的 `gi.invent` 链表。
- 不在 Asyncify 等待输入时调用导出的 `_repopulate_perminvent`，避免
  WASM 重入和调用栈损坏。

### Upstream 工作

1. 向 `NetHack/NetHack` 提交 issue，先确认永久背包是否属于官方
   `shim_graphics` 的预期能力。
2. 与维护者确认 capability 应由编译选项决定，还是由 shim consumer
   在运行时声明。
3. 设计 Emscripten 下的 `shim_ctrl_nhwindow` 请求和返回值 ABI，处理
   `set_mode`、`request_settings` 及 `win_request_info`。
4. 在设计得到认可后提交一个范围独立、带测试的 upstream PR。
5. PR 不包含 BlissHack 的 React UI，只补充通用 shim 能力。

建议的 issue 标题：

```text
WASM shim_graphics cannot support persistent inventory
```

### BlissHack 后续工作

1. 在 upstream 接口确定后更新 WASM 构建。
2. 使用已有的 `inventoryWindowId` 和 `WindowState.menuItems` 渲染
   非 modal 的固定背包区域。
3. 保持玩家按 `i` 打开的普通背包为阻塞式菜单。
4. 覆盖启动、空背包、拾取、丢弃、穿戴、鉴定、存档恢复和关闭
   `perm_invent` 等测试场景。
5. 验证连续背包更新不会产生 Asyncify 重入或额外消耗游戏回合。

### 验收标准

- 核心能够正常启用 `perm_invent`。
- 背包变化后侧栏自动更新，不需要模拟键盘命令。
- 永久背包更新不会打开 modal，也不会暂停游戏循环。
- 普通背包和物品选择菜单的行为不受影响。
- 原生和 WASM shim consumer 的兼容性经过验证。

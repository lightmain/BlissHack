# BlissHack TODO

## 将永久背包 shim 改动贡献给上游

**状态：可选的上游工作，不阻塞 BlissHack。**

### 当前实现

BlissHack 已在 prealpha-3 完成永久背包：

- Emscripten shim 声明 `WC_PERM_INVENT`。
- 核心通过 `MENU_BEHAVE_PERMINV` 发送完整背包菜单。
- React 渲染非 modal 的永久背包，并支持位置、折叠和内容模式设置。
- 开关与模式通过命令边界的 Settings 协议更新，不从 Asyncify 等待状态重入
  WASM。
- 自动测试覆盖启动、物品变化、普通背包并存、保存继续和跨 session 清理。

Emscripten 的 `shim_ctrl_nhwindow()` 仍返回 `NULL`。当前实现不依赖该接口：
核心使用默认非 tty 行为，侧栏尺寸、位置和响应式布局由 React 管理。

详细实现和限制见：

- `doc/BlissHack/plans/in-prealpha-3/permanent-inventory.md`
- `doc/BlissHack/shim-interface-reference.md`
- `doc/BlissHack/upstream-modifications.md`

### 后续上游工作

1. 向 NetHack 上游确认 `shim_graphics` 是否应提供永久背包能力，以及 capability
   应由构建目标还是 shim consumer 声明。
2. 将 `WC_PERM_INVENT` 支持整理为不包含 BlissHack React UI 和 Settings
   协议的独立改动。
3. 只有通用 shim consumer 确实需要 `maxslot`、滚动或聚焦信息时，才单独设计
   Emscripten `shim_ctrl_nhwindow()` 的请求和返回值 ABI。
4. 为原生与 Emscripten shim consumer 补充独立回归测试后再提交上游 PR。
5. 上游接受相关实现后，重新核对并尽量删除 BlissHack 对应的本地 C diff。

### 保持不变的边界

- 不通过模拟 `i` 命令轮询背包。
- 不直接遍历 WASM 中的 `gi.invent` 链表。
- 不在 Asyncify 等待输入时调用 `_repopulate_perminvent`。
- 永久背包物品动作需要独立设计 action intent、命令边界和过期 revision
  处理，不作为上游 capability 工作的一部分。

# BlissHack alpha-2.5 桌面版人工测试

## 1. 预览产物

本版本预览产物只保存在本地 `frontend/out/make/`，不得上传 GitHub：

- macOS Apple Silicon：
  `BlissHack-alpha-2.5-darwin-arm64.dmg`
- macOS Apple Silicon ZIP：
  `zip/darwin/arm64/BlissHack-darwin-arm64-0.2.5-alpha.0.zip`
- Windows x64 ZIP：
  `zip/win32/x64/BlissHack-win32-x64-0.2.5-alpha.0.zip`

macOS 预览包使用 ad-hoc 签名，已经通过本地深度验签，但没有 Developer ID
notarization。Windows 预览包没有 Authenticode 签名，也不是安装器。正式发布前
仍需分别在真实 Windows x64 和 macOS 签名环境执行发布验收。

## 2. 安装与启动

### macOS arm64

1. 打开 DMG，把 `BlissHack.app` 拖到 `Applications`。
2. 首次启动若 Gatekeeper 提示未验证开发者，右键应用选择 `Open`，或在
   `System Settings > Privacy & Security` 选择 `Open Anyway`。
3. 确认 Home 显示 `alpha-2.5` 和 `NetHack 5.0`。

### Windows x64

1. 把整个 ZIP 解压到一个新目录，不要只复制 `BlissHack.exe`。
2. 运行 `BlissHack.exe`。若 SmartScreen 提示未知发布者，选择
   `More info > Run anyway`。
3. 确认 Home 显示 `alpha-2.5` 和 `NetHack 5.0`。

## 3. 必测流程

### A. 离线和单实例

1. 断开网络后启动，确认 Home、Tiles、Settings 和游戏均能打开。
2. 应用运行时再次启动同一程序，确认只聚焦原窗口，不出现第二个游戏窗口。
3. 点击 License 和 Examine 中的外链，确认使用系统浏览器打开，桌面窗口不
   导航离开 BlissHack。

### B. 关闭与存档

1. 新建角色并进入地图，在主命令状态关闭窗口。
2. 选择 `Cancel`，确认窗口保留、游戏仍可继续且没有消耗回合。
3. 打开一个核心菜单或输入提示后关闭窗口，确认 `Save and Exit` 不可用；取消
   关闭，完成或取消核心提示。
4. 回到主命令状态再次关闭，选择 `Save and Exit`。
5. 等待窗口自行关闭，不要强制结束进程。
6. 重新启动，打开 Continue，确认角色、地图位置、背包和状态恢复。
7. 再次关闭并选择 `Exit Without Saving`，确认已有存档仍存在，但本次未保存
   进度没有被伪装成已保存。
8. macOS 另测 `Cmd+Q`，Windows 另测 `Alt+F4`。

### C. 原生文件导出

以下操作都应打开系统 Save 对话框；取消对话框不应显示成功，也不应覆盖原文件：

1. Home 导出 Diagnostic Log。
2. Continue 列表导出原始存档。
3. Settings 导出 Profile。
4. Settings 导出 Full Backup。
5. All Actions 导出 Action Bar Layout。
6. 对同名现有文件执行覆盖，确认写入成功后文件完整，失败时旧文件不被截断。
7. 把 Profile、Full Backup、原始存档和 Action Bar Layout 重新导入，确认数据
   与导出前一致。

### D. 窗口、输入和显示

1. 验证 Tiles 和 ASCII renderer。
2. 验证永久背包 Right 和 Below 布局。
3. 缩放到最小窗口、最大化、全屏，再恢复，确认地图、动作栏和弹窗不重叠。
4. Windows 验证 `Alt` 仍作为 NetHack Meta 输入，不会激活应用菜单。
5. macOS 验证复制、粘贴、隐藏和窗口系统菜单，不应抢占普通游戏输入。
6. 在高 DPI 显示器检查图块、文字和应用图标。

### E. 持久性与清理

1. 保存后完全退出应用并重新启动，确认存档仍存在。
2. 重启操作系统后再次确认。
3. Settings 执行 Clear Local Data，确认只清理 BlissHack 数据。
4. 卸载或删除应用后确认用户数据是否保留，并记录实际平台行为。

## 4. 产物检查

- macOS：DMG 可以挂载，`.app` 可以复制，About 显示 alpha-2.5。
- Windows：ZIP 必须完整解压，`BlissHack.exe` 能启动。
- 包内应存在 `license` 和 `THIRD_PARTY_NOTICES.md`。
- 任务管理器或 Activity Monitor 中 renderer 不应拥有 Node.js `require`。
- 正常操作不应出现 fatal screen、空白窗口或未处理错误。

## 5. 反馈格式

记录以下信息：

- 操作系统版本和 CPU 架构。
- 使用的产物文件名。
- 是否全新安装，是否从网页备份导入。
- 最短复现步骤。
- 实际结果、预期结果和截图。
- 若出现 fatal screen，附上导出的 Diagnostic Log 和 Error ID。

用户确认 Windows 与 macOS 人工结果前，不更新 release manifest 为 accepted，也不
上传或发布这些预览产物。

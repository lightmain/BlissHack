# BlissHack Raw Save 导入导出设计

本文记录 prealpha-2 阶段三的第一版导入导出决策。当前范围只处理
BlissHack WASM 构建所使用的 NetHack historical binary save，不增加
BlissHack 外层容器，也不集成 `sfctool` portable format。

## 1. 格式与兼容性

- 导出文件内容必须与 IDBFS 中 `/save/0<角色名>` 的 bytes 完全一致。
- 导入成功后写入 IDBFS 的也必须是相同的原始 bytes，不转换为 JSON、ZIP
  或其他格式。
- MIME type 使用 `application/octet-stream`。MIME type 和下载文件名只用于
  浏览器交互，不能作为格式或安全校验依据。
- 下载文件名使用 `<角色名>.nhsave`。导入时忽略用户提供的文件名，目标路径
  始终从 save 内部身份块派生为 `/save/0<角色名>`。
- 当前只保证与本 BlissHack WASM save fingerprint 完全匹配的 historical
  save 可导入。桌面 NetHack save 只有版本、feature、实体数量、数据模型和
  结构布局都兼容时才能导入。
- 本阶段不实现 BlissHack manifest、checksum、数字签名、压缩、sfctool
  转换或跨 ABI 迁移。

## 2. 可读取元数据

NetHack save header 后的固定 `PL_NSIZ_PLUS` 身份块包含：

```text
playerName NUL role-race-gender-alignment ... playmode
```

列表和导入预检从该块读取：

- 角色名；
- role 的 3 字符 filecode；
- race 的 3 字符 filecode；
- gender 的 3 字符 filecode；
- alignment 的 3 字符 filecode。

这些字段必须来自 raw save，不信任上传文件名。当前 fingerprint、身份块长度
和字段结构必须全部有效；最终 Continue 仍由 NetHack `validate()` 完整校验。

Historical save 不包含可直接作为“保存时间”的 wall-clock timestamp。
界面中的保存时间定义为文件修改时间：

- 已有存档使用 Emscripten `FS.stat(path).mtime`；
- 待导入存档使用浏览器 `File.lastModified`；
- 时间缺失或无效时明确显示 Unknown，不伪造时间；
- 外部文件时间由用户文件系统提供，只用于冲突比较，不参与兼容性判断。

## 3. 大小和输入限制

- 每次只选择并导入一个本地文件。
- 文件选择器不使用扩展名过滤，避免隐藏没有扩展名或使用平台特定扩展名的
  原版 NetHack save。
- 空文件和超过 64 MiB 的文件在读取前拒绝。
- 不接受远程 URL、目录、多个文件或拖放导入。
- 玩家名继续受 NetHack `PL_NSIZ` 和 `/save/0<角色名>` 直接路径规则限制。

## 4. 首页与 Popover

- 导入和导出只在 Home、且没有活动 session 时可用。
- Continue 在持久存储可用时始终可以打开存档 popover；没有存档时显示空列表
  和 Import 按钮，而不是禁用整个入口。
- Import 按钮位于 popover 列表上方，点击后打开浏览器单文件选择器。
- 每个存档右侧依次显示 Export 和 Delete 图标按钮。
- invalid 列表项允许删除，但不允许 Continue 或 Export。
- 导出读取当前已枚举的 ready save，创建
  `application/octet-stream` Blob，并立即触发浏览器下载。导出不写入、
  删除、锁定或 flush save。

导入成功后：

1. 重新枚举 `/save`；
2. 在 Import 按钮上方短暂显示 `Import successful`；
3. popover 保持打开，新存档立即出现在列表中；
4. 成功提示自动消失，不改变 Home 生命周期。

普通导入失败时：

1. 显示阻塞式错误对话框；
2. 对话框只有 `OK` 按钮；
3. 点击后关闭对话框和 save popover，返回正常 Home；
4. 正式 save 和列表保持不变。

## 5. 同名冲突

导入身份块中的 player name 决定目标路径。如果该路径已存在，则不立即写入，
而是显示冲突对话框。对话框同时展示 Existing 和 Incoming：

- 文件保存时间；
- role；
- race；
- gender；
- alignment。

操作只有：

- `Cancel`：不修改 FS，关闭冲突对话框，保留 save popover；
- `Overwrite`：执行覆盖事务，成功后重新枚举并显示
  `Import successful`。

冲突判断只按规范化目标路径，不按上传文件名。用户不能把导入文件重命名为
另一个角色，也不能静默覆盖。

## 6. 导入事务

导入事务位于 `frontend/src/storage/storage-transaction.ts`，并复用当前
module-bound storage queue。React screen 不直接操作 Emscripten FS。

无冲突导入：

1. 在正式路径外的内部临时路径写入 bytes；
2. 读回临时文件并确认长度和内容；
3. rename 到正式 `/save/0<角色名>`；
4. 执行 `syncfs(false)`；
5. flush 失败时删除内存中的正式文件并再次 flush 恢复导入前状态。

覆盖导入：

1. 复制旧存档 bytes 作为回滚备份；
2. 写入并验证内部临时文件；
3. rename 临时文件覆盖正式路径；
4. 执行 `syncfs(false)`；
5. 任一步失败时写回旧 bytes、清理临时文件并再次 flush；
6. 只有正式文件可读且 flush 成功才报告成功。

临时路径不得被 `listSaves()` 展示。所有导入、删除、session 启动和 flush
操作必须串行化；事务进行中不能开始 New Game 或 Continue。

## 7. 测试边界

- raw 导出 bytes 与 IDBFS 文件逐字节一致。
- header、fingerprint、身份块、角色 filecode、空文件和超大文件校验。
- 导入文件名与内部角色名不同时，以内部角色名决定目标。
- 无冲突导入成功、flush 失败回滚。
- 同名冲突不写 FS，取消不修改文件。
- 覆盖成功替换旧 bytes；失败后旧文件 hash 不变。
- Import、Export 只出现在 Home save popover。
- 没有本地存档时仍能打开 popover 并导入。
- 冲突对话框展示双方时间及 role/race/gender/alignment。
- 普通失败需要 `OK`，确认后回到正常 Home。
- 成功提示短暂显示，新存档出现在重新枚举后的列表中。
- Playwright 捕获下载并逐字节比较，再删除、上传并 Continue 同一角色。

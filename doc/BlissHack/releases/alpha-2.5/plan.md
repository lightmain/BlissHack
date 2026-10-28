# BlissHack alpha-2.5 Electron 桌面版计划

## 1. 文档状态

本文定义 alpha-2.5 的产品范围、桌面安全边界、存档与退出契约、构建发布方式、
实施阶段和验收门禁。当前状态为实施中，完成自动验证、独立复审和用户人工验收
前不得标记为 accepted。

alpha-2.5 继续以 React、TypeScript façade、Emscripten Asyncify 和现有
NetHack WASM 为唯一游戏实现。Electron 只提供受限桌面宿主，不建立第二套游戏
核心、存档格式、UI 状态机或动作协议。

## 2. 版本目标

1. 使用 Electron 为 Windows x64、macOS arm64 和 macOS x64 提供离线桌面版。
2. 保留网页版及现有生产构建；同一套 `frontend/dist` 同时作为网页和桌面
   renderer。
3. 通过标准、安全、支持 Fetch API 的本地协议加载经过现有 manifest 校验的
   `nethack.js`、`nethack.wasm`、Tiles 和 Encyclopedia 资源，不使用
   `file://`，不关闭同源或 Web 安全检查。
4. 保持 renderer 的 Node integration 关闭、context isolation 与 Chromium
   sandbox 开启，只通过有界 preload API 暴露必要桌面能力。
5. 桌面应用保持单实例，避免多个进程同时操作同一 IndexedDB/IDBFS 数据。
6. 拦截窗口关闭、macOS Quit 和更新重启等退出请求；活动游戏必须由玩家选择
   保存退出、放弃未保存进度或取消，保存路径必须等待核心正常退出和 IDBFS
   flush 后才销毁窗口。
7. 备份、原始存档、Profile、动作栏布局和诊断日志使用原生 Save 对话框导出；
   浏览器继续使用现有下载行为。
8. Windows 不安装会抢占 NetHack Alt/Meta 输入的默认菜单；macOS 只保留必要
   系统菜单和标准 Command 操作。
9. 提供本地打包命令、桌面冒烟测试和人工验收说明；本版本实施期间不上传 GitHub
   Releases，也不启用自动更新。

## 3. 非目标

- 不支持 Linux、Microsoft Store 或 Mac App Store。
- 不把 WASM 改为原生 Win32、Cocoa 或 Node addon。
- 不把 IDBFS 迁移到 Node 或操作系统文件系统。
- 不实现云存档、Steam、成就、系统托盘、开机启动或自动更新。
- 不在本版本购买、生成或提交 Windows/macOS 生产签名凭据。
- 不保证 macOS Universal 单文件；arm64 与 x64 可分别分发。
- 不自动迁移浏览器 origin 中的 IndexedDB。玩家通过现有完整备份导入桌面版。

## 4. 架构边界

```text
Electron main
  ├─ BrowserWindow 生命周期、单实例、菜单、CSP
  ├─ blisshack://app/ 只读资源协议
  └─ 有界 IPC：关闭握手、原生 Save 对话框
          ↓ contextBridge
React renderer（与网页版共用）
          ↓ 现有 façade / Asyncify
NetHack WASM + IDBFS
```

- `electron/` 拥有桌面主进程、preload、协议和打包配置。
- `frontend/src/desktop/` 拥有可注入的平台适配器。普通 React 组件不得直接
  import `electron`。
- `session-lifecycle.ts` 继续拥有模块、活动 session 和最终 flush。Electron
  不直接读写 Emscripten FS。
- `storage-service.ts` 继续拥有存档、Ranking 和 IDBFS；应用名称、bundle id、
  协议 origin 与持久 session partition 发布后保持稳定。

## 5. 安全契约

- 只加载 checked-in 本地资源；禁止 renderer 导航到远程页面或创建任意窗口。
- `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`、
  `webSecurity=true`。
- CSP 默认拒绝资源，只允许当前应用所需的同源资源、现有 Blob loader、内联
  样式和本地图像。
- preload 只暴露版本化、可撤销监听的关闭事件，以及限制文件名和最大字节数的
 保存操作。IPC 主进程校验 sender、字段、大小和目标路径。
- 打包启用 ASAR，并关闭 Electron `RunAsNode`、Node CLI inspect 和
  `NODE_OPTIONS`；只从 ASAR 加载应用。
- 协议处理必须拒绝非 `GET`/`HEAD`、错误 host、路径穿越、编码绕过和不存在的
 资源。

## 6. 退出与存档契约

1. Home、启动页、终局页或非活动 session 可以直接确认退出。
2. 活动 session 收到关闭请求时显示项目自有确认窗口，不使用不受测试控制的
   `window.confirm()`。
3. `Save and Exit` 只在核心主命令边界且运行时设置没有 pending 更新时可执行。
4. 保存后等待现有 session 状态离开活动 session；只有核心退出 callback、
   storage flush 和 session 清理全部完成，renderer 才向 main 确认关闭。
5. `Exit Without Saving` 明确放弃当前内存进度，但不删除已有持久存档。
6. `Cancel` 必须恢复游戏且不向核心发送输入。
7. renderer crash、IPC 错误和保存失败不得伪报安全保存；窗口保持打开或进入现有
   fatal workflow。

## 7. 打包和产物

- Electron 与 Electron Forge 使用固定版本并进入 `package-lock.json`。
- macOS 当前开发机生成 arm64 `.app`、`.zip` 和本地预览安装介质；x64 配置由
  CI/目标机器验证。
- Windows x64 至少生成可解压运行的本地包；正式安装器在 Windows runner
  验证。若当前 macOS 缺少 Wine/Mono，不以未验证的跨平台 installer 冒充通过。
- 所有本地产物位于 ignored 输出目录，不提交 Git，不上传 GitHub。
- 包中包含 NetHack License、BlissHack 上游声明和源码获取信息。

## 8. 实施阶段

### 阶段一：运行壳与协议

- 先建立协议路径、请求方法、host、资源边界、BrowserWindow 安全选项和
  preload 暴露面的自动测试。
- 实现 Electron main、preload、单实例、菜单和 CSP。
- 运行现有 Web 生产构建，证明网页版没有回归。

### 阶段二：退出和原生导出

- 先为关闭请求状态、保存完成握手、取消、放弃进度和文件请求校验建立测试。
- 接入现有 `requestSaveAndExit()` 与 session 生命周期。
- 抽取跨平台文件导出 adapter；桌面使用原生 Save 对话框，Web 保留 Blob
  download。

### 阶段三：打包与桌面测试

- 生成项目图标和 Forge 配置。
- 增加 Electron 冒烟测试，覆盖安全配置、本地协议、WASM 首页、IndexedDB、
  preload API 和关闭请求。
- 在本机生成 macOS arm64 预览包和能够生成的 Windows x64 本地包，不上传。

### 阶段四：复审与人工验收

- 子 Agent 独立检查安全边界、存档退出竞态、文件写入和打包内容。
- 修复 findings 后执行完整单元、lint、生产构建、WASM、浏览器与桌面测试。
- 提供逐步人工测试清单，等待用户检查本地产物；用户确认前不创建发布验收记录。

## 9. 自动验收门禁

- `npm test`
- `npm run lint`
- `npm run build`
- `npm run test:integration:wasm`
- `npm run test:integration:browser`
- 新增的桌面单元测试和 Electron 冒烟测试
- macOS arm64 本地 package/make 成功并能启动
- Windows x64 package 结构生成成功；安装器只在 Windows 环境宣称通过
- `npm run docs:check`
- `git diff --check`

## 10. 人工验收门禁

1. 桌面应用离线启动并到达 Home。
2. 新建游戏，完成至少一个回合，通过窗口关闭选择 Save and Exit。
3. 重启桌面应用，继续该存档并验证地图、状态、背包和 Ranking。
4. 分别验证取消关闭和不保存退出。
5. 导出并重新导入完整备份、原始存档、Profile、动作栏布局和诊断日志。
6. 验证 Windows Alt/Meta 与 macOS Command 系统快捷键边界。
7. 验证 Tiles/ASCII、Right/Below、窗口缩放、全屏和高 DPI。
8. 检查 About/发行包中的版本、许可证和源码地址。
9. macOS 检查 arm64 包启动；Windows x64 包在真实 Windows 10/11 检查。

用户完成人工检查并明确批准后，才补充
`doc/BlissHack/releases/alpha-2.5/release-acceptance.md`、更新 manifest 状态并
提交发布验收。

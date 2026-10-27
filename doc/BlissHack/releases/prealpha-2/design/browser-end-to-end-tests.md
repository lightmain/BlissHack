# BlissHack 阶段六：浏览器端到端测试设计

本文定义 prealpha-2 阶段六的浏览器端到端测试。本文所说的“浏览器端到端测试”
表示 Playwright 启动真实 Chromium，打开 Vite 提供的生产构建，并通过玩家可见
的按钮、输入框、键盘操作、文件上传和文件下载完成测试。Playwright 是当前项目
使用的浏览器自动化工具；Chromium 是 Chrome 所基于的开源浏览器内核。

阶段六不会建立第二套游戏控制接口。测试通过正式界面启动 NetHack，使用正式
IDBFS 存储，读取正式诊断日志，并等待正式应用状态变化。只有测试证据收集会
直接读取浏览器本地存储，该读取不会修改应用状态。

## 1. 当前基础和阶段目标

阶段四已经加入 4 条长流程测试，阶段五完成后普通浏览器套件已有 11 条测试，
覆盖新游戏、键盘输入、保存、继续、删除、导出、导入、同名冲突、无效文件、
game module 更换和诊断日志导出。阶段六保留这些覆盖，将普通浏览器套件整理为
5 个按玩家工作流划分的文件，并补充以下缺口：

1. 玩家开始游戏之前，NetHack 的 `main()` 没有运行。
2. 保存并继续后，角色身份和地图位置来自旧游戏。
3. 活动游戏可以通过 NetHack 的 `#quit` 命令正常退出，随后可以开始第二局。
4. raw save 导入前后的文件字节完全相同。
5. 截断文件被拒绝后，原存档字节保持不变。
6. `nethack.js` 返回 404 时显示致命错误页。
7. 浏览器没有 IndexedDB 时显示存储不可用状态，并允许开始临时游戏。
8. Playwright 测试失败时自动附加浏览器本地诊断日志。

完成后，普通浏览器套件包含 15 条测试，长流程套件包含 4 条测试。

## 2. 统一术语

“浏览器上下文”表示 Playwright 创建的一套相互隔离的 Cookie、IndexedDB、
浏览器本地存储和缓存。每条普通测试默认获得独立浏览器上下文，因此不同测试的
存档不会互相影响。

“页面刷新”表示在同一个浏览器上下文中重新加载当前网页。页面刷新会重新创建
JavaScript 和 WebAssembly 状态，但保留该浏览器上下文中的 IndexedDB。存档
持久化测试使用页面刷新。新的浏览器上下文具有独立 IndexedDB，不能用来读取
前一个浏览器上下文的存档。

“测试 artifact”表示测试失败后由 Playwright 保存的证据文件。当前证据包括
截图、执行跟踪、错误上下文和浏览器本地诊断日志。执行跟踪记录测试期间的页面
状态、网络请求和操作步骤。

“生产构建”表示 `npm run build` 生成的静态文件。浏览器测试使用 Vite preview
提供生产构建，不使用带有热更新功能的开发服务器。

## 3. 测试环境

普通测试使用 `frontend/playwright.config.ts`，端口为 4174，视口为
1280×900。长流程测试使用 `frontend/playwright.long.config.ts`，端口为
4175。两个配置都使用 `/BlissHack/` 部署路径、单个执行进程、失败截图和失败
执行跟踪。

Chromium 是 prealpha-2 的强制浏览器。Firefox 和 WebKit 可以在后续版本加入，
阶段六不为了多浏览器支持扩大当前工作量。

普通测试在每次 GitHub push 和 pull request 中运行。长流程测试继续由
`workflow_dispatch` 手动启动，因为长流程会重复创建、保存、继续和传输游戏，
执行时间明显长于普通测试。

## 4. 测试文件

`home-and-new-game.spec.ts` 验证初始 Home、空存档列表、开始前没有游戏会话、
角色创建、终端绘制、键盘操作和已有角色名提示。

`save-and-continue.spec.ts` 验证保存返回、页面刷新后扫描存档、存档身份显示，
以及继续游戏后角色身份和地图位置恢复。

`normal-exit.spec.ts` 验证活动游戏使用 `#quit` 退出，并验证退出后的第二局使用
新的游戏会话 ID 和 game module ID。

`save-transfer.spec.ts` 验证删除、raw save 导出、导入、逐字节一致、同名冲突、
无效文件和截断文件保护。

`fatal-paths.spec.ts` 验证未处理 Promise 拒绝、`nethack.js` 404 和 IndexedDB
不可用。

`browser-long/long-flow.spec.ts` 保留阶段四的 10 次游戏会话循环、10 次继续与
保存、5 次导出删除导入和 5 次重复扫描。

## 5. 公共测试辅助函数

`helpers/game-flow.ts` 负责打开 Home、开始新游戏、保存并返回、继续存档、
读取地图位置、移动到相邻地板和通过 `#quit` 正常退出。辅助函数只组合正式界面
操作，不直接调用 session manager 或 NetHack bridge。

`helpers/save-flow.ts` 负责打开存档列表、读取浏览器下载、导出存档、确认删除和
上传存档。普通测试和长流程测试共用这些操作，避免两处形成不同的存档操作步骤。

`helpers/browser-errors.ts` 收集 Console error 和 pageerror。正常测试在结束前
断言两个集合都为空。故意触发致命错误的测试单独声明预期错误。

`helpers/diagnostic-artifact.ts` 有两个职责。第一，通过正式
`Export Diagnostic Log` 按钮下载并解析诊断 JSON。第二，在测试失败时只读
`blisshack.diagnostics.v1`，把其中内容附加到测试结果。

`fixtures.ts` 为所有普通浏览器测试安装自动失败诊断收集。长流程测试也使用同一
fixture。fixture 不注入生产对象，不改变浏览器存储，也不绕过玩家界面执行游戏
命令。

## 6. 初始状态和新游戏

新浏览器上下文准备完成后，Home 应显示 `New Game`、`Continue` 和禁用的
`Settings`。`Continue` 保持可用，因为空存档列表仍然包含 raw save 导入入口；
打开后应显示 `No saved games`。

测试在开始游戏前通过 Home 的诊断导出按钮读取日志，并确认不存在
`wasm.main_started` 和 `session.created`。玩家完成一局并保存返回后，诊断日志
应恰好包含一个 `wasm.main_started` 和一个 `session.created`。

完整新游戏测试通过名字输入、随机角色确认、角色确认、介绍文本和教程选择进入
地图。测试验证角色状态、80×21 地图、生命值显示、消息历史、调整命令、位置
输入和普通移动。

角色选择阶段输入 `q` 的测试继续保留。该测试验证尚未进入地图时的 NetHack
正常退出路径。

## 7. 保存和继续

测试开始一局游戏，移动到相邻地板并记录地图光标的横坐标和纵坐标，然后使用
NetHack 的保存命令。测试等待 Home 出现；Home 只有在 NetHack 退出、存储同步
完成和新 game module 准备完成后才会显示，因此这个界面条件同时验证了保存
流程的完成顺序。

测试在同一个浏览器上下文中刷新页面，打开存档列表并继续游戏。继续后应显示
原角色身份，不出现名字输入或角色创建问题，并且地图光标坐标与保存前一致。

存储同步队列、重复保存事件和存储同步失败仍由 storage service 与 session
manager 单元测试验证。浏览器测试不增加控制 `FS.syncfs` 的生产故障注入接口。

## 8. 活动游戏正常退出

测试进入地图后发送 `#`，在正式扩展命令窗口选择 `quit`，确认
`Really quit without saving?`，处理 NetHack 自己产生的公开信息询问、文本窗口
和 `--More--`，最后等待 Home 出现。

测试随后开始第二局并正常保存返回，再通过正式诊断导出读取
`session.created` 和 `module.loading`。两条游戏会话记录必须具有不同的游戏
会话 ID，所有 game module 加载记录也必须具有不同的 game module ID。

该测试不通过刷新页面结束第一局，也不读取 session manager 内部对象。

## 9. raw save 传输和失败保护

成功传输测试保存一局，使用正式按钮导出 raw save，删除浏览器存档，再通过正式
文件输入上传刚导出的文件。导入完成后立即再次导出，两次文件的全部字节必须
相同。页面刷新后必须仍然可以继续该存档。

同名存档测试继续验证冲突窗口中的 Existing 和 Incoming 信息、Cancel 和
Overwrite。删除测试继续验证两次确认以及刷新后删除结果保持。

截断文件测试先导出原存档，再上传该文件前三个字节。导入应显示
`Import failed`。关闭错误窗口后重新导出原存档，文件全部字节必须与失败前
相同。

临时文件清理、临时文件写入失败、读回不一致、改名失败和回滚同步失败继续由
storage transaction 单元测试验证。浏览器界面不会暴露 Emscripten 文件系统
内部路径。

## 10. 浏览器失败路径

loader 失败测试使用 Playwright 网络路由让 `nethack.js` 返回 HTTP 404。测试
验证致命错误页、错误编号、`Return Home` 和诊断日志中的
`module.loading_failed`。这个网络路由只存在于测试进程中。

存储不可用测试在页面脚本运行前让测试浏览器不提供 IndexedDB。测试验证 Home
显示存储不可用提示、`Continue` 禁用、`New Game` 可用，并且玩家能够开始临时
游戏。storage service 单元测试继续覆盖 mount 和 populate 回调的具体失败。

未处理 Promise 拒绝测试继续验证游戏会话级致命错误、`Reload Application`、
Console 错误编号、JSON 导出和隐私过滤。

过期回调通过 session manager 单元测试验证。全局回调在游戏会话清理后已经被
删除，浏览器界面没有自然操作能够重新调用旧闭包，因此阶段六不增加测试专用的
全局回调接口。

## 11. 失败证据

Playwright 在普通测试失败时保存截图和执行跟踪。自动 fixture 还读取当前页面
的 `blisshack.diagnostics.v1`，并以
`blisshack-diagnostic-storage` 附件保存。如果页面已经关闭或浏览器拒绝读取
本地存储，fixture 保存读取失败信息，但不会覆盖原始测试失败。

GitHub Actions 上传 `frontend/test-results/playwright`。长流程失败时上传
`frontend/test-results/playwright-long`。两个目录都包含各自的截图、执行跟踪
和诊断附件。

## 12. 实现边界

阶段六不新增以下内容：

- 挂在 `window` 上的 session manager、game module 或文件系统测试接口；
- 生产环境故障注入开关；
- 为浏览器测试伪造合法 raw save；
- 依赖固定随机地图、完整游戏消息或随机角色职业的断言；
- Firefox 和 WebKit 强制门禁；
- 真实存储同步回调失败的浏览器级模拟；
- 跨浏览器上下文共享 IndexedDB 的假设。

阶段六的代码改动集中在 Playwright 测试和测试辅助函数。生产应用行为保持不变。

## 13. 验收命令

阶段六完成时执行：

```bash
cd frontend
npm run lint
npm test
npm run build
npm run test:integration:wasm
npm run test:integration:browser
npm run test:long
```

普通浏览器测试必须 15 条全部通过，长流程测试必须 4 条全部通过。正常流程不得
产生未预期 Console error 或 pageerror；所有测试必须能够独立运行，并且不得
依赖测试文件或测试用例的执行顺序。

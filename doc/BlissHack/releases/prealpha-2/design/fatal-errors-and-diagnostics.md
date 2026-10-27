# BlissHack 阶段五：致命错误和诊断日志设计

本文定义 prealpha-2 阶段五使用的致命错误处理和诊断日志。阶段五的目标是让
BlissHack 在无法安全继续运行时停止当前操作，向玩家显示稳定的错误编号，并
保留一份可以由玩家主动导出的本地诊断记录。阶段五不建立网络监控服务，不上传
玩家数据，也不持续写入玩家选择的本地文件。

## 1. 需要解决的问题

阶段四完成后，BlissHack 已经能够创建和清理 game module，能够隔离过期的游戏
会话，并且在部分模块错误或游戏会话错误发生后进入现有的 fatal 应用状态。
本文把 Emscripten 创建的一套 WebAssembly 实例、内存和文件系统继续称为
“game module”，把从玩家开始一局游戏到该局退出和清理完成的过程继续称为
“游戏会话”。

现有 fatal 应用状态仍有四项不足。第一，错误页只有粗略的错误编号，开发者无法
从错误编号找到错误发生前的运行步骤。第二，页面刷新会删除 JavaScript 内存中
的错误信息。第三，浏览器未处理异常尚未统一进入应用的 fatal 状态。第四，错误
页没有导出诊断信息的操作，玩家只能截取界面或打开浏览器开发工具。

阶段五通过低频诊断事件、浏览器本地存储、精简 Console 输出和 JSON 文件导出
解决这些问题。这里的“Console”表示浏览器开发工具中的控制台；“JSON”表示一种
由键、值、数组和对象组成的文本数据格式。

## 2. 统一术语

本文使用“诊断事件”表示程序在一个重要运行节点写下的一条结构化记录。诊断事件
只描述程序状态和错误类别，不保存玩家在游戏中输入或看到的正文。

本文使用“诊断日志”表示按照发生顺序保存的诊断事件集合。诊断日志最多保存
500 条诊断事件；加入第 501 条诊断事件时，程序删除最早的一条诊断事件。

本文使用“浏览器本地存储”表示浏览器提供的 `localStorage` 键值存储。诊断日志
使用固定键名 `blisshack.diagnostics.v1`。浏览器本地存储允许诊断日志在同一
站点的页面刷新后继续存在。

本文使用“错误编号”表示一次致命错误的短标识，例如 `BH-A7F31C2D`。错误编号
不包含角色名、存档名或错误消息。致命错误页、Console 记录和导出的诊断日志
使用同一个错误编号，从而允许开发者确认三处信息属于同一次错误。

本文使用“构建编号”表示生成当前网页构建的 Git 提交编号。GitHub Actions 构建
使用完整的 Git 提交编号；本地开发构建在没有提供提交编号时使用
`prealpha-2-development`。

本文使用“致命错误”表示应用无法确认当前 game module 或游戏会话仍然满足运行
约束，因此必须停止当前操作的错误。本文使用“可恢复错误”表示某次操作失败后，
应用仍然知道有效状态并允许玩家继续操作。

## 3. 诊断事件格式

每条诊断事件使用以下固定结构：

```ts
interface DiagnosticEvent {
  sequence: number;
  timestamp: string;
  level: "info" | "warning" | "error" | "fatal";
  area: "app" | "session" | "wasm" | "bridge" | "storage" | "browser";
  event: string;
  errorId: string | null;
  moduleId: string | null;
  sessionId: string | null;
  detail?: DiagnosticDetail;
}
```

`sequence` 是从 1 开始递增的顺序号。页面从浏览器本地存储恢复诊断日志后，
下一条诊断事件继续使用已经保存的顺序号，不重新从 1 开始。

`timestamp` 是诊断事件发生时的协调世界时。协调世界时是一套不随用户所在时区
变化的统一时间标准。导出文件使用 ISO 8601 文本格式，例如
`2026-09-04T10:20:30.000Z`。

`level` 表示诊断事件的严重程度。`info` 表示正常的重要节点；`warning` 表示
功能降级或请求被拒绝，但应用仍可继续；`error` 表示一次操作失败，但应用仍然
具有明确的安全状态；`fatal` 表示应用必须停止当前 game module 或游戏会话。

`area` 表示诊断事件所属的代码区域。`app` 表示 React 应用和顶层状态；
`session` 表示游戏会话；`wasm` 表示 game module 和 NetHack 的 `main()`；
`bridge` 表示 NetHack shim 回调与 TypeScript 之间的桥接层；`storage` 表示
浏览器存档；`browser` 表示浏览器报告的未处理异常。

`event` 是稳定的事件名称，例如 `session.created` 或
`browser.unhandled_rejection`。事件名称用于测试和检索，不包含动态文本。

`moduleId` 和 `sessionId` 是应用自己生成的运行标识。两个标识不包含玩家信息。
没有对应 game module 或游戏会话时，字段值为 `null`。

`detail` 只能包含代码明确允许的字段。当前允许的字段包括构建编号、JavaScript
错误类型、shim 回调名称、发生约束错误时等待的输入类型、存档数量、存储是否
可用和经过清理的 JavaScript 调用位置。调用方不能把任意对象直接写入
`detail`。

## 4. 会写入哪些诊断事件

### 4.1 应用和 game module

页面运行后写入 `app.started`。该诊断事件包含构建编号。玩家从模块级致命错误
返回主界面时写入 `app.return_home`。玩家导出诊断日志时写入
`diagnostics.exported`，因此导出的文件也能说明玩家何时执行了导出操作。

开始创建 game module 时写入 `module.loading`，创建完成时写入
`module.loaded`，创建失败时写入 `module.loading_failed`。NetHack 的
`main()` 开始运行时写入 `wasm.main_started`，`main()` 异常结束时写入
`wasm.main_failed`。

例如，网页资源加载正常，但 NetHack 的 `main()` 返回了无法识别的失败结果时，
日志末尾可能依次出现 `module.loaded`、`session.created`、
`wasm.main_started` 和 `wasm.main_failed`。开发者由此可以确认 game module
已经创建，错误发生在游戏会话开始之后。

### 4.2 游戏会话

游戏会话获得 game module 时写入 `session.created`。shim 完成窗口初始化并
允许玩家操作时写入 `session.running`。游戏开始退出时写入
`session.exiting`。全局回调、等待输入和旧 game module 引用完成清理时写入
`session.cleaned`。

致命错误发生后，session manager 先使当前游戏会话失效，删除对应的全局回调，
清除等待输入，然后进入 fatal 应用状态。玩家之后发送的按键、位置输入、文字
输入或菜单选择都不会再传给旧 game module。

### 4.3 浏览器存档

浏览器存储可用并完成存档扫描时写入 `storage.ready`，事件只包含存档数量和
存储是否可用。浏览器不支持 IndexedDB，或者 IDBFS 无法完成初始化时写入
`storage.unavailable` 或 `storage.initialize_failed`。

存档导入成功、发生同名冲突或被校验拒绝时，分别写入
`storage.import_completed`、`storage.import_conflict` 和
`storage.import_rejected`。存档删除和导出也分别记录完成或失败。游戏退出时
完成存储同步会写入 `storage.flush_completed`；存储同步失败并导致游戏状态
无法安全继续时写入 `storage.flush_failed`。

阶段四已经取消持久化事务记录文件和多阶段事务状态机，因此阶段五不记录虚构的
事务步骤。诊断日志只记录当前存储代码确实执行的初始化、导入、导出、删除、
恢复和存储同步结果。

### 4.4 bridge 和浏览器异常

shim 回调抛出错误或破坏等待输入约束时写入 `bridge.callback_failed`。该诊断
事件可以记录回调名称和当时等待的输入类型，但不会记录回调参数、具体按键、
提示文字或游戏消息。

浏览器的全局 `error` 事件写入 `browser.window_error`。浏览器的
`unhandledrejection` 事件表示一个 Promise 失败后没有调用方处理该失败，
该事件写入 `browser.unhandled_rejection`。同一个 JavaScript 错误对象即使
同时经过 React 错误边界和浏览器事件，也只生成一个 fatal 诊断事件和一个错误
编号。

## 5. 明确不记录的内容

诊断日志不记录以下内容：

- 角色名和存档文件路径；
- 完整按键、组合键、命令参数和文字输入；
- 游戏消息、历史消息、菜单文字和询问文字；
- 存档字节、上传文件内容和下载文件内容；
- 每次移动、每个回合和每个地图格更新；
- JavaScript 错误消息正文；
- 浏览器地址中的查询参数和片段；
- 调用方传入但未列入允许字段的任意对象字段。

例如，一个未处理异常的原始错误消息是
`Ada pressed Control+p near a secret door`。诊断日志只保留
`errorName: "Error"` 和经过清理的代码位置，不保留 Ada、Control+p 或
secret door。这个限制意味着诊断日志可能无法解释所有游戏内容相关错误，但能
避免把玩家输入和游戏正文长期保存在浏览器中。

JavaScript 调用位置会删除第一行错误消息，只保留以 `at` 开始的函数和文件
位置，最多保留 10 行，每行和总长度也受到限制。地址中的查询参数和片段会被
删除。

## 6. 保存、容量和失败降级

程序每次写入诊断事件后，把最多 500 条诊断事件和下一个顺序号保存到浏览器
本地存储。这里的数据量很小，写入只发生在低频运行节点；地图绘制、按键输入和
正常游戏回合不会触发诊断日志写入。

程序读取浏览器本地存储时不会信任其中的数据。无法解析的 JSON、错误的格式
版本、错误的字段类型和超长字段会被丢弃或限制。恢复后的诊断事件按照顺序号
排序，并再次限制为最新 500 条。

浏览器本地存储可能因为隐私设置、配额或访问策略而抛出错误。第一次保存失败
后，诊断日志切换为内存模式，并向 Console 输出一次
`diagnostics.persistence_unavailable` warning。之后的诊断事件仍然可以在
当前页面导出，但刷新页面后不会保留。诊断日志不会尝试记录自己的保存失败，
从而避免递归错误。

## 7. Console 输出

`info` 诊断事件不输出到 Console，避免正常启动、保存和退出过程淹没真正需要
关注的错误。`warning`、`error` 和 `fatal` 诊断事件输出一行精简文本。

例如：

```text
[BlissHack][fatal][BH-A7F31C2D] browser.unhandled_rejection
```

Console 文本只包含产品名、严重程度、可选错误编号和稳定事件名称。Console
不输出原始错误消息、角色名、按键、游戏消息、存档路径或存档内容。应用处理
浏览器全局异常后会阻止浏览器再次输出包含原始错误消息的默认 Console 文本。

Console 不能替代诊断日志。Console 内容默认不会跨页面刷新保留，并且玩家通常
不会一直打开浏览器开发工具。Console 的用途是在开发过程中立即发现问题，并
通过错误编号关联导出的诊断日志。

## 8. 如何查看和导出诊断日志

主界面页脚提供 `Export Diagnostic Log`。玩家可以在没有发生致命错误时导出
当前和刷新前保存的诊断事件。

致命错误页也提供 `Export Diagnostic Log`。点击按钮后，浏览器下载
`blisshack-diagnostics.json`。网页只在玩家点击按钮时产生一次普通下载，不会
申请长期文件访问权限，也不会持续写入玩家文件系统。

导出文件使用以下结构：

```ts
interface DiagnosticExport {
  schemaVersion: 1;
  buildId: string;
  exportedAt: string;
  browser: {
    userAgent: string;
  };
  events: DiagnosticEvent[];
}
```

玩家可以使用文本编辑器查看该文件。开发者也可以在浏览器开发工具的
Application 页面中查看 Local Storage 下的 `blisshack.diagnostics.v1`，
但直接查看浏览器本地存储主要用于开发调试；提交问题时应使用导出的 JSON
文件。

## 9. 致命错误和可恢复错误

下列情况属于致命错误：

- game module 加载器或 module factory 失败；
- NetHack 的 `main()` 异常结束；
- shim 回调抛出错误或等待输入约束被破坏；
- 活动游戏会话在退出时无法完成必要的存储同步；
- 恢复原始存档失败，程序无法确认继续操作是否安全；
- 浏览器报告未处理的 `error` 或 `unhandledrejection`；
- React 组件树发生未处理的渲染错误。

下列情况属于可恢复错误或 warning：

- 浏览器不支持 IndexedDB，玩家仍可开始不持久保存的临时游戏；
- 待导入文件为空、过大、格式无效或与已有存档同名；
- 单次导入、导出或删除失败，但存储代码已经确认当前存档状态；
- 主界面扫描存档失败，并且没有正在执行的写操作；
- 页面卸载时最后一次存储同步失败，因为页面已经无法提供恢复操作。

错误分类依据是应用能否证明当前 game module、游戏会话和存档状态仍然有效，
不依据错误文本听起来是否严重。

## 10. 致命错误页

致命错误页显示固定的人类可读摘要和错误编号，不直接显示 JavaScript 调用位置
或原始错误消息。页面始终提供 `Export Diagnostic Log`。

如果错误发生时没有活动游戏会话，页面提供 `Return Home`。session manager
废弃失败的 game module，创建新的 game module，重新初始化存储并进入主界面。

如果错误发生时存在活动游戏会话，页面提供 `Reload Application`。错误处理
已经使旧游戏会话失效，但应用不会假设旧 game module 能够在同一页面中安全
恢复。重新加载页面会重新创建全部 JavaScript 和 WebAssembly 状态。

React 根节点外层还有一个最低限度错误边界。如果正常应用界面自身无法渲染，
错误边界显示错误编号、`Export Diagnostic Log` 和
`Reload Application`，从而避免只留下空白页面。

## 11. 代码职责

`frontend/src/diagnostics/diagnostic-log.ts` 负责诊断事件格式、500 条容量、
浏览器本地存储、隐私过滤、错误编号、Console 输出和 JSON 内容。

`frontend/src/diagnostics/browser-errors.ts` 负责安装和移除浏览器全局异常监听器，
并对同一个错误对象进行重复过滤。

`frontend/src/diagnostics/download-diagnostics.ts` 负责在玩家点击按钮后创建 JSON
下载，并立即释放临时下载地址。

`frontend/src/diagnostics/AppErrorBoundary.tsx` 负责 React 无法正常渲染时的最低
限度错误界面。

`frontend/src/session/session-manager.ts` 负责记录 game module、游戏会话和存储
操作的低频运行节点。session manager 仍然是使失败游戏会话失效和阻止旧输入的
唯一所有者。

`frontend/src/screens/FatalScreen.tsx` 只负责显示错误编号和当前状态允许的操作，
不自行判断游戏会话是否安全。

## 12. 自动测试

诊断日志单元测试验证以下行为：

1. 写入 501 条诊断事件后只保留最新 500 条。
2. 页面恢复后继续使用已有顺序号。
3. 损坏的浏览器本地存储内容不会阻止应用启动。
4. 未列入允许字段的内容、错误消息正文和地址查询参数不会进入导出文件。
5. 浏览器本地存储抛出错误后切换到内存模式，并且不会递归记录。
6. JSON 导出可以重新解析，并包含格式版本、构建编号和浏览器信息。
7. 同一个错误对象只生成一个 fatal 诊断事件和一个错误编号。
8. 浏览器 `error` 和 `unhandledrejection` 可以被安装、移除和重复过滤。

应用状态和界面测试验证应用级 fatal 事件、模块级 fatal 事件、游戏会话级 fatal
事件，以及致命错误页在两种游戏会话状态下显示的操作。

session manager 测试验证 fatal 发生后全局回调已经删除、等待输入已经清除、
活动游戏会话已经消失，并且后续输入或旧回调不能重新进入 running 状态。

Playwright 浏览器测试在真实生产构建中开始一局游戏，然后注入包含测试角色名、
组合键和游戏消息的未处理 Promise 拒绝。测试确认 fatal 页可见，Console 中
出现带同一错误编号的精简记录，下载的 JSON 包含对应 fatal 诊断事件，同时
JSON 和 Console 都不包含注入的角色名、组合键和游戏消息。

## 13. 不实现的内容

阶段五不实现以下内容：

- 自动上传诊断日志或远程监控服务；
- 持续写入玩家选择的本地文件；
- 周期性触发浏览器下载；
- 拦截和保存所有 `console.log` 输出；
- 记录每次按键、每个输入状态、每个回合或每个地图格；
- 保存完整 JavaScript 错误消息；
- 保存完整存档路径、存档字节或文件内容；
- 增加新的存档事务状态机；
- 在发生游戏会话级 fatal 后尝试继续使用旧 game module。

这些限制用于控制实现复杂度、日志容量和隐私风险。阶段五提供本地、可导出、
能够关联错误编号的诊断信息，但不把 BlissHack 扩展成通用监控系统。

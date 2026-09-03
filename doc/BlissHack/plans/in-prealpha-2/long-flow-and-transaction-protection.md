# BlissHack 长流程测试与事务保护设计

本文定义 prealpha-2 阶段四的实现方案。目标是在不修改 NetHack 游戏逻辑和
存档格式的前提下，为重复创建 WASM module、IDBFS 同步、raw save 覆盖导入、
页面刷新和异常中断建立可验证的安全边界。

本文以当前阶段一至三实现为基线：

- 一个 game module 最多运行一局；
- Home 持有下一局 module，并使用该 module 的 FS 枚举和修改存档；
- 所有正式存档仍是 `/save/0<角色名>` 中的 NetHack historical binary bytes；
- raw save 导入先写临时文件，再替换正式路径；
- session manager 拒绝旧 module 和旧 session 的异步结果。

本文补充阶段四需要的持久事务记录、故障注入、测试观测和长流程测试。它不改变
raw save 的对外格式，也不实现阶段五的致命错误页、日志导出或日志
`localStorage` 持久化。

## 1. 当前实现与阶段四缺口

当前实现已经具备：

1. `storage-service.ts` 中的 `syncfs` Promise 队列；
2. 导入覆盖前的内存 bytes 备份；
3. `.blisshack-import-<随机值>.tmp` 临时文件；
4. 导入失败后的同进程回滚；
5. session、module 和全局 shim callback 的隔离；
6. 单次新游戏、保存、继续、删除、导入和导出的 Playwright 流程。

阶段四不能只增加循环次数。当前还有以下结构性缺口：

- 页面在 `rename` 或 `syncfs(false)` 期间关闭时，内存备份会丢失；
- 下次 `initialize()` 只过滤临时文件，不识别和恢复未完成事务；
- 导入过程没有显式 transaction ID、状态机和可定位的失败步骤；
- `syncfs` 队列不能报告当前 operation、队列深度或是否已经完全空闲；
- 当前内存 FS fake 没有区分 module 内存快照与 IndexedDB 持久快照；
- Playwright 无法读取 session ID、活动 session 数量、未结束存储操作和内部
  临时文件，因此只能通过表面 UI 推测不变量；
- 当前 browser suite 与长流程 suite 没有脚本和 artifact 隔离。

阶段四应先补齐这些能力，再编写循环测试。否则测试失败时只能得到超时或界面
截图，无法判断是 session 泄漏、旧 callback、FS 快照还是事务恢复问题。

## 2. 范围

### 2.1 本阶段包含

- 对 Home 存储操作统一分配 operation ID；
- 对每次导入尝试分配 transaction ID；
- 导入事务显式状态机；
- 可跨页面刷新的临时 journal 和持久备份；
- `initialize()` 时的未完成事务恢复；
- 每个规定步骤的确定性故障注入；
- 区分内存 FS 和持久 IDBFS 快照的测试夹具；
- 只在测试构建中启用的只读运行状态观测接口；
- 最小、内存内、容量有界的运行事件记录；
- 独立的 `test:long` Playwright 配置和长流程用例；
- 失败时的 trace、截图、浏览器错误和状态快照 artifact；
- 普通 CI 与长流程测试的职责划分。

### 2.2 本阶段不包含

- 修改 NetHack C 核心、shim ABI 或 raw save payload；
- 为 IDBFS 声明其本身不提供的跨文件原子事务；
- 自动修复任意损坏的 NetHack save；
- 多标签页并发写入或跨标签页锁；
- 生产环境故障注入入口；
- 阶段五的持久诊断日志、日志下载和 fatal page 完整行为；
- 依赖固定地图、怪物位置、随机种子或 wall-clock sleep 的测试。

## 3. 安全不变量

实现和测试共同维护以下不变量：

1. 同一标签页中活动 session 数量只能是 0 或 1。
2. 一个 module 最多调用一次 `main()`，旧 module 不得重新成为 Home module。
3. session 结束后，其全局 callback 必须删除；即使测试保存了旧 callback
   引用，调用它也不能改变当前 UI 或 session。
4. 同一 module 的存储 operation 严格串行执行。
5. session 启动必须等待 Home storage operation 和恢复流程全部结束。
6. 导入报告成功前，正式文件必须可读、已通过重新校验并完成持久化。
7. 在事务提交点之前失败时：
   - 原来有正式存档，则恢复后的 bytes 与事务开始前完全一致；
   - 原来没有正式存档，则不得留下新的正式存档。
8. 在事务提交点之后，即使临时文件清理被中断，新正式存档也必须保持有效；
   下次 `initialize()` 只完成清理，不回退已经提交的导入。
9. 无法证明应当回滚还是提交时必须停止写入，保留可恢复证据，不得猜测。
10. `listSaves()` 永远不展示 journal、backup 或 temporary 文件。
11. 任何错误和运行事件可以包含 operation ID、transaction ID、步骤名和计数，
    但不能包含角色名、正式路径、存档 bytes、游戏消息或按键。
12. 测试结束时没有未完成 storage operation；活动 session 为 0，或是用例
    明确声明并断言的唯一 session。

## 4. 标识与错误模型

### 4.1 Operation ID

operation 表示一次对外存储动作，包括：

```text
initialize
scan
flush
delete
export
import
continue-restore
recovery
```

ID 在当前标签页中唯一，使用非敏感随机值和单调序号，例如
`storage-op-12-<random>`。operation 从进入串行协调器开始，到成功、失败或
取消时结束。

### 4.2 Transaction ID

transaction 只表示一次 raw save 导入尝试。用户选择文件时创建 ID；遇到同名
冲突后，Cancel 或 Overwrite 继续使用同一个 transaction ID。transaction ID
不会从文件名、角色名或 save bytes 派生。

一次 transaction 可以先后关联两个 operation：

1. `prepare` operation：读取、校验并发现冲突；
2. `overwrite` operation：用户确认后执行替换。

这样冲突对话框等待用户时不会占住 storage queue，但 session manager 会把
该 transaction 标记为 `awaiting-confirmation`，在用户取消或完成前拒绝启动
session。

### 4.3 结构化错误

新增结构化错误，不依赖解析错误字符串：

```ts
type StorageOperationKind =
  | "initialize"
  | "scan"
  | "flush"
  | "delete"
  | "export"
  | "import"
  | "continue-restore"
  | "recovery";

class StorageOperationError extends Error {
  readonly operation: StorageOperationKind;
  readonly operationId: string;
  readonly transactionId: string | null;
  readonly step: StorageFaultStep;
  readonly cause: unknown;
}
```

面向玩家的 UI 仍显示简短说明；Playwright artifact 和最小运行事件记录使用
结构化字段。错误中不记录 save 路径，因为路径包含玩家名。

## 5. 存储操作协调器

在 `frontend/src/storage/storage-operation.ts` 新增 module-bound
协调器。`storage-service.ts` 不再只串行化单个 `syncfs`，而是通过协调器
串行化完整的存储动作。

建议接口：

```ts
interface StorageOperationSnapshot {
  active: {
    operation: StorageOperationKind;
    operationId: string;
    transactionId: string | null;
    step: string;
  } | null;
  queued: number;
}

interface StorageOperationCoordinator {
  run<T>(
    operation: StorageOperationKind,
    transactionId: string | null,
    task: (context: StorageOperationContext) => Promise<T>,
  ): Promise<T>;
  whenIdle(): Promise<void>;
  snapshot(): StorageOperationSnapshot;
}
```

规则如下：

- `initialize`、scan、import、delete、export、恢复和 session 退出 flush 都
  经过同一协调器；
- operation 内部调用私有的 `syncFilesystem()`，不能再次进入公共队列造成
  自锁；
- 后续 operation 在前一 operation 失败后仍可运行，但必须等待它的回滚结束；
- `whenIdle()` 只在 `active === null && queued === 0` 时完成；
- session manager 在认领 Home module 前等待 `whenIdle()`，并再次检查
  module 和 pending import transaction；
- `snapshot()` 只返回 ID、步骤和计数，不返回文件名或 bytes；
- production 逻辑不能根据测试快照改变行为。

Home 层现有的 `homeOperationPromise` 继续负责“拒绝重复用户动作”；storage
协调器负责底层顺序和可观察性。两者职责不同，不建立第二套应用生命周期。

## 6. 导入事务状态机

导入事务使用以下显式状态：

```text
created
  -> reading-source
  -> validating-source
  -> awaiting-confirmation
  -> preparing
  -> prepared
  -> replacing
  -> verifying-destination
  -> committing
  -> committed
  -> cleaning
  -> completed

created ... committing
  -> rolling-back
  -> failed | recovery-required

committed ... cleaning
  -> completed | committed-cleanup-pending
```

`committed` 是唯一不可再回滚的状态。到达它之前，任何普通异常都进入
`rolling-back`。提交后清理失败不删除新正式存档；它记录
`committed-cleanup-pending`，由下次初始化继续清理。

同名冲突发生在任何 FS 写入之前。`awaiting-confirmation` 只保留经过校验的
incoming bytes、摘要和 transaction ID，不创建 journal。Cancel 清除内存
上下文；Overwrite 从 `preparing` 继续。

## 7. 内部文件与 Journal

每个写事务使用三个不出现在存档列表中的内部文件：

```text
/save/.blisshack-import-<transaction-id>.journal
/save/.blisshack-import-<transaction-id>.tmp
/save/.blisshack-import-<transaction-id>.bak
```

- `.tmp` 保存待导入 raw save；
- `.bak` 保存原正式存档；无同名存档时不存在；
- `.journal` 是小型 UTF-8 JSON，只描述恢复所需状态。

journal schema：

```ts
interface ImportJournalV1 {
  schemaVersion: 1;
  kind: "raw-save-import";
  transactionId: string;
  phase: "prepared" | "committed";
  destinationFileName: string;
  hadOriginal: boolean;
}
```

约束：

- journal 最大 4096 bytes；
- `transactionId` 必须满足固定安全字符集和长度；
- `destinationFileName` 必须重新经过与正式 save path 相同的校验；
- journal 不保存 incoming 或 original bytes，不保存 UI 文案；
- journal 是临时恢复记录，不是 save sidecar index；事务结束后必须删除；
- raw save 的格式和导出 bytes 不发生变化；
- 诊断事件不得复制 `destinationFileName`。

阶段三文档中的“内存 bytes 备份”仍用于同进程快速回滚，但不能再承担刷新后的
恢复责任。阶段四增加 `.bak` 作为已经持久化的恢复副本。实现阶段需要同步更新
`raw-save-import-export.md` 对这一点的描述。

## 8. 正常导入协议

### 8.1 读取与预检

1. session manager 创建 transaction ID 和 operation ID。
2. 通过可注入的 `RawSaveSource.read()` 读取浏览器 `File`。
3. 在读取前拒绝空文件和超过 64 MiB 的文件。
4. 使用当前 shim fingerprint 和身份块校验 bytes。
5. 计算目标正式路径，但不把路径写入日志。
6. 无冲突时继续；有冲突时进入 `awaiting-confirmation`。

`SavePickerPopover` 不再直接长期持有 64 MiB bytes。它只持有 opaque
transaction ID 和冲突摘要；bytes 由当前 Home manager 的 pending import
上下文持有。关闭 popover、取消或 module 失效时必须释放。

### 8.2 Prepare

1. 如果目标已存在，把正式 bytes 复制到内存。
2. 写入 `.bak`；无原文件时跳过。
3. 写入 `.tmp`。
4. 读回 `.tmp` 并逐字节比较。
5. 写入 `phase: "prepared"` 的 journal。
6. 执行第一次 `syncfs(false)`，确保 journal、backup 和 temporary 已持久化。

第一次 flush 成功前不修改正式路径。它失败时，正式存档仍是旧版本；实现清理
内存临时文件，并尽力 flush 清理结果。

### 8.3 Replace 与校验

1. rename `.tmp` 到正式路径。
2. 执行第二次 `syncfs(false)`，把替换后的正式文件持久化。
3. 从正式路径重新读取 bytes 并与 incoming bytes 比较。
4. 调用当前构建 validator 重新校验正式文件。
5. 执行一次正式 `listSaves` 重新扫描，确认目标恰好出现一次且状态为 ready。

上述任一步失败都仍属于未提交事务，必须从内存或 `.bak` 恢复旧 bytes；无旧
文件时删除新正式路径。回滚完成后执行 `syncfs(false)`，再报告原始错误。

### 8.4 Commit 与清理

1. 把 journal 更新为 `phase: "committed"`。
2. 执行第三次 `syncfs(false)`。这次成功是事务提交点。
3. 删除 `.bak`、残留 `.tmp` 和 journal。
4. 执行第四次 `syncfs(false)` 持久化清理。
5. 再次确认 operation queue 空闲，向 UI 返回成功。

提交点后的新正式文件已经可恢复。清理 flush 失败时返回
`committed-cleanup-pending` 的内部结果并记录 warning；UI 可以报告导入成功，
下次 `initialize()` 会删除内部文件。不能在此时恢复旧文件，否则页面可能在
“已成功”和“已回滚”之间产生新的不确定状态。

正常路径增加了 sync 次数，但导入是低频用户操作，安全性优先于吞吐量。

## 9. 回滚协议

提交点之前发生错误时：

1. 把 journal 保持或重写为 `prepared`；
2. 原文件存在时，从内存备份恢复；内存备份不可用时从 `.bak` 恢复；
3. 原文件不存在时，删除可能已经出现的正式目标；
4. 删除 `.tmp`；
5. 执行 `syncfs(false)`；
6. 确认正式文件 bytes 与原始备份一致；
7. 删除 `.bak` 和 journal，再次 flush。

如果回滚 flush 自身失败：

- 抛出包含原始错误和回滚错误的 `AggregateError`；
- operation 状态为 `recovery-required`；
- 不继续 scan，不开始 session，不删除仍可用于恢复的 `.bak` 或 journal；
- 当前 module 的持久存储停止接受写操作；
- 阶段四沿用当前顶层错误处理进入不可继续状态，阶段五再提供完整 fatal page
  和日志导出。

## 10. 初始化恢复

`storage.initialize()` 在 `syncfs(true)` 后、第一次正常 `listSaves()` 前执行
`recoverInterruptedTransactions()`。恢复本身是一个独占的 `recovery`
operation。

### 10.1 有效 journal

对每个合法 journal：

- `prepared`：
  - `hadOriginal=true` 时要求 `.bak` 存在、可读，并让
    `validateSaveBytes()` 校验其内容，然后把它写回正式路径；
  - `hadOriginal=false` 时删除可能存在的正式目标；
  - 删除 `.tmp`、`.bak` 和 journal；
  - flush 后重新校验恢复结果。
- `committed`：
  - 正式目标可读且通过 validator 时保留新正式文件，只删除内部文件并 flush；
  - 正式目标缺失或无效且 `.bak` 有效时恢复旧文件；
  - 无有效正式文件也无有效备份时停止恢复并报告 `recovery-required`。

### 10.2 孤立文件

- 没有 journal 的 `.tmp` 永远不是正式存档，可以删除并 flush。
- 没有 journal 的 `.bak` 先读取 bytes，并通过 `validateSaveBytes()` 得到
  内部身份：
  - 对应正式文件不存在或无效时，恢复 backup；
  - 对应正式文件有效时，不覆盖它，只删除孤立 backup；
  - backup 本身无效时保留现场并报告恢复错误。
- journal JSON 损坏、路径非法、同一目标出现多个未完成事务或 backup 与
  journal 身份不一致时，禁止猜测，保留文件并报告 `recovery-required`。

标准中断路径必须自动恢复；元数据本身损坏属于无法安全判定的异常，不在阶段四
中自动选取“看起来较新”的文件。

## 11. 故障注入

生产代码只依赖一个默认 no-op checkpoint：

```ts
type StorageFaultStep =
  | "read-source"
  | "validate-source"
  | "read-backup"
  | "write-temporary"
  | "verify-temporary"
  | "rename-destination"
  | "flush-prepare"
  | "flush-replacement"
  | "final-rescan"
  | "write-commit-journal"
  | "flush-commit"
  | "cleanup-artifacts"
  | "flush-cleanup"
  | "rollback"
  | "recovery";

interface StorageFaultInjector {
  checkpoint(
    step: StorageFaultStep,
    timing: "before" | "after",
    context: {
      operationId: string;
      transactionId: string | null;
    },
  ): void | Promise<void>;
}
```

规则：

- 默认实现不执行任何操作，不读取 URL 或全局变量；
- Vitest 注入确定性 fake，在指定 step 和 timing 抛错；
- 普通失败允许事务执行回滚；
- “进程中断”使用专用 `SimulatedProcessInterruption`，测试 harness 立即丢弃
  当前内存 FS，不执行 catch 中的同进程回滚，然后用同一个持久快照创建新
  module；
- 浏览器不通过随机 quota、关闭 IndexedDB 或强杀进程制造故障；
- 每个故障点至少覆盖“执行前失败”和对状态有意义的“执行后中断”；
- 测试断言结构化错误的 operation、operation ID、transaction ID 和 step。

## 12. 存储测试夹具

扩展 `storage-test-helpers.ts`，明确分开：

```text
memoryFiles       当前 Emscripten module 的 MEMFS/IDBFS 视图
persistedFiles    模拟 IndexedDB 中最后一次成功同步的视图
syncRequests      尚未完成的 syncfs 调用
operationHistory  operation 和 step 记录
```

`syncfs(true)` 把 `persistedFiles` 复制到 `memoryFiles`；
`syncfs(false)` 只有在 fake 明确完成成功时才复制回去。

夹具提供：

- `completeSync()`：成功提交整个快照；
- `failSyncBeforeCommit(error)`：持久快照不变后报错；
- `failSyncAfterCommit(error)`：持久快照已变化后报错，用于模拟不确定结果；
- `crashAndRecreateModule()`：丢弃内存视图，以相同持久快照创建新 module；
- `failNextFsCall(method, timing)`：确定性注入 read/write/rename/unlink 失败；
- `assertNoInternalArtifacts()`；
- `assertPersistedBytes(path, expected)`；
- `assertStorageIdle()`。

生产实现不依赖此夹具。

## 13. 最小运行事件

阶段四需要失败证据，但不提前实现阶段五全部功能。新增内存内、最多 500 条的
最小事件 sink，事件字段与阶段五 `DiagnosticEvent` 兼容。

阶段四只记录：

- module 准备、session 创建、运行、退出和清理；
- stale callback 被拒绝；
- storage operation 开始、步骤变化、成功和失败；
- transaction prepare、rollback、commit 和启动恢复；
- 当前 active/queued 计数。

本阶段不实现：

- `localStorage`；
- JSON 下载 UI；
- `window.onerror` 和 `unhandledrejection` 全局接管；
- fatal page 扩展。

事件 detail 使用 allowlist，不记录角色名、文件名、消息、按键或 bytes。长流程
测试失败时把内存事件快照附加到 Playwright artifact。阶段五直接扩展该 sink，
不另建第二套日志系统。

## 14. 浏览器测试观测接口

长流程测试需要验证内部不变量，但仍必须通过真实 UI 开始、继续、保存、导入和
导出。为此增加只读的 test API。

只有构建时 `VITE_ENABLE_TEST_API=1` 才把接口注册到
`window.__BLISSHACK_TEST__`。普通开发、生产和 GitHub Pages 构建中该对象
不存在，不能通过 query string 动态开启。

建议接口：

```ts
interface BlissHackTestSnapshot {
  appPhase: "booting" | "home" | "session" | "fatal";
  moduleId: string | null;
  sessionId: string | null;
  activeSessionCount: 0 | 1;
  registeredCallbackCount: number;
  storage: StorageOperationSnapshot | null;
  pendingImportTransactionId: string | null;
  internalArtifactCount: number;
}

interface BlissHackTestApi {
  snapshot(): BlissHackTestSnapshot;
  events(): readonly DiagnosticEvent[];
  invokeRetiredCallback(
    index: number,
    callbackName: string,
  ): Promise<void>;
}
```

限制：

- 不提供开始游戏、发送按键、写文件、改 app state 或完成 sync 的方法；
- 所有用户流程仍由 Playwright 点击、键盘和文件选择器完成；
- snapshot 不返回角色名、存档路径或游戏内容；
- 为 stale callback 测试最多保留两个 retired callback 引用，并在测试调用后
  释放；该保留逻辑只存在于测试构建；
- production callback 仍在 session 清理时删除，不因测试设计产生泄漏。

## 15. Playwright 长流程组织

新增：

```text
frontend/
├── playwright.config.ts
├── playwright.long.config.ts
└── test/integration-tests/
    ├── browser/
    │   ├── playable-frontend.spec.ts
    │   └── helpers/
    │       ├── artifacts.ts
    │       ├── game-flow.ts
    │       └── test-api.ts
    └── browser-long/
        └── long-flow.spec.ts
```

`package.json` 增加：

```json
{
  "scripts": {
    "test:long": "playwright test --config=playwright.long.config.ts"
  }
}
```

普通 browser suite 和 long suite 都使用 production build 与 Vite preview。
测试构建设置 `VITE_ENABLE_TEST_API=1`。两套配置使用不同端口和 outputDir，
避免并行或连续运行时覆盖 artifact。

长测试设置：

- Chromium；
- `workers: 1`；
- 每个 spec 独立 browser context；
- 单个 case 使用适合 WASM 重载的显式较长 timeout；
- `trace: "retain-on-failure"`；
- `screenshot: "only-on-failure"`；
- 不设置重试来掩盖本地确定性失败；定时 CI 若启用也只允许 0 次重试。

测试 helper 不使用 `waitForTimeout()`。等待条件来自：

- 可访问的 UI 状态；
- download 事件；
- test API 的 operation idle 和 session 快照；
- Playwright `expect.poll()`。

## 16. 必测长流程

### 16.1 Session 生命周期循环 10 次

使用角色选择阶段 `q` 的正常退出路径，因为它能稳定触发真实 `main()`、
shim 初始化、核心退出、flush、callback 清理和下一 module 创建，不依赖地图。

每轮：

1. 从 Home 点击 New Game；
2. 等待名字输入并输入该测试专用唯一名字；
3. 等待随机角色问题；
4. 断言 session 已进入 running，活动数为 1；
5. 按 `q` 正常结束；
6. 等待下一 Home module 准备完成和 storage idle；
7. 断言活动 session 为 0、callback 数为 0；
8. 记录 module ID 和 session ID。

最终断言 10 个 session ID 和相邻 module ID 均不同，factory 没有重入，
任何观测点的活动 session 数不超过 1。

第 2 轮运行期间调用第 1 轮保留的 stale callback，断言 app phase、当前
session ID、地图摘要和 pending input 均不变化，并存在一条
`stale-callback-ignored` 事件。

### 16.2 同一存档继续和保存 10 次

先通过真实 UI 创建角色并保存一次。随后循环 10 次：

1. 刷新页面；
2. 等待 Home storage idle；
3. 打开 picker，断言角色只出现一次；
4. Continue；
5. 断言没有名字输入和角色创建，地图与身份状态可见；
6. 通过 NetHack 标准 `S`、确认和 `--More--` 流程保存；
7. 等待 Home、下一 module 和 storage idle；
8. 断言存档只出现一次，内部事务文件为 0。

测试不要求角色移动，也不比较会随正常 save 改变的整个文件 hash。它验证每次
恢复都经过核心 restore 路径，并记录 10 个不同 session ID。

### 16.3 导出、删除、导入和继续循环 5 次

从已有正式存档开始。每轮：

1. 导出并用 Node `crypto.createHash("sha256")` 计算下载 bytes hash；
2. 二次确认删除并等待 storage idle；
3. 用刚下载的 bytes 导入；
4. 导入后再次导出，断言 bytes 和 hash 与本轮原文件完全一致；
5. 断言正式列表只有一项，内部事务文件为 0；
6. Continue，确认核心恢复；
7. 保存并返回，为下一轮生成正式存档。

hash 只比较同一轮传输前后。NetHack 恢复并再次保存可能合法改变 save bytes，
因此不要求五轮之间 hash 恒定。

### 16.4 后台恢复与反复扫描

在 Home：

1. 记录 module ID、factory 次数和 session 计数；
2. 使用 Chromium CDP lifecycle/visibility 能力让页面进入后台再恢复；
3. 打开、关闭 picker，并通过 reload 触发新的 module populate 和 scan；
4. 断言后台恢复本身没有创建 module 或 session；
5. 每次 scan 后列表路径集合没有重复；
6. 最终 storage idle，内部事务文件为 0。

若当前 Chromium 版本不能可靠模拟 visibility，使用同一 context 中打开第二个
页面产生真实失焦，再切回原页面；不得只手工派发伪造 DOM 事件后声称覆盖浏览器
生命周期。

## 17. 故障测试矩阵

Vitest 对以下必需步骤分别建立独立 case：

| 故障步骤 | 预期正式文件 | 内部文件 | 后续 initialize |
| --- | --- | --- | --- |
| 读取上传文件 | 旧 bytes 不变 | 无 | 正常 |
| 校验 raw save | 旧 bytes 不变 | 无 | 正常 |
| 读取旧 bytes | 旧 bytes 不变 | 无 | 正常 |
| 写 `.tmp` | 旧 bytes 不变 | 清理或仅 orphan tmp | 自动清理 |
| 读回/验证 `.tmp` | 旧 bytes 不变 | 清理或 prepared 证据 | 自动回滚 |
| rename 正式路径 | 回滚为旧 bytes | 允许 prepared 证据 | 自动回滚 |
| replacement flush | 回滚为旧 bytes | 允许 prepared 证据 | 自动回滚 |
| 最终重新扫描 | 回滚为旧 bytes | 允许 prepared 证据 | 自动回滚 |

另补充：

- prepare flush 在持久化前和持久化后报错；
- commit journal flush 在持久化前和持久化后报错；
- rollback write 或 rollback flush 失败；
- committed 后 cleanup 和 cleanup flush 失败；
- prepared、committed、orphan tmp、orphan backup 的重启恢复；
- journal 截断、schema 不支持、非法目标和缺失 backup；
- 两个 journal 指向同一目标时 fail closed；
- operation queue 在失败后继续保持顺序；
- pending conflict 时拒绝 session 启动；
- Cancel 释放 bytes、transaction 和 Home 门禁；
- 每个最终状态都调用 `assertStorageIdle()`。

每个覆盖已有存档的 case 使用 byte-for-byte 比较和 SHA-256 辅助输出。hash
只进入测试断言和 artifact，不写入生产存档格式。

## 18. 失败 Artifact

每个 Playwright case 从页面创建时开始捕获：

- `console.error`；
- `pageerror`；
- download failure；
- Playwright trace；
- failure screenshot。

`afterEach` 在失败时额外附加：

```text
runtime-snapshot.json
runtime-events.json
browser-errors.json
```

内容包括：

- 当前 app phase；
- module ID 和 session ID；
- 活动 session 和 callback 数；
- 当前 storage operation、step、operation ID 和 transaction ID；
- queue depth 和内部 artifact 数；
- 最近最多 500 条 allowlist 事件；
- 失败发生的循环编号。

artifact 不包含角色名、save 路径、上传文件名、游戏消息、按键或 save bytes。
测试断言错误文本必须直接指出 `round X/Y`，避免只报告一个最终 timeout。

## 19. CI 分层

### 19.1 普通 CI

每次 push 和 pull request 运行：

```bash
npm run lint
npm test
npm run build
npm run test:integration:wasm
npm run test:integration:browser
```

普通 browser suite 保留单次关键流程，不复制 10 次和 5 次循环。失败上传
Playwright artifact。部署 job 应依赖测试通过，或由独立 test workflow 提供
同等 branch protection；不把浏览器安装和测试逻辑隐藏在 Pages 发布步骤中。

### 19.2 长流程

`npm run test:long` 是阶段四强制的本地发布前命令。初始实现建议增加
`workflow_dispatch`，但不立即设为每次提交门禁。观察时长和稳定性后，再决定
是否增加每周定时任务。

长流程失败不得通过自动重试变绿。修复前应保留第一次失败的 trace、循环编号和
运行状态。

## 20. 预计代码范围

新增：

```text
frontend/src/storage/storage-operation.ts
frontend/src/storage/storage-operation.test.ts
frontend/src/diagnostics/diagnostic-log.ts
frontend/src/diagnostics/diagnostic-log.test.ts
frontend/src/test-api.ts
frontend/test/integration-tests/browser/helpers/artifacts.ts
frontend/test/integration-tests/browser/helpers/game-flow.ts
frontend/test/integration-tests/browser/helpers/test-api.ts
frontend/test/integration-tests/browser-long/long-flow.spec.ts
frontend/playwright.long.config.ts
```

修改：

```text
frontend/src/storage/storage-service.ts
frontend/src/storage/storage-service.test.ts
frontend/src/storage/storage-test-helpers.ts
frontend/src/storage/storage-transaction.ts
frontend/src/storage/storage-transaction.test.ts
frontend/src/session/session-manager.ts
frontend/src/session/session-manager.test.ts
frontend/src/App.tsx
frontend/src/vite-env.d.ts
frontend/test/integration-tests/browser/playable-frontend.spec.ts
frontend/playwright.config.ts
frontend/package.json
doc/BlissHack/plans/in-prealpha-2/raw-save-import-export.md
```

是否新增 GitHub Actions workflow 在实现前确认。阶段四不需要修改
`frontend/public/nethack.js`、`frontend/public/nethack.wasm` 或任何 C 文件。

## 21. 实施顺序

1. 扩展 FS fake，使内存和持久快照可分离。
2. 增加 storage operation 协调器、ID 和结构化错误。
3. 把现有 import 改造成显式状态机，但先保持同进程行为测试通过。
4. 增加 journal、持久 backup、提交点和初始化恢复。
5. 完成每个故障点及中断恢复的 Vitest 矩阵。
6. 增加最小内存事件 sink。
7. 增加只在测试构建启用的只读 test API。
8. 提取现有 Playwright helper 和 artifact fixture。
9. 实现 10 次、10 次和 5 次长流程。
10. 增加 `test:long`，运行 lint、unit、build、WASM、普通 browser 和 long
    全套验证。

## 22. 人工观察

自动测试通过后，按阶段四原计划执行以下人工检查并记录浏览器版本：

1. 实际游玩至少 30 分钟，保存、刷新并继续，确认操作、地图和消息历史正常。
2. 手动完成至少 10 次 New Game 或 Continue 与 Home 之间的切换，观察加载
   时间没有持续增加。
3. 分别在 Home 和活动游戏中切换标签页、最小化浏览器并恢复，确认不会重复
   创建 module 或 session。
4. 在导入的 prepare、replace 和 cleanup 阶段使用开发测试构建暂停并刷新，
   确认重新打开后恢复结果符合 journal phase。
5. 在 DevTools 中观察全局 callback 数、WASM module 生命周期事件和 storage
   queue，确认没有持续增长。
6. 检查 IndexedDB 对应目录，正常流程结束后不存在 `.tmp`、`.bak` 或
   `.journal`。

30 分钟游玩只作为人工稳定性观察，不纳入自动 CI，也不以固定地图进度作为
通过条件。

## 23. 阶段四完成标准

只有同时满足以下条件才完成阶段四：

- 必需故障点都有独立、确定性的单元测试；
- 提交前失败能保持或恢复旧 bytes，无原文件时不产生正式文件；
- 标准页面中断能在下一次 initialize 自动恢复；
- 无法安全判定的 journal 损坏会 fail closed；
- 10 次 session 生命周期循环通过；
- 同一存档 10 次继续和保存循环通过；
- 5 次导出、删除、导入和继续循环通过，单轮传输 hash 一致；
- stale callback、后台恢复、列表去重和无内部残留文件断言通过；
- 所有测试不依赖随机地图和 wall-clock sleep；
- 失败 artifact 能定位循环轮次、session 和 storage step；
- `npm run lint`、`npm test`、`npm run build`、
  `npm run test:integration:wasm`、`npm run test:integration:browser` 和
  `npm run test:long` 全部通过。

## 24. 实现前需要确认的决策

本文推荐以下默认选择：

1. **持久 backup**：允许阶段四把阶段三的纯内存回滚升级为
   `.bak + journal` 协议；否则无法满足刷新期间的自动恢复。
2. **提交点**：采用三次安全性 flush 加一次清理 flush，接受低频导入操作的
   额外延迟。
3. **测试 API**：只由 `VITE_ENABLE_TEST_API=1` 的专用构建启用，线上构建不
   暴露。
4. **最小日志**：阶段四先实现内存环形事件 sink，阶段五再增加持久化、导出和
   全局错误捕获。
5. **长测 CI**：阶段四先提供本地强制脚本和手动 workflow，不把长测加入每次
   push；稳定后再增加定时 CI。

这些选择中，持久 backup 和明确提交点是事务安全的必要条件；测试 API、最小
日志和 CI 频率属于工程取舍，可以在实现前调整。

# BlissHack prealpha-2 开发计划

## 1. 版本目标

prealpha-2 的目标是为现有可游玩的字符版前端增加可靠的浏览器应用
外壳和存档工作流。完成后，玩家应当能够从主界面开始新游戏、保存并
返回主界面、继续已有游戏、导入和导出存档；发生致命错误时能够获得
明确反馈并导出本地诊断日志。

本版本按照以下优先级实施：

1. 应用状态机、主界面和 WASM session 生命周期。
2. IDBFS 存档读取、保存和继续游戏。
3. 存档导入、导出及保存并返回主菜单。
4. 长流程测试和存档导入失败路径测试。
5. 致命错误页和 500 条本地诊断日志。
6. 新游戏、保存、继续和退出的浏览器测试。

编号表示产品重要性和主要开发顺序。阶段四使用 Playwright trace、截图和
浏览器错误定位长流程失败；本地诊断日志仍在阶段五实现。

## 2. 范围边界

### 2.1 本版本包含

- 同一标签页内至多存在一个活动的 NetHack WASM 会话。
- 每局游戏使用独立 session ID 和独立 WASM 实例；该实例在进入首页读取
  存档时创建，玩家选择后由同一局使用。
- React 顶层应用状态机和简单主界面。
- 从 IDBFS 枚举、读取、删除、写入和同步存档。
- 新游戏、继续游戏、保存并返回主界面。
- 存档导入、导出、冲突处理和失败回滚。
- 有界、本地、可导出的诊断日志。
- 致命错误后的会话隔离和重新开始能力。
- 角色选择阶段按 `q` 正常结束当前 session 并返回主界面。
- 单元测试、WASM 集成测试、浏览器端到端测试和长流程测试。

### 2.2 本版本不包含

- 设置界面和 `.nethackrc` 图形化编辑。
- 四列角色、种族、性别和阵营选择界面。
- 现代化结算信息重排；沿用 NetHack 当前结束流程。
- 多语言和核心文本替换。
- 永久背包界面。
- 图块、Canvas 或 WebGL 地图。
- 后台自动保存当前 WASM 内存。
- 自动修复已经损坏的 Asyncify 调用栈。
- 任意桌面版或其他 NetHack 构建存档的兼容承诺。
- 修改 NetHack 原版 C 代码。

### 2.3 通用约束

- React 不得在 Asyncify 等待输入期间通过额外 `ccall()` 强行调用
  NetHack 保存、退出或恢复函数。
- 保存和退出必须通过 NetHack 正常输入及 shim 回调完成。
- `FS.syncfs()` 只负责同步已经存在的文件，不得称为游戏存档。
- 所有与游戏会话相关的异步操作必须关联 session ID，过期 session
  不得更新当前 UI。主界面的存储操作改用 operation 或 transaction ID。
- 存档写入和同步操作必须串行化，不允许并发执行。
- 新增函数必须按项目约定说明用途、参数和返回值。
- 不得记录完整按键、游戏消息、玩家姓名或存档内容到诊断日志。

### 2.4 前端目录组织

新增代码不全部放在 `frontend/src` 根目录。根目录只保留应用入口、
全局样式和目前已有的稳定模块；prealpha-2 新增代码按职责分目录：

```text
frontend/src/
├── app/
│   ├── app-state.ts
│   └── app-state.test.ts
├── session/
│   ├── session-manager.ts
│   └── session-manager.test.ts
├── storage/
│   ├── storage-service.ts
│   ├── storage-service.test.ts
│   ├── storage-transaction.ts
│   └── storage-transaction.test.ts
├── diagnostics/
│   ├── diagnostic-log.ts
│   └── diagnostic-log.test.ts
├── screens/
│   ├── HomeScreen.tsx
│   ├── GameScreen.tsx
│   ├── SavePickerPopover.tsx
│   └── FatalScreen.tsx
├── App.tsx
├── main.tsx
├── nethack-bridge.ts
└── game-state.ts
```

测试与对应实现放在同一目录。`App.tsx` 只负责组合顶层 screen 和连接
应用 reducer，不承载 WASM、存储或诊断实现。现有
`nethack-bridge.ts`、`game-state.ts`、`keyboard.ts` 和渲染辅助模块
暂不因目录整理而移动；只有出现清晰的模块边界收益时再单独重构，避免
本版本产生大量无行为变化的路径修改。

## 3. 阶段一：应用状态机、主界面和 WASM session 生命周期

### 3.1 目的

建立统一的应用生命周期：页面打开时先创建下一局的唯一 WASM module，
用它读取存档后显示主界面；点击新游戏或继续游戏时，同一个 module 创建
活动 session 并调用一次 `main()`。游戏结束并完成同步和清理后，创建下一
module，再返回准备完成的主界面。替换当前由模块级 `wasmModule` 和
`startupPromise` 隐式管理一局游戏的方式。

本阶段只保留一个对外权威状态机。

### 3.2 单一应用状态机

使用 TypeScript 判别联合类型和 reducer，不引入 React Router 或
XState。应用状态至少包括：

```ts
type AppState =
  | {
      phase: "booting";
      moduleId: string | null;
      status: "loading-module" | "loading-storage";
    }
  | {
      phase: "home";
      moduleId: string;
      savePickerOpen: boolean;
      storageAvailable: boolean;
    }
  | {
      phase: "session";
      moduleId: string;
      sessionId: string;
      status: "starting" | "running" | "saving" | "exiting";
    }
  | {
      phase: "fatal";
      moduleId: string | null;
      sessionId: string | null;
      errorId: string;
    }
```

`phase` 决定当前顶层界面。`booting.status` 描述下一局 module 的创建与
storage populate；`session.status` 只描述用户选择之后的活动游戏。
初始 `booting` 的 `moduleId` 为 `null`；manager 在 factory 调用前生成
`moduleId` 并派发 `MODULE_LOADING`，后续用它拒绝旧 module 的异步完成事件。
`sessionId` 在用户选择 New Game 或 Continue 时生成，用于隔离游戏 callback。

`home` 不存在活动 session，但持有一个已初始化、尚未调用 `main()` 的下一局
game module。存档列表是 `home.savePickerOpen` 控制的局部 popover，不切换
顶层界面。资源清理完成后先创建并初始化下一 module，再进入 `home`；module
准备或活动 session 的不可恢复错误都进入顶层 `fatal`。实际
`EmscriptenModule` 对象由 manager 持有，不放进 reducer。

后续阶段可以增加 `importing` 等顶层状态，但所有状态转换必须继续由同一个
reducer 处理。

### 3.3 Session manager 职责

1. 新增 session manager，负责为首页准备 module，并负责 session 的认领、
   启动、退出和释放。
2. 每次用户从首页开始或继续游戏时生成唯一 session ID。ID 在当前标签页生命周期
   内不得重复，也不得从角色名等用户信息推导。
3. session manager 通过事件向 reducer 报告：

   ```text
   MODULE_LOADING
   STORAGE_LOADING
   HOME_READY
   SAVE_PICKER_OPENED
   SAVE_PICKER_CLOSED
   SESSION_CREATED
   SESSION_RUNNING
   SESSION_SAVING
   SESSION_EXITING
   SESSION_CLEANUP_COMPLETED
   MODULE_FATAL_ERROR
   SESSION_FATAL_ERROR
   ```

4. reducer 是应用状态的唯一事实来源。session manager 不得自行切换
   React screen，也不得暴露另一份可独立修改的 public lifecycle state。
5. 同一时间只能有一个当前 module 和一个活动 session。重复点击开始按钮
   必须认领同一个 ready module 一次，复用当前启动 Promise 或被 reducer
   拒绝，不能创建第二个 module 或第二次调用 `main()`。
6. 每个 session 使用唯一的全局 shim callback 名称，不能让新旧实例
   共享固定的 `blissCallback`。
7. shim callback 必须闭包绑定所属 module 和 session ID，不能通过
   可被新 session 覆盖的全局 `wasmModule` 解析指针。
8. 所有 callback 在 dispatch 前检查 session 是否仍然有效。过期
   callback 不得修改新 session 的地图、输入请求、错误或存档状态。
9. 已完成清理或发生致命错误的 WASM 实例不得再次调用 `main()`，
   不得用于继续游戏；下一局必须由 Emscripten factory 创建新实例。
10. session 清理至少包括：
    - 清除 pending input 和按键队列。
    - 移除该 session 注册的全局 callback。
    - 解除当前活动 session 引用。
    - 重置只属于该局的窗口、地图和状态数据。
11. 开发环境 HMR 或 React 重复挂载不得启动第二个活动 session。
12. 本阶段不要求把 WASM 移入 Web Worker，也不提供强制杀死正常运行
    中核心的能力。

### 3.4 状态转换要求

- 页面初始化时先生成 `moduleId`：
  `booting/loading-module -> booting/loading-storage -> home`。
- 首页打开和关闭存档列表：
  `home/savePickerOpen:false -> home/savePickerOpen:true -> home`；始终使用
  同一个 `moduleId`。
- 点击新游戏或选择存档：
  `home -> session/starting`；即使 popover 展开也可以点击 New Game，认领
  已经准备好的 module，并生成 `sessionId`。
- 调用 `main()` 并收到 `shim_init_nhwindows`：
  `session/starting -> session/running`。
- 后续保存流程：
  `session/running -> session/saving -> session/exiting`。
- 普通游戏结束：
  `session/running -> session/exiting`。
- 角色选择阶段按 `q`：
  `session/running -> session/exiting -> booting -> home`。
- 核心退出、同步和清理全部完成：
  `session/exiting -> booting -> home`；`booting` 中准备下一 module。
- module 准备失败：任意 `booting` status 进入 `fatal`，`sessionId=null`。
- 当前 session 的致命错误：任意 session status 进入 `fatal`。
- `moduleId` 不匹配的 module/storage 事件和 `sessionId` 不匹配的 session
  事件不能触发 reducer 状态转换。
- `session/running` 不能通过普通 `RETURN_HOME` 事件绕过核心退出。
- 不允许出现 UI 显示游戏中、session manager 却认为 session 已失败
  等两套状态不一致的组合。

### 3.5 主界面需求

1. 第一视口明确显示产品名 `BlissHack`。
2. 显示当前基于 NetHack 5.0，以及 BlissHack 为非官方修改版本。
3. 左侧命令区包含三个纵向排列的按钮：
   - `New Game`：可用。
   - `Continue`：本阶段为 disabled。
   - `Settings`：disabled，并在本版本始终不实现。
4. disabled 按钮必须具有原生 `disabled` 属性，不能只依赖颜色。
5. 页面底部显示 BlissHack 版本、NetHack 版权和许可证入口。
6. 页面不使用营销式 hero、装饰性卡片堆叠、渐变球或无功能说明文案。
7. 视觉方向采用安静的终端式游戏主界面：
   - 深色中性背景。
   - 高对比标题和命令。
   - 一种主强调色，加上中性灰色层级。
   - 卡片圆角不超过 8px。
8. 桌面和移动宽度下按钮文字不得溢出或重叠。
9. 进入主界面前创建下一局 WASM module，用于挂载 IDBFS 和枚举存档；主界面
   不调用 `main()`，也不存在活动 NetHack session。
10. 产品 Logo 位于左侧命令区上方，与按钮左边缘对齐；按钮组靠近内容区下方，
    右侧保留为空白。

### 3.6 游戏结束要求

- 死亡、逃离地牢、飞升、主动退出等流程仍由 NetHack 原有界面展示。
- 用户完成原版结束信息后，以 `shim_exit_nhwindows` 作为核心退出信号。
- 收到退出信号后 reducer 进入 `session/exiting`。
- 退出时先完成必要同步，再清理 session，最后回主界面。
- 一局结束并完成 flush 和清理后，创建下一局的新 module；旧地图和消息不得
  残留。
- 本版本不增加结算 Scene，不解析六类 disclosure 数据。

### 3.7 预期代码范围

- 新增 `frontend/src/app/app-state.ts`。
- 新增 `frontend/src/app/app-state.test.ts`。
- 新增 `frontend/src/session/session-manager.ts`。
- 新增 `frontend/src/session/session-manager.test.ts`。
- 新增 `frontend/src/screens/HomeScreen.tsx`。
- 新增 `frontend/src/screens/GameScreen.tsx`。
- 重构 `frontend/src/nethack-bridge.ts`，使 bridge 依赖显式 session。
- 调整 `frontend/src/game-state.ts`，使其只负责单局游戏数据。
- 重构 `frontend/src/App.tsx` 为顶层 screen dispatcher。
- 更新 `frontend/src/App.css`。
- 保留当前 shim ABI 和 Emscripten loader，不修改 C 源码。

### 3.8 单元测试要求

- reducer 覆盖每个合法顶层状态和 session status 转换。
- reducer 拒绝 stale session 的 `SESSION_RUNNING`、
  `SESSION_CLEANUP_COMPLETED` 和 `SESSION_FATAL_ERROR`。
- `session/running` 不能通过普通 `RETURN_HOME` 绕过核心退出。
- reducer 对未知 action 触发 TypeScript 穷尽检查。
- HomeScreen 组件渲染本身不调用 module factory；顶层生命周期在进入首页前
  只创建一个 module。
- 连续派发 `NEW_GAME` 只认领一个 ready module、只调用一次 `main()`。
- 第一局退出并完成 flush 后，为第二局创建不同 module；开始第二局时生成不同
  session ID。
- 旧 session callback 到达时不会更新第二局状态。
- 旧 session 指针只能由旧 module 解码。
- pending menu、`yn`、line input 和按键队列在 session 结束后全部清空。
- callback 全局名称不会碰撞，并在 session 结束后删除。
- 对已经退出的 session 再次发送输入不会调用任何 resolver。
- 重复清理同一 session 是幂等操作。
- `Settings` 始终具有 disabled 属性；`Continue` 只在持久存储不可用时
  disabled，没有本地存档时仍可打开 Import。
- 正常退出和保存退出最终都回到 `home`。
- 在初始 `[ynaq]` 角色选择提示按 `q` 会结束 session 并回到 `home`。

### 3.9 自动验收标准

- `npm test` 全部通过。
- React 单元测试覆盖 reducer 全部分支。
- WASM 集成测试确认一次 session 只收到一次初始化序列。
- 测试中主动触发过期 callback，不产生跨 session 状态污染。
- Playwright 首屏断言主界面可见，NetHack 名字输入不可见。
- 点击 `New Game` 后才加载并启动游戏。
- 角色选择阶段按 `q` 后回到主界面，不创建游戏地图。
- TypeScript、Oxlint 和生产构建通过。
- 原有名字输入、角色选择、地图、菜单和键盘测试无回归。
- 页面在桌面和移动 viewport 下无横向溢出。
- 按钮、标题和状态区域必须能通过语义查询定位。

### 3.10 手动观察标准

- 首次打开页面只看到主界面，不会闪现终端或名字输入。
- `Continue` 和 `Settings` 清楚地呈 disabled 状态且无法点击。
- 点击 `New Game` 后有明确加载状态。
- 快速连续点击“新游戏”不会出现两个名字输入框或两个游戏实例。
- 一局正常退出后回到干净主界面，再次新游戏正常。
- 第二局不残留第一局地图、消息、modal 或按键队列。
- 开发服务器热更新后不会在终端出现 Asyncify 重入警告。
- 浏览器控制台没有重复初始化、未处理 Promise 或 stale callback
  错误。
- 手机宽度和桌面宽度下排版稳定，无文字遮挡。

## 4. 阶段二：IDBFS 存档读取、保存和继续游戏

### 4.1 强制设计评审门禁

进入本阶段时，先停止功能开发，与用户详细讨论并确认浏览器内存储和读取
方案。在讨论完成、文档获得用户确认前，不实现存档列表元数据或继续游戏。
导入、导出和覆盖规则不属于本门禁，统一推迟到阶段三开始前单独评审。

研究结果写入独立文档，至少回答：

1. 当前 WASM 构建会在 `/save` 中创建哪些文件。
2. 正常保存文件名如何包含 UID 和角色名。
3. 正常保存、恢复、恢复失败和游戏结束时文件如何创建或删除。
4. save header 中的版本、数据模型和角色信息如何编码。
5. 同一 BlissHack 版本、不同 BlissHack 版本、桌面 NetHack 与 WASM
   存档分别具有什么兼容性。
6. IndexedDB、IDBFS 虚拟文件和原版 NetHack bytes 之间是什么关系。
7. 阶段二如何读取并校验角色身份和兼容性。
8. 每局 game module 在首页、活动 session 和退出期间如何流转。
9. 恢复失败时如何阻止静默创建同名新游戏。
10. 阶段二能够可靠展示哪些元数据。

### 4.2 存储服务需求

1. 将 IDBFS 操作从 bridge 中提取为独立 storage service。
2. 存储实现放在 `frontend/src/storage/`，存档列表弹层放在
   `frontend/src/screens/SavePickerPopover.tsx`。
3. storage service 至少提供：

   ```text
   initialize()
   listSaves()
   readSave()
   restoreOriginalSave()
   deleteSave()
   flush()
   ```

   `restoreOriginalSave()` 只用于 Continue 失败回滚，不是通用写入接口。
   `deleteSave()` 只删除当前首页已经枚举的正式 save，并在 flush 失败时
   写回原始 bytes。阶段二不公开导入或覆盖所需的通用写入接口；NetHack
   核心仍负责游戏流程中的正式 save 创建和消费。

4. `/save` 只挂载一次，并在读取列表前执行 `syncfs(true)`。
5. 所有 `syncfs` 操作通过同一异步队列串行化；首页删除和阶段三导入的
   write、rename、回滚均复用该队列。
6. IndexedDB 中由 IDBFS 保存的文件内容必须保持为 NetHack 原版二进制
   save bytes，不转换为 JSON 或 BlissHack 容器。
7. IndexedDB 不可用时：
   - 新游戏仍可运行。
   - 主界面明确显示存档不可持久化。
   - `Continue`、导入和导出按实际能力禁用。
8. 列表只展示被确认是存档的文件，不展示临时文件、备份文件或其他
   IDBFS 内容。
9. 恢复必须使用 NetHack 原有的角色名查找机制，不能从 JS 直接恢复
   C 内部结构。
10. 列表校验比较 shim 根据当前构建生成的 header fingerprint，只最小解析
    49-byte 角色身份块；最终完整校验仍由核心 `validate()` 完成。
11. 进入首页前创建下一局 game module，并用它 initialize 和 list；选择存档
    后由新 session 认领同一个 module、设置对应启动身份，再调用 NetHack
    `main()`，由核心自行执行 `restore_saved_game()`。
12. 恢复失败不能静默开始一个同名新游戏并覆盖原存档。
13. 核心退出后必须等待 `flush()` 完成并清理旧 module，再创建下一 module、
    重新枚举并把 UI 标记为已经安全返回主界面。

### 4.3 Continue UI

- 没有存档时，`Continue` 保持 disabled。
- 有至少一个可继续存档时，`Continue` 启用。
- 点击后从 Continue 按钮右侧展开存档列表，不切换主界面。
- 点击弹层以外的空白区域或按 Escape 关闭；展开时 New Game 仍可直接启动。
- 本版本只显示格式评审确认能够可靠读取的字段。
- 无法读取元数据的文件显示为不可继续，并提供错误状态；不得猜测。
- 每个存档项右端提供红色垃圾桶按钮；无法继续的存档仍可删除。
- 第一次点击垃圾桶只在按钮上方显示 `Sure?`，第二次点击才执行删除。
- 删除完成并成功 flush 后才重新枚举列表；失败时写回原始 bytes、再次
  flush，并保留列表项显示错误。
- `Settings` 始终 disabled。

### 4.4 单元测试要求

- 首次 initialize 挂载 `/save` 并调用 `syncfs(true)`。
- 重复 initialize 不重复挂载。
- 并发调用 flush 时严格按队列顺序执行。
- IndexedDB 缺失、挂载失败、读取失败和同步失败均有确定返回结果。
- 文件筛选排除临时、备份和无关文件。
- 空列表使 Continue disabled，非空列表使其 enabled。
- 选择存档时把正确身份传给认领当前 module 的新 session，不创建第二个
  module。
- 恢复失败时原文件仍然存在，不创建同名新游戏。
- 删除前复制原始 bytes；删除 flush 失败时写回并再次 flush。
- 过期 module、活动 session 和未在当前列表中的路径不能触发删除。
- 删除二次确认、pending 防重复和失败保留列表项均有组件测试。
- session 退出前不会提前报告保存成功。

### 4.5 自动验收标准

- storage service 单元测试使用内存 FS fake，不依赖真实浏览器。
- 真实浏览器测试验证保存后刷新页面仍能枚举存档。
- 真实浏览器测试验证继续游戏经过核心恢复路径，而不是创建新角色。
- 真实浏览器测试验证第二次确认后删除，并在刷新页面后仍不存在。
- 模拟 `syncfs` 失败时不会显示“保存成功”。
- 原有 IDBFS 集成测试迁移后继续通过。

### 4.6 手动观察标准

- 无存档首次启动时 Continue 不可用。
- 保存一局并刷新页面后 Continue 可用。
- 存档列表和实际可恢复游戏一致。
- 选择存档后恢复原角色、地图和消息历史。
- 禁用浏览器 IndexedDB 后仍可临时新游戏，并看到明确警告。

## 5. 阶段三：导入、导出及保存并返回主菜单

### 5.0 导入导出设计评审门禁

本阶段第一版已经确认只实现 raw NetHack historical save：

- 不增加 BlissHack 容器、manifest、checksum 或 build ID；
- 不实现 `sfctool` portable format 或跨 ABI 转换；
- MIME type 使用 `application/octet-stream`，下载扩展名使用 `.nhsave`；
- 单文件上限 64 MiB，上传文件名不参与身份判断；
- 同名冲突由 save 内部角色名决定，必须显示双方文件时间以及
  role/race/gender/alignment，并由用户选择取消或覆盖；
- 覆盖采用临时文件、内存 bytes 备份和失败回滚；
- 真实 `/save` 文件继续是唯一事实来源，不增加 sidecar index。

完整格式、事务和 UI 设计见
`doc/BlissHack/plans/in-prealpha-2/raw-save-import-export.md`。

### 5.1 保存并返回主菜单

1. 游戏 screen 提供 `Save and Return` 命令。
2. 该命令只在核心处于可接收顶层游戏命令的状态时启用；菜单、`yn`、
   `getlin` 和其他阻塞输入期间禁用。
3. 前端通过标准按键输入触发 NetHack 保存，不直接调用 `dosave()`。
4. NetHack 的确认问题继续由现有 shim 输入 UI 处理。
5. 只有收到核心退出回调且 `flush()` 成功后，才回到主界面并报告保存
   成功。
6. 保存被玩家取消时保持当前游戏和 session。
7. 保存文件写入成功但 IDBFS 同步失败时进入可恢复错误状态，不得显示
   成功，也不得立即开始新 session。
8. `pagehide` 可以尽力 flush 已有文件，但不能作为该功能的成功路径。

### 5.2 导出需求

- 只能从主界面或存档列表导出，不在活动游戏中读取可能变化的文件。
- 导出前等待所有 storage operations 完成。
- 导出内容是 IDBFS 中未经包装的原始 NetHack save bytes。
- 下载扩展名为 `.nhsave`，MIME type 为 `application/octet-stream`。
- 导出文件名必须可读、可跨平台保存，不包含路径分隔符。
- 导出不修改、删除或锁定原存档。
- 下载失败时原存档保持不变，并显示可理解的错误。

### 5.3 导入需求

- 只能在没有活动 session 时导入。
- 导入事务实现放在 `frontend/src/storage/storage-transaction.ts`，
  不写入 React screen 或 bridge。
- 使用浏览器文件选择器读取，不接受远程 URL。
- 每次只导入一个文件；空文件和超过 64 MiB 的文件在读取前拒绝。
- 在写入正式存档前完成 raw save fingerprint、身份块和角色信息校验。
- 上传文件名不决定目标；目标始终是身份块角色名对应的 `/save/0<角色名>`。
- 不兼容文件不得写入正式路径。
- 同名冲突必须让用户明确选择取消或替换，不允许静默覆盖。
- 冲突提示同时展示双方的文件修改时间以及
  role/race/gender/alignment。
- 替换采用临时文件和内存 bytes 备份，任何一步失败都恢复旧存档。
- 导入成功的定义是正式文件可读且 `syncfs(false)` 成功。
- 导入完成后重新从 IDBFS 枚举列表，不能只修改 React 内存。
- 临时文件在成功后清理；失败恢复所需备份不得提前释放。
- 没有本地存档时 Continue 仍可打开 popover，以便使用 Import。
- 普通失败显示只有 `OK` 的错误对话框；确认后关闭 popover 回到 Home。
- 成功后在 Import 按钮上方短暂显示 `Import successful`，并立即显示重新
  枚举的列表。

### 5.4 阶段二删除功能边界

本地存档删除已按用户确认提前在阶段二完成。它只操作当前 IDBFS 中的正式
save，不决定导出格式、导入冲突或覆盖策略。阶段三增加导入导出后，可以再
评审是否在删除确认中建议先导出，但不得改变阶段二已有的二次确认和失败回滚。

### 5.5 单元测试要求

- `Save and Return` 在错误输入阶段保持 disabled。
- 连续点击保存只发送一次保存命令。
- 玩家拒绝保存后回到 `playing`，不会返回主界面。
- 核心退出但 flush 失败时不会报告成功。
- 导出 bytes 与存储中的原文件完全一致。
- 无效版本、空文件、超大文件和截断文件均被拒绝。
- 同名导入取消时不修改任何文件。
- 同名替换成功时旧文件被新文件取代。
- write、rename、delete 或 flush 任一步失败时旧文件 hash 不变。
- 导入成功后不存在遗留临时文件。
- 删除失败后 UI 与重新扫描结果一致。

### 5.6 自动验收标准

- 所有存档操作单元测试通过。
- Playwright 能捕获导出下载并验证 raw save bytes。
- Playwright 能上传刚导出的文件并继续该游戏。
- 测试覆盖导入冲突的取消和替换路径。
- 测试覆盖同步失败，不产生虚假的成功状态。

### 5.7 手动观察标准

- 保存并返回过程具有明确的 saving 状态，按钮不能重复点击。
- 保存完成后主界面 Continue 立即可用。
- 下载文件名和错误提示可理解。
- 删除本地存档后导入导出文件，可以恢复同一角色。
- 导入错误文件不会让已有存档消失或变得不可继续。

## 6. 阶段四：长流程测试和导入失败路径测试

### 6.1 目的

验证多次创建 WASM、IDBFS 同步、导入替换和页面刷新组合后仍然可靠。
阶段四保留阶段三已经实现的临时文件、读回校验、内存备份和失败回滚，
不增加持久化备份文件、事务记录文件、跨刷新恢复协议或导入状态机。

当前 Emscripten IDBFS 的一次 `syncfs(false)` 使用一个 IndexedDB
读写事务提交该次同步的全部文件变化。因此，页面在导入同步期间中断后，
持久化存储应保留完整旧存档或完整新存档，不应出现只写入一部分的正式
存档。阶段四接受“无法确认覆盖是否已经完成”的交互结果，但不接受损坏
存档。

### 6.2 测试分层

1. 普通 CI 测试：
   - 每次提交运行。
   - 覆盖单次新游戏、保存、继续、退出和导入导出。
   - 总时长应适合现有 GitHub Actions。
2. 长流程浏览器测试：
   - 使用独立 npm script，例如 `test:long`。
   - 本地发布前运行，后续可配置定时 CI。
   - 失败时保留 Playwright trace、截图、console error 和 pageerror。
3. 存储失败路径单元测试：
   - 在 Vitest 中让现有内存 FS 和 `syncfs` 测试替身返回错误。
   - 不在生产代码中增加故障注入框架。
   - 不依赖浏览器随机制造磁盘故障。

### 6.3 必测长流程

- 连续执行至少 10 次“创建 session -> 开始游戏 -> 正常退出”，活动
  session 数量始终不超过一个。
- 同一存档至少执行 10 次“继续 -> 保存 -> 刷新 -> 继续”。
- 导出、删除、导入、继续至少循环 5 次，每轮导入前后存档内容逐字节一致。
- 前一局退出后的 stale callback 不影响下一局。
- 页面在游戏外进入后台再恢复，不重复加载或启动 session。
- 存档列表反复打开和重新扫描，不出现重复项目。
- 正常导入和可完成回滚的失败结束后不存在 `.tmp` 临时文件。

### 6.4 导入失败路径

使用现有 FS 和 `syncfs` 测试替身覆盖：

```text
读取导入文件
校验 raw save
写入临时文件
读回临时文件时内容不一致
将临时文件改名为正式文件
syncfs(false)
syncfs(false) 失败后的内存回滚
回滚结果再次 syncfs(false) 失败
```

测试要求：

- 冲突未确认时不写入临时文件或正式文件。
- 写入、读回或改名失败时，原正式存档 bytes 保持不变。
- 第一次 `syncfs(false)` 失败时，内存文件系统恢复原正式存档，并再次
  尝试同步回滚结果。
- 新导入没有旧存档时，失败回滚不留下正式文件。
- 不把失败的导入显示为可继续存档。
- 不删除唯一一份有效副本。
- 错误不包含存档内容。
- 成功和已完成回滚后不留下临时文件。

页面中断不通过单元测试或浏览器测试模拟跨刷新回滚，因为精确命中短暂的
同步窗口会使测试依赖执行时序。该情况保留为人工观察项。阶段四接受重新
打开应用后得到完整旧存档或完整新存档，不承诺一定恢复其中某一个版本。

### 6.5 单元测试要求

- 导入写入、读回、改名、第一次同步和回滚同步失败都有独立测试。
- 每个失败测试都验证正式文件和临时文件的最终状态。
- 现有同步队列测试继续确认多个 `syncfs` 严格按顺序执行。
- 现有 session manager 测试继续确认一次只有一个活动 session，过期
  callback 不影响下一局。
- 长流程 helper 在某一轮失败时报告准确轮次。
- 测试辅助代码本身不依赖 wall-clock sleep 或随机地图。

### 6.6 自动验收标准

- 长流程测试按规定循环次数通过。
- 导入失败路径单元测试全部通过。
- 每轮结束时界面只显示 Home 或唯一游戏界面，不出现重复 session UI。
- 浏览器控制台和 pageerror 没有未预期错误。
- 没有依赖固定地图布局、怪物行为或随机数的脆弱断言。
- 测试失败能够输出当前循环轮次，并保留 Playwright trace 和截图。
- 不新增生产环境测试接口、事务协调器或阶段五诊断日志。

### 6.7 手动观察标准

- 实际游玩至少 30 分钟后保存并恢复，操作和消息历史正常。
- 手动完成至少 10 次新游戏或继续游戏切换，无明显性能下降。
- 在主界面和游戏界面切换标签页、最小化浏览器后恢复正常。
- 导入同步期间刷新页面后重新打开应用，正式存档是可校验和可继续的旧版本
  或新版本，不出现损坏文件。
- DevTools 中没有持续增长的全局 callback 或多个活动 session。

## 7. 阶段五：致命错误页和本地诊断日志

详细设计、事件清单、隐私限制和实现边界见
`doc/BlissHack/plans/in-prealpha-2/fatal-errors-and-diagnostics.md`。

### 7.1 诊断日志

- 按发生顺序保存最多 500 条低频诊断事件，第 501 条覆盖最早一条。
- 诊断事件使用固定字段，包含顺序号、时间、严重程度、代码区域、事件名称、
  错误编号、game module ID、游戏会话 ID 和经过限制的附加字段。
- 诊断日志保存在浏览器 `localStorage` 的
  `blisshack.diagnostics.v1`；保存失败后退化为本页内存日志。
- GitHub Actions 构建使用 Git 提交编号作为构建编号，本地构建使用明确的开发
  标识。
- `warning`、`error` 和 `fatal` 同时向浏览器 Console 输出一行精简记录；
  `info` 不输出到 Console。

### 7.2 记录范围和隐私限制

- 记录应用启动、game module 创建、游戏会话状态、NetHack `main()`、
  浏览器存储操作、bridge 约束错误、浏览器未处理异常和诊断日志导出。
- 不逐条记录输入状态、按键、游戏回合、消息、菜单或地图更新。
- 不记录角色名、存档路径、存档字节、上传文件内容、错误消息正文和浏览器地址
  查询参数。
- 附加字段采用固定允许列表；JavaScript 调用位置删除错误消息行并限制行数和
  长度。
- 阶段四已经取消复杂存档事务，因此不记录事务状态机或虚构的事务步骤。

### 7.3 查看和导出

- Home 页脚和致命错误页都提供 `Export Diagnostic Log`。
- 点击后下载 UTF-8 JSON 文件 `blisshack-diagnostics.json`，其中包含格式
  版本、构建编号、导出时间、浏览器基本信息和最多 500 条诊断事件。
- 玩家也可以在浏览器开发工具的 Application 页面查看
  `blisshack.diagnostics.v1`。
- 不增加网络上传接口，不持续写入玩家选择的本地文件，不周期性触发下载。

### 7.4 致命错误

以下情况进入 fatal 应用状态：

- game module 加载器或 module factory 失败；
- NetHack `main()` 异常结束；
- bridge 回调或等待输入约束被破坏；
- 活动游戏会话退出时无法完成必要的存储同步；
- 恢复原始存档失败，应用无法确认继续操作是否安全；
- 浏览器报告未处理的 `error` 或 `unhandledrejection`；
- React 组件树发生未处理的渲染错误。

发生游戏会话级 fatal 后，session manager 删除全局回调、清除等待输入并拒绝
向旧 game module 发送后续输入。发生模块级 fatal 且没有活动游戏会话时，玩家
可以废弃失败模块并返回新 Home；存在失败游戏会话时只能重新加载应用。

### 7.5 可恢复错误

浏览器不支持 IndexedDB、无效导入文件、同名导入冲突以及已经确认存档状态的
单次导入、导出或删除失败属于 warning 或可恢复错误。错误分类依据是应用能否
证明当前 game module、游戏会话和存档状态仍然有效。

### 7.6 致命错误页

- 显示固定的人类可读摘要和错误编号，不显示原始错误消息。
- 始终提供 `Export Diagnostic Log`。
- 没有活动游戏会话时提供 `Return Home`。
- 存在失败游戏会话时提供 `Reload Application`。
- React 根节点错误边界在正常界面无法渲染时提供最低限度错误页、日志导出和
  重新加载操作。

### 7.7 自动验收标准

- 写入 501 条诊断事件后只保留最新 500 条，页面恢复后顺序号继续递增。
- 浏览器本地存储损坏或抛错不会阻止应用运行。
- JSON 导出包含格式版本和构建编号，并且可以重新解析。
- 同一个错误对象只产生一个 fatal 诊断事件和一个错误编号。
- fatal 发生后旧回调、等待输入和活动游戏会话全部失效。
- 浏览器测试注入未处理 Promise 拒绝后显示 fatal 页并成功下载诊断 JSON。
- Console 与导出文件使用同一错误编号，且都不包含测试角色名、按键或游戏消息。

### 7.8 手动观察标准

- 断开或重命名 WebAssembly 资源后显示致命错误页，不显示空白页面。
- Home 和致命错误页都可以下载并阅读格式化诊断 JSON。
- 页面刷新后仍能导出上一页面保存的关键诊断事件。
- 正常游戏不会因为低频诊断事件写入产生可感知卡顿。
- 浏览器本地存储、Console 和导出文件中均不出现玩家名称、游戏对话和完整输入。

## 8. 阶段六：浏览器端到端测试

完整测试设计和实现边界见
`doc/BlissHack/plans/in-prealpha-2/browser-end-to-end-tests.md`。

### 8.1 测试环境

- 使用生产构建、Vite preview 和 Chromium。
- 普通测试使用独立浏览器上下文，页面刷新在同一个浏览器上下文中保留
  IndexedDB。
- 捕获 Console error、pageerror、下载、失败截图和执行跟踪。
- 测试失败时只读 `blisshack.diagnostics.v1`，并把诊断日志附加到 Playwright
  测试结果。
- 不依赖网络服务、外部 API、远端存档或生产测试接口。
- 普通测试分为 Home 与新游戏、保存与继续、正常退出、存档传输和失败路径
  5 个文件。

### 8.2 新游戏测试

- Home 显示 `New Game`、可用于导入的 `Continue` 和禁用的 `Settings`。
- 空存档列表显示 `No saved games`。
- 开始游戏前的诊断日志不包含 `wasm.main_started` 或 `session.created`。
- 完成名字、随机角色确认、介绍文本和教程选择后显示地图、状态和输入。
- 保存返回后，诊断日志恰好包含一个 `wasm.main_started` 和一个
  `session.created`。
- 角色选择阶段输入 `q` 能正常返回 Home。

### 8.3 保存测试

- 开始一局并移动到相邻地板，记录地图光标位置。
- 执行 NetHack 保存命令并等待 Home 出现。
- 在同一个浏览器上下文中刷新页面，重新扫描 IndexedDB。
- 断言存档身份可见并能够继续。
- 存储同步顺序和重复保存继续由单元测试验证，不加入生产故障注入接口。

### 8.4 继续游戏测试

- 继续后角色身份和地图光标位置与保存前一致。
- 不重新进入名字和角色创建流程。
- session manager 单元测试继续验证旧 game module 被废弃。
- 浏览器测试通过正式诊断日志验证连续游戏使用不同的游戏会话 ID 和 game
  module ID。

### 8.5 正常退出测试

- 在活动地图中通过 `#quit` 扩展命令主动退出。
- 完成 NetHack 原生确认、公开信息询问、文本窗口和 `--More--`。
- 等待 `shim_exit_nhwindows` 后返回 Home，不通过刷新丢弃 game module。
- 开始并保存第二局。
- 诊断日志显示两局使用不同的游戏会话 ID 和 game module ID。

### 8.6 导出和导入测试

- 保存并通过正式浏览器按钮导出 raw save。
- 删除存档，上传刚导出的文件，再次导出并逐字节比较。
- 页面刷新后继续导入的存档。
- 同名冲突测试覆盖 Cancel 和 Overwrite。
- 截断文件测试验证导入失败，并确认原存档字节不变。
- 临时文件和回滚细节继续由 storage transaction 单元测试验证。

### 8.7 失败路径测试

- Playwright 让 `nethack.js` 返回 404，致命错误页显示错误编号和
  `Return Home`，诊断日志包含 `module.loading_failed`。
- 测试浏览器不提供 IndexedDB 时，Home 显示存储不可用状态，`Continue`
  禁用，但允许开始临时游戏。
- 未处理 Promise 拒绝显示游戏会话级致命错误，并能导出不含玩家输入的诊断
  日志。
- 真实 IDBFS populate、flush 和 rollback 回调失败继续由单元测试覆盖。
- 过期回调继续由 session manager 单元测试覆盖，不增加全局测试接口。

### 8.8 相关单元测试要求

- app reducer 的新游戏、保存、继续、退出和 fatal 转换已由单元测试
  覆盖，浏览器测试不重复模拟 reducer 内部实现。
- storage service 测试覆盖 mount、populate、flush 和队列失败。
- storage transaction 测试覆盖临时写入、读回、改名、同步和回滚失败。
- session manager 测试覆盖游戏会话 ID、game module ID、过期回调和输入失效。
- 浏览器合法导入数据来自真实导出的 raw save，不维护伪造合法存档生成器。

### 8.9 自动验收标准

以下命令全部通过：

```bash
cd frontend
npm run lint
npm test
npm run build
npm run test:integration:wasm
npm run test:integration:browser
npm run test:long
```

所有强制 Playwright case：

- 不得有未预期 console error。
- 不得有 pageerror。
- 不得依赖测试执行顺序。
- 普通浏览器测试 15 条全部通过，长流程测试 4 条全部通过。
- 单个失败必须生成截图、执行跟踪和浏览器本地诊断日志。

### 8.10 手动最终验收

1. 在全新浏览器配置中打开线上构建，确认主界面初始状态。
2. 新建一局，保存并返回，刷新后继续。
3. 导出存档，清除站点数据，重新打开后导入并继续。
4. 正常退出一局并开始第二局。
5. 模拟 WASM 加载失败并导出诊断日志。
6. 在桌面和移动 viewport 检查主界面、游戏和错误页。
7. 确认日志没有玩家输入或游戏内容。

## 9. 阶段交付和评审点

每一阶段按以下顺序交付：

1. 先补充或更新该阶段单元测试。
2. 实现最小功能。
3. 运行单元、构建和相关集成测试。
4. 提交独立 commit，避免跨阶段混杂。
5. 向用户报告自动测试结果和需要手动观察的项目。
6. 用户确认后进入下一阶段。

强制暂停点：

- 阶段一完成后，审核主界面、状态机和 session 生命周期行为。
- 阶段二开始时，详细讨论并确认浏览器内存储、读取、校验和 module 生命周期。
- 阶段三开始时，详细讨论并确认导入、导出、删除和覆盖方案。
- 阶段三完成后，人工执行一次导出、删除、导入和继续。
- 阶段六完成后，执行全部自动命令和手动最终验收。

## 10. prealpha-2 完成定义

只有同时满足以下条件，prealpha-2 才算完成：

- 所有六个阶段的功能需求和自动验收标准通过。
- 主界面、新游戏、继续、保存、退出、导入和导出形成闭环。
- 任意时刻至多一个活动 WASM session。
- 正常退出后能够创建全新 WASM session。
- 导入任何失败点都不会丢失原有效存档。
- 致命错误不会留下可继续操作的错误会话。
- 本地日志最多 500 条且可导出，不包含规定禁止的数据。
- 全部现有测试无回归，新增浏览器和长流程测试稳定通过。
- 用户完成手动最终验收。

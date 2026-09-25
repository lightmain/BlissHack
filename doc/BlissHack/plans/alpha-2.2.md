# BlissHack alpha-2.2 计划

## 1. 文档状态

本文定义 alpha-2.2 的产品范围、兼容边界、目标架构、实施阶段和验收门禁。
alpha-2.2 已于 2026-09-22 完成实现、自动门禁和人工验收。最终验收记录见
`doc/BlissHack/plans/in-alpha-2.2/release-acceptance.md`。

alpha-2.2 聚焦三类信息与流程体验：

1. 增加原版与详细两档信息量，当前只控制状态栏字段的解释性悬停内容。
2. 增加原版与 BlissHack 两种终局总结风格，将串行披露流程收集为多 Tab
   结果页。
3. 增加原版与 BlissHack 两种开局角色选择风格，将姓名和角色四要素集中到
   一个支持鼠标与连续键盘输入的界面。

本版本优先保持 NetHack 核心规则、窗口接口和上游可合并性。不得为了界面便利
修改角色合法性、随机生成、存档恢复或终局计分规则。

最终交付包括：

- 分支、版本和真实 WASM 开局/终局 characterization 基线已建立。
- profile v3、三项设置、旧 profile 迁移及三代本地键治理已完成。
- `informationLevel` 已接入状态栏说明，且与 XP、地图和背包检查保持独立。
- 当前构建的权威角色元数据、启动控制契约和统一角色选择界面已完成。
- 终局采集、分 Tab 结果页、本地 Ranking、备份 schema v2 和原版兼容路径已完成。
- 单元、WASM、Chromium、Firefox、WebKit、性能和长流程门禁均已通过。

## 2. 版本目标

alpha-2.2 完成以下目标：

1. 将“信息量”建立为独立的前端展示设置，不再与 `showExperience` 互相派生。
2. 保留当前 XP 显示开关及其运行时更新语义。
3. 在详细信息量下显示状态字段说明，在原版信息量下保持原版可获得的信息边界。
4. 用同一角色创建界面完成姓名、职业、种族、性别和阵营选择。
5. 对已有存档名直接继续游戏，并展示和锁定该存档的角色身份。
6. 支持鼠标选择和按 accelerator 连续选择四个角色要素。
7. 在 BlissHack 终局模式下自动完成原生 disclosure 问答，保留核心生成的全部
   结果并集中展示。
8. 死亡、逃离和飞升均进入统一的多 Tab 终局结果页，确认后返回 Home。
9. 原版开局和原版终局路径保持当前行为。

## 3. 当前基线

### 3.1 Settings 与 profile

- 当前 profile 是严格 schema v2，未知字段和缺失字段都会被拒绝。
- `interface` 保存地图 renderer、字体、消息行数、Follow 和永久背包布局。
- `nethack.showExperience` 独立控制核心 `showexp`，可在游戏内通过版本化
  runtime settings 协议更新。
- Settings 同时用于 Home 默认值和当前游戏；并非所有设置都适合在当前 session
  立即生效。

### 3.2 开局流程

- `main()` 启动后先通过 `shim_askname` 获取姓名。
- 核心随后以姓名查找存档；命中时直接恢复，不进入角色选择。
- 新名字进入 `shim_player_selection()`。
- WASM 专用 `shim_player_selection()` 先调用无参数、返回 boolean 的
  `shim_player_selection_or_tty`：
  - 返回 `true` 时继续使用 `genl_player_setup()` 原生串行流程。
  - 返回 `false` 时认为窗口端已经写好 `flags.initrole`、
    `flags.initrace`、`flags.initgend` 和 `flags.initalign`。
- 四个 `flags.init*` 已通过 `globalThis.nethackGlobal.globals` 暴露。
- 当前前端只把已有存档的姓名传给输入控制器；完整 `SaveIdentity` 尚未进入
  开局输入状态。

### 3.3 终局流程

原生 `really_done()` 的主要可见顺序为：

1. inventory；
2. attributes；
3. vanquished creatures；
4. genocided/extinct species；
5. conduct and achievements；
6. dungeon overview；
7. 墓碑或逃离/飞升文字总结；
8. score list；
9. `exit_nhwindows()` 和 `main()` 结束。

当前桥接把这些内容作为普通 `yn`、menu、text 和 blocking display 逐项呈现。
session 的 `mainPromise` 完成后会 flush 存储、退休 module 并准备返回 Home，
尚无可在 session 结束后保留的结果状态。

### 3.4 已有可复用边界

- `input-controller.ts` 是唯一 pending input owner。
- `game-state.ts` 已完整保存 text/menu window 内容，并能在窗口销毁前复制。
- `GameModalRenderer` 已支持通用菜单和文本内容。
- `AppState` 是 Home、Settings、Session 和 Fatal 的唯一顶层状态机。
- Home module 在开始游戏前已经完成 IDBFS 初始化和存档枚举。
- `SaveIdentity` 已包含姓名、职业、种族、性别和阵营。
- `sys/libnh/libnhmain.c` 是 WASM 专用适配层，已经负责向 JavaScript 暴露常量、
  指针和少量全局变量。

## 4. 已确定的产品决策

### 4.1 新设置

profile v3 增加以下设置：

```ts
interface InterfaceSettingsV3 {
  informationLevel: "original" | "detailed";
  endgameStyle: "original" | "blisshack";
  characterSetupStyle: "original" | "blisshack";
}
```

字段并入现有 `InterfaceSettings`，实际类型还包含 v2 的所有既有字段。

默认值：

| 设置 | 默认值 |
| --- | --- |
| `informationLevel` | `original` |
| `endgameStyle` | `original` |
| `characterSetupStyle` | `original` |

选择默认 `original` 是为了让旧用户升级后不被自动切换到新的交互流程。
该表记录 alpha-2.2 引入这些字段时的默认值；当前新建 profile 已改为
`detailed`、`blisshack`、`blisshack`，历史 profile 迁移仍保持
`original`。

### 4.2 profile v3 迁移

- v1 继续先按现有规则迁移为 v2 语义，再补齐 v3 字段。
- v2 的三个新字段全部迁移为 `original`。
- `nethack.showExperience` 原样保留，不迁移、不重命名，也不由
  `informationLevel` 派生。
- 导入、导出、差异预览、恢复默认值和 backup 内嵌 profile 均使用 v3。
- localStorage key 随 schema 更新为 `blisshack.profile.v3`；仅在没有 v3 时
  读取和迁移旧 key。
- profile schema 与 runtime settings protocol 是不同版本域。新增纯界面设置
  不要求提升当前 WASM runtime settings protocol 版本。

### 4.3 信息量语义

`informationLevel` 当前只控制状态栏解释性悬停：

- `original`：St、Dx、Co、In、Wi、Ch、AC、状态和其他字段不显示额外玩法说明。
- `detailed`：显示项目维护的字段说明和当前值。
- HP、Energy、XP 的可见数值和进度条不受影响。
- `showExperience` 继续单独决定经验字段是否由核心启用和显示。
- 地图 `clicklook`、物品名称、右键操作菜单和鉴定状态不受影响。
- 不因选择 `original` 删除屏幕阅读器需要的名称、值和语义。

本版本不接入 Wiki，不增加状态字段的嵌套百科说明。后续详细信息扩展必须继续
遵守可见性和鉴定规则。

### 4.4 开局角色选择布局

BlissHack 角色选择使用一个独立、占据主要游戏区域的界面：

```text
┌──────────────┬──────────┬──────────┬──────────┬──────────┐
│ 角色预览      │ 职业      │ 种族      │ 性别      │ 阵营      │
│ Tiles / @    │          │          │          │          │
│ 姓名          │          │          │          │          │
└──────────────┴──────────┴──────────┴──────────┴──────────┘
  [自动] [自动并开始] [确定]
```

- 五列区域中右侧四列等宽。
- Tiles 模式显示当前角色预览；ASCII 模式显示 `@`。
- 开局时 HP、Energy 和六项属性尚未由 `newgame()` 生成，因此本版本不显示
  虚构的当前属性、进度条或随机结果。
- 不自动填写上一局姓名。
- 进入界面后姓名输入框自动获得焦点。
- Escape 或明确的取消动作保留原版 `q` 的退出语义并返回 Home。

### 4.5 开局键盘与鼠标流程

姓名阶段：

- 空姓名不能提交。
- Enter 对姓名执行与当前 `normalizePlayerNameInput()` 相同的 trim 和
  31-byte UTF-8 截断。
- 已有存档匹配使用核心启动前已枚举的完整 `SaveIdentity`，不另建文件名猜测。

新名字：

1. Enter 后焦点进入第一个尚未确定的角色要素列。
2. 每列可用鼠标点击。
3. 每列保留核心对应选项的 accelerator；按下字符立即选择。
4. 选择后焦点移动到下一个尚未确定的列。
5. 四项都确定后，Enter 等价于点击“确定”并开始游戏。
6. 点击先前列可以修改选择；不合法的后续值立即清除或禁用。
7. 焦点移动不能触发页面滚动，也不能把字符送入普通游戏 typeahead。

已有存档名：

- 右侧四列禁止修改。
- 四列高亮显示存档记录中的职业、种族、性别和阵营。
- 按钮下显示“已存在存档，将继续游戏”。
- Enter 等价于“确定”，直接让核心执行原生 restore。
- “自动”和“自动并开始”不可用。

按钮：

- “自动”：对应原版 `y`，由核心生成完整合法组合，再回到当前界面供用户检查
  或修改。
- “自动并开始”：对应原版 `a`，由核心生成完整合法组合并立即开始。
- “确定”：仅在姓名非空且四项完整时可用；已有存档名是例外，直接继续。
- 前端不得自行实现随机分布；`y` 和 `a` 继续消费核心原生随机流程。

### 4.6 终局结果页

BlissHack 终局模式覆盖死亡、逃离和飞升。普通退出、启动取消、restore 失败和
fatal error 不进入终局结果页。

界面结构：

- 顶部为可横向滚动的 Tab 列表。
- 第一项固定为“总结”，显示核心生成的墓碑或逃离/飞升总结。
- 后续只显示实际产生内容的 disclosure Tab。
- score list 有内容时作为“排名”Tab 放在最后。
- 主体内容保留核心文本属性和等宽排版，长内容在 Tab 内独立滚动。
- 底部只有一个固定的“确定”按钮。
- 切换 Tab 不改变按钮、不恢复核心输入，也不改变结果数据。
- 点击“确定”后释放结果状态并返回 Home。

终局结果必须保存核心实际生成的文本和菜单内容，不在 TypeScript 中重新计算：

- 死因；
- 分数、金币、回合和等级；
- 已鉴定财产及容器内容；
- 属性和能力；
- 击杀、灭绝和灭族列表；
- conduct 和 achievements；
- dungeon overview；
- 排名。

### 4.7 原版模式

- `characterSetupStyle="original"` 时完全保留当前姓名输入、`[ynaq]`、四段菜单
  和最终确认流程。
- `endgameStyle="original"` 时完全保留当前串行 disclosure、墓碑、总结和排名。
- 两种模式共享同一核心规则和存档格式。
- 在游戏内修改角色选择风格只影响下一次新游戏。
- 在游戏内修改终局风格应用于当前游戏的最终结算及后续默认值。
- 信息量在当前游戏中立即生效，因为它不需要进入 WASM。

## 5. 上游兼容与修改边界

### 5.1 硬性约束

alpha-2.2 不得：

- 修改 `src/role.c` 的角色合法性、随机或确认流程。
- 修改 `src/end.c` 的 disclosure、计分、bones、墓碑、排名或退出顺序。
- 改变 `struct window_procs`。
- 改变任何现有 shim callback 的名称、参数格式或返回类型。
- 根据 WASM 内存偏移猜测 role、race、program state 或终局数据。
- 根据英文菜单文本决定角色是否合法。
- 在 Asyncify callback pending 期间通过 `ccall()` 重入核心。
- 在前端重新实现终局计分、物品鉴定或角色初始化。

### 5.2 首选实现层

优先顺序：

1. 复用现有 callback 和 `flags.init*` 全局绑定。
2. 在 TypeScript bridge/game state/session 层实现新的交互状态。
3. 确有必要时，仅在 `sys/libnh/libnhmain.c` 增加 Emscripten 专用、只读的
   元数据或状态暴露。
4. 只有前述方式经测试证明无法完成需求时，停止实施并单独评审 shim 或核心
   修改，不在原阶段中顺手扩大 C 改动。

### 5.3 允许评审的 WASM 适配扩展

角色选择可能需要从 `libnhmain.c` 暴露以下只读数据：

- 职业、种族、性别和阵营的稳定索引；
- 显示名和 file code；
- accelerator；
- compatibility mask；
- 角色预览所需的 monster/glyph/tile 标识。

终局识别可能需要暴露 `program_state.gameover` 的只读 boolean。该值只用于
区分普通游戏 `yn` 与终局 disclosure，不用于改变核心状态。

这些扩展必须满足：

- 不改变 shim ABI。
- 不新增 React 到 C 的运行时重入调用。
- 不导出结构体地址供 TypeScript 长期保存。
- 每个字段通过现有 typed global/constant 机制复制或绑定。
- 上游表项变化后，测试必须失败而不是静默错配。
- 修改按项目规则标注 BlissHack、日期和目的，并更新 shim/上游修改文档。

## 6. 目标架构

### 6.1 profile

建议演进：

```text
BlissHackProfileV1
  -> BlissHackProfileV2
  -> BlissHackProfileV3
```

不得修改旧版本 validator 来接受新字段。每个历史 schema 先严格验证，再通过
显式 migrator 生成 v3。

### 6.2 CharacterSetupController

角色创建需要独立于普通 `GameActionController`。后者只服务已经进入游戏后的
命令边界，不应持有启动角色状态。

建议状态：

```text
idle
-> entering-name
-> checking-name
-> continuing-save

checking-name
-> selecting-role
-> selecting-race
-> selecting-gender
-> selecting-alignment
-> ready
-> starting-new-game

任意未开始状态
-> cancelled
```

状态至少包含：

- module ID 和 session ID；
- 规范化姓名；
- 匹配的 `SaveIdentity` 或 null；
- 四项选择的核心索引；
- 每项合法候选与 accelerator；
- 当前键盘焦点列；
- Tiles/ASCII 预览信息；
- pending `shim_askname` 或 `shim_player_selection_or_tty` 所有权。

职责边界：

- `input-controller.ts` 继续拥有 Promise resolver 和 Asyncify pending action。
- CharacterSetupController 只做纯状态转换和合法 UI 事件编排。
- React 不直接写 WASM 指针；最终提交通过 bridge 函数一次写入
  `svp.plname` 和 `flags.init*`。
- `shim_player_selection_or_tty` 在原版模式立即返回 `true`。
- BlissHack 手动选择完成后写入完整 `flags.init*` 并返回 `false`。
- BlissHack 的“自动”和“自动并开始”返回 `true`，随后只在角色控制器确认的
  初始 `[ynaq]` 请求上分别提交 `y` 或 `a`。任何非预期请求都停止自动步骤并
  回退原版呈现。
- “自动”在核心到达最终确认菜单后读取已确定的 `flags.init*`，继续用统一界面
  展示结果；“确定”再提交原生确认。该过程不预先排队多个按键。

### 6.3 角色合法组合

角色目录必须来自当前构建，不得在 TSX 中手写 NetHack 5.0 列表。

前端可从当前构建提供的 option metadata 建立完整合法 tuple 集：

```ts
interface CharacterTuple {
  role: number;
  race: number;
  gender: number;
  alignment: number;
}
```

每次选择后，候选项通过“至少存在一个包含当前部分选择的合法 tuple”决定：

- 有合法补全的项可选。
- 没有合法补全的项禁用。
- 修改前置项后，不再兼容的后置选择清空。
- tuple 只服务手动选择的候选过滤；随机操作仍交给核心。

若无法证明 metadata 与核心 `valid*`/`ok_*` 结果一致，停止该阶段并评审，
不得以手工例外列表补洞。

### 6.4 EndgameCollector

终局采集器位于 bridge/input 与 game-state 之间，只在以下条件同时满足时启用：

- 当前 session 的 `endgameStyle` 是 `blisshack`；
- 核心已经进入可验证的 game-over 状态；
- session 不是 fatal、restore failure 或用户在角色选择中退出。

建议状态：

```text
idle
-> collecting-disclosure
-> collecting-summary
-> collecting-ranking
-> complete
```

行为：

1. game-over 状态中的 disclosure `yn` 自动按 `y` 处理。
2. 每个问题建立一个暂存 section；没有后续内容的 section 最终丢弃。
3. blocking text 和 `PICK_NONE` menu 内容复制到当前 section 后立即向核心确认。
4. 同一 disclosure 下的 inventory 和嵌套 container 窗口归入同一 section。
5. 核心销毁正常 HUD 的 map/status/message 窗口后，后续 end window 归为总结。
6. 总结窗口之后产生的 score window 归为排名。
7. `main()` 正常完成后冻结不可变 `EndgameSummary`。
8. 任一非预期可交互菜单、数字输入、getlin 或不支持的 prompt 都停止自动化，
   回退到原版呈现，不丢失当前核心输入。

采集器不得依赖固定延时。问题文本可以作为用户可见 Tab 标签的来源，但不能作为
判定游戏规则、合法选项或数据结构的唯一依据。

### 6.5 AppState 与 session 生命周期

新增顶层结果状态，建议形式：

```ts
{
  phase: "end-summary";
  completedSessionId: string;
  nextModuleId: string | null;
  summary: EndgameSummary;
}
```

生命周期：

1. 核心完成全部结算。
2. session manager flush IDBFS。
3. 退休已结束 module、清理 callback 和 pending input。
4. 保留不可变终局结果，进入 `end-summary`。
5. 可在后台或确认后准备下一 Home module，但同一时刻仍不得存在两个活动
   NetHack session。
6. 用户点击“确定”后进入 Home。

终局结果不能依赖已退休 module、window ID、WASM 指针或全局 callback。

### 6.6 本地 Ranking 持久化

alpha-2.2 只实现浏览器本地 Ranking，不实现或预留全球排行榜服务。

- NetHack 核心继续读写根目录 `/record`，不改变原版记录格式和
  `SCOREPREFIX`。
- storage service 将经过有界结构校验的原始 bytes 镜像到
  `/save/.ranking-record`，由现有 `/save` IDBFS 和游戏锁负责持久化与并发。
- module 初始化及跨页面 refresh 后从 sidecar 恢复 `/record`；损坏 sidecar
  回退到构建内空记录并写入不含内容的诊断事件。
- 原版终局会在 `shim_exit_nhwindows` 之后才调用 `topten()`，因此 `main()`
  正常返回后必须再执行一次最终 flush，之后才能退休 module。
- 完整备份 schema v2 增加带长度、SHA-256 和 Base64 的 Ranking payload；
  schema v1 继续导入，并保留导入前的本地 Ranking。
- `Clear Local Data` 同时清除存档、Ranking、profile 与 diagnostics，普通失败
  使用同一有界快照补偿恢复。
- WASM sysconf 使用 `PERS_IS_UID=0`。Emscripten 中所有玩家 UID 都是 0，
  按姓名区分才能避免不同角色共享同一 `PERSMAX` 限额。

## 7. 快速再来一局

“以当前角色配置快速再来一局”不作为 alpha-2.2 完成条件，作为 stretch goal。

本版本主体实现应为未来保留：

```ts
interface CharacterPreset {
  playerName: string;
  role: number;
  race: number;
  gender: number;
  alignment: number;
}
```

只有同时满足以下条件时才允许在 alpha-2.2 末期加入按钮：

- 新游戏和继续游戏都能获得不依赖显示文本解析的 preset。
- 已结束 session 已完全 flush 和退休。
- 新 module 可以在不复用旧 WASM 指针的情况下接收 preset。
- 同名存档冲突有明确行为且不会意外 Continue。
- 原版和 BlissHack 角色选择模式的语义已经覆盖测试。

若任一条件未满足，按钮延后到后续版本；alpha-2.2 只保存必要的结果身份数据。

## 8. 分阶段实施

每个开发阶段严格遵循：

```text
测试 subagent
-> 提交失败测试或 characterization baseline
-> 主 Agent 实现
-> 独立 reviewer
-> 修正 findings
-> 阶段完整验证
-> 阶段 commit
```

### 阶段零：分支、版本与基线

1. 确认 alpha-2.1 已完成人工验收并位于预期基线。
2. 创建 alpha-2.2 开发分支。
3. 根 `VERSION` 更新为 `alpha-2.2`。
4. 运行工具链预检。
5. 若版本写入 WASM runtime manifest，重新构建并提交运行时三件套。
6. 记录现有角色选择、已有存档恢复和终局串行流程的真实 WASM
   characterization。

建议提交：

```text
chore: start alpha-2.2 development
test: characterize alpha-2.2 startup and endgame flows
```

### 阶段一：profile v3 与设置界面

测试优先定义：

- v1、v2 严格迁移到 v3。
- v3 缺失、未知和非法枚举字段被拒绝。
- 三个新设置正确保存、导入、导出和恢复默认值。
- `showExperience` 与 `informationLevel` 完全独立。
- 游戏内只对适用设置显示正确的生效范围。

实施：

1. 新增三个枚举及 v3 类型。
2. 建立 v1 -> v2 -> v3 显式迁移链。
3. 更新 profile store key 和 legacy fallback。
4. Settings 使用 segmented controls 呈现三项设置。
5. 更新 profile diff 标签和 backup/profile 测试。

建议提交：

```text
feat: add alpha-2.2 presentation settings
```

### 阶段二：状态栏信息量

测试优先定义：

- `original` 不显示状态字段的解释性可见 Tooltip。
- `detailed` 显示说明和当前值。
- 两种模式下无障碍名称和值一致。
- XP 是否存在只取决于 `showExperience`。
- 地图和背包 Tooltip 不受信息量设置影响。
- 游戏内切换立即生效且不产生核心输入。

实施仅限前端状态语义层、`StatusArea` 和 Tooltip presentation。

建议提交：

```text
feat: add status information levels
```

### 阶段三：角色元数据与启动控制契约

先验证不改变 shim ABI 的方案：

1. 确认角色表和 compatibility mask 在 `libnhmain.c` 初始化时可安全复制。
2. 确认 tile/glyph 预览在角色选择时已经可用；不可用则只显示稳定的角色
   ASCII 或通用 `@`，不得提前初始化游戏。
3. 建立角色目录 decoder 和合法 tuple 纯函数。
4. 将完整已有存档 identity 传入角色启动上下文。
5. 为 `shim_player_selection_or_tty` 增加 BlissHack 模式的 pending action，
   但不改变 callback 签名。

门禁：

- 原版路径仍同步返回 `true`。
- BlissHack 完整选择返回 `false`。
- cancel 保留退出语义。
- callback pending 期间没有 `ccall()`。
- 元数据与核心至少覆盖所有合法 tuple 的一致性验证。

建议提交：

```text
test: define character setup contracts
feat: expose wasm character metadata
```

若不需要修改 `libnhmain.c` 即可获得权威数据，则省略第二个提交和 runtime
重建。

### 阶段四：BlissHack 角色选择界面

测试优先定义：

- 初始焦点位于姓名。
- 空姓名不能前进。
- 新名字 Enter 后焦点进入第一个待选列。
- accelerator 选择后逐列移动焦点。
- 鼠标选择和键盘选择产生相同状态。
- 修改前置选择会清理非法后置值。
- 第四项后 Enter 开始。
- 自动通过核心 `y` 填充并停在统一确认界面。
- 自动并开始通过核心 `a` 立即提交。
- 已有存档锁定并高亮四项，Enter 直接 Continue。
- Escape 返回 Home，不创建新游戏地图。
- Tiles/ASCII 预览均不依赖未初始化状态值。

真实 WASM 浏览器测试必须覆盖：

- 一次键入姓名和四个 accelerator 后进入地图。
- 自动、自动并开始、确定和取消。
- 已有存档名直接恢复。
- 原版设置仍显示当前串行流程。
- Firefox 和 WebKit 的焦点移动及 Enter 行为。

建议提交：

```text
feat: add unified character setup
```

### 阶段五：终局采集契约

先建立真实 WASM characterization：

- 至少一种普通死亡。
- 可测试的逃离和飞升路径；必要时使用测试构建或确定性的测试 fixture，
  不在产品构建开放 wizard helper。
- 有/无 inventory、vanquished、genocided、conduct、overview 内容。
- end window 与 score window 的创建、显示、销毁顺序。
- session `mainPromise`、`exit_nhwindows` 和 storage flush 顺序。

测试优先定义：

- 只在已验证 game-over 状态自动回答。
- 普通游戏中的相同 `ynq` 不被自动回答。
- 多窗口 disclosure 被归入同一 section。
- 空 section 被省略。
- 总结始终排第一，排名始终排最后。
- 捕获后核心 blocking display 得到准确确认。
- 非预期输入立即回退原版 UI。
- reset、fatal 和 session 替换清理 collector。

建议提交：

```text
test: define endgame collection contracts
feat: collect structured endgame output
```

### 阶段六：终局结果页与应用生命周期

实施：

1. 新增不可变 `EndgameSummary` 模型。
2. 增加 `end-summary` 顶层 app phase。
3. 调整正常 session 退休流程，使结果在 module 清理后仍存在。
4. 增加多 Tab 结果页和底部固定“确定”按钮。
5. 对长 inventory、overview 和 ranking 建立独立 overflow。
6. 原版模式不创建 collector 或结果页。

测试覆盖：

- 死亡、逃离、飞升的总结首栏。
- Tab 键盘操作、焦点、ARIA 关系和滚动。
- 切换 Tab 不触发核心或改变按钮。
- 确定后只返回一次 Home。
- 结果页期间不存在活动 callback、pending input 或旧 module 引用。
- storage flush 失败仍走 fatal，不展示伪完成结果。

建议提交：

```text
feat: add tabbed endgame summary
```

### 阶段七：快速再来一局可行性门禁

只评估，不默认实现：

1. 验证 session identity 是否可结构化保留。
2. 验证结束后同名 save 的实际状态。
3. 验证 preset 能由新 module 安全消费。
4. 确定按钮行为、冲突提示和原版模式关系。

门禁通过且不扩大核心修改时，可单独提交：

```text
feat: restart with the completed character
```

否则记录为后续版本任务，不阻塞 alpha-2.2。

### 阶段八：兼容、文档与发布

1. 运行 unit、lint、build、WASM、Chromium、Firefox、WebKit、性能和长流程。
2. 为角色选择和终局页增加 1280×900、900×700 视觉回归。
3. 验证 320px 最小宽度无页面级横向 overflow；本版本仍不承诺完整移动端操作。
4. 验证 profile v1/v2/v3、backup、save import/export 和多页面锁。
5. 验证 original/original 组合与 alpha-2.1 行为一致。
6. 更新 README、frontend README、session-start、shim interface 和
   upstream modifications。
7. 独立 reviewer 检查 Asyncify、session 退休、输入归属、存档误恢复和上游
   合并风险。
8. 创建 alpha-2.2 release acceptance，停在人工验收门槛。

建议提交：

```text
test: complete alpha-2.2 workflow coverage
docs: complete alpha-2.2 acceptance
```

## 9. 测试策略

### 9.1 单元测试

- profile 三代严格迁移与导入导出。
- 信息量和 XP 开关的正交组合。
- 角色 tuple 过滤、后置清理、随机和焦点状态机。
- 姓名规范化与存档 identity 匹配。
- 终局 collector 的阶段转换、分组、fallback 和冻结。
- app reducer 的 session -> end-summary -> home 路径。
- 结果页 Tab、按钮和无障碍结构。

### 9.2 Bridge 与 WASM 测试

- 原版和 BlissHack `shim_player_selection_or_tty` 返回语义。
- 四个 `flags.init*` 的写入和新游戏实际身份。
- 已有姓名仍由核心 restore，而不是误建新角色。
- game-over 标志只在真实终局开启。
- disclosure 自动确认不会作用于普通游戏 prompt。
- 墓碑、逃离、飞升总结和 score list 均不丢失。
- 无 Asyncify 重入、双 pending action 或悬空 resolver。
- 若修改 WASM 适配层，运行时三件套版本和 manifest 一致。

### 9.3 浏览器测试

- 原版/BlissHack 开局两种风格。
- 姓名 -> 四字符 -> Enter 的快速启动路径。
- 鼠标跨列修改、非法组合禁用和自动按钮。
- 同名存档直接继续及身份高亮。
- informationLevel 游戏内即时切换。
- 三类终局结果、多 Tab 浏览和返回 Home。
- 刷新、锁竞争、存储失败和 session cleanup。
- Chromium 完整流程；Firefox/WebKit 覆盖发布关键焦点与生命周期。

### 9.4 回归范围

- `showExperience` 和 turn count 动态设置。
- 状态、地图和永久背包 Tooltip。
- 普通 menu、text、history、yn、getlin 和 extcmd。
- Save and Exit、Continue、导入导出、backup 和恢复失败。
- 角色选择 `q` 返回 Home。
- 两键 typeahead 和游戏键盘焦点。
- Tiles/ASCII、Right/Below HUD。

## 10. 人工验收

### 10.1 信息量

1. 在 `original` 下悬停 St、Dx、AC 和状态标签，确认没有额外玩法说明。
2. 切换 `detailed`，确认说明立即出现。
3. 分别开关 Show experience，确认 XP 与信息量互不影响。
4. 检查地图和背包 Tooltip 没有变化。

### 10.2 角色选择

1. 选择 BlissHack 风格并开始新游戏，确认姓名自动聚焦。
2. 输入姓名并按 Enter，再连续输入四个合法 accelerator 和 Enter。
3. 确认焦点逐列移动且最终角色身份正确。
4. 用鼠标修改前一列，确认非法后续选择被清理。
5. 分别验证自动、自动并开始和取消。
6. 输入已有存档名，确认四列锁定、高亮正确身份，Enter 继续原存档。
7. 切换 ASCII，确认预览为 `@` 且布局不跳动。
8. 选择 original，确认原生流程没有改变。

### 10.3 终局

1. 普通死亡后确认第一栏显示原生墓碑和总结。
2. 浏览财产、属性、击杀、灭绝、conduct、overview 和排名中实际存在的 Tab。
3. 确认不存在的栏目不产生空 Tab。
4. 切换 Tab，确认底部“确定”始终不变。
5. 点击确定，确认返回 Home 且本地存储已经 flush。
6. 分别验证逃离和飞升总结。
7. 选择 original，确认仍按原生串行问答显示。
8. 检查 Console 没有 pending input、旧 callback、已退休 module 或 React
   焦点错误。

## 11. 风险与处理

| 风险 | 处理 |
| --- | --- |
| profile v3 使旧设置不可读 | 严格 v1/v2 迁移、legacy key fallback、导入回归 |
| 信息量与 XP 再次耦合 | 类型和组合测试明确两者正交 |
| 角色列表复制后偏离上游 | 数据来自当前 WASM 构建，禁止 TSX 手写表 |
| 前端合法性规则偏离核心 | 完整 tuple 一致性测试；不通过即停止评审 |
| 姓名命中存档却进入新建 | 使用已枚举完整 identity，并保留核心 restore 为最终权威 |
| 连续字符进入普通 typeahead | 角色控制器独占启动阶段键盘 |
| Asyncify callback 被重入 | 只写已暴露 globals 和解析 callback 数据，不在 pending 中 ccall |
| 自动随机分布偏离核心 | 自动与自动并开始直接复用核心 `y`/`a`，不在前端随机 |
| 终局自动 `y` 误作用于普通 prompt | 必须同时验证 session style 和 game-over 状态 |
| disclosure 多窗口归类错误 | 以 collector 生命周期和窗口销毁顺序分组，文本只用于显示标签 |
| final window 被归入 overview | 以正常 HUD 销毁作为 summary 阶段边界 |
| session 结束后结果消失 | 结果复制为无 WASM 引用的 app-level immutable state |
| 结果页阻止存储 flush | 先完成 flush 和 module 退休，再展示可确认结果 |
| 上游更新造成 adapter 冲突 | 修改限于 libnh Emscripten 暴露，禁止改 shim 签名和核心流程 |

## 12. 停止条件

出现以下情况时暂停对应阶段并单独评审：

- 角色元数据只能通过结构体地址或猜测内存布局获得。
- 合法组合无法在不复制复杂核心规则的情况下验证。
- 统一角色界面必须改变 `src/role.c` 才能正确恢复已有存档。
- 自动选择必须在 Asyncify pending callback 中重入 C。
- 终局只能通过硬编码英文问题全文判断是否处于 game over。
- 自动 disclosure 会改变计分、bones、物品识别或存档清理结果。
- 终局结果必须保留已退休 module 或 window ID 才能显示。
- 原版模式不能保持当前 callback 顺序和交互。
- 快速再来一局要求绕过同名存档保护或复用旧 module。

## 13. 完成定义

alpha-2.2 只有同时满足以下条件才算完成：

1. profile v3 严格迁移、保存、导入和导出正确。
2. 信息量只控制状态栏解释性悬停，不控制 XP。
3. `showExperience` 保持独立且可在游戏内动态更新。
4. BlissHack 角色界面包含姓名和四个角色要素，支持鼠标与连续键盘输入。
5. 已有存档名直接进入核心 restore，不允许修改保存身份。
6. 角色选择使用当前构建的权威元数据，不在前端手写非法组合规则。
7. 原版角色选择路径无回归。
8. BlissHack 终局自动收集核心生成的 disclosure、总结和排名。
9. 死亡、逃离和飞升均使用统一多 Tab 结果页。
10. 确定后才返回 Home，且此前存储已 flush、旧 session 已退休。
11. 原版终局路径无回归。
12. 未改变现有 shim callback ABI，也未修改角色和终局核心流程。
13. 单元、WASM、Chromium、Firefox、WebKit、性能和长流程测试通过。
14. 独立代码审查与人工验收完成后再合入和部署。

快速再来一局不属于以上完成条件。

## 14. 计划提交序列

```text
docs: plan alpha-2.2 presentation workflows
chore: start alpha-2.2 development
test: characterize alpha-2.2 startup and endgame flows
feat: add alpha-2.2 presentation settings
feat: add status information levels
test: define character setup contracts
feat: expose wasm character metadata
feat: add unified character setup
test: define endgame collection contracts
feat: collect structured endgame output
feat: add tabbed endgame summary
test: complete alpha-2.2 workflow coverage
docs: complete alpha-2.2 acceptance
```

若角色元数据无需修改 WASM 适配层，则省略对应提交。快速再来一局只有通过阶段七
门禁后才插入独立功能提交。

## 15. 完成记录

alpha-2.2 已完成全部必需阶段。快速再来一局未纳入本版本，不影响完成定义。
实现范围、验证结果和人工验收结论记录在
`doc/BlissHack/plans/in-alpha-2.2/release-acceptance.md`。

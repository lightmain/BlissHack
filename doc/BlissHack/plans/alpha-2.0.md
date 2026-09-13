# BlissHack alpha-2.0 交互式 HUD 计划

## 1. 文档状态

本文定义 alpha-2.0 的产品范围、交互语义、架构边界、实施阶段和验收门禁。
alpha-1.1 已完成人工验收并合入 `BlissHack`；创建 alpha-2.0 开发分支和修改
根 `VERSION` 属于后续实施的第一个提交，不在本计划提交中提前执行。

alpha-2.0 是 UI 与操作版本，不是新一轮地图美术或渲染技术版本。它建立桌面
游戏 HUD、结构化角色状态、地图与物品的悬停信息、核心驱动的右键操作菜单，
以及永久背包拖放丢弃。后续 alpha-2.1 可以在本版本预留的动作栏边界上尝试
少量常用动作按钮。

## 2. 版本目标

alpha-2.0 将当前“终端区域与若干侧栏”的布局升级为占满浏览器 viewport 的
桌面游戏界面，同时保持 NetHack 核心是游戏规则和合法动作的唯一权威。

本版本完成以下六项目标：

1. 建立全屏 HUD Shell，将消息、地图、永久背包和状态固定在明确的屏幕区域。
2. 将状态文本整理为可扫描的图形化状态栏，并支持字段说明。
3. 为地图格、永久背包物品和状态字段建立统一悬停信息层。
4. 右键地图格时显示核心 `therecmdmenu` 生成的操作列表。
5. 右键永久背包物品时显示核心 `itemactions()` 生成的操作列表。
6. 允许把永久背包物品拖到地图区域，并通过原生 drop 流程丢在玩家脚下。

本版本不引入新的地图图格、漂亮渲染、动画、Travel and Act 或 PixiJS。

## 3. 当前基线

### 3.1 已有能力

- `MapViewport` 是地图 scroll container、camera、renderer 和 pointer 生命周期
  的唯一 owner。
- Tiles 使用 Canvas 2D，ASCII 使用 DOM；两者消费同一个 `MapCell[21][80]`。
- 地图保留真实 overflow，隐藏 scrollbar；右键达到 5 CSS px 后平移 camera。
- Follow player、renderer 切换和布局变化已经使用归一化 anchor。
- `input-controller.ts` 已区分 key、position、yn、line、menu、display 和
  extended-command 等核心等待状态。
- 用户 typeahead 最多缓存两个按键；alpha-2.0 不改变这个上限。
- 标准菜单已经保留 identifier、accelerator、glyph、文本、颜色和 item flags。
- 永久背包发布不可变完整快照，并提供 session 内递增 revision。
- 状态回调已经提供文本、变化方向、百分比、颜色、文本属性和 condition mask。
- NetHack 5.0 已有 `therecmdmenu`、`mouseaction`、`clicklook`、`travel` 和
  `itemactions()`，不需要前端重新实现合法动作判断。

### 3.2 当前缺口

- `MapViewport` 仍直接把鼠标手势转换成 `sendPosition()`，没有高层交互意图。
- 前端只有“核心正在等待什么”的输入控制器，没有“UI 想执行什么”的动作编排器。
- 所有标准菜单都以居中 modal 呈现，无法保留鼠标触发位置。
- 地图 glyph 没有可供 Tooltip 直接使用的权威说明文本。
- 永久背包虽然保留 identifier、accelerator 和 revision，但仍是纯展示。
- 状态组件直接消费数字字段表，缺少稳定的语义 view model 和字段说明。
- 当前 game shell 仍按终端内容自然排版，不是稳定的 viewport HUD。
- `shim_status_enablefield` 已声明，但当前函数表注册的是
  `genl_status_enablefield`，TypeScript 收不到字段名称、格式和动态启停状态。

## 4. 已确定的产品决策

### 4.1 桌面范围

- alpha-2.0 只面向桌面浏览器，不设计手机布局、触摸操作或虚拟键盘。
- “全屏 HUD”表示使用浏览器可用 viewport，不调用浏览器 Fullscreen API。
- 主要验收视口为 1280×900，最低桌面验收视口继续使用 900×700。
- 浏览器缩放和高 DPR 必须保持内容不重叠，但不承诺任意极窄窗口。

### 4.2 HUD 布局

- 消息栏是不透明的固定高度顶部区域，不覆盖地图。
- 地图占据消息栏、状态栏和永久背包之外的剩余中央空间。
- 永久背包的 `right` 模式贴齐 viewport 右侧，并占据独立布局列。
- 现有 `below` 设置继续受支持，不强制迁移用户选择。
- 状态栏贴齐 viewport 底部，并占据独立固定区域。
- alpha-2.0 在组件和 CSS Grid 中保留 action bar slot，但不显示空背景条，
  不提供动作按钮；alpha-2.1 加入首批动作后再产生可见高度。
- 当前独立的顶部品牌 header 不继续占用游戏空间；版本、诊断和设置入口移入
  暂停层或 HUD 中不挤压地图的位置。
- 加载、fatal 和锁冲突仍使用明确页面状态，不隐藏在 HUD 内。

建议布局：

```text
┌──────────────── messages ────────────────┬─ inventory ─┐
│                                           │             │
│                    map                    │             │
│                                           │             │
├──────────────── status ──────────────────┤             │
└──────────────── future action slot ──────┴─────────────┘
```

### 4.3 地图鼠标语义

普通主命令状态：

| 手势 | 行为 |
| --- | --- |
| 鼠标悬停约 300ms | 请求并显示核心权威的格子说明 |
| 左键短按 | 交给核心 `mouseaction` 执行默认动作 |
| 右键短按 | 打开核心 `therecmdmenu` 操作列表 |
| 右键移动小于 5 CSS px | 仍按右键短按处理 |
| 右键移动达到 5 CSS px | 平移 camera，不执行游戏动作 |

`mouseaction` 的现有语义保持不变：远处目标可以触发普通 Travel，邻近目标可以
移动、攻击、开门或执行核心已有的默认动作。它不会把远处目标组合成
Travel and Act。

核心正在等待显式位置输入时：

| 手势 | 行为 |
| --- | --- |
| 左键短按 | 提交主位置选择 |
| 右键短按 | 提交次位置选择 |
| 右键拖动 | 平移 camera，不提交位置 |
| 悬停 | 不发起新的核心检查命令 |

显式位置输入包括 `;`、Travel 目标、投掷方向以及其他 `getpos` 流程。位置输入
优先于普通 Context Menu，避免一个右键同时代表菜单和目标选择。

### 4.4 悬停信息

- 地图、物品和状态共享 Tooltip 外观、延迟、屏幕边缘避让和关闭规则。
- 永久背包 Tooltip 使用核心已提供的 `MenuItem.text`、glyph 和结构化菜单字段。
- 状态 Tooltip 使用 BL 字段语义表和项目维护的说明文本。
- 地图 Tooltip 不根据 `tileIndex` 推断真实怪物或物品身份，避免泄露未鉴定、
  伪装、幻觉或记忆状态下的信息。
- 地图停留约 300ms 后，仅在主命令边界发起一次核心 `clicklook`。
- `clicklook` 不消耗游戏回合；其输出作为临时检查结果显示，不写入普通消息
  历史，也不触发 `--More--`。
- 同一 map revision、坐标和显示 glyph 的结果可以缓存；地图变化、session
  变化或显式刷新后失效。
- 指针离开、开始拖动、按下键盘、打开菜单或目标变更时取消待显示 Tooltip。
- 同一时刻最多有一个 hover inspect intent；不为快速扫过的每一格排队。

### 4.5 右键操作列表

- 地图操作列表必须来自核心 `therecmdmenu`，前端不按 glyph 猜测合法动作。
- 永久背包操作列表必须来自核心 `itemactions()`，前端不按英文物品名猜测
  “可吃”“可穿戴”“可使用”等能力。
- 鼠标触发的菜单锚定在目标附近，并在接近 viewport 边缘时翻转或平移。
- 键盘触发的普通菜单保持居中 modal。
- 即使核心只返回一个动作，也显示菜单，不自动消耗回合。
- Escape、点击外部、session 变化、目标过期或出现非预期核心 prompt 时取消。
- 远处格子的菜单只显示核心当前提供的 Travel、Throw、Look 等动作，不增加
  “走过去后自动开门/打开箱子”的组合动作。

### 4.6 永久背包操作与拖放

- 左键物品只聚焦或选中视觉项，不执行游戏动作。
- 右键物品启动其核心 `itemactions()` 流程。
- 双击没有额外语义。
- 拖动使用 Pointer Events，不使用浏览器原生 HTML Drag and Drop。
- 位移达到 5 CSS px 后成为 drag；低于阈值仍是普通点击。
- 拖入地图区域时高亮玩家当前格，并显示 “Drop at your feet”。
- 在地图上松开表示通过核心 drop 流程丢弃整个物品堆，落点永远是玩家脚下，
  与鼠标所在地图坐标无关。
- alpha-2.0 不提供拆分数量 UI；数量、装备、诅咒和拒绝行为继续由核心处理。
- 拖动开始后 permanent inventory revision 改变、物品不再存在、session 变化、
  pointer cancel 或 lost capture 时取消，不执行任何核心命令。
- Tiles 模式可以复用当前物品 glyph 的官方 Tile 作为物品图标和拖动预览；
  ASCII 模式保留字符。不得为此增加新美术或第二套物品身份推断。

### 4.7 图形化状态栏

- HP 和 Energy 使用主要进度条。
- XP 使用较细的次级进度条；没有可靠百分比时保留数值，不自行推算。
- 角色名、称号、等级、属性、AC、金币、回合和地点继续显示，不能因重排丢失
  现有状态信息。
- Hunger、负面状态和其他 conditions 使用紧凑、高辨识度的状态标签。
- `StatusValue.change` 用于短暂的数值变化提示，但 alpha-2.0 不加入补间动画。
- 颜色继续尊重核心的 packed color 与 attributes；危险状态可在此基础上增加
  统一语义 tone。
- 悬停显示字段用途和当前值，不解释隐藏规则或提供核心没有确认的数据。
- 状态栏继续使用 React DOM，不移入地图 Canvas。

### 4.8 输入队列

- 保留现有最多两个按键的 typeahead，不改成动画期间吞键。
- alpha-2.0 没有视觉动画，因此不增加 visual input barrier。
- UI ActionIntent 不使用 typeahead 拼接多步命令；它逐个等待核心的真实输入
  请求和菜单。
- Context Menu 或自动物品选择期间，普通用户按键不得插入 intent 中间步骤。
- 核心进入普通主命令边界后，现有 typeahead 行为恢复。

## 5. 非目标

- 新增、替换或重绘任何地图 Tile。
- 16×16 之外的地图素材尺寸或独立高清物品图标。
- Canvas 光晕、阴影、水面、反射、粒子或色彩分级。
- 玩家、怪物、投射物或 UI 动画。
- `VisualTimeline`、视觉输入屏障或动画帧队列。
- PixiJS、Three.js、WebGL、WebGPU 或新的 renderer。
- Travel and Act、自动开远处箱子或前端寻路。
- 完整动作栏、技能栏、快捷栏或自定义键位 UI。
- 通过 WASM 内存遍历 `gi.invent`、怪物链表或地图内部结构。
- 从菜单文本、消息文本或 tileIndex 推断隐藏规则和物品能力。
- 用户上传 tileset、主题市场或 Tileset 编辑器。
- profile schema v3、backup schema v2 或 save 格式变化。
- Canvas 地图的屏幕阅读器镜像。
- 移动端、触摸拖放和虚拟控制器。

## 6. 目标架构

### 6.1 组件边界

建议结构：

```text
frontend/src/game-actions/
├── action-intents.ts
├── game-action-controller.ts
├── game-action-reducer.ts
└── interaction-origin.ts

frontend/src/interactions/
├── OverlayRoot.tsx
├── AnchoredContextMenu.tsx
├── InspectTooltip.tsx
├── use-anchored-overlay.ts
└── use-inventory-drag.ts

frontend/src/screens/game/
├── GameHudLayout.tsx
├── MessageArea.tsx
├── StatusArea.tsx
├── StatusMetric.tsx
└── FutureActionBarSlot.tsx
```

这只是职责建议；实施时应先检查是否能在现有目录中以更少文件维持清晰边界，
不为了匹配目录图机械拆分。

### 6.2 GameActionController

`input-controller.ts` 继续负责核心到前端的等待状态。新增的
`GameActionController` 负责前端到核心的高层意图，两者不能合并成一个同时
管理 UI 和 WASM 指针的大状态机。

建议状态：

```text
idle
→ waiting-command-boundary
→ starting-command
→ waiting-expected-input
→ presenting-context-menu
→ completing
→ idle

任意状态
→ cancelled
→ idle
```

每个 intent 至少绑定：

- 当前 module/session ID。
- 创建时的 game snapshot revision。
- 可选的 permanent inventory revision。
- 来源 `InteractionOrigin`。
- 预期出现的下一种输入请求。
- 取消原因和不包含游戏内容的诊断事件。

状态机必须满足：

1. 同时最多执行一个 UI intent。
2. 非预期 menu、yn、line、position 或 display 请求立即终止自动步骤并把控制权
   交还现有 UI。
3. 不把多个未来按键预先放入 typeahead。
4. 不持久化菜单 identifier 或 extcmd sourceIndex。
5. session reset、fatal、退出和组件卸载统一取消。
6. 取消 intent 不修改背包快照、地图或 profile。

### 6.3 命令调用

动作控制器优先复用当前核心输入协议：

```text
map context
  -> nh_poskey(x, y, CLICK_1)
  -> therecmdmenu
  -> existing menu callbacks

map inspect
  -> nh_poskey(x, y, CLICK_2)
  -> clicklook
  -> transient message capture

inventory context
  -> inventory command
  -> wait for item selection menu
  -> locate the current accelerator in the newly generated menu
  -> submit that menu row
  -> itemactions menu

drop item
  -> drop command
  -> wait for item selection menu
  -> locate and submit the current accelerator
  -> return remaining prompts to normal UI
```

永久背包 identifier 只用于确认“仍是用户看到的同一快照”，不得作为
`struct obj *` 重新传入核心。真正提交普通菜单时继续使用该菜单本次返回的
identifier。

命令名称应以核心 command metadata 为权威。不得假定未来自定义键位下 `i`、
`d` 或 `#` 一定绑定原命令；阶段一需要评审现有 extcmdlist 是否足以按命令名
启动流程。若必须补充协议，只能在安全命令边界消费版本化请求，不能从 React
在 Asyncify 等待期间直接重入导出的 C 函数。

### 6.4 InteractionOrigin 与菜单呈现

建议类型：

```ts
type InteractionOrigin =
  | { kind: "keyboard" }
  | {
      kind: "map";
      clientX: number;
      clientY: number;
      mapX: number;
      mapY: number;
    }
  | {
      kind: "inventory";
      clientX: number;
      clientY: number;
      inventoryRevision: number;
      accelerator: number;
    };
```

DOMRect 不进入 game state，避免持有失效元素引用。Overlay 在显示时根据客户区
坐标、当前 viewport 和实测菜单尺寸做 clamp/flip。

普通 `GameModal` 的菜单数据和选择逻辑继续复用。Context Menu 只是另一种
presentation，不复制一套 selection reducer。

### 6.5 Hover Inspect

地图悬停需要独立、受限的状态机：

```text
pointer enters cell
→ 300ms debounce
→ verify same cell + command boundary + no modal
→ start clicklook intent
→ capture complete output until next command boundary
→ publish ephemeral tooltip
```

为避免竞态：

- 新目标替换尚未开始的 timer。
- 已进入核心的 clicklook 不尝试中途取消，只丢弃过期显示结果。
- 相同目标不重复创建并发 intent。
- 捕获只覆盖该 intent 期间新增的消息，不修改更早消息。
- 核心出现 fatal、text display 或非预期 prompt 时停止捕获并使用正常 UI。
- Tooltip 内容不写入持久消息历史、诊断日志或 profile。

地图应增加独立 `mapRevision`，只在 `flushDisplay()` 实际提交地图变化时递增；
不能用包含状态、消息和 modal 的全局 snapshot revision 作为缓存失效条件。

### 6.6 MapViewport

`MapViewport` 继续拥有 scroll、camera、renderer 和 pointer capture，但不再
直接决定所有游戏动作。它向上提交高层事件：

```text
onPrimaryClick
onContextClick
onHoverTarget
onHoverLeave
onDropItem
```

`use-right-drag-pan.ts` 继续固定 5 CSS px 阈值。Context Menu 只在
`pointerup` 确认没有 drag 后创建。现有 `pointercancel`、
`lostpointercapture` 和卸载清理保持。

普通命令与显式 position input 的分流发生在交互控制器，不在 Canvas 或 ASCII
renderer 内实现。

### 6.7 Inventory drag

建议 payload：

```ts
interface InventoryDragPayload {
  kind: "inventory-item";
  sessionId: string;
  inventoryRevision: number;
  identifier: number;
  accelerator: number;
  glyph: GlyphInfo | null;
}
```

拖动 UI 只保存当前手势和 preview；核心状态仍由 permanent inventory snapshot
拥有。Drop 完成后不乐观删除物品，等待核心下一次永久背包更新。

地图 DropTarget 不使用鼠标落点作为游戏坐标，只显示玩家格高亮。目标高亮属于
DOM/Canvas overlay，不写回 `MapCell`。

### 6.8 状态语义层

建议从数字索引表生成：

```ts
interface StatusMetric {
  id: string;
  field: number;
  label: string;
  text: string;
  percent?: number;
  change: -1 | 0 | 1;
  color: number;
  attributes: number;
  group: "identity" | "resource" | "attribute" | "world" | "condition";
}
```

`StatusArea` 只消费 `StatusMetric[]`，不硬编码三行字段序列。

对于 `shim_status_enablefield`，先以 C 调用链测试证明 wrapper 能同时保留
`genl_status_enablefield` 的内部 bookkeeping 和 Emscripten callback，再做最小
修改。若无法无损组合，alpha-2.0 可以维护与当前 NetHack 5.0 构建绑定的显式
BL 字段 metadata，但必须由测试与 `include/botl.h` 保持同步，不能解析显示文本
猜字段。

### 6.9 HUD Shell

`GameHudLayout` 是游戏页面布局的唯一 owner：

- `GameScreen` 管 session、pause、settings 和顶层错误状态。
- `GameHudLayout` 组合消息、地图、永久背包、状态和未来 action slot。
- `MapViewport` 不感知消息栏或状态栏内容。
- `PermanentInventoryPanel` 不决定自己位于右侧还是下方，只响应布局 props。
- `StatusArea` 不读取 viewport 尺寸。
- OverlayRoot 位于 inert 游戏内容之外，但仍在当前 session shell 内。

布局使用 CSS Grid、`minmax(0, 1fr)` 和明确 overflow owner。不得通过负 margin、
固定屏幕坐标或多个互相覆盖的 `position: fixed` 面板拼接。

## 7. 核心与 shim 边界

### 7.1 不需要新 ABI 的功能

以下能力原则上通过现有 ABI 完成：

- 地图 `mouseaction`。
- 地图 `therecmdmenu`。
- 地图 `clicklook`。
- 普通菜单呈现和选择。
- 永久背包到 `itemactions()` 的交互流程。
- drop 命令和物品选择。
- 状态 value、percent、change、color 和 condition mask。

### 7.2 允许的最小 C 侧工作

alpha-2.0 只允许为了现有窗口接口完整性进行最小修改，例如：

- 为 Emscripten shim 正确转发 status field metadata，同时保留 genl 状态管理。
- 在浏览器运行时配置中绑定 `mouse1:mouseaction`、
  `mouse2:therecmdmenu`，前提是验证不会改变显式 getpos 的 modifier。
- 如命令名调用无法通过现有 extcmd 流程安全完成，增加在
  `shim_get_nh_event()` 命令边界消费的版本化 command intent。

任何上游文件修改仍必须：

- 在源码中标注 BlissHack 修改者、日期和目的。
- 更新 `shim-interface-reference.md` 与 `upstream-modifications.md`。
- 重新构建并成对提交 runtime 三件套。
- 运行 WASM、Chromium、Firefox 和 WebKit 相关测试。

### 7.3 禁止的调用方式

- React 在 Asyncify 输入等待期间直接调用 `itemactions()`、`displayInventory()`
  或任意新导出 C helper。
- 把 permanent inventory identifier 解释为长期稳定的对象指针。
- 前端提前发送 `i + item + action` 或 `d + item`。
- 通过英文菜单文本判断动作类型。
- 在 TypeScript 中复制 NetHack 的合法动作规则。

## 8. 分阶段实施

每个阶段继续遵循 alpha-1 已验证的流程：

```text
测试 subagent
→ 提交失败测试或 characterization baseline
→ 主线程实现
→ 独立 reviewer
→ 修正 findings
→ 阶段验证
→ 阶段 commit
```

### 阶段零：分支与版本

1. 从已合入 alpha-1.1 的 `BlissHack` 创建 `alpha-2.0`。
2. 根 `VERSION` 改为 `alpha-2.0`。
3. 重新构建 runtime 三件套，使核心、manifest 和前端版本一致。
4. 只提交版本切换和对应 runtime，不混入功能。

建议提交：

```text
chore: start alpha-2.0 development
```

### 阶段一：动作与交互契约

测试优先定义：

- 同时只允许一个 UI ActionIntent。
- intent 只在主命令边界启动。
- 预期菜单按 accelerator 找到当前条目后才自动提交。
- permanent inventory revision 变化取消动作。
- 非预期 prompt 终止自动步骤并交回正常 UI。
- session reset、fatal 和卸载清理 intent。
- 用户 typeahead 仍最多缓存两个键。
- 右键拖动不创建 context intent。
- 显式 position input 优先于普通右键菜单。

实现 `GameActionController`、`InteractionOrigin` 和 MapViewport 高层事件边界，
但暂不改变可见 UI。

建议提交：

```text
test: define alpha-2.0 action intent contracts
refactor: add game action coordination
```

### 阶段二：全屏 HUD Shell

实施：

1. 抽取 `GameHudLayout`。
2. 建立 messages、map、inventory、status 和 future action slot。
3. 消息栏改为顶部不透明固定高度区域。
4. 地图填充中央剩余空间，维持真实 overflow 和 camera。
5. 永久背包 right 贴齐 viewport 右边缘，below 保持兼容。
6. 状态区域固定到底部。
7. 移除游戏中的独立 header 占位，把必要入口迁入 HUD 或 pause。
8. 保留 action slot contract，但空状态不产生可见空条。

门禁：

- 1280×900 与 900×700 不重叠。
- Tiles/ASCII、Right/Below、展开/折叠和消息行数均保持 camera anchor。
- 地图、消息、背包和状态各自只有一个 overflow owner。
- Home、Settings、fatal、pause 和锁冲突布局不回归。

建议提交：

```text
feat: introduce fullscreen game HUD shell
```

### 阶段三：图形化状态

测试优先定义：

- 所有当前 BL 字段进入稳定语义组。
- HP、Energy 和 XP 百分比边界正确 clamp。
- 空字段不占位，动态禁用字段消失。
- condition mask 和颜色映射不丢失。
- 状态值变化不改变游戏输入或 snapshot 之外的状态。
- Tooltip 只展示当前字段及静态说明。

实施 `StatusMetric` 转换、资源条、属性组、条件标签和字段 Tooltip。若修复
status metadata callback，则在本阶段重新构建 WASM。

建议提交：

```text
feat: add graphical character status HUD
```

### 阶段四：Overlay 与悬停信息

建立统一 OverlayRoot、锚定位置算法和 InspectTooltip。

测试覆盖：

- Tooltip 延迟、取消和同目标去重。
- viewport 四边 clamp/flip。
- 地图 clicklook 不消耗回合。
- clicklook 输出不进入普通消息历史。
- 过期 map revision 的结果不显示。
- 快速跨格移动不会形成 intent 队列。
- inventory/status Tooltip 不进入核心。
- modal、pause、drag 和 session reset 清理 Overlay。

建议提交：

```text
feat: add contextual hover inspection
```

### 阶段五：地图与物品右键菜单

实施：

1. 浏览器运行时使用核心 `mouseaction` 和 `therecmdmenu` 的确定绑定。
2. 普通状态的右键短按创建 map-context intent。
3. 核心返回的菜单以锚定 Context Menu 呈现。
4. 右键永久背包物品启动 inventory selection，再进入核心 `itemactions()`。
5. 中间物品选择菜单由 intent 验证并提交，不闪现给用户。
6. 最终 itemactions 菜单锚定在原物品附近。
7. 普通键盘菜单继续走现有 modal。

门禁：

- 打开或取消 Context Menu 不消耗回合。
- 选择动作后的回合语义与键盘原生命令一致。
- 相邻门、怪物、容器、地面物品和远处格子使用核心提供的实际菜单。
- itemactions 对武器、护甲、食物、工具和未知物品均不由前端猜测。
- 右键拖动、3px 抖动、5px 阈值和拖出边界行为保持。
- `;` 等 position input 中不打开普通 Context Menu。

建议提交：

```text
feat: add core-driven context action menus
```

### 阶段六：永久背包拖放丢弃

测试优先定义：

- 小于 5px 不开始拖动。
- 达到阈值后显示拖动预览。
- 只有地图区域接受 drop。
- 玩家格高亮与鼠标落点无关。
- 成功 drop 只启动一次核心 drop 流程。
- pointer cancel、lost capture、Escape 和组件卸载不执行命令。
- stale inventory revision、缺失 accelerator 和非预期菜单安全取消。
- 核心拒绝、装备或诅咒情形使用原生反馈。
- 成功后等待永久背包新 revision，不乐观删除 UI 项。

建议提交：

```text
feat: support dropping permanent inventory items
```

### 阶段七：兼容、文档与发布门禁

1. 完整运行单元、lint、build、WASM、Chromium、Firefox、WebKit、性能和长流程。
2. 增加 1280×900 与 900×700 的 HUD 截图回归。
3. 验证 Tiles/ASCII 和永久背包 Right/Below。
4. 验证存档、Continue、profile、backup 和多页面锁。
5. 更新 README、frontend README、session-start、shim 和上游修改文档。
6. 新增 alpha-2.0 release acceptance。
7. 独立 reviewer 检查动作竞态、过期 revision、菜单焦点和布局 overflow。
8. 停在人工验收门槛，不自行 push 部署分支。

建议提交：

```text
test: complete alpha-2.0 interaction coverage
docs: complete alpha-2.0 acceptance
```

## 9. 测试策略

### 9.1 单元测试

- ActionIntent reducer 的全部状态转换和取消路径。
- InteractionOrigin 生命周期。
- map/position 模式手势路由。
- inventory revision 与 accelerator 验证。
- hover debounce、缓存和过期结果。
- Overlay clamp/flip 算法。
- StatusMetric 分组、百分比、颜色和 conditions。
- drag threshold、drop target 和 pointer cancel。

### 9.2 Bridge 与 WASM 测试

- `mouse1:mouseaction`、`mouse2:therecmdmenu` 的实际绑定。
- clicklook 不消耗回合并生成安全描述。
- therecmdmenu 返回核心合法动作 identifier。
- inventory 选择进入 `itemactions()`。
- drop 只影响指定物品，失败路径不误选。
- status metadata wrapper 不改变原有 genl 行为。
- runtime 三件套版本、ABI 和 manifest 一致。

### 9.3 浏览器测试

- Chromium 覆盖所有主流程。
- Firefox 与 WebKit 覆盖右键 click/drag、Context Menu、hover、物品动作、
  拖放、HUD 两种布局和状态条。
- 测试使用 command readiness、snapshot/map/inventory revision 和菜单状态，
  不依赖固定 sleep。
- Tooltip 和 Context Menu 的可见位置使用范围断言，不依赖逐像素完全相等。
- 真实 WASM 流程验证操作回合数，不只测试 mock callback。

### 9.4 回归范围

- 右键拖动与 Follow。
- Tiles/ASCII fallback。
- 普通菜单、文本、history、yn、line 和 extcmd。
- 永久背包更新、折叠和模式切换。
- Settings 在游戏内应用。
- Save and Exit、Continue、profile 和 backup。
- 多页面锁、fatal 和 session cleanup。
- 两键 typeahead。

## 10. 人工验收

### 10.1 HUD

1. 在 1280×900 和 900×700 下进入 Tiles 游戏。
2. 确认消息栏为顶部不透明固定高度，不覆盖地图。
3. 确认状态栏贴底，永久背包 Right 时贴右，所有区域不重叠。
4. 切换永久背包 Below、折叠状态、消息行数和 Tiles/ASCII。
5. 确认 camera 保持合理区域，滚动和 Follow 正常。

### 10.2 地图交互

1. 悬停墙、门、怪物、物品、楼梯和未知目标，核对核心描述。
2. 快速移动指针，确认没有旧 Tooltip 或消息历史污染。
3. 左键相邻门、敌人、空地和远处格子，确认核心默认动作。
4. 右键相同目标，确认菜单内容来自实际上下文。
5. 右键拖动和轻微抖动，确认 pan/click 阈值未回归。
6. 在 `;`、Travel 和方向选择中确认左右键仍提交位置。

### 10.3 永久背包

1. 右键武器、护甲、食物、工具和未知物品，核对 itemactions。
2. 选择一个实际动作，确认结果与键盘路径一致。
3. 取消菜单，确认不消耗回合。
4. 将普通物品拖到地图，确认落在玩家脚下并更新背包。
5. 对成组物品、装备物品和不可丢弃情形重复测试。
6. 拖动中改变背包或取消 pointer，确认不会误丢物品。

### 10.4 状态和数据

1. 受伤、治疗、消耗能量、升级和属性变化时检查状态栏。
2. 触发 Hunger、Blind、Confusion 等状态并检查 Tooltip。
3. 保存退出、刷新 Continue，确认 HUD 和操作仍正常。
4. 导出导入 profile 与完整 backup。
5. 检查 Console 没有 stale intent、pointer capture、menu、React 或 WASM 错误。

## 11. 风险与处理

| 风险 | 处理 |
| --- | --- |
| hover 频繁占用命令边界 | 300ms debounce、单 intent、map revision 缓存 |
| tileIndex 泄露真实身份 | 地图说明只使用核心 clicklook |
| Context Menu 与 getpos 冲突 | position input 优先，普通 context 仅限 command boundary |
| 右键拖动误触菜单 | 延续 5px 阈值和 pointer capture |
| 物品字符变化导致误操作 | inventory revision + 新菜单 accelerator 双重验证 |
| identifier 被误当对象指针 | 只提交当前普通菜单本次返回的 identifier |
| 自动流程吞掉非预期 prompt | 终止 intent 并交回现有 UI |
| HUD 固定区域挤压地图 | CSS Grid、明确 minmax 和 overflow owner |
| 消息固定高度丢失历史 | 保留现有历史查看入口和消息行数设置 |
| 状态重排丢字段 | 语义转换测试覆盖全部 BL 字段 |
| C 侧 status wrapper 改变行为 | 同时验证 genl bookkeeping 与 Emscripten callback |
| Context Menu 边缘溢出 | 渲染后测量并 clamp/flip |
| 三浏览器右键差异 | Chromium、Firefox、WebKit 真实 pointer 流程 |

## 12. 停止条件

出现以下情况时暂停对应阶段并单独评审：

- 地图 hover 无法在不污染消息历史的情况下复用 clicklook。
- itemactions 必须依赖不稳定对象指针或解析英文文本。
- 命令调用必须在 Asyncify 等待期间从 JavaScript 重入 C。
- status metadata wrapper 会破坏 genl 状态管理。
- `mouseaction` 的浏览器绑定改变显式 position input 语义。
- 拖放无法在 stale revision 下证明不会选择错误物品。
- 全屏布局要求删除现有永久背包 Below 或 ASCII renderer。
- 需求扩张到 Travel and Act、动画、光效或新 tileset。

## 13. 完成定义

alpha-2.0 只有同时满足以下条件才算完成：

1. 游戏使用稳定的桌面 HUD Shell，消息栏不透明且固定占高。
2. 地图、永久背包、状态和未来 action slot 的布局 ownership 明确。
3. 当前全部状态信息以图形化、可扫描形式显示并支持说明 Tooltip。
4. 地图 hover 使用核心权威描述，不泄露或猜测游戏信息。
5. 普通左键、右键、右键拖动和显式 position input 的语义确定且有测试。
6. 地图右键菜单完全使用核心 therecmdmenu。
7. 永久背包右键菜单完全使用核心 itemactions。
8. 拖放丢弃经过核心原生流程，并拒绝 stale inventory 操作。
9. UI ActionIntent 不依赖盲目按键宏，不重入 WASM。
10. 现有两键 typeahead、存档、profile、backup 和多页面锁不回归。
11. Tiles、ASCII、Right、Below、1280×900 和 900×700 全部通过。
12. 单元、WASM、Chromium、Firefox、WebKit、性能和长流程测试通过。
13. 人工验收通过后再合入并 push 部署分支。

## 14. 计划提交序列

```text
docs: plan alpha-2.0 interactive HUD
chore: start alpha-2.0 development
test: define alpha-2.0 action intent contracts
refactor: add game action coordination
feat: introduce fullscreen game HUD shell
feat: add graphical character status HUD
feat: add contextual hover inspection
feat: add core-driven context action menus
feat: support dropping permanent inventory items
test: complete alpha-2.0 interaction coverage
docs: complete alpha-2.0 acceptance
```

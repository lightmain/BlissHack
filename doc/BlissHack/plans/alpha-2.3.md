# BlissHack alpha-2.3 动作栏计划

## 1. 文档状态

本文定义 alpha-2.3 的产品范围、交互契约、数据模型、核心边界、实施阶段和验收
门禁。alpha-2.2 已完成实现、自动门禁和人工验收；当前经确认的动作栏原型为：

- `doc/BlissHack/prototypes/alpha-2.3-action-bar.html`
- `doc/BlissHack/prototypes/alpha-2.3-action-bar.test.mjs`

原型的布局与交互是本版本的产品基线，但其中模拟的动作结果、静态输入类型和独立
localStorage key 不是生产架构。正式实现必须接入当前 React HUD、严格 profile、
`GameActionController` 和 NetHack 核心输入流程。

alpha-2.3 增加 Settings 项 `Action bar`，值为：

- `Original`：不显示动作栏。阶段一至阶段七暂时保持 alpha-2.2 的图形化状态栏；
  阶段八作为本版本最后一步，将其改成更接近原始 NetHack TTY 的两行状态显示。
- `BlissHack`：启用本计划定义的状态栏与动作栏合并界面。

## 2. 版本目标

alpha-2.3 完成以下目标：

1. 把当前原型中的动作栏完整接入真实游戏 HUD。
2. 让动作按钮通过安全命令边界启动当前 WASM 构建中的真实 NetHack 命令。
3. 让物品、方向、地图坐标及其他后续输入由核心实际请求驱动，而不是预先拼接
   按键序列。
4. 提供 104 个当前非移动玩家命令的 All Actions 面板，并保留稳定分类。
5. 支持 1 至 4 行、默认 2 行、分类 Tab、竖向分隔、空槽补齐、锁定、拖动排序、
   覆盖、移除和 Custom 布局。
6. 将动作栏布局纳入 profile v4，使其跨游戏保存，并随 Profile 和完整备份一起
   导入、导出和清除。
7. 保持不可执行动作的槽位稳定；只有真实上下文动作才允许动态出现或消失。
8. 保留现有键盘、地图右键、永久背包右键和背包拖放操作。
9. 在最后一个阶段把 `Original` 模式改为无 HP、Energy、XP 图形进度条的
   TTY 风格状态区。

## 3. 当前基线

### 3.1 可复用能力

- `GameHudLayout` 已拥有 messages、map、inventory、status 和空 action slot。
- `GameScreen` 是游戏内键盘、暂停、modal、hover、拖放和高层动作的组合边界。
- `GameActionController` 已保证同一时刻只有一个 UI intent，并按真实 command、
  menu、snapshot、map revision 和 inventory revision 推进。
- `input-controller.ts` 是唯一 Asyncify pending input owner，并在 UI intent
  期间冻结两键 typeahead。
- 现有版本化 command-boundary 协议已能安全执行 `clicklook`、`inventory` 和
  `drop`，C 侧通过 `cmdq_add_ec()` 进入正常命令队列。
- `nhgetch` 和 `nh_poskey` 已携带 `program_state.input_state`，但 TypeScript
  当前只保留“是否为主命令”的 boolean。
- 普通菜单、文本、`yn`、`getlin`、extended command 和地图位置输入已有完整
  UI。
- 状态字段已由 `status_enablefield/status_update` 结构化提供，当前
  `StatusArea` 能绘制 HP、Energy、XP 进度条及其他字段。
- profile v3 使用严格 schema、单 key 原子替换和显式 v1 -> v2 -> v3 迁移链。
- Profile 导出和完整备份都会嵌入当前 profile；完整备份外层当前为 schema v2。
- `OverlayRoot`、锚定菜单、焦点恢复和 `inert` 已有可复用实现。

### 3.2 当前缺口

- action slot 高度仍为零，没有生产动作栏组件。
- command-boundary 协议只有三个固定命令，不能执行完整 catalog。
- 当前 `ExtendedCommand` 只包含 `sourceIndex`、name 和 description，没有 key
  与 flags。
- `GameActionController` 只覆盖地图菜单、地图检查、物品右键和 drop，不能表示
  通用动作、动作栏物品选择或 targeting。
- `getdir` 通过 `yn_function` 进入前端；当前 snapshot 不能权威区分方向输入与
  普通 yes/no prompt。
- 多数物品命令默认先请求一个字符；不能直接得到原型所需的轻量物品选择面板。
- profile v3 没有动作栏模式或布局字段。
- 当前整个 `GameTerminal` 共用一个 `inert` 边界，无法在 All Actions 打开时
  只禁用消息、地图和永久背包而保留动作栏交互。
- 当前 `Original` 状态仍是 BlissHack 图形化状态，尚非 TTY 风格。

## 4. 已确定的产品契约

### 4.1 Settings 与默认行为

新增：

```ts
type ActionBarStyle = "original" | "blisshack";
```

Settings 中以 segmented control 显示：

```text
Action bar  [ Original | BlissHack ]
```

规则：

- v1、v2、v3 profile 迁移到 v4 时使用 `original`，避免升级后突然改变 HUD。
- 新建 profile 默认使用 `BlissHack` 动作栏；旧 profile 的迁移结果不变。
- Home Settings 的选择用于下一局。
- 游戏内 Settings 的选择保存后立即生效，不进入 WASM，也不改变回合。
- 从 `BlissHack` 切回 `Original` 不删除自定义布局；再次切回时恢复原布局。
- 该设置与 `informationLevel`、`showExperience`、地图 renderer 和永久背包
  位置相互独立。

### 4.2 两种 HUD 模式

`BlissHack`：

- 状态内容位于动作栏左侧。
- 动作网格位于中间，分类 Tab 位于网格下方。
- 减少行数、增加行数、锁定和 All Actions 四个圆形按钮位于最右侧，纵向排列，
  尺寸固定，间距随 dock 高度增加而展开。
- 输入提示位于 dock 的稳定区域，不能被动作格覆盖。
- Right 永久背包继续占右侧独立列，dock 占左侧底部。
- Below 永久背包保留独立区域，dock 使用完整底部宽度；HUD 自身负责极矮窗口
  的纵向恢复，不产生页面级横向 overflow。

`Original`：

- 不渲染动作网格、分类 Tab、动作栏工具按钮或 All Actions。
- 阶段八之前继续使用 alpha-2.2 当前状态栏，保证开发期间兼容路径始终可用。
- 阶段八改为 React 实现的 TTY 风格两行状态区；仍消费结构化状态字段，不切换
  window port，不解析 ANSI，也不从显示文本反推游戏状态。
- TTY 风格不绘制 HP、Energy 或 XP 进度条。
- `showExperience` 仍只决定核心是否提供经验值字段。
- `informationLevel="detailed"` 仍可提供已有的解释性 Tooltip；视觉排版本身
  保持 TTY 风格。

### 4.3 Dock 几何

- 行数范围为 1 至 4，默认 2。
- 每个动作槽是固定比例正方形；目标尺寸 48 CSS px，空间不足时可缩小，但不能
  小于 32 CSS px。
- 能容纳必需列时，槽位尺寸按可用宽度计算，使动作网格只包含完整列，不留下
  半格。
- 必需列在最小槽位下仍放不下时，动作网格自身横向滚动，不能继续压缩。
- All 布局由 Common、Gear、Magic、Items 四个纵向分区组成。
- 分隔条只能在解锁状态拖动，并按整列吸附；不能形成零列分区。
- 最右分区吸收剩余完整列，并以空槽填满到右边界。
- 行数、字体、消息行数、renderer、背包位置或 viewport 改变后，重新计算 dock
  几何并保留地图 camera anchor。
- Tooltip、物品选择面板和 All Actions 的 bottom offset 以实测 dock 高度为
  准，不保存像素尺寸。

### 4.4 分类与默认布局

底部 Tab 顺序固定为：

```text
All | Common | Gear | Magic | Items | Explore | Custom
```

默认 All 布局：

| 分区 | 初始列数 | 初始动作 |
| --- | ---: | --- |
| Common | 2 | `eat`, `quaff`, `kick`, `search` |
| Gear | 3 | `wield`, `wear`, `puton`, `takeoff`, `remove`, `swap` |
| Magic | 3 | `cast`, `zap`, `read`, `fire`, `throw`, `quiver` |
| Items | 3 | `apply`, `engrave`, `dip`, `loot`, `tip`, `rub` |

默认 All 不包含 `open`、`close`、`drop` 或任何方向移动命令。开门/关门优先使用
地图直接移动和右键菜单；drop 优先使用永久背包拖放或物品右键。

其他 Tab 的初始内容以已确认原型中的 `action-bar-config.layouts` 为准。Custom
初始为空。Tab 只切换可见布局，不改变命令 catalog。

### 4.5 动作目录

All Actions 使用当前 WASM 构建中的 104 个非方向、非 internal、非 wizard、
非 `CMD_NOT_AVAILABLE` 玩家命令。24 个方向移动变体不进入动作目录。

展示分类与原型保持一致：

| 类别 | 数量 | 命令 |
| --- | ---: | --- |
| Common | 11 | `fight`, `fire`, `herecmdmenu`, `kick`, `look`, `search`, `travel`, `twoweapon`, `untrap`, `wait`, `wipe` |
| Gear | 19 | `adjust`, `call`, `inventory`, `inventtype`, `name`, `puton`, `quiver`, `remove`, `seeall`, `seeamulet`, `seearmor`, `seerings`, `seetools`, `seeweapon`, `swap`, `takeoff`, `takeoffall`, `wear`, `wield` |
| Magic | 10 | `cast`, `enhance`, `invoke`, `monster`, `offer`, `pray`, `read`, `rub`, `turn`, `zap` |
| Items | 11 | `apply`, `dip`, `drop`, `droptype`, `eat`, `engrave`, `loot`, `pickup`, `quaff`, `throw`, `tip` |
| Explore | 21 | `annotate`, `chat`, `close`, `down`, `force`, `glance`, `jump`, `lookaround`, `open`, `pay`, `retravel`, `ride`, `run`, `rush`, `showtrap`, `sit`, `teleport`, `terrain`, `therecmdmenu`, `up`, `whatis` |
| Info | 14 | `attributes`, `chronicle`, `conduct`, `genocided`, `history`, `known`, `knownclass`, `overview`, `perminv`, `prevmsg`, `showgold`, `showspells`, `vanquished`, `whatdoes` |
| System | 18 | `#`, `?`, `autopickup`, `exploremode`, `help`, `options`, `optionsfull`, `quit`, `redraw`, `repeat`, `reqmenu`, `save`, `saveoptions`, `shell`, `suspend`, `toggle`, `version`, `versionshort` |

目录规则：

- 命令 name 和当前 session 的临时 command ID 来自当前 WASM，不在 TSX 中复制。
- catalog 同时复制 key 与 flags；分类、图标和默认布局是前端展示 metadata，
  必须对 catalog name 做穷举校验。
- profile 只保存命令 name，不保存 `sourceIndex`、函数地址或 WASM 指针。
- 当前版本不提供自定义快捷键。Tooltip 的 key 显示当前构建的默认绑定；没有
  单键绑定时显示 `#name`。
- 每个动作使用 Lucide 图标；Lucide 没有合适图标时使用已确认的
  `square-dashed-x-corner` 占位符。
- Tooltip 只包含动作 name 和 key，不展示 `extcmdlist` description，也不新增
  项目自行撰写的动作说明。
- 104 个目录项都保留在 All Actions；目录可见不等于可以用裸 command ID
  执行。带 `CMD_PARAM` 的条目在 alpha-2.3 标记为 `unavailable`，协议拒绝
  排队。当前构建中这条规则覆盖 `toggle`；玩家仍可通过 `optionsfull` 修改
  选项。本版本不伪造 `Cmd_bind.param`，也不引入参数编辑器。
- 带 `PREFIXCMD` 的 `fight`、`reqmenu`、`run` 和 `rush` 可以启动，但必须继续
  使用核心原生的下一命令输入；不能把该输入误判为动作已经完成。

### 4.6 执行动作

动作按钮只在当前 session、主命令边界、无 pause、无核心 modal 且没有其他
active intent 时开始命令。开始后：

1. 关闭 All Actions 和普通动作 Tooltip。
2. 通过版本化 command-boundary 协议发送当前 catalog command ID。
3. C 侧在下一次 `shim_get_nh_event()` 验证该 ID 属于当前可见 catalog。
4. C 侧把对应 `ext_func_tab` 放入 `CQ_CANNED`。
5. `rhack()` 继续执行 `can_do_extcmd()`、前缀、repeat 和命令返回值等原生路径。
6. 前端仅根据随后真实出现的 input/menu/display 和递增的安全命令边界
   generation 更新 UI。

执行资格：

- 协议必须拒绝 `INTERNALCMD`、`WIZMODECMD`、`CMD_NOT_AVAILABLE` 和
  `CMD_PARAM`，即使 UI 状态错误也不能进入 `CQ_CANNED`。
- 普通目录命令只携带 session command ID 和 request nonce，不携带函数地址。
- `PREFIXCMD` 进入 `waiting-prefix-continuation` 并把后续按键交给核心；只有
  `rhack()` 返回后出现的下一次 `shim_get_nh_event()` generation 才表示整个
  prefix 流程结束。`commandInp` 本身不是完成信号。
- 若以后要求直接执行参数化命令，必须单独设计有界参数 schema，并证明执行期
  建立的 `Cmd_bind` context 与键盘绑定路径一致；不得在本版本中顺带放宽。

不得：

- 点击按钮后调用 `sendKey(defaultKey)`。
- 预先发送 `command + inventory accelerator + direction`。
- 在 Asyncify callback pending 时从 React `ccall()` 重入核心。
- 按英文 prompt、菜单文字或物品名称判断流程阶段。
- 在 TypeScript 中复制 NetHack 的命令合法性或回合规则。

### 4.7 后续输入

物品参数：

- 对会进入 `getobj()` 的动作，command request 携带“一次命令内使用菜单选择”
  标志。
- 核心仍负责过滤合法候选、数量、特殊的 hands/nothing 项和取消行为。
- 前端只把核心实际生成的 `PICK_ONE` 菜单改呈现为 dock 上方轻量选择面板。
- command request 使用当前 session 内单调递增、非零且不回绕的 32-bit request
  nonce；耗尽视为 fatal protocol error，不能复用旧值。C 侧仅在
  该 request 的强制菜单路径进入 `getobj()` 候选菜单期间标记
  `action-getobj` provenance；shim 将 provenance、request nonce 和单调递增的
  menu generation 随 `select_menu` observation 一起复制到 TypeScript。
- chooser 只有在 `PICK_ONE`、`action-getobj` provenance、active request
  nonce 和本次新 menu generation 全部匹配时才接管。仅凭“动作正在运行”、
  window ID、prompt 或第一个 `PICK_ONE` 菜单都不够。
- 选择时提交本次菜单行的 identifier，不复用永久背包 identifier。
- 零候选、唯一候选、二次物品选择和不支持菜单化的命令都以真实核心行为为准；
  不能用永久背包快照伪造候选。
- 每次 `getobj()` 返回后立即清理 provenance；request 在完成、拒绝、取消和
  session reset 时清理。匹配失败的菜单原样交给现有原生 UI。

方向参数：

- 为 `yn_function` 等输入回调保留完整 `program_state.input_state`，让前端能识别
  真实 `getdirInp`，不得匹配 “In what direction?” 文本。
- 进入 direction targeting 后高亮相邻候选格，键盘方向与地图点击都转换为当前
  number-pad 模式可接受的方向输入。
- 前端不声称相邻格一定合法；最终合法性和反馈由核心决定。

地图坐标参数：

- 只有观察到真实 `getposInp`/position request 后才进入 position targeting。
- 地图点击复用 `sendPosition()`；核心已有的 getpos 光标、合法位置高亮和过滤
  仍是权威。

其他输入：

- 普通 `yn`、line、PICK_ANY、text、message、extended-command 或特殊菜单不做
  猜测，交回现有 UI 正常呈现。
- 交回后允许玩家完成该命令，并在下一次主命令边界结束 action intent。
- Escape 或再次点击当前 targeting 动作必须向当前核心请求提交真实取消，而不
  只是隐藏前端 UI。
- 提交取消后进入 `cancelling-core-input`；chooser、targeting 高亮和 active
  intent/input barrier 不能立即清除。只有对应 Asyncify callback resolver
  已被消费，并且观察到晚于本次动作起始 generation 的新
  `shim_get_nh_event()`，才能回到 `idle`。session reset、fatal 和 module
  disposal 走单独的终止清理路径。
- 取消等待期间拒绝新动作。快速执行“Escape 后点击另一动作”不得让新动作命中
  前一个 pending input。

### 4.8 可用、不可用与槽位稳定性

动作状态分为：

```text
available | blocked | unavailable
```

- `blocked`：session 非 running、read-only、pause/modal 打开、不是主命令边界、
  另一个 intent 正在执行，或布局正处于不允许执行的编辑手势。
- `unavailable`：动作 name 无法在当前 catalog 解析，或当前构建明确标记为
  internal、wizard、`CMD_NOT_AVAILABLE`、`CMD_PARAM`。
- `available`：可以向核心请求执行；核心仍可能根据角色、物品、地形或状态给出
  原生拒绝。

当前前端无法可靠预判“是否有可吃物品”“是否有法术”“祈祷是否可用”等规则。
alpha-2.3 不为此遍历 WASM 内存，也不调用可能产生副作用的
`can_do_extcmd()` 做预览。不能证明不可用时保持可点击，让核心反馈。

`blocked` 和 `unavailable` 动作都保留原槽位并降低亮度，不重排。未来如核心
提供无副作用的动态 availability snapshot，可以在不改变布局模型的前提下补充。

### 4.9 All Actions

- 三点按钮打开一个位于 dock 上方、不覆盖 dock、非全屏的 All Actions 面板。
- 面板按 Common、Gear、Magic、Items、Explore、Info、System 垂直分节。
- 每节内部使用固定比例正方形 grid；面板纵向滚动并复用 `index.css` 的全局
  scrollbar。
- 面板提供正式的 `.bhactions` 导入和导出控件；格式与行为见第 5.2 节。
- 单击动作立即关闭面板并按第 4.6、4.7 节执行。
- 打开时 messages、map 和 permanent inventory 变暗且 `inert`。
- 状态与动作 dock 保持原亮度和可交互。
- 面板不是 `aria-modal=true`；键盘焦点范围为 panel 与 dock 两个可交互根。
- dock、panel 和 chooser 的交互根必须带 `data-browser-keyboard`。Enter 和
  Space 只触发当前浏览器控件一次，Escape 只执行本层关闭或核心取消，不能再
  冒泡成 NetHack 按键；组件卸载后不得残留键盘 owner。
- Escape、pause、核心 modal、session reset、fatal 和卸载都关闭面板并恢复
  合法焦点。

### 4.10 锁定、拖放和分隔条

- 初始为锁定状态。
- 锁定时不能移动、覆盖、删除动作或拖动分隔条。
- 锁定和解锁状态下都能从 All Actions 开始拖动。
- 从 All Actions 拖到已锁定 dock 时不修改布局，锁按钮短暂显示红色拒绝反馈。
- 解锁后拖到空槽为插入，拖到占用槽为覆盖。
- 解锁后动作可在当前布局内移动或交换。
- 解锁后把动作拖到 dock 外即删除；拖入 All Actions 也只是从 dock 删除。
- 从 All Actions 拖到 dock 外不执行任何操作。
- 分隔条拖动按整列吸附，只改变相邻分区边界，不移动动作顺序。
- Pointer cancel、lost capture、Escape、窗口失焦、session reset 和组件卸载均
  取消当前编辑手势，不提交半成品。
- 布局修改只在完整手势结束时原子保存，不在 pointer move 中反复写存储。

## 5. 持久化契约

### 5.1 Profile v4

正式实现升级到 profile v4。建议结构：

```ts
interface InterfaceSettingsV4 extends InterfaceSettingsV3 {
  actionBarStyle: "original" | "blisshack";
  actionBarLayout: {
    rows: 1 | 2 | 3 | 4;
    locked: boolean;
    activeCategory:
      | "all"
      | "common"
      | "gear"
      | "magic"
      | "items"
      | "explore"
      | "custom";
    all: Array<{
      category: "common" | "gear" | "magic" | "items";
      columns: number;
      slots: Array<string | null>;
    }>;
    categories: Record<
      "common" | "gear" | "magic" | "items" | "explore" | "custom",
      Array<string | null>
    >;
  };
}
```

实际实现可调整字段命名，但必须保持这些语义：

- 显式保存空槽，保证重载后位置不压缩。
- All 分区顺序固定；columns 有上下界；数组和字符串有明确长度限制。
- name 使用有界 ASCII command ID。未知 name 保留为不可用槽，不能执行，也
  不能导致整个 profile 丢失；这样跨构建降级或升级不会静默破坏布局。
- 不保存 icon、key、description、sourceIndex、DOMRect、像素宽度、hover、
  drag、chooser、targeting 或 active intent。

迁移与存储：

- `blisshack.profile.v4` 是新权威 key。
- 仅在 v4 缺失时依次读取 v3、v2、v1。
- v4 损坏时使用完整默认 profile，不回退旧 key，不自动覆盖损坏值。
- v1/v2/v3 均经过各自严格 validator 后迁移；动作栏模式为 Original，布局为
  当前默认值。
- Clear Local Data 同时清理 v4、v3、v2、v1 和 diagnostics。
- 原型的 `blisshack.profile.v3.actionBar` 不进入生产读取、迁移或清理逻辑。

### 5.2 导入与导出

- `.bhprofile` 导出升级为 schema v4，并包含完整动作栏设置。
- 旧 schema v1/v2/v3 `.bhprofile` 继续迁移。
- 完整 backup 外层仍为 schema v2，因为容器、save 和 Ranking 结构未变；其
  内嵌 profile 使用 v4。
- 旧 backup v1/v2 中的旧 profile 继续迁移，Ranking 兼容规则不变。
- All Actions 必须提供独立布局导入和导出，文件扩展名为 `.bhactions`。文档
  schema v1 只包含格式版本和完整 `actionBarLayout`，使用与 profile v4 相同
  的严格 validator、尺寸上限和未知 action name 保留规则。
- `.bhactions` 导入只替换 `actionBarLayout`，不改变 `actionBarStyle` 或其他
  profile 字段；确认后通过同一个 profile 原子提交路径保存，不能建立第二个
  localStorage key。
- `.bhactions` 导出必须从已提交 profile 生成稳定文档；取消、非法文件或保存
  失败时保持当前内存布局与持久布局一致。
- 所有导入先展示差异并确认；失败不产生部分布局或 profile 更新。

## 6. 目标架构

建议增加：

```text
frontend/src/action-bar/
├── action-catalog.ts
├── action-catalog-metadata.ts
├── action-bar-layout.ts
├── action-bar-layout-controller.ts
├── action-bar-execution.ts
└── *.test.ts

frontend/src/screens/game/
├── ActionDock.tsx
├── ActionGrid.tsx
├── ActionSlot.tsx
├── ActionItemChooser.tsx
├── ActionTargetingOverlay.tsx
├── AllActionsPanel.tsx
└── OriginalStatusArea.tsx
```

文件名不是硬性要求；职责边界是硬性要求：

- catalog 层解析当前 WASM 命令身份与键位。
- metadata 层只维护分类、图标和默认布局。
- layout 层负责纯数据校验、resize、分隔和拖放结果。
- `GameActionController` 继续作为唯一游戏动作 intent owner。
- `input-controller.ts` 继续作为唯一 pending Asyncify input owner。
- React 组件只呈现状态和发出语义事件，不直接操作 WASM 指针。
- `GameHudLayout` 仍是 messages、map、inventory 和底部区域的唯一几何 owner。

### 6.1 版本化动作目录

优先仿照角色目录建立值复制的 `actionCatalog`：

```ts
interface ActionCatalogEntry {
  sessionCommandId: number;
  name: string;
  defaultKey: number;
  flags: number;
}
```

- C/libnh 初始化完成后复制当前构建的数据，不向 React 暴露函数地址。
- `sessionCommandId` 只在当前 module/session 内使用。
- 初始化时拒绝重复 name、越界 ID、非法 flags 和超过上限的 catalog。
- 若继续复用 `extcmdlist` 指针 decoder，必须以当前 WASM32 结构布局测试作为
  门禁；不得增加未经验证的偏移猜测。
- 现有 extended-command picker 与动作栏共享同一份 decoded catalog，避免两套
  过滤规则。

### 6.2 通用 command-boundary 协议

将现有协议升级为 v2，至少表达：

- 固定内部命令 `clicklook`。
- catalog command ID。
- 是否请求本命令使用核心物品菜单。
- 当前 session 内非零、不回绕的 32-bit request nonce。
- `clicklook` 所需坐标。

C 侧必须：

1. 拒绝未知版本、未知位、越界 ID 和无函数条目。
2. 拒绝 internal、wizard、`CMD_NOT_AVAILABLE` 和 `CMD_PARAM` 条目。
3. 每个 `shim_get_nh_event()` 最多消费一个请求。
4. 只把命令放入 `CQ_CANNED`，由 `rhack()` 正常执行
   `can_do_extcmd()`、repeat 和回合语义。
5. 将物品菜单请求限制为当前命令作用域，并在完成、拒绝或下一主命令边界清理，
   不能让 `force_invmenu` 泄漏到后续键盘命令。
6. 用原 payload/nonce 回报接受结果；session reset 同时清理 pending 与 active
   请求。
7. 发布单调递增的 command-boundary generation；前端用它区分 prefix 的后续
   `commandInp` 与 `rhack()` 真正结束后的新顶层边界。
8. nonce 或 generation 达到上限时拒绝继续分配并进入明确 fatal 路径，不允许
   在同一 session 内回绕后与旧 observation 碰撞。

command-scoped 物品菜单还需要一个独立于 `force_invmenu` 的来源标记：

1. 只在本次 action request 触发的 `getobj()` 强制候选菜单调用期间设置
   `action-getobj` provenance。
2. `shim_select_menu` 将 provenance、request nonce 和 menu generation 作为
   值复制 metadata 传给 bridge，不暴露对象指针。
3. 离开该 `getobj()` 调用时无条件清理 provenance；嵌套或后续普通菜单不得
   继承。
4. 若无法以局部、可测试的改动证明 provenance，暂停轻量 chooser，保留原生
   菜单，不能退化为按 prompt 或菜单顺序猜测。

若命令不能在不改游戏规则的情况下产生核心候选菜单，该命令回退原生 prompt，
不得为统一外观修改物品合法性。

### 6.3 动作状态机

建议扩展为：

```text
idle
-> waiting-command-boundary
-> starting-command
-> waiting-core-response

waiting-core-response
-> presenting-item-menu
-> targeting-direction
-> targeting-position
-> waiting-prefix-continuation
-> handed-off-to-native-ui
-> completing
-> idle

任意 active 状态
-> cancelling-core-input
-> waiting-cancel-boundary
-> idle
```

每个 intent 至少绑定：

- module ID、session ID 和创建时 snapshot revision。
- 持久化 action name 与当前 session command ID。
- 来源 slot/panel 和可选 focus restore token。
- 已观察到的核心 input kind。
- 可选 inventory/menu revision。
- 取消原因和不含游戏内容的诊断事件。

约束：

- 同时最多一个 active intent。
- 每一步只消费当前真实 pending input。
- 静态 action metadata 不能决定下一步一定是 item、direction 或 position。
- 非预期输入必须可见地交回现有 UI，不能被吞掉。
- 完成只由 request 接受后递增的新 command-boundary generation 或明确的核心
  终止事件判定，不能用 `commandInp`、input 变空或固定 timeout。
- 正常取消必须等待当前 callback resolver 被核心消费和新的 boundary
  generation；等待期间仍持有 intent/input barrier。
- action intent 与 layout edit gesture 互斥。

### 6.4 HUD 与 Overlay

`GameTerminal` 拆分为可独立 inert 的游戏内容和 dock：

```text
GameHudLayout
├── GameContent
│   ├── MessageArea
│   ├── MapViewport
│   └── PermanentInventoryPanel
└── BottomRegion
    ├── OriginalStatusArea
    └── ActionDock
```

实际只按当前模式渲染一个 bottom branch。All Actions 和 chooser 可以挂在
session-owned overlay host，但它们的可交互范围必须与 dock 分离于
`GameContent` 的 inert 边界。

状态与动作栏共用底部区域时不得重复构造 `StatusMetric[]`。BlissHack dock 使用
紧凑 status variant；Original 使用阶段八的 TTY variant。

`ActionDock`、`AllActionsPanel` 和 `ActionItemChooser` 是明确的浏览器键盘
owner，根节点使用现有 `data-browser-keyboard` 契约。它们的 Enter、Space 和
Escape handler 必须先完成本地语义并阻止同一事件到达 `GameScreen` 的全局
NetHack 键盘路由。

## 7. 非目标

- 自定义键位或图形化 key binding 编辑器。
- 方向移动按钮、虚拟摇杆、手机触控布局。
- Travel and Act、自动走到目标后执行动作或前端寻路。
- 根据 tile、英文消息、物品名称或永久背包内容推断动作合法性。
- 精确预判每个命令在当前游戏规则下是否可执行。
- 修改 NetHack 的角色能力、物品过滤、命令耗时、确认或取消规则。
- 持久化 sourceIndex、菜单 identifier、WASM 地址或运行中的 targeting 状态。
- 为每个动作撰写解释性文案。
- 新的地图 Tile、独立动作插画、动画时间线或自定义主题。
- 默认加入没有核心生产者的动态上下文动作。数据模型允许未来在 dock 边缘显示
  临时动作，但 alpha-2.3 不伪造此类动作。

## 8. 分阶段实施

每个阶段必须依次执行：

```text
测试 subagent
-> 提交失败测试或 characterization baseline
-> 主 Agent 实现
-> 独立 reviewer
-> 修正 findings
-> 阶段完整验证
-> 阶段 commit
```

### 阶段零：分支、版本和行为基线

1. 确认 alpha-2.2 release acceptance 与当前 runtime 三件套一致。
2. 创建 alpha-2.3 开发分支并更新根 `VERSION`。
3. 运行固定工具链预检；版本进入 runtime manifest 时重新构建三件套。
4. 固化原型 17 项契约测试。
5. 用真实 WASM 记录 104 个可见非方向命令及 24 个被排除的移动命令。
6. 为代表性流程建立 characterization：
   `search`、`inventory`、`eat`、`wield`、`apply`、`throw`、`kick`、`travel`、
   `#`、`save`、`toggle`、一个 `PREFIXCMD` 后续命令和一个核心拒绝路径。
7. 固化 alpha-2.2 Original HUD、Tiles/ASCII、Right/Below 的截图与几何基线。

门禁：

- catalog 与原型 name/order 完全一致。
- 记录每个代表命令实际产生的 menu、getdir、getpos、yn、display 顺序。
- 不依赖固定 sleep 或英文 prompt 做流程判定。

建议提交：

```text
chore: start alpha-2.3 development
test: characterize action bar command flows
```

### 阶段一：动作目录和通用命令协议

测试优先定义：

- catalog 版本、数量、唯一 name、key、flags 和过滤规则。
- `sessionCommandId` 只属于创建它的 module/session。
- 协议 v1 现有三个命令继续兼容或被明确迁移。
- v2 未知版本、未知位、越界 ID、internal、wizard 和 unavailable 命令被拒绝。
- 每个安全边界最多消费一个请求。
- request/result 必须精确匹配；reset 清理 pending 与 active 请求。
- catalog command 由 `CQ_CANNED` 执行并经过 `rhack()` 的原生可用性检查。
- `CMD_PARAM` 目录项无法按裸 ID 排队，当前 `toggle` 保持可见但不可执行。
- `PREFIXCMD` 的后续 `commandInp` 不被当成新顶层 boundary；整个组合命令结束
  后才发布新的 generation。

实施版本化 catalog 和 command protocol v2。若修改 C 或 libnh，按仓库规则更新
文件头、`shim-interface-reference.md`、`upstream-modifications.md`，并用固定
Emscripten 6.0.9 重建、一起提交：

```text
frontend/public/nethack.js
frontend/public/nethack.wasm
frontend/public/nethack-runtime.json
```

建议提交：

```text
test: define generic action command protocol
feat: expose the action command catalog
feat: dispatch catalog commands at safe boundaries
```

### 阶段二：profile v4 与布局领域模型

测试优先定义：

- v1/v2/v3 严格迁移到 v4，模式为 Original，布局为默认值。
- v4 缺失字段、非法枚举、越界行数/列数、过大数组和过长 name 被拒绝。
- 空槽、未知 action name、分类、分区宽度和锁定状态可无损 round-trip。
- v4 key 优先级、旧 key fallback、损坏处理和 Clear Local Data。
- `.bhprofile`、`.bhactions` 和 backup v1/v2 的导入导出。
- profile diff 能显示 Action bar 模式和布局变化摘要。

实现纯函数布局模型、profile v4 和 Settings segmented control。动作栏编辑结果
必须复用现有完整 profile 原子提交，不新建旁路 localStorage key。
本阶段同时定义 `.bhactions` schema v1、validator、稳定序列化和导入差异模型；
可见导入导出控件在阶段六接入。

建议提交：

```text
feat: persist alpha-2.3 action bar settings
```

### 阶段三：ActionDock 与 HUD 状态合并

先只接通可见 UI 和纯布局交互，不执行游戏命令：

1. 增加 `ActionDock`、grid、slot、分类 Tab 和四个纵向圆形工具按钮。
2. 将现有状态指标以紧凑 variant 放到 BlissHack dock 左侧。
3. 保留输入提示并防止与状态、动作格重叠。
4. 实现 1 至 4 行、完整列拟合、32 px 下限、横向滚动和末分区空槽填充。
5. 实现 All 分区竖向分隔条的整列吸附视觉，但本阶段不提交持久修改。
6. Original 继续使用 alpha-2.2 状态栏和零高 action slot。

门禁：

- 两种模式都只有一个状态实例和一个输入提示实例。
- 四个工具按钮固定同径，纵向 `space-between`。
- Tab 顺序、All 分区顺序、默认动作和禁用动作槽位符合原型。
- Tiles/ASCII、Right/Below、1/2/3/4 行均不发生元素重叠。
- 1280×900 和 900×700 保持地图可操作；320px 最小宽度可恢复且无页面级横向
  overflow。
- 行数和模式切换保留归一化 camera anchor。

建议提交：

```text
feat: add the BlissHack action dock
```

### 阶段四：真实动作、物品选择与 targeting

测试 subagent 先扩展 `GameActionController`：

- 直接命令从请求到下一 command boundary 完成。
- 核心生成的物品菜单由轻量 chooser 呈现。
- 只有 request nonce、`action-getobj` provenance 和 menu generation 匹配的
  核心物品菜单由轻量 chooser 呈现。
- `item -> direction`、`item -> position` 和多次 item 流程逐步推进。
- 真实 `getdirInp` 与普通 `yn` 不混淆。
- 真实 `getposInp` 才开启地图坐标 targeting。
- 普通 yn/line/display/extcmd/PICK_ANY 安全交回现有 UI。
- Escape、再次点击、session reset、fatal、unmount 和 stale revision 正确
  取消。
- 取消在 resolver 被核心消费且出现新的 boundary generation 前保持 busy；此时
  点击其他动作不会执行。
- `PREFIXCMD` 保留核心后续命令输入，并在完整组合结束后完成。
- UI intent 期间不接受 typeahead，不会把用户按键插入自动步骤。

实施：

1. 扩展 input snapshot，保留核心完整输入种类。
2. 增加 action intent、chooser、direction targeting 和 position targeting
   状态。
3. 只使用核心返回的菜单候选。
4. 为物品动作增加 command-scoped 强制菜单和 `getobj` provenance 机制，并
   证明 nonce、menu generation 与所有清理路径不会泄漏。
5. 单击 ActionDock 或 All Actions 的动作时执行同一条路径。
6. 每个动作的回合、取消和错误消息与原生命令一致。
7. `CMD_PARAM` 动作保持 unavailable；prefix 动作使用核心原生 continuation。

本阶段若为 provenance 修改 `src/invent.c`、shim callback 或其他上游文件，
必须按仓库规则写明 BlissHack 修改者、日期和目的，更新
`shim-interface-reference.md` 与 `upstream-modifications.md`，再用固定
Emscripten 6.0.9 重建并成组提交 runtime 三件套。

真实 WASM 门禁至少覆盖：

| 类型 | 命令 |
| --- | --- |
| 直接 | `search`, `wait`, `inventory` |
| 物品 | `eat`, `quaff`, `wield`, `wear`, `read` |
| 物品后续方向 | `apply`, `throw`, `zap` |
| 方向 | `kick`, `open`, `chat`, `untrap` |
| 地图坐标 | `travel`, `glance`, `jump` |
| 特殊/原生回退 | `#`, `options`, `save`, `quit`, `fight` |
| flags 边界 | `toggle`, `fight`, `reqmenu`, `run`, `rush` |

建议提交：

```text
test: define action bar execution contracts
feat: execute action bar commands through the core
feat: add action item and targeting flows
```

### 阶段五：锁定、拖放、分隔与持久化

测试优先覆盖：

- 锁定时所有布局修改都被拒绝且只有锁按钮显示短暂红光。
- 解锁后同布局移动、交换、空槽插入和占用槽覆盖。
- 从 dock 拖出删除；拖入 All Actions 同样删除。
- 从 All Actions 拖到 dock 外不变；拖到锁定 dock 不变。
- 分隔条只按整列移动，不能产生零列或越界 capacity。
- 行数变化保留动作序列与显式空槽。
- pointer cancel、lost capture、Escape、blur、reset 和卸载不保存。
- 只在完整操作结束时提交一次 profile；失败恢复已保存布局并给出错误状态。
- 刷新、Save and Exit、Continue 和新游戏复用同一布局。

拖动优先复用项目已有 Pointer Events controller 模式，不使用浏览器原生 HTML
Drag and Drop。布局 reducer 保持纯函数，组件不直接写 localStorage。

建议提交：

```text
feat: customize and persist action bar layouts
```

### 阶段六：All Actions、焦点与布局交换

实施完整 All Actions：

1. 渲染七个垂直分类 section 和 104 个当前 catalog 动作。
2. 使用全局 scrollbar，并确保面板不覆盖 dock。
3. 只 dim/inert messages、map 和 permanent inventory。
4. 保持 dock 可点击、可拖动，并支持 panel 与 dock 之间的拖放规则。
5. 保存打开按钮，关闭后在 inert 清除之后恢复焦点。
6. 键盘焦点只遍历 panel 与 dock 的可交互控件。
7. 为 dock、panel 和 chooser 标记 `data-browser-keyboard`，验证 Enter、Space
   和 Escape 不会同时进入全局 NetHack 键盘路由。
8. 接入并完成正式 `.bhactions` v1 导入导出；profile 和 backup 路径同时保持。

门禁：

- 面板不是全屏，也不声明 `aria-modal=true`。
- 单击动作先关闭面板，再执行一次且仅一次核心命令。
- core modal、pause 和 All Actions 不会同时争夺焦点。
- 动作 Tooltip 只有 name 和 key。
- `.bhactions` 导出、差异确认、取消、有效导入和非法文件拒绝均可用，且不会
  改变动作栏模式或其他设置。
- Chromium、Firefox、WebKit 的点击、滚动、拖放、Escape 和焦点恢复一致。

建议提交：

```text
feat: add the all actions panel
```

### 阶段七：响应式、兼容与动作栏综合门禁

1. 扩展 `hud-visual.spec.ts` 的 Original/BlissHack 几何检查。
2. Chromium 截图覆盖 Tiles/ASCII、Right/Below、默认 2 行和最大 4 行。
3. Firefox/WebKit 覆盖同一几何、overflow、焦点和 Pointer Events 合同。
4. 验证 1/2/3/4 行的 slot 完整列、末区空槽和最小尺寸。
5. 验证地图 camera、hover、右键、position input 和背包拖放不回归。
6. 验证 pause、游戏内 Settings、终局结果页、fatal、锁冲突和 read-only
   end-summary 背景。
7. 验证 profile v1-v4、backup v1/v2、跨页面 stale profile 和 Clear Local
   Data。
8. 对 104 个 catalog name 建立构建门禁，对代表命令执行真实 WASM 流程。
9. 验证 `.bhactions` v1 的导出、导入、取消、损坏和原子失败路径。
10. 运行 unit、lint、build、WASM、Chromium、Firefox、WebKit、performance 和
   long-flow。

本阶段结束后，BlissHack 动作栏必须达到可人工验收状态；Original 仍暂时是
alpha-2.2 图形状态栏。

建议提交：

```text
test: complete action bar integration coverage
```

### 阶段八：Original TTY 状态与发布收尾

这是 alpha-2.3 的最后一步，不提前穿插到动作栏主体阶段。

实施：

1. 新增 `OriginalStatusArea`，使用当前结构化 BL 字段构造 TTY 风格两行文本。
2. 顺序以 NetHack 5.0 `win/tty/wintty.c` 的 two-line field order 和
   `genl_status_update()` 行分组为依据。
3. 保留核心颜色与 text attributes，但移除 HP、Energy、XP 图形进度条、卡片化
   resource 布局和 BlissHack 条状视觉。
4. 动态启停字段、conditions、`showExperience`、`showTime` 和 polymorph HD
   必须与核心 callback 一致。
5. `informationLevel="detailed"` 只增加既有说明 Tooltip，不改变两行字段内容。
6. Original 与 BlissHack 切换不得重置动作栏布局、地图 camera 或输入状态。
7. 更新 README、frontend README、session-start、shim/upstream 修改记录和
   `in-alpha-2.3/release-acceptance.md`。
8. 重新运行 alpha-2.3 全部自动门禁并完成独立 reviewer。
9. 停在人工验收门槛；未获确认前不自行 push 或部署。

门禁：

- Original DOM 中不存在 `.nh-status-bar` 或 HP/Energy/XP progress bar。
- Original 两行字段顺序与当前 NetHack 5.0 TTY 基线一致。
- Original 没有 action dock；BlissHack 的图形状态和动作栏不受影响。
- 两种模式在 1280×900、900×700、Tiles/ASCII、Right/Below 下均无重叠。
- 全部自动测试通过并记录环境、runtime hash、截图和人工检查项。

建议提交：

```text
feat: add the original tty status layout
docs: complete alpha-2.3 acceptance
```

## 9. 测试策略

### 9.1 单元与组件测试

- catalog 解码、过滤、key 格式化和 metadata 穷举。
- profile v4、布局 validator、迁移、导入导出和 diff。
- 行数、分区宽度、完整列拟合、空槽与 horizontal overflow 计算。
- layout reducer 的移动、交换、覆盖、删除、锁定拒绝和取消。
- action intent 的全部状态转换、native handoff 和清理。
- request nonce、menu generation、`getobj` provenance、prefix continuation
  和 cancel-boundary 状态转换。
- All Actions 的分类、焦点范围、inert ownership 和 trigger 恢复。
- dock、panel、chooser 的浏览器键盘 ownership；Enter/Space/Escape 不重复
  发送到核心。
- ActionSlot 的 available/blocked/unavailable 与稳定占位。
- Original TTY 状态字段排序、动态启停、颜色和无进度条。

### 9.2 Bridge 与 WASM

- 当前构建 catalog 与 104/24 基线。
- command protocol v2 编解码、拒绝和 request/result 配对。
- `CQ_CANNED`、`can_do_extcmd()`、repeat 和回合语义。
- `CMD_PARAM` 拒绝与当前 `toggle` unavailable；四个 `PREFIXCMD` 的原生后续
  输入、取消和新 boundary generation。
- command-scoped item menu 在成功、取消、零候选和异常后都清理。
- 普通 `PICK_ONE`、同 window ID 重用和过期 menu generation 不会被 chooser
  接管。
- `getdirInp`、`getposInp`、`commandInp` 和普通 `otherInp` 的准确传播。
- item menu identifier 只在当前 menu 生命周期使用。
- 无 Asyncify 重入、悬空 resolver、双 pending action 或跨 session 命令。
- runtime 三件套版本、ABI 和 manifest 一致。

### 9.3 浏览器

- 两种 Action bar 设置在 Home 与游戏内的生效范围。
- 默认布局、所有 Tab、All Actions 和 Tooltip。
- `.bhactions` 导出、差异确认、导入、取消和损坏文件拒绝。
- 1 至 4 行、分隔条、锁定提示和全部拖放方向。
- 刷新、退出、继续、Profile 和完整备份后的布局恢复。
- 物品 chooser、键盘/地图方向 targeting、位置 targeting 和 Escape。
- 核心拒绝、普通 modal、pause、read-only end-summary 和 fatal。
- 当前地图右键、hover、永久背包右键及拖放完整回归。

浏览器测试使用 command readiness、input kind、snapshot/map/inventory revision
和实际菜单状态等待，不使用固定 sleep 判断游戏流程。

## 10. 人工验收

### 10.1 Settings 与模式

1. 在 Home 选择 Original，进入新游戏确认无动作栏。
2. 在游戏暂停 Settings 切换 BlissHack，Apply 后确认 dock 立即出现且不耗回合。
3. 调整布局后切回 Original，再切回 BlissHack，确认布局未丢失。
4. 刷新、Save and Exit、Continue 后确认模式和布局恢复。
5. 导出再导入 Profile 和完整备份，确认动作栏设置一同恢复。
6. 从 All Actions 导出 `.bhactions`，修改布局后重新导入并确认只恢复布局；
   再验证取消和损坏文件不会改变任何设置。

### 10.2 动作执行

1. 从 dock 与 All Actions 分别执行 direct、item、direction、position 动作。
2. 验证 `eat`、`quaff`、装备类动作显示核心过滤后的轻量物品面板。
3. 验证 `apply`、`throw`、`zap` 只在核心真实请求后继续方向 targeting。
4. 用鼠标和键盘完成 `kick` 与 `travel`，并分别用 Escape 取消。
5. 执行会打开普通 yn、text、menu 或 extended-command 的动作，确认回退原生 UI。
6. 对无可用物品、无可用法术和核心拒绝状态确认原生消息与回合语义。
7. 确认 `toggle` 可见但不可点击，`fight`、`reqmenu`、`run`、`rush` 等 prefix
   动作仍要求核心原生后续命令。
8. 在物品 chooser 或 targeting 中按 Escape 后立即点击另一动作，确认新动作
   只在前一取消真正回到命令边界后才能开始。
9. 确认任何流程都没有多余命令、错选物品或残留 targeting 高亮。

### 10.3 布局编辑

1. 在锁定状态尝试拖动动作和分隔条，确认不变且锁按钮红光提示。
2. 解锁后完成移动、交换、覆盖、空槽插入和拖出删除。
3. 打开 All Actions，从面板拖入空槽和占用槽。
4. 将 dock 动作拖入 All Actions，确认只是从 dock 删除。
5. 调整 1、2、3、4 行及所有分隔条，确认按格吸附和右侧空槽补齐。
6. 在 Pointer cancel、失焦和 Escape 中断手势，确认不保存半成品。

### 10.4 布局与焦点

1. 在 1280×900 和 900×700 下检查 Tiles/ASCII、Right/Below、2/4 行。
2. 确认四个圆形工具按钮大小固定，纵向间距随 dock 高度展开。
3. 打开 All Actions，确认消息、地图、永久背包变暗且不可操作，dock 保持正常。
4. 用 Tab、Shift+Tab、Enter、Space 和 Escape 检查 panel 与 dock。
5. 在 dock、panel 和 chooser 聚焦时按 Enter、Space 和 Escape，确认每次只有
   一个浏览器 UI 结果且没有额外 NetHack 输入。
6. 确认 Tooltip、chooser 和 panel 不被 viewport 或 dock 裁切。
7. 确认地图滚动、Follow 和 camera anchor 在行数及模式变化后合理保持。

### 10.5 Original TTY

1. 在 Original 下确认只有 TTY 风格状态文字，没有三类图形进度条。
2. 对比当前 NetHack 5.0 TTY 的两行字段顺序。
3. 分别开关 Show experience 和 Show turn count。
4. 触发 Hunger、负面状态、属性变化、升级和 polymorph，确认字段更新正确。
5. 切换 Detailed，确认只增加 Tooltip，不改变 TTY 文本。

## 11. 风险与处理

| 风险 | 处理 |
| --- | --- |
| 静态 input metadata 与真实命令分支不一致 | 只按核心实际 input/menu 推进 |
| 通用命令绕过 `can_do_extcmd()` | 只入 `CQ_CANNED`，由 `rhack()` 执行 |
| 物品 chooser 伪造候选或泄露未知信息 | 只呈现当前核心 `getobj()` 菜单 |
| 同命令的普通菜单被误认作 chooser | request nonce + `action-getobj` provenance + menu generation 三重匹配 |
| `force_invmenu` 泄漏到下一命令 | command-scoped 标志、所有退出路径清理、WASM 测试 |
| `getdir` 被误判为普通 yn | 传播 `program_state.input_state`，禁止 prompt 文本匹配 |
| 取消 UI 早于核心取消 | 等 callback resolver 消费和新 boundary generation 后才回 idle |
| prefix 输入被误判为动作完成 | 以 `shim_get_nh_event()` generation 而非 `commandInp` 判定完成 |
| 浏览器控件按键重复发送给核心 | `data-browser-keyboard` + 局部 handler + 冒泡回归测试 |
| persisted sourceIndex 在重建后错指命令 | 只持久化 name，session 内重新解析 ID |
| 不能准确预判动作可用性 | 使用三态模型；未知保持可点击并由核心反馈 |
| 104 项 metadata 漏项或漂移 | 与当前 WASM catalog 做构建时穷举测试 |
| All Actions 使 dock 一起 inert | 拆分 GameContent 与 BottomRegion inert 边界 |
| 多层 overlay 争夺焦点 | 明确优先级、单 owner、关闭清理和三浏览器测试 |
| 4 行 dock 挤压地图 | 32px 下限、grid 内滚动、HUD 自身纵向恢复 |
| Below 背包与 dock 争夺高度 | 独立布局行、显式 minmax 和极矮 viewport 回归 |
| 快速拖放导致 profile 写入乱序 | 手势结束单次提交、串行化、失败恢复 |
| TTY 状态复制过多上游布局逻辑 | 只复用结构化字段与固定两行顺序，不移植终端绘制器 |

## 12. 停止条件

出现以下情况时暂停对应阶段并单独评审：

- 通用命令只能通过模拟默认快捷键或 Asyncify 重入执行。
- item chooser 必须根据永久背包或英文物品名自行判断候选。
- 方向输入只能通过匹配英文 prompt 识别。
- command-scoped 菜单请求无法证明在取消和异常路径后清理。
- 无法为强制 `getobj()` 菜单提供 request nonce、provenance 和 menu generation
  三重来源证明。
- `CMD_PARAM` 只能通过伪造 `gc.cmd_bind` 或未校验参数执行。
- prefix 流程无法区分 continuation input 与真正的新 command boundary。
- targeting 取消无法等待核心 callback 消费就必须开放下一动作。
- catalog 需要持久化函数地址、WASM 指针或未经验证的结构偏移。
- 精确 disabled 状态要求读取未公开核心状态或泄露未鉴定信息。
- All Actions 无法在保持 dock 交互时可靠隔离地图和背包焦点。
- 900×700 下必须把动作槽缩小到 32px 以下或产生区域重叠。
- Original TTY 模式必须切换 window port 或复制完整 tty terminal 才能实现。
- 需求扩张到自定义键位、Travel and Act、移动端控制器或新动作美术。

## 13. 完成定义

alpha-2.3 只有同时满足以下条件才算完成：

1. Settings 提供 Original/BlissHack Action bar 选项，并使用 profile v4。
2. 旧 profile 与旧 backup 保持可导入，布局随 Profile 和完整备份保存。
3. `.bhactions` v1 是正式交付：可独立导出、预览并原子导入布局，失败或取消
   不改变 profile。
4. BlissHack dock 与状态区合并，符合已确认原型的行数、分区、Tab 和工具布局。
5. All Actions 来自当前 WASM 的 104 个可见非方向命令；`CMD_PARAM` 保持可见
   但不可用，prefix 命令保留核心原生 continuation。
6. 动作按命令身份在安全边界执行，不依赖默认快捷键宏或 WASM 重入。
7. 物品、方向、坐标和其他后续输入由核心实际请求驱动；chooser 具有 nonce、
   `getobj` provenance 和 menu generation 来源证明。
8. 正常取消在核心消费并到达新命令边界前不会开放下一动作。
9. 锁定、拖放、覆盖、移除、分隔、空槽和 Custom 布局可跨游戏恢复。
10. All Actions 打开时只 dim/inert 游戏内容，dock 保持可交互。
11. dock、panel、chooser 的浏览器键盘事件不会重复进入 NetHack。
12. 不可执行动作保留槽位，不因状态变化重排。
13. 地图、右键菜单、hover、永久背包、暂停和普通键盘输入无回归。
14. Original 最终使用无 HP、Energy、XP 图形条的 TTY 风格状态区。
15. Tiles/ASCII、Right/Below、1 至 4 行和规定 viewport 通过几何及截图门禁。
16. unit、lint、build、WASM、Chromium、Firefox、WebKit、performance 和
    long-flow 全部通过。
17. 独立代码审查和人工验收完成后再合入并部署。

## 14. 计划提交序列

```text
docs: plan alpha-2.3 action bar
chore: start alpha-2.3 development
test: characterize action bar command flows
test: define generic action command protocol
feat: expose the action command catalog
feat: dispatch catalog commands at safe boundaries
feat: persist alpha-2.3 action bar settings
feat: add the BlissHack action dock
test: define action bar execution contracts
feat: execute action bar commands through the core
feat: add action item and targeting flows
feat: customize and persist action bar layouts
feat: add the all actions panel
test: complete action bar integration coverage
feat: add the original tty status layout
docs: complete alpha-2.3 acceptance
```

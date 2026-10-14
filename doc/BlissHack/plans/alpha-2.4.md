# BlissHack alpha-2.4 Examine 观察窗口计划

## 1. 文档状态

本文定义 alpha-2.4 的产品范围、交互契约、可见身份边界、数据生成与许可边界、
运行时架构、实施阶段和验收门禁。alpha-2.3 已于 2026-09-26 完成实现、自动
门禁、独立复审和人工验收；根目录 `VERSION` 当前为 `alpha-2.4`。

本版本经用户确认的视觉与交互原型为：

- `doc/BlissHack/prototypes/alpha-2.4-examine-newt.html`
- `doc/BlissHack/prototypes/alpha-2.4-examine-newt.NOTICE.md`

原型是布局、信息层级、来源标注和交互方式的产品基线，不是生产数据源，也不是
生产状态机。原型中手写的 Newt 数值不得直接复制到游戏；例如当前
`src/makemon.c:newmonhp()` 会把等级 0 怪物掷出的最低 1 HP 提升为 2，因此
Newt 的生成 HP 范围是 2 至 4，而不是原型暂写的 1 至 4。正式实现必须由当前
NetHack 5.0 源码生成数据并通过源码一致性校验。

本文完成并经用户确认前不开始功能实现。计划中的阶段状态、建议文件和提交名不
表示对应代码已经存在。

## 2. 版本目标

alpha-2.4 完成以下目标：

1. 在 `informationLevel="detailed"` 时，为地图和永久背包的核心右键菜单增加
   一个明确的 `Examine` 前端动作。
2. 选择 `Examine` 后先安全解除当前核心菜单，再打开已确认原型形式的大型、
   非全屏观察窗口；整个流程不消耗游戏回合。
3. 使用核心已经决定的最终显示身份，不读取隐藏怪物、物品或地图状态，不泄露
   幻觉、伪装、未鉴定、未发现陷阱或地图记忆之外的信息。
4. 为怪物、物品、尸体、雕像、已安全识别的神器、可见陷阱和地形建立与当前
   NetHack 源码绑定的结构化资料。
5. 在观察窗口中分别展示 NetHack 源码事实和 NetHackWiki 完整段落节选，并
   明确区分 NGPL 与 CC BY-SA 3.0 的来源、署名和修改说明。
6. Wiki 文字只允许从固定 revision 选择完整原文段落；禁止摘要、翻译、改写、
   拼接句子或把不同段落合并成新段落。
7. 让全部正常构建、测试和游戏运行保持离线；Wiki 更新只能由显式维护命令
   触发，不能在玩家浏览器中实时请求 Wiki。
8. 保持现有核心右键动作、地图悬停、背包悬停、键盘菜单、动作栏、存档和
   profile 行为不变。

## 3. 当前基线与缺口

### 3.1 可复用能力

- `MapCell` 同时保存核心最终提交的前景和背景 `GlyphInfo`；
  `GlyphInfo.glyph` 与 `glyphFlags` 已由 `shim_print_glyph` 值复制到前端。
- 永久背包的每个 `MenuItem` 已保存核心提供的可见文本、glyph、accelerator
  和 identifier，完整快照带有 session 内单调递增的 inventory revision。
- `mapRevision` 只在一次实际地图提交后递增，可用于拒绝已经变化的地图目标。
- `GameActionController` 是地图检查、地图/背包右键、背包 drop 和动作栏命令的
  唯一高层 intent owner。
- `input-controller.ts` 是唯一 Asyncify pending input owner；UI intent 活跃时
  不会把普通 typeahead 混入自动流程。
- 地图右键通过核心 `therecmdmenu`，背包右键通过核心 `itemactions()`；当前
  `PICK_ONE` 菜单和对应 resolver 已完整接通。
- `GameModals.tsx` 已支持锚定菜单、菜单键盘操作、边缘避让和关闭后的焦点恢复。
- `OverlayRoot`、`inert`、`SecondaryDialog` 和现有游戏 shell 提供可复用的
  modal、焦点与层级边界。
- profile v4 已有 `informationLevel: "original" | "detailed"`，新 profile
  默认 Detailed，旧 profile 迁移为 Original。
- Tiles 和 ASCII 共用相同的 `MapCell`/`GlyphInfo` 数据，不需要建立两套
  Examine 身份规则。
- 当前仓库已有显式生成并校验 tiles 资源的脚本模式，可以复用其
  generate/verify/checked-in asset 工作流。

### 3.2 当前缺口

- `informationLevel` 当前只控制状态栏解释性 Tooltip，尚未控制右键菜单或
  观察窗口。
- `map-context` intent 没有保存创建时的 map revision 和可见 glyph；
  `inventory-context` 也没有保存物品 glyph 或可见实体身份。
- `ContextMenuPresentation` 只表示核心菜单窗口和锚点，不能表示前端合成行。
- `MenuOverlay` 直接把所有行当作核心 `itemIndex` 提交，不能安全表示一个没有
  核心 identifier 的 `Examine` 动作。
- 取消核心右键菜单后，当前控制器只等待菜单输入改变并完成；没有
  “resolver 已消费、顶层命令边界已恢复、此时可以打开本地对话框”的显式状态。
- 前端没有 NetHack 实体目录、glyph 到可见实体的版本化映射、资料 lazy loader
  或严格运行时 validator。
- `include/monsters.h`、`include/objects.h`、`include/artilist.h` 和
  `include/defsym.h` 是宏驱动源码，不能依靠正则表达式稳定解析。
- Wiki 文本没有固定 revision、完整段落选择、来源追踪、许可校验和离线更新
  流程。
- 普通对象 glyph 不编码神器身份。若要显示神器专属资料，需要核心在确认名称
  已对玩家可见时额外发布有界、值复制的可见身份，不能从菜单文本猜测。

## 4. 已确定的产品契约

### 4.1 `informationLevel` 语义

alpha-2.4 不增加设置项，不提升 profile schema：

```ts
type InformationLevel = "original" | "detailed";
```

规则：

- `original`：地图与背包右键菜单继续只显示核心实际产生的动作，不增加
  `Examine`；现有地图/背包悬停行为保持不变。
- `detailed`：目标可以安全解析为受支持的可见实体时，在核心右键菜单末尾增加
  分隔线和 `Examine`。
- 运行中的 Settings 切换继续通过现有 profile v4 原子保存路径生效，不调用
  WASM，不改变回合。
- 切到 Original 时，尚未打开的 Examine 请求立即取消；若观察窗口已经打开，
  则关闭窗口并恢复焦点。
- profile、`.bhprofile`、`.bhactions` 和完整 backup 的 schema 均不因本功能
  改变。

这有意扩展 `informationLevel` 的职责。实现完成后，文档应把它描述为
“控制额外解释和 Examine 入口”，不能继续写成“只控制状态 Tooltip”。

### 4.2 右键菜单入口

- 地图和永久背包原有核心动作按原顺序、原文字、原 accelerator 和原
  identifier 呈现。
- `Examine` 是前端合成的语义行，不是 NetHack 核心动作，不能伪造
  `itemIndex`、identifier、accelerator 或菜单文本去骗过核心 resolver。
- 渲染层使用不相交的判别联合：

  ```ts
  type ContextMenuRow =
    | { kind: "core"; itemIndex: number; item: MenuItem }
    | { kind: "examine"; target: ExamineTarget };
  ```

- `Examine` 首选键为 `e`；如果核心菜单已经占用该键，必须保留核心绑定并选择
  一个未占用键或不显示快捷键。语义身份始终是 `kind: "examine"`，不依赖字符。
- 只在小型资料索引已验证、目标可解析且当前模式为 Detailed 时添加该行。
  数据缺失、目标不支持或索引版本不匹配时，原菜单仍可正常使用。
- 只有右键上下文菜单增加该行。普通键盘 `PICK_ONE` 菜单、动作栏物品选择器和
  其他核心菜单不得出现 `Examine`。
- 远处地图格继续使用核心给出的 Travel、Throw、Look 等动作；Examine 不改变
  这些动作的合法性，也不组合“走过去再操作”。

### 4.3 选择与关闭顺序

选择 `Examine` 后必须遵守以下顺序：

```text
presenting-context-menu
-> resolving-context-menu-for-examine
-> submitMenuSelection(null)
-> waiting-context-command-boundary
-> 核心 select_menu resolver 已返回
-> 原菜单窗口已经消失
-> 新的顶层 command boundary 已出现
-> complete context intent
-> open Examine dialog
```

硬性约束：

- 在 `select_menu` 的 Asyncify resolver pending 时不得打开观察窗口，不得从
  React 重入 C，也不得提前释放 action input barrier。
- `submitMenuSelection(null)` 只表示取消核心菜单，不能同时被当作 intent 完成
  信号。
- 完成至少要求原 window ID 不再是 active modal、顶层 command input 已恢复，
  且 command-boundary generation 大于开始本次 context 流程时的 generation。
- 没有 generation 证据时不得使用固定 timeout、一个 React tick 或
  `modal === null` 单独判定完成。
- 目标在等待期间变旧、session reset、fatal、unmount 或模式切换时，只取消
  intent，不打开旧资料。
- 现有核心动作继续直接提交真实菜单行；不先取消再重放，不改变其回合语义。

### 4.4 可观察实体范围

alpha-2.4 支持玩家当前可见且具有稳定资料身份的实体：

- 普通、宠物、骑乘和探测显示的怪物种类。
- 已公开类型的普通物品；generic/unidentified glyph 只提供当前物品类别资料。
- 带物种身份的尸体和雕像。
- 永久背包中已经由核心安全公开身份的神器。
- 已经显示在地图上的陷阱。
- 墙、门、地板、走廊、楼梯、祭坛、泉水、水、熔岩、树等持久地形或设施。
- 永久背包中的普通物品、尸体、雕像和已公开神器。

以下不在本版本范围：

- 未发现陷阱、隐藏门、未探索格或任何没有显示 glyph 的内容。
- invisible、warning、zap、explosion、swallow 和临时 effect glyph。
- 怪物实例当前 HP、当前装备、驯服度、和平状态、状态异常或内部 AI 状态。
- 地上被怪物或物品前景完全遮住、当前并非目标的背景实体。
- 尚未公开真实名称的神器或物品真实类型。
- 玩家自定义命名反推出的真实类型。

当一格同时存在前景和背景时，Examine 只选择玩家当前看到的最上层持久实体：
优先前景，前景不可观察或不存在时才使用背景。不在窗口内提供切换到被遮挡实体
的旁路。

### 4.5 观察窗口

观察窗口遵循已确认 Newt 原型：

- 大型但非全屏，保留可见 backdrop 和游戏空间边界。
- 顶部显示当前可见 glyph、实体名称、简短类别和来源于核心数据的特征标签。
- 左侧为 `Overview`、`Strategy`、`History` Tab；只显示该实体实际收录的
  Wiki 节选。
- 右侧事实列在切换 Tab 时保持可见，展示结构化核心数据。
- Wiki 来源条固定显示页面标题、`NetHackWiki contributors`、revision、
  revision history、CC BY-SA 3.0 链接和允许的展示变更说明。
- 核心事实区单独显示 NetHack 版本、具体源码路径和 `dat/license`。
- Wiki 内容和核心事实不能放进同一个未标来源的段落，也不能让一个许可标签看似
  覆盖两类内容。
- 没有 Wiki 节选时显示事实视图，不生成空 Tab，不用项目自行撰写的摘要填充。
- 没有某类核心字段时直接省略对应区块，不显示推测值。
- 关闭方式包括右上角关闭按钮、Escape 和 backdrop 点击。
- 打开时初始焦点进入对话框；Tab 支持方向键、Home/End；Tab 键被限制在窗口
  内；关闭后恢复到发起右键的地图或背包目标。
- 对话框打开时游戏内容和其他游戏控件为 `inert`，全局 NetHack 键盘路由不
  接收窗口按键。
- 桌面保持正文与事实双列。窄屏改为单列、一个明确的纵向 scroll owner，不
  允许正文列、事实列和 backdrop 出现相互竞争的嵌套滚动。
- 所有外部链接使用新窗口并带 `noopener noreferrer`；许可链接带
  `rel="license"`。
- 打开、切 Tab、滚动、点击来源和关闭均不调用核心，不消耗回合。

### 4.6 显示字段

怪物事实至少支持：

- 名称、怪物类别、基础等级、难度、速度、AC、魔抗和阵营。
- 完整生成 flags 与 frequency，不把它们压缩成一个可能误导的标签。
- 有序 attack 数组；每个 attack 保留攻击方式、伤害类型、骰子个数和面数。
- HP 规则的结构化公式或范围，包括等级 0、普通 Nd8、golem、Rider、特殊
  固定 HP、成年龙和 home elemental 分支；不得只保存一个平均值。
- size、重量、营养、声音、抗性、可传递抗性和 mflags。
- 尸体是否存在及源码能直接证明的食用效果。Newt 能量效果来自
  `src/eat.c:eye_of_newt_buzz()`，不能误标为 `include/monsters.h` 字段。

物品事实至少支持：

- 对象类别、基础名称与源码描述、生成概率、重量、基础价格、材质和使用延迟；
  只有 entity resolver 已确认具体对象类型时才显示该类型字段。
- 魔法、充能、唯一、不可许愿、双手/体积等静态 flags。
- 武器伤害与命中、护甲属性、食物营养、法术等级等适用于该类别的结构化字段。
- 不显示当前实例 BUC、侵蚀、附魔、剩余充能、容器内容或其他未通过现有 UI
  安全提供的实例值。

神器事实至少支持：

- 基础物品、阵营、角色/种族限制、生成与智能 flags。
- attack、defense、carry 和 invoke 字段，以及源码中的价格与 gift metadata。
- 只在核心确认神器身份已经公开时显示；否则只显示基础物品资料。

地形与陷阱事实至少支持：

- `defsym`/trap 稳定身份、默认符号、类别和源码已有的静态属性。
- 不显示当前格隐藏状态、门锁/陷阱内部状态、祭坛真实阵营等不在最终 glyph 中
  完整表达的信息。

## 5. 可见身份与防剧透模型

### 5.1 唯一原则

观察窗口的身份输入必须是“核心已经选择给玩家显示的身份”，而不是“该格或该
对象在 C 内存中的真实身份”。允许的数据来源只有：

1. 核心最终提交的 `GlyphInfo.glyph`/`glyphFlags`。
2. 当前 map revision 或 inventory revision。
3. 核心专门值复制、并明确保证只表达已公开名称的有界可见身份 token。

禁止：

- 遍历 `fmon`、`invent`、`level.objects`、`levl` 或其他 WASM 内部结构。
- 从 `tileIndex`、颜色、英文 `MenuItem.text`、消息或核心动作列表猜测身份。
- 把菜单 identifier、`struct obj *`、`struct monst *` 或 WASM 地址保存到
  React state。
- 为提高命中率进行模糊标题匹配、字符串包含匹配或用户命名解析。

### 5.2 Glyph 映射

生成器为当前源码构建完整、版本绑定的 glyph 映射：

```ts
interface GlyphBinding {
  glyph: number;
  entityId: string | null;
  presentation:
    | "monster"
    | "pet"
    | "ridden"
    | "detected"
    | "object"
    | "corpse"
    | "statue"
    | "terrain"
    | "trap"
    | "unsupported";
}
```

规则：

- normal/pet/ridden/detected 的不同 glyph 都可以映射到同一个怪物 species，
  但 UI 可保留对应展示标签。
- corpse/statue 由 glyph 中的 species 与对象种类组合解析，不能丢失物种。
- pile-top glyph 与普通对象使用相同实体资料，但保留“物品堆顶部”展示语义。
- 地牢主题墙 glyph 映射回同一个 `S_*` 语义，同时允许保留主题 variant。
- `generic_obj_to_glyph()` 只编码 object class，因此 generic/unidentified
  object glyph 只映射到通用类别，不声称知道具体外观或真实效果。
- hallucination 或 disguise 已经改变最终 glyph 时，窗口描述该显示 glyph，
  绝不附加“真实是……”信息。
- `NO_GLYPH`、越界 glyph 和 unsupported glyph 返回不可观察，不尝试 fallback。

`tileIndex` 只用于复用当前 tile 图像，不能作为资料身份。

### 5.3 地图目标

`map-context` intent 增加：

```ts
interface MapExamineCapture {
  mapRevision: number;
  glyph: GlyphInfo;
  mapX: number;
  mapY: number;
}
```

- 右键完成时从同一个 snapshot 捕获坐标、revision 和
  `foreground ?? background` 的值复制。
- 在菜单呈现、选择 Examine 和打开对话框前均验证 session 与 map revision。
- 打开前再次读取该坐标；glyph 身份不相同则以 `target-stale` 取消。
- 目标更新时不自动把即将打开的对话框改成新实体。
- 对话框打开后资料是一次不可变快照；后续地图变化不将其悄悄替换。session
  结束、fatal 或离开 GameScreen 时关闭。

### 5.4 背包目标与神器

`inventory-context` intent 增加：

```ts
interface InventoryExamineCapture {
  inventoryRevision: number;
  identifier: number;
  accelerator: number;
  glyph: GlyphInfo;
  visibleEntityToken: string | null;
}
```

- identifier 和 accelerator 仍只用于验证并选择本次核心生成的背包菜单行。
- 普通对象、尸体和雕像优先通过最终 glyph 解析。对于静态生成时尚未发现、但
  本局运行时已经公开类型的普通对象，核心可以发布 `object:OBJECT_ENUM`
  可见 token。
- 神器不能通过对象 glyph 区分。普通对象的运行时发现状态也不能由静态 glyph
  binding 表达。实现必须在实际 inventory/menu producer 调用链中增加一次性的
  可见身份 metadata，并在 `shim_add_menu` 处复制成有界 token；token 使用
  生成目录中的枚举 ID，不包含指针或自由文本。
- 普通对象 token 要求同一行已经执行 `doname()`，并且 `dknown` 与
  `objects[otyp].oc_name_known` 都为真。只有核心用于显示对象名称的同一判断
  已经公开神器名称时，才允许 token 为 `artifact:*`；未公开时必须为 null。
- 前端只在 token 存在于当前构建目录并与最终 glyph 的精确对象对照一致时升级
  身份；公开 generic glyph binding 仍只表达类别。
- metadata 在每个 menu row 后立即清理，并在取消、窗口销毁、session reset
  和 fatal 时清理，不能泄漏到下一行或下一菜单。
- 如果阶段性源码审计不能证明该 token 与玩家可见名称完全同边界，必须暂停
  神器接入并请求范围复审；不得退回解析英文物品文本。

地图上的神器或运行时发现对象若只有基础对象 glyph 且没有安全的公开身份 token，
只显示 glyph 公开的基础物品或类别资料。alpha-2.4 不为此读取地图对象链。

## 6. 数据资产与 schema

### 6.1 稳定实体 ID

数据使用源码符号构造稳定 ID，不使用本地化显示名：

```text
monster:PM_NEWT
object:POT_HEALING
artifact:ART_EXCALIBUR
terrain:S_FOUNTAIN
trap:WEB
appearance:POTION_CLASS:GENERIC
```

实际前缀和符号规范可在阶段一测试中微调，但必须满足：

- ID 是有界 ASCII，大小写和前缀规范唯一。
- 同一源码构建内不重复。
- 显示名变化不改变 ID。
- 不存在的编译条件条目不能遗留悬空 glyph binding。
- Wiki alias 只从该 ID 显式映射，不能反向用页面标题决定游戏身份。

### 6.2 核心 manifest

建议目录：

```text
frontend/public/encyclopedia/
├── core/
│   ├── manifest.json
│   ├── glyph-bindings.json
│   ├── monsters-*.json
│   ├── objects-*.json
│   ├── artifacts.json
│   └── terrain.json
├── wiki/
│   ├── manifest.json
│   └── excerpts-*.json
└── NOTICE.md
```

`core/manifest.json` 至少包含：

```ts
interface CoreEncyclopediaManifest {
  schemaVersion: 1;
  nethackVersion: string;
  sourceFingerprint: string;
  generatorVersion: string;
  entityCounts: Record<string, number>;
  chunks: Array<{
    kind: string;
    file: string;
    sha256: string;
    bytes: number;
  }>;
  glyphBindings: {
    file: string;
    sha256: string;
    maxGlyph: number;
  };
}
```

- `sourceFingerprint` 覆盖所有被读取的源码、生成头文件、编译条件和 exporter
  版本，不只写人类可读版本号。
- 文件名使用内容稳定的分片方案；实体按 kind 和稳定 ID 排序。
- JSON 序列化顺序、换行和数字格式固定，同一源码重复生成应产生零 diff。
- 所有数组、字符串、文件和总资源大小都有上限；运行时 validator 不信任
  `public/` 中的 JSON。
- runtime manifest 或等价构建 metadata 记录 encyclopedia manifest hash，
  防止 WASM 与资料来自不同源码构建。

### 6.3 核心实体 schema

公共 envelope：

```ts
interface CoreEntityRecord {
  schemaVersion: 1;
  id: string;
  kind: "monster" | "object" | "artifact" | "terrain" | "trap";
  names: {
    primary: string;
    female?: string;
    neutral?: string;
    appearance?: string;
  };
  symbol: number | null;
  color: number | null;
  facts: MonsterFacts | ObjectFacts | ArtifactFacts | TerrainFacts;
  sourceRefs: Array<{
    path: string;
    symbol: string;
  }>;
}
```

具体 facts 使用判别联合，不建立一个大量 nullable 字段的万能对象：

- `MonsterFacts` 保留 ordered attacks、结构化 HP rule、generation、resistance、
  conveys、mflags、corpse 和基本战斗字段。
- `ObjectFacts` 按 weapon/armor/food/spellbook/tool 等 subtype 保存直接字段。
- `ArtifactFacts` 引用基础 object ID，并保存 artifact struct 的直接字段。
- `TerrainFacts` 区分 terrain 与 trap，并只包含静态、非实例字段。

所有 flag 和 enum 都由穷举映射转换为稳定符号名。遇到未知 bit、未知 attack
类型、非法引用或 fencepost 条目时生成失败，不能静默输出裸数字后继续。

### 6.4 Wiki schema

Wiki 数据与核心数据放在独立文件，单条记录至少包含：

```ts
interface WikiExcerptRecord {
  schemaVersion: 1;
  entityId: string;
  page: {
    title: string;
    revisionId: number;
    revisionTimestamp: string;
    sourceUrl: string;
    historyUrl: string;
    authorLabel: "NetHackWiki contributors";
  };
  license: {
    spdxLikeId: "CC-BY-SA-3.0";
    name: "Creative Commons Attribution-ShareAlike 3.0 Unported";
    url: "https://creativecommons.org/licenses/by-sa/3.0/";
  };
  modifications: [
    "internal link destinations omitted",
    "Wiki markup omitted",
    "wording unchanged",
  ];
  sections: Array<{
    tab: "overview" | "strategy" | "history";
    sourceHeading: string;
    paragraphs: string[];
    paragraphHashes: string[];
  }>;
}
```

规则：

- `paragraphs` 只保存纯文本完整段落，不保存可注入 React 的 HTML。
- 每个段落与原 revision 中一个完整段落一一对应；不能截句、合并或把列表项
  改写成段落。
- 可以不选择某段，也可以整页没有 Wiki 记录；不能为了填满 Tab 自动生成内容。
- 页面 title 到 entity ID 的匹配来自 checked-in alias catalog，必须精确匹配。
- redirect 必须解析到固定最终 title，并在 manifest 中保留原 title 与目标；
  不做模糊搜索、编辑距离或搜索结果第一名自动命中。
- 每个 revision、段落和输出 chunk 都有 hash，更新时任何文字变化都要求人工
  重新选择和复审。

## 7. 数据生成与许可流程

### 7.1 核心源码 exporter

增加显式命令：

```text
cd frontend
npm run encyclopedia:generate
npm run encyclopedia:verify
```

实现原则：

1. 编译并运行一个 host C exporter，读取当前编译配置下真正形成的
   `mons[]`、`objects[]`、`artilist[]`、symbols 和 glyph offsets。
2. exporter 使用与 NetHack 构建一致的生成头文件和 compile defines；不能用
   正则表达式拆 `MON(...)`、`OBJECT(...)` 或 `A(ATTK(...))`。
3. HP 等不在静态 struct 中完整表达的规则由一个小型、穷举、带源码引用的规则
   层表示；测试必须与 `newmonhp()` 的分支和代表实体一致。
4. Newt 的特殊能量效果等跨文件规则只有在具有明确源码定位和测试时才进入核心
   facts；没有系统证据就省略，不用 Wiki 文字反向填充核心事实。
5. Node 生成器负责严格接收 exporter 的机器输出、拆分 JSON、计算 hash 和
   原子替换 staging 目录。
6. 生成失败不得留下半套新资产；成功后再替换 checked-in 目录。
7. `verify` 在临时目录重新生成并逐文件比较，不改工作树。

`frontend/package.json` 的 `prebuild` 增加 `encyclopedia:verify`。普通
`npm run build` 只校验 checked-in 资产，不下载 Wiki，也不修改文件。

### 7.2 Wiki 导入

增加显式维护命令：

```text
cd frontend
npm run encyclopedia:refresh-wiki -- --dump <official-xml-dump>
```

规则：

- 输入是维护者显式提供的官方 MediaWiki XML dump；不在正常构建、CI 或玩家
  浏览器中调用 MediaWiki API。
- XML 使用流式 XML parser，wikitext 使用经过固定版本的 MediaWiki AST parser；
  禁止用正则表达式剥离模板和链接。
- checked-in selection catalog 指定 entity ID、精确 page title、目标 revision、
  section heading、完整段落位置和预期 hash。
- 允许的转换只包括去掉 Wiki 格式标记和内部链接目的地，同时保留显示文字、
  标点、段落边界和原始语言。
- 包含 template/transclusion、图片/File、表格、引用标签、来源不明 HTML、
  Origin、Wikipedia-derived 内容、encyclopedia quotation、游戏消息、
  Rodney/Hugo/basedon 或其他混合/不明许可材料的候选段落一律 fail closed。
- 某页或某段无法安全导入时，生成 coverage report 并跳过 Wiki 内容；不能阻止
  对应实体使用 NGPL 核心事实。
- refresh 只生成待审 candidate 和 diff，不自动覆盖已审核节选，不自动提交，
  更不能自动合并 scheduled job 的结果。
- 若以后增加定时刷新，只允许创建 artifact 或 PR；必须人工核对 revision、
  段落原文、排除项和 attribution 后合并。

### 7.3 许可与 NOTICE

- `core/` JSON 明确标记来源于 NetHack 5.0 源码和 `dat/license`，使用 NGPL
  标识。
- `wiki/` JSON 明确标记每页 revision、contributors、source/history URL 和
  CC BY-SA 3.0。
- 两类数据使用不同目录、manifest、运行时类型和 UI 来源区域；不生成一个把
  两类内容标成同一许可的合并 JSON。
- `frontend/public/encyclopedia/NOTICE.md` 由已审核 attribution manifest
  稳定生成，列出所有纳入页面、revision、来源、历史和许可链接。
- 仓库级 README 和发布文档说明包含 NetHackWiki 节选及其许可；页面级来源条
  仍然保留，不能只依赖仓库 NOTICE。
- Wiki 图片不纳入 alpha-2.4。对话框只复用 NetHack 当前 glyph/tile，不下载
  页面图片或第三方素材。
- 本流程是可审计的来源与许可工程约束，不对外声称替代法律意见。

## 8. 运行时架构

### 8.1 建议模块

```text
frontend/src/encyclopedia/
├── encyclopedia-types.ts
├── encyclopedia-validation.ts
├── encyclopedia-loader.ts
├── entity-resolution.ts
├── glyph-bindings.ts
├── examine-controller.ts
└── *.test.ts

frontend/src/screens/game/
├── ExamineDialog.tsx
├── ExamineFacts.tsx
├── ExamineWikiArticle.tsx
└── ExamineSourceStrip.tsx

frontend/scripts/encyclopedia/
├── export-core-data.c
├── generate-core-assets.mjs
├── import-wiki-dump.mjs
├── verify-encyclopedia-assets.mjs
├── wiki-aliases.json
├── wiki-selections.json
└── *.test.mjs
```

文件名可以按实现调整，职责边界不可合并：

- exporter 只读取源码结构并输出机器数据。
- generator 负责确定性 JSON 和 manifest。
- Wiki importer 只处理固定 revision 与完整段落选择。
- runtime validator/loader 不负责推断身份。
- entity resolver 只接受可见 glyph 或已审核 visible token。
- Examine controller 负责本地窗口生命周期，不拥有 WASM resolver。
- `GameActionController` 继续独占右键核心流程和菜单 handoff。
- React 组件只渲染已验证记录并发出语义事件。

### 8.2 加载策略

- Detailed 游戏界面挂载后预加载小型 core manifest、glyph binding index 和
  Wiki index；Original 不主动加载。
- 选择 Examine 后按 entity ID lazy-load 对应 core chunk 和可选 Wiki chunk。
- 同一 build 的已验证 chunk 按 URL/hash 缓存；并发请求合并。
- session reset 或组件卸载使用 `AbortController` 取消未完成请求。
- 首次 chunk 加载可以在已经打开的对话框内显示稳定 loading state，不能重新
  打开核心菜单或阻塞主线程。
- Wiki chunk 加载失败时仍显示核心事实；核心 chunk 缺失或校验失败时关闭本次
  请求并记录非敏感诊断，不显示可能错配的内容。
- 诊断只记录 schema、asset hash、entity kind 和错误类别，不记录 Wiki 段落、
  游戏消息、玩家命名或存档内容。

### 8.3 Context Menu 组合

`GameModals.tsx` 不再直接假定每个可选按钮都提交核心行。建议由
`GameModalRenderer` 接收语义 callback：

```ts
interface ContextMenuHandlers {
  chooseCore(itemIndex: number, count: number): void;
  chooseExamine(target: ExamineTarget): void;
  cancel(): void;
}
```

- 普通非 context 菜单继续走现有 `submitMenuSelection`。
- context 菜单的 `chooseCore` 仍提交原始 index/count。
- `chooseExamine` 调用控制器新方法，由控制器提交唯一一次 null cancellation。
- backdrop、Escape 和普通取消仍是用户取消，不打开观察窗口。
- 菜单 row key、焦点 index 和 accelerator 分配基于判别联合，synthetic row
  永远不能进入 `selected` map 或 bulk menu 逻辑。

### 8.4 Action 状态机扩展

建议增加状态：

```text
presenting-context-menu
-> resolving-context-menu-for-examine
-> waiting-context-command-boundary
-> completing
-> idle
```

并增加一次性 completion payload：

```ts
type ActionCompletion =
  | { kind: "none" }
  | { kind: "open-examine"; target: ExamineTarget };
```

约束：

- completion payload 只在所有核心完成门禁通过时发给 GameScreen。
- reducer 回到 idle 后才设置 Examine 本地状态，保证观察窗口与 active action
  intent 不重叠。
- payload 使用值复制的 entity ID、可见 glyph、来源和 revision，不包含
  MenuItem、WindowState 或 DOM 节点引用。
- 普通核心菜单选择不产生 payload。
- 取消与 stale 路径清空 payload，不能在后续无关 boundary 补开窗口。
- context intent 保存开始时的 boundary generation；generation 耗尽沿用现有
  fatal 约束，不回绕。

### 8.5 对话框与焦点所有权

- `GameScreen` 拥有至多一个 `ExamineViewState`，与 pause、Settings、endgame
  和核心 modal 互斥。
- 菜单到对话框是一次焦点 handoff。选择 Examine 时菜单不能先永久恢复焦点又
  与对话框抢焦点；对话框关闭后才按序列化 origin 恢复地图或对应背包项。
- 如果原背包项已消失，恢复到背包容器；如果地图已卸载，恢复到 game shell；
  不能持有失效 DOM ref。
- 窗口根节点使用 `data-browser-keyboard`，Escape、Tab 和 Tab-list 导航必须
  阻止事件到达 `GameScreen` 的全局键盘 handler。
- 点击来源链接不会关闭窗口，也不会向 NetHack 发送按键。

## 9. 非目标

- 修改 NetHack 怪物、物品、掉落、鉴定、回合或战斗规则。
- 显示怪物实例当前 HP 或任何未暴露的实时内部状态。
- 把 Wiki 文字翻译成中文、摘要成短文、改写为项目口吻或由模型补写。
- 自动抓取最新网页、运行时搜索 Wiki、嵌入完整 Wiki 阅读器或离线全文搜索。
- 导入 Wiki 图片、音频、模板、表格、百科引文或页面全部历史。
- 在观察窗口中继续弹出概念嵌套窗口。
- 替换已有约 300ms 的地图 hover `clicklook` Tooltip。
- 给普通键盘菜单或 All Actions 增加 Examine。
- 根据资料预判核心动作是否合法，或把资料按钮变成攻击、食用、穿戴等动作。
- 为被遮挡背景实体增加选择器。
- 新增 profile v5、backup schema、存档字段或独立 localStorage key。
- 为了资料读取暴露任意 C 指针、对象链或通用内存查询接口。
- 声称本项目的数据流程构成法律意见。

## 10. 分阶段实施

每个阶段必须严格执行：

```text
测试 subagent
-> 提交预期失败测试或 characterization baseline
-> 主 Agent 实现
-> 独立 reviewer
-> 主 Agent 修正 findings
-> 运行该阶段完整验证
-> 阶段 commit
```

测试编写与 reviewer 必须是不同 subagent，也不能由主 Agent 自检替代。环境
无法创建 subagent 时暂停，不进入实现。

### 阶段零：行为、源码与许可基线

测试 subagent 先建立：

1. 当前 Detailed/Original 右键菜单、地图悬停和背包悬停 characterization。
2. map-context 和 inventory-context 的 window、revision、cancel 与 command
   boundary 顺序记录。
3. 真实 WASM 中取消 `therecmdmenu`/`itemactions` 不增加 turn 的测试。
4. 代表 glyph 分类基线：普通怪物、宠物、ridden、detected、对象、generic
   对象、corpse、statue、piletop、terrain、trap 和 unsupported effect。
5. Newt、普通等级怪物、golem、Rider、成年龙和 home elemental 的 HP 规则
   源码基线。
6. Newt 固定 revision 205110 的四个完整段落、attribution 和排除项 fixture；
   两个含模板的 lead 段落不发布，Overview 只显示核心源码事实。

主 Agent 完成源码审计：

- `display.h` glyph offsets、`glyph_is_*` 与 `glyph_to_*`。
- `monsters.h`/`permonst.h`、`objects.h`/`objclass.h`、
  `artilist.h`/`artifact.h`、`defsym.h`/`rm.h`。
- `makemon.c:newmonhp()` 与纳入的特殊食用规则。
- map/inventory menu producer 到 `shim_add_menu` 的神器可见名称调用链。
- NetHackWiki dump 的 revision、许可元数据和 parser 可保真范围。

门禁：

- 证明最终 glyph 的映射能覆盖目标范围并正确排除临时 glyph。
- 证明 Newt HP 为 2 至 4，原型硬编码不作为事实来源。
- 给出神器 visible token 的最小 producer 边界；若无法证明，触发停止条件。
- Wiki parser 不能无损处理的节点有明确 fail-closed 分类。

建议提交：

```text
test: characterize examine data and context flows
docs: record examine source and license boundaries
```

### 阶段一：核心资料 exporter 与确定性资产

测试 subagent 先定义：

- entity ID 唯一性、fencepost 排除和全量计数。
- enum/flag 穷举、ordered attacks 和复合 corpse/statue 引用。
- 所有 glyph `0 <= glyph < MAX_GLYPH` 恰有一个 supported/unsupported 结果。
- unidentified/generic glyph 不映射真实物品效果。
- HP rule 代表样本和边界值。
- 相同源码重复生成 byte-for-byte 一致。
- source fingerprint、chunk hash、size limit 和损坏拒绝。
- `verify` 不修改工作树。

实施 host C exporter、Node generator、split assets、manifest、运行时严格类型和
validator。所有核心实体必须进入 catalog；没有 Wiki 内容不影响 core coverage。

门禁：

- 不使用正则解析宏源码。
- 不输出未知 flags 或悬空引用。
- 生产 Newt 事实与当前源码一致。
- `npm run encyclopedia:generate` 后再次 generate 为零 diff。
- `npm run encyclopedia:verify` 通过。

建议提交：

```text
test: define NetHack encyclopedia data contracts
feat: generate NetHack encyclopedia assets
```

### 阶段二：Wiki 固定 revision 节选管线

测试 subagent 先定义：

- XML 流式读取和固定 revision 选择。
- exact title/redirect/alias 规则及 fuzzy match 拒绝。
- 内部链接与强调 markup 去除后文字、标点和段落边界不变。
- 句子节选、段落拼接、模板、图片、引用、Origin/Wikipedia、game messages、
  Rodney/Hugo/basedon 和未知许可节点被拒绝。
- paragraph hash、revision hash 和 attribution 稳定。
- Wiki 记录缺失时 core entity 仍有效。
- NOTICE 包含所有且仅包含已发布页面。

实施 alias/selection catalog、dump importer、candidate diff、coverage report、
Wiki chunks 和 NOTICE 生成。Newt revision 205110 是第一个完整 acceptance
fixture。

门禁：

- Newt 展示文字与固定 revision 的所选完整段落逐字符一致。
- 没有摘要、翻译、改写或跨段拼接。
- 每条 Wiki 记录都有 page、revision、history、contributors 和 license。
- core 与 Wiki JSON 物理分离。
- 普通 build/test 不访问网络。

建议提交：

```text
test: define verbatim wiki excerpt rules
feat: import attributed NetHackWiki excerpts
```

### 阶段三：可见实体解析与 lazy loader

测试 subagent 先定义：

- MapCell 前景优先、背景 fallback 和 unsupported 结果。
- hallucinated/disguised glyph 只返回显示身份。
- corpse/statue/piletop 和地图主题墙映射。
- inventory revision、glyph、identifier、accelerator 的完整 stale 校验。
- 神器 token 只在名称已公开时出现，row/session 清理无泄漏。
- manifest 与 runtime fingerprint 不符时 fail closed。
- chunk 并发去重、hash/schema/size 错误、abort 和 Wiki-only failure。

实施 runtime loader、resolver 和 intent capture。若神器需要最小 C/shim metadata
补充，必须：

1. 先由测试证明已公开/未公开边界。
2. 在修改的上游文件标注 BlissHack 修改者、日期和目的。
3. 更新 `doc/BlissHack/shim-interface-reference.md` 和
   `doc/BlissHack/upstream-modifications.md`。
4. 使用固定 Emscripten 6.0.9 重建并成组提交
   `nethack.js`、`nethack.wasm`、`nethack-runtime.json`。

门禁：

- 前端没有 C 指针或自由文本身份解析。
- map/inventory revision 变化都拒绝旧目标。
- 旧 runtime 与新资料、或新 runtime 与旧资料均不会显示错配内容。
- Core 资料可离线 lazy-load；Wiki 失败只降级为 facts-only。

建议提交：

```text
test: define visible encyclopedia identity resolution
feat: resolve visible NetHack encyclopedia entities
```

### 阶段四：合成菜单行与安全 handoff

测试 subagent 先扩展 reducer/controller：

- Original 永远没有 synthetic row，Detailed 只对 supported target 添加。
- core row 和 synthetic row 的 identity、accelerator 和选择路径不碰撞。
- 选择 core row 与 alpha-2.3 完全一致。
- 选择 Examine 只提交一次 `null`。
- resolver pending、菜单仍活跃或 boundary 未递增时绝不打开对话框。
- 新 command boundary 后先回 idle，再发布一次 open payload。
- backdrop/Escape 是普通取消，不发布 payload。
- map/inventory revision、glyph、session、fatal、unmount 和模式变化会清空
  payload。
- 快速重复右键、双击 Examine 或 stale React render 不会打开两次。

实施 `ContextMenuRow`、语义 handlers、action states、completion payload 和
焦点 handoff。不得把 Examine 作为 fake `MenuItem` 追加到核心 window state。

真实 WASM 门禁：

- newt、门、地面物品、可见陷阱和背包物品均能取消原菜单并回到命令边界。
- turn counter、地图和背包不因打开 Examine 改变。
- 选择原有攻击、移动、拾取或 itemaction 仍执行同一核心路径。

建议提交：

```text
test: define examine context-menu handoff
feat: add the synthetic examine context action
```

### 阶段五：观察窗口

测试 subagent 先定义：

- 已确认原型的 header、source strip、Tab、article、facts 和 provenance 层级。
- 有 Wiki、无 Wiki、部分 Tab、facts 字段缺失和加载失败状态。
- ordered attacks、HP formula、flags 和 object/artifact subtype 的无损呈现。
- role/dialog、aria-modal、tablist/tabpanel、键盘导航、focus trap 和 focus
  restore。
- Escape、backdrop、关闭按钮和外部链接事件隔离。
- 1280x900、900x700、窄屏和短 viewport 的尺寸、单一 scroll owner 与无重叠。
- Tiles/ASCII、Right/Right-short/Below、Original/BlissHack action bar 组合。

实施对话框组件与样式，复用当前 glyph/tile 资产，不导入 Wiki 图片。内容必须
以 React 文本节点渲染，不能使用 `dangerouslySetInnerHTML`。

门禁：

- 视觉层级与已确认 Newt 原型一致。
- 最长实体名、最长 trait、六个 attack 和较长 Wiki 段落均不溢出或遮挡。
- facts 列与 Wiki 来源条的许可归属清楚。
- 窄屏只有一个对话框内容滚动容器。
- 所有窗口操作均不进入 WASM。

建议提交：

```text
test: define the examine dialog experience
feat: add the encyclopedia examine dialog
```

### 阶段六：覆盖率、兼容与发布收尾

1. 生成全 catalog coverage report，确认所有目标核心实体有记录，所有
   unsupported glyph 有显式原因。
2. 为 Wiki 缺失、alias 冲突、revision 变化和许可不明项生成审查报告；缺失
   Wiki 允许发布，错误 attribution 不允许发布。
3. 扩展真实 WASM 与 Playwright 流程，覆盖 Chromium、Firefox 和 WebKit。
4. 检查资源大小、首次 Detailed 预加载、dialog chunk 延迟和重复打开缓存。
5. 运行 lint、单元、生产构建、WASM、浏览器兼容、性能和长流程门禁。
6. 独立 reviewer 重点审查防剧透、Asyncify 生命周期、许可分离、焦点、移动端
   overflow 和 existing context action regression。
7. 完成所有 findings 后更新 README、session-start、相关 interface/upstream
   文档和 release acceptance。
8. 按人工清单验收，用户确认后才把 alpha-2.4 标记完成。

建议提交：

```text
test: cover examine flows across browsers
docs: complete alpha-2.4 examine acceptance
```

## 11. 测试策略

### 11.1 生成器与 schema

- host exporter 的源码表数量、ID、flags、attacks、对象 subtype 和 glyph
  offsets。
- 特殊 HP 规则的公式和范围，不只测试 Newt。
- JSON schema、大小、hash、路径穿越、重复 ID、未知字段和错误引用。
- 确定性输出和 verify 零修改。
- Wiki XML/AST fixture、完整段落 hash、禁用节点和 NOTICE。
- fuzz/property tests 覆盖非法 manifest、越界 glyph 和 malformed chunks。

### 11.2 控制器与组件

- reducer 每个状态和非法 transition。
- core/synthetic rows 的键盘与指针选择。
- null cancellation、window 消失、boundary generation 和 completion payload
  的严格顺序。
- stale map/inventory/session 与重复事件。
- loader 并发、abort、cache 和 graceful fallback。
- dialog Tab、focus、inert、关闭、来源链接和无 Wiki 状态。

### 11.3 Bridge 与真实 WASM

- `therecmdmenu` 和 `itemactions` 取消后到下一命令边界的真实 callback 顺序。
- visible identity metadata 的已公开/未公开神器样本和清理路径。
- normal、pet、ridden、detected、corpse、statue、generic object、terrain、
  trap 的真实 glyph。
- hallucination、mimic/disguise、未鉴定物品和隐藏陷阱不泄露。
- 打开/关闭 Examine 前后 moves、inventory revision 和地图状态不被功能本身
  修改。
- 若修改 shim，执行现有 callback ABI、save、action command 和 runtime
  triplet 全部回归测试。

### 11.4 浏览器

- Chromium 截图覆盖 Newt Overview/Strategy/History、facts-only、长内容、
  Right/Below 和桌面/窄屏。
- Firefox/WebKit 覆盖相同的可见性、尺寸范围、单 scroll owner 和 pointer
  行为，不要求与 Chromium 逐像素一致。
- 键盘只用流程覆盖菜单 `e` 或 fallback accelerator、Enter、Escape、
  Arrow/Home/End、Tab/Shift+Tab 和关闭后继续移动。
- 右键 click/drag 5 px 阈值保持；拖动不能打开菜单或 Examine。
- 低速 chunk fixture 验证 loading 期间无重复请求、无核心阻塞和无布局跳出
  viewport。
- 离线 context 验证所有资料来自本地构建资产，不请求 nethackwiki.com。

## 12. 人工验收

### 12.1 设置与入口

1. Detailed 下右键地图 Newt，确认原有核心动作后有分隔线和 `Examine`。
2. Original 下重复操作，确认菜单与 alpha-2.3 相同。
3. 在游戏内切换 Detailed/Original，确认即时生效且 profile schema 仍为 v4。
4. 右键不支持的临时 effect，确认不出现错误或错误资料。

### 12.2 核心流程

1. 选择 `Examine`，确认核心菜单先关闭，随后才打开观察窗口。
2. 记录 moves/time，反复打开、切 Tab、关闭，确认不消耗回合。
3. 分别选择原菜单中的攻击、移动、拾取和物品动作，确认行为没有改变。
4. 在菜单打开后让 map/inventory revision 变化，确认旧 Examine 不出现。
5. 快速重复右键、Escape、backdrop 和关闭按钮，确认无重复窗口或卡死输入。
6. 关闭后立即用键盘移动，确认焦点与命令输入恢复。

### 12.3 身份与防剧透

1. 检查普通怪物、宠物、ridden/detected 怪物的 species 与显示标签。
2. 检查地上物品、物品堆、尸体和雕像。
3. 检查未鉴定 potion/scroll/wand，确认不显示真实效果。
4. 在 hallucination 和 mimic/disguise 场景打开，确认只描述显示身份。
5. 检查隐藏与已发现陷阱，确认只有已经显示的陷阱可观察。
6. 检查普通神器、尚未公开名称的神器和已公开神器；未公开时只显示基础物品。

### 12.4 内容与来源

1. 核对 Newt 基础等级、2 至 4 HP 规则、1d2 bite、traits、corpse 数据和能量
   效果的源码引用。
2. 逐段核对 Newt revision 205110，确认 Strategy 两段、History 一段和
   Dudley's dungeon 一段完整、顺序正确、文字未改；Overview 没有 Wiki
   节选，只显示核心源码事实。
3. 确认页面 title、contributors、revision、history、CC BY-SA 3.0 和修改
   说明可见且链接正确。
4. 确认 NetHack facts 单独显示版本、源码路径和 NGPL。
5. 打开没有 Wiki 节选的实体，确认 facts-only 视图自然可用。
6. 断网重载并重复上述操作，确认没有运行时外部请求。

### 12.5 布局与辅助功能

1. 在 1280x900、900x700 和窄屏检查长名称、六次攻击和长段落。
2. 检查 Tiles/ASCII、背包 Right/Right-short/Below 和两种动作栏模式。
3. 只用键盘完成菜单选择、三组 Tab 导航、来源链接聚焦和关闭。
4. 使用屏幕阅读器检查 dialog 标题、Tab 选择状态、facts definition list 和
   source links。
5. 确认对话框外内容不可聚焦，关闭后焦点回到合理触发位置。

## 13. 风险与处理

| 风险 | 处理 |
| --- | --- |
| glyph 映射与 WASM 源码版本错配 | source fingerprint、manifest hash、runtime 绑定、fail closed |
| glyph 泄露真实怪物或物品 | 只使用核心最终显示 glyph，禁止读取内部对象链 |
| generic object 映射到真实效果 | 建立 appearance/unsupported 身份，不用对象真值 fallback |
| 神器 glyph 无法表达身份 | 仅增加经过证明的已公开 visible token；否则暂停该范围 |
| synthetic row 被提交给核心 | 判别联合与独立 handler，不制造 fake itemIndex |
| Asyncify resolver 未结束就开窗口 | 等待原 window 消失和新 boundary generation |
| revision 变化打开旧目标 | intent 捕获并持续验证 map/inventory revision 与 glyph |
| Wiki parser 改写文字 | AST 白名单、完整段落 hash、逐字符 fixture、人工 diff |
| Wiki 页面含混合许可内容 | 高风险节点和 section fail closed，允许 facts-only |
| Wiki 更新造成无人审查的内容变化 | refresh 只产 candidate/PR，永不自动合并 |
| 核心与 Wiki 许可归属混淆 | 独立目录、manifest、类型、UI 区域和 NOTICE |
| 资料资产显著增加首屏大小 | 小索引预载、按 kind/entity chunk lazy-load、大小预算 |
| 对话框抢走游戏按键或焦点丢失 | data-browser-keyboard、focus trap、序列化 origin 恢复 |
| 移动端多层滚动和内容遮挡 | 单一 scroll owner、稳定 max-size、跨浏览器几何测试 |
| 生成器依赖本机偶然环境 | 固定 Node/host compiler 输入、工具链检查、确定性 verify |

初始预算在阶段一用实测基线锁定。若未有更严格数据，建议：

- core + glyph index 压缩前总量不超过 2 MiB。
- Wiki checked-in excerpts 压缩前总量不超过 4 MiB。
- Detailed 首次预加载只包含 manifest/index，不超过 150 KiB。
- 单个 chunk 不超过 256 KiB，单个实体记录不超过 64 KiB。
- 打开已缓存实体不产生可感知主线程长任务。

预算不能通过删除来源、截句、合并段落或降低 schema 校验来达成；应调整
chunking 或减少经过人工选择的 Wiki coverage。

## 14. 停止条件

出现以下任一情况时暂停对应阶段并请求用户复审：

- 无法仅凭最终显示 glyph 或已证明的 visible token 避免身份泄露。
- 神器 token 需要暴露 C 指针、通用对象查询或解析英文菜单文本。
- 取消右键菜单后无法用权威 boundary 证明 Asyncify resolver 已结束。
- host exporter 必须依赖脆弱正则解析或与实际 NetHack 编译条件不同的手写表。
- HP、attack 或 flags 只能通过近似值表达，却会在 UI 中看似精确事实。
- Wiki dump 无法提供目标 revision 或许可元数据。
- parser 无法证明段落文字未改，或目标段落包含无法隔离的混合许可内容。
- 为完成布局必须移除现有核心菜单、地图 hover、Tiles/ASCII 或永久背包模式。
- 需要提升 profile、backup、save 或 command protocol schema，且尚未单独评审。
- 当前环境不能按仓库规则创建测试 subagent 或独立 reviewer。

Wiki 某页失败本身不是整个功能的停止条件。该实体应继续提供经过验证的核心
facts，并在 coverage report 中记录 Wiki 缺口。

## 15. 完成定义

alpha-2.4 只有同时满足以下条件才算完成：

1. Detailed 为所有受支持地图/背包目标提供 synthetic `Examine`，Original
   保持原菜单。
2. Synthetic row 与核心 row 完全分型，不可能提交 fake identifier/index。
3. 每次打开都经过核心菜单 resolver 消费和新 command boundary，不消耗回合。
4. map/inventory/session/glyph 过期均 fail closed。
5. 所有目标核心实体都有由当前源码确定性生成、严格校验的数据记录。
6. 幻觉、伪装、未鉴定、隐藏陷阱和未公开神器没有身份泄露。
7. HP、attacks、flags、resistances 和 generation 等结构不被错误压缩。
8. Wiki 内容只包含固定 revision 的完整原文段落，无摘要、翻译、改写或拼接。
9. 每条 Wiki 节选和每个核心 facts 区域都显示正确且分离的来源与许可。
10. 正常 build、test 和游戏运行完全离线；refresh 是显式维护命令。
11. 对话框在桌面和窄屏无重叠，焦点、键盘、inert 和单 scroll owner 正确。
12. 现有地图/背包右键动作、hover、动作栏、存档和 profile 流程无回归。
13. 每阶段完成测试 subagent、实现、独立 reviewer、findings 修正、完整验证和
    commit。
14. `npm test`、`npm run lint`、`npm run build`、WASM 集成、三浏览器兼容、
    性能与长流程门禁全部通过。
15. `git diff --check` 通过，README、session-start、NOTICE、shim/upstream
    文档和 release acceptance 与实现一致。
16. 用户按人工验收清单确认。

## 16. 计划提交序列

建议按以下稳定检查点提交；实际拆分可因 reviewer findings 调整，但不能跨过
阶段门禁：

```text
test: characterize examine data and context flows
docs: record examine source and license boundaries
test: define NetHack encyclopedia data contracts
feat: generate NetHack encyclopedia assets
test: define verbatim wiki excerpt rules
feat: import attributed NetHackWiki excerpts
test: define visible encyclopedia identity resolution
feat: resolve visible NetHack encyclopedia entities
test: define examine context-menu handoff
feat: add the synthetic examine context action
test: define the examine dialog experience
feat: add the encyclopedia examine dialog
test: cover examine flows across browsers
docs: complete alpha-2.4 examine acceptance
```

若阶段三修改 C/shim，runtime 三件套、接口文档和上游修改记录必须与对应实现
放在同一稳定提交中，不得提交来源不同的 `nethack.js` 与 `nethack.wasm`。

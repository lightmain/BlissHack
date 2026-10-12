# BlissHack alpha-2.4 Examine 源码与许可边界

本文记录阶段零的源码审计结论。后续 exporter、可见身份解析、Wiki 导入和
Examine UI 必须以这些边界为准；本文不是手写资料源，生产事实仍由当前源码
确定性生成。

## 1. 最终显示 glyph

`include/display.h` 定义了当前构建的完整 glyph 空间。生产 resolver 必须使用
有顺序的分类器，不能假定所有 `glyph_is_*` 宏互斥：

- 普通、宠物、探测和骑乘怪物分别使用独立 offset，但都能通过
  `glyph_to_mon()` 还原到核心最终选择显示的 species。
- 尸体与雕像 glyph 独立编码 species；pile-top 变体保留相同 species，并可
  额外标记物品堆展示语义。
- 普通对象 glyph 编码 object type。`generic_obj_to_glyph()` 只把
  `obj->oclass` 加到 generic object offset，不能推出真实 object type。
- 地牢主题墙使用不同 offset，但 `glyph_to_cmap()` 都回到相同 `S_*` 语义。
- 已显示陷阱位于 `GLYPH_TRAP_OFF` 到 `MAXTCHARS` 的有界区间。
- warning、invisible、zap、swallow、explosion、unexplored、nothing、
  `NO_GLYPH` 和越界值没有稳定的可观察资料身份，必须显式返回 unsupported。

`glyph_is_cmap()` 为兼容旧调用而覆盖从 stone 到 cmap C 的连续宽区间，其中也会
命中 trap 和 zap。resolver 的顺序必须先拒绝 zap、swallow、explosion 与其他
临时 effect，再识别 trap，最后才把剩余可持久 `S_*` 解释为 terrain。

`obj_to_glyph()` 在幻觉时选择随机显示对象，怪物 glyph 也经过 `what_mon()`。
因此解析器只能接受 `shim_print_glyph` 或菜单回调最终提交的 glyph，不能回查
地图对象、怪物链或 tile index。这样 Examine 描述的是玩家实际看到的身份。

## 2. 怪物 HP 与跨文件规则

`src/makemon.c:newmonhp()` 的分支顺序是：

1. golem 使用 `golemhp()` 固定值；
2. Rider 使用 `10d8`；
3. `mlevel > 49` 的特殊怪物使用 `2 * (mlevel - 6)`；
4. 成年龙在普通层使用 `adjusted level * 4 + adjusted level d4`，在
   endgame 使用 `adjusted level * 8`；
5. 调整后等级为 0 的怪物使用 `1d4`；
6. 其他怪物使用 `adjusted level d8`，home elemental 的结果再乘 3。

所有分支最后都应用最低点提升：当结果等于参与掷骰的 `basehp` 时加 1。Newt
的基础等级为 0，因此其初始 HP 是 2–4，不是原型中的 1–4。生产记录必须把该
规则和 `adj_lev()` 的上下文依赖结构化表示，不能只输出平均值或把基础等级
直接当作所有场景的实际等级。

Newt 尸体的能量效果不是 `struct permonst` 字段。
`src/eat.c:cpostfx()` 对 `PM_NEWT` 调用 `eye_of_newt_buzz()`；该函数描述
2/3 概率或当前能量不高于最大能量 2/3 时增加 `1d3`，溢出时有 1/3 概率增加
最大能量 1。该事实必须单独标注 `src/eat.c` 来源。

## 3. 物品与神器可见身份

永久背包由 `src/invent.c:display_pickinv()` 生成。每个真实物品先经过
`obj_to_glyph()` 与 `map_glyphinfo()`，再以 `doname(otmp)` 的可见文本调用
`add_menu()`。

`src/objnam.c:xname()` 只在 `has_oname(obj) && dknown` 时追加对象名称；
artifact 的核心名称保存在同一个 oname 中。`distant_name()` 对 artifact
仍然走相同的 `dknown` 约束。因此最小安全 token 条件是：

```text
otmp->oartifact > 0 && has_oname(otmp) && otmp->dknown
```

token 只能是生成目录中的有界 `artifact:ART_*` ID，并且必须在上述同一个
inventory row producer 已经执行 `doname()` 后、调用 `add_menu()` 前设置，
调用后立即清理。shim 在复制该行后还需再次清理，并在菜单取消、window
销毁、session reset 与 fatal 路径清理。不得把 artifact 编号、对象指针或菜单
文字留给 React 推断。

地图上的 artifact 没有这种 row-local producer metadata，只解析基础对象
glyph。

## 4. Context 与 command boundary

`win/shim/winshim.c:shim_get_nh_event()` 在每个顶层命令边界递增非回绕的
`command_boundary_generation`，再同步前端命令。前端
`commandBoundaryGeneration` 因此可以证明新的顶层 command boundary 已经
出现。

地图和背包 context menu 都通过真实 `PICK_ONE` `select_menu` resolver。
选择 Examine 时必须只向该 resolver 提交一次 `null`，并同时满足：

1. 原 window ID 已不再是 active modal；
2. `commandInput` 已恢复；
3. boundary generation 大于 context intent 捕获值；
4. map/inventory revision、目标 glyph、module 与 session 仍匹配。

固定 timeout、单个 React tick 或仅检查 `modal === null` 都不是完成证据。

## 5. Wiki 固定 revision 与许可

alpha-2.4 首个审核样本固定为 NetHackWiki `Newt` revision `205110`。批准原型
及其 NOTICE 保存六个完整段落，分属 Overview、Strategy、History 和
Dudley's dungeon。导入只允许移除 Wiki markup 和内部链接目的地，不改变
显示文字、标点、顺序或段落边界。

导入器必须使用流式 XML parser 和固定版本的 MediaWiki AST parser。以下节点
或来源一律 fail closed，不能降级成字符串清洗：

- template、transclusion、parser function；
- File/Image、表格、引用标签或来源不明 HTML；
- Origin、Wikipedia-derived、百科引文；
- game messages、Rodney、Hugo、basedon；
- 句子级选择、跨段拼接、模糊标题匹配或 revision 不一致；
- 缺少 revision、contributors、source/history URL 或 CC BY-SA 3.0 元数据。

失败只移除该实体的 Wiki 内容并写入 coverage report；NGPL 核心事实仍可发布。
正常 build、test 和浏览器运行不得访问 Wiki。维护命令只能读取显式传入的
官方 XML dump，并产生候选 diff，不自动覆盖已审核节选。

## 6. 来源与许可分离

- `core/` 资产只来自 NetHack 5.0 源码，指向具体源码路径和 `dat/license`。
- `wiki/` 资产逐页记录 title、revision、contributors、source、history、
  CC BY-SA 3.0 和允许的展示变更。
- 两类资产使用不同 manifest、runtime type、目录和 UI 来源区域。
- Wiki 图片不纳入 alpha-2.4；UI 只复用当前 NetHack glyph/tile。

阶段零没有发现需要暴露指针、解析英文菜单文本或读取隐藏状态的情形，也没有
触发计划中的停止条件。

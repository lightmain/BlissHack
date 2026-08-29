# NetHack Guidebook 结构化索引

> 基于 `/doc/Guidebook.txt` (NetHack 5.0.0, 7854行) 编写
> 用于设计 JSON API 协议时的参考文档

---

## 1. 游戏屏幕布局 (行 173-627)

### 概述
NetHack 屏幕由三个区域组成，最小推荐尺寸为 24行 x 80列。地图区域使用 21x80 的区域。

### 屏幕结构
| 区域 | 位置 | 说明 |
|------|------|------|
| 消息行 (Message Line) | 顶部第1行 | 显示事件描述文本，多条消息时显示 "--More--" |
| 地图 (Map) | 中间区域 (约21行) | 显示当前地图层级的已探索部分 |
| 状态行 (Status Lines) | 底部2-3行 | 显示角色当前状态的数值信息 |

### API 设计要点
- 消息区是纯文本，可能有多条待显示消息（需要分页机制）
- 地图是二维字符网格，每个位置一个 ASCII 符号
- 状态行包含多个独立字段，每个字段有固定格式

---

## 2. 状态行字段 (行 343-494)

### 概述
状态行显示在屏幕底部2行（或配置为3行），包含角色的关键属性和状态。

### 完整字段列表

| 字段名 | 状态行缩写 | 数据类型 | 说明 |
|--------|-----------|----------|------|
| Title | (角色名 + 等级称号) | string | 如 "Player the Rambler" |
| Strength | St: | int (3-18, 或 18/xx) | 力量属性 |
| Dexterity | Dx: | int | 敏捷属性 |
| Constitution | Co: | int | 体质属性 |
| Intelligence | In: | int | 智力属性 |
| Wisdom | Wi: | int | 智慧属性 |
| Charisma | Ch: | int | 魅力属性 |
| Alignment | (文字) | enum: Lawful/Neutral/Chaotic | 阵营 |
| Dungeon Level | Dlvl: | int 或 string | 当前层数或特殊名称 |
| Gold | $: | int | 随身携带的金币数 |
| Hit Points | HP: | "当前(最大)" 格式 | 如 HP:9(12) |
| Power (Mana) | Pw: | "当前(最大)" 格式 | 如 Pw:3(3) |
| Armor Class | AC: | int (越低越好，可为负) | 护甲等级 |
| Experience | Exp: 或 Xp: | "等级/经验值" 格式 | 如 Exp:1/19 |
| Time | T: | int | 已过回合数（可选显示） |
| Score | S: | int | 分数（可选显示） |
| HD | HD: | int | 变形时显示的 Hit Dice |

### 状态条件字段 (Status Conditions)

#### 饥饿状态 (Hunger)
| 值 | 显示文本 | 说明 |
|----|----------|------|
| Satiated | Satiated | 过饱 |
| Not Hungry | (不显示) | 正常，也称 Normal |
| Hungry | Hungry | 饥饿 |
| Weak | Weak | 虚弱 |
| Fainting | Fainting | 晕厥 |

#### 负重状态 (Encumbrance)
| 值 | 显示文本 | 说明 |
|----|----------|------|
| Unencumbered | (不显示) | 正常 |
| Burdened | Burdened | 负担 |
| Stressed | Stressed | 压力 |
| Strained | Strained | 紧张 |
| Overtaxed | Overtaxed | 超载 |
| Overloaded | Overloaded | 过载 |

#### 致命状态 (Fatal Conditions)
| 缩写 | 全称 | 说明 |
|-------|------|------|
| Stone | Petrifying | 正在石化 |
| Slime | Slime | 正在变成绿色粘液 |
| Strngl | Strangled | 被勒死中 |
| FoodPois | Food Poisoning | 严重食物中毒 |
| TermIll | Terminal Illness | 绝症 |

#### 非致命状态 (Non-fatal Conditions)
| 缩写 | 全称 | 说明 |
|-------|------|------|
| Blind | Blind | 失明 |
| Deaf | Deaf | 失聪 |
| Stun | Stunned | 眩晕 |
| Conf | Confused | 混乱 |
| Hallu | Hallucinating | 幻觉 |

#### 移动修正 (Movement Modifiers)
| 缩写 | 全称 | 说明 |
|-------|------|------|
| Lev | Levitating | 悬浮 |
| Fly | Flying | 飞行 |
| Ride | Riding | 骑乘 |

### 可配置的状态高亮字段 (行 6320-6500)
可用于 `hilite_status` 配置的字段名列表:
```
title, dungeon-level, experience-level, strength, gold, experience,
dexterity, hitpoints, HD, constitution, hitpoints-max, time,
intelligence, power, hunger, wisdom, power-max, carrying-capacity,
charisma, armor-class, condition, alignment, score
```

### API 设计要点
- 状态行是结构化数据，每个字段可独立提取
- HP 和 Pw 都有当前值/最大值对
- 状态条件是一组布尔标志，可同时存在多个
- 六大属性 (St/Dx/Co/In/Wi/Ch) 范围通常 3-18，可超出
- AC 可为负值
- 强度有特殊表示: 18/01 到 18/99 以及 18/**

---

## 3. 地图符号系统 (行 508-627, 6504-6767)

### 概述
地图是字符网格，每个位置用一个 ASCII 符号表示。所有符号可通过 SYMBOLS 系统自定义。

### 地形符号

| 符号 | 含义 |
|------|------|
| `-` | 水平墙/房间角落/东西向开门 |
| `\|` | 垂直墙/南北向开门/墓碑 |
| `.` | 房间地板/冰面/无门的门道/开启吊桥 |
| `#` | 走廊/铁栅栏/树/关闭吊桥 |
| `>` | 下楼梯 |
| `<` | 上楼梯 |
| `+` | 关闭的门/法术书 |
| `{` | 喷泉/水槽 |
| `}` | 水池/护城河/岩浆 |
| `\` | 王座 |
| `_` | 祭坛/铁链 |
| `^` | 陷阱（发现后显示） |
| ` ` (空格) | 未探索/实心岩石 |

### 物品符号

| 符号 | 物品类型 | 对应 pickup_types |
|------|----------|-------------------|
| `$` | 金币 | $ |
| `)` | 武器 | ) |
| `[` | 护甲 | [ |
| `%` | 食物 | % |
| `?` | 卷轴 | ? |
| `/` | 魔杖 | / |
| `=` | 戒指 | = |
| `!` | 药水 | ! |
| `(` | 工具 | ( |
| `"` | 护符/蜘蛛网 | " |
| `*` | 宝石/石头 | * |
| `` ` `` | 巨石/雕像/铭文 | ` |
| `0` | 铁球 | 0 |
| `+` | 法术书 | + |

### 怪物符号

| 符号范围 | 说明 |
|----------|------|
| `a-z` | 小写字母代表各类怪物 |
| `A-Z` (除I) | 大写字母代表各类怪物 |
| `@` | 玩家角色/人类/精灵 |
| `&` | 主要恶魔 |
| `'` | 魔像 |
| `:` | 蜥蜴 |
| `;` | 海怪 |
| `I` | 不可见怪物的记忆位置 |
| `1-5` | 通过 Warning 感知的未见怪物（危险等级） |

### 完整符号名称列表 (行 6537-6767)
所有符号以 `S_` 前缀命名，共约 160+ 个符号定义，包括:
- 地形: S_room, S_corr, S_litcorr, S_hwall, S_vwall, S_upstair, S_dnstair, S_fountain, S_pool, S_lava, S_ice, S_altar, S_throne, S_tree 等
- 门: S_vcdoor(关), S_vodoor(开), S_hcdoor(关), S_hodoor(开), S_ndoor(无门)
- 陷阱: S_arrow_trap, S_bear_trap, S_pit, S_spiked_pit, S_hole, S_trap_door, S_fire_trap, S_sleeping_gas_trap, S_magic_portal, S_teleportation_trap, S_level_teleporter, S_polymorph_trap, S_vibrating_square 等
- 物品: S_weapon, S_armor, S_food, S_scroll, S_potion, S_wand, S_ring, S_amulet, S_gem, S_tool, S_book, S_coin, S_ball, S_chain, S_boulder, S_rock
- 怪物: S_human, S_ant, S_bat, S_dog, S_feline, S_dragon, S_giant 等（按字母对应）
- 特效: S_vbeam, S_hbeam, S_lslant, S_rslant, S_expl_tl 到 S_expl_br (爆炸), S_digbeam, S_flashbeam

### API 设计要点
- 每个地图格子是一个符号，但可包含多层信息（地形 + 物品 + 怪物）
- 显示优先级: 怪物 > 物品 > 地形
- 物品堆叠时只显示顶层物品（可用 hilite_pile 选项高亮）
- 不可见但记忆中的位置会保持显示
- 每个符号可通过 SYMBOLS 配置替换为其他字符
- 颜色可以区分不同实体（如走廊中的铭文）

---

## 4. 玩家命令系统 (行 629-2265)

### 概述
命令分为单键命令、前缀+方向命令和扩展命令(#开头)。支持数字前缀重复执行。

### 4.1 输入类型分类

| 输入类型 | 说明 | 示例 |
|----------|------|------|
| 单键命令 | 按一个键执行 | `i`(背包), `s`(搜索) |
| 方向命令 | 命令 + 方向键 | `o` + 方向(开门) |
| 前缀 + 方向 | 修饰前缀 + 方向 | `g` + 方向(持续走) |
| 物品选择 | 命令后选择背包物品 | `d` + 物品字母 |
| 文本输入 | 命令后输入字符串 | `C`(命名) |
| 菜单选择 | 弹出菜单选项 | `D`(丢弃类型) |
| yes/no 确认 | y/n 或 yes/no | 攻击和平生物确认 |
| 数量 + 命令 | 数字前缀 | `10s`(搜索10次) |
| 位置选择 | 移动光标选定地图位置 | `_`(旅行), `/`(查看) |

### 4.2 方向系统

```
     y  k  u          7  8  9
      \ | /            \ | /
     h- . -l          4- . -6
      / | \            / | \
     b  j  n          1  2  3
 (number_pad off)  (number_pad on)
```

方向键:
- 标准模式: y(左上) k(上) u(右上) h(左) l(右) b(左下) j(下) n(右下)
- 小键盘模式: 7(左上) 8(上) 9(右上) 4(左) 6(右) 1(左下) 2(下) 3(右下)
- `.` 或 `s` 表示自身方向
- 大写方向字母表示持续移动

### 4.3 移动前缀

| 前缀 | 按键 | 功能 |
|------|------|------|
| 移动 | [yuhjklbn] | 移动一格（遇怪攻击） |
| 持续移动 | YUHJKLBN (大写) | 向该方向移动直到撞墙 |
| 安全移动 | m + 方向 | 移动不拾取不攻击 |
| 强制攻击 | F + 方向 | 即使看不到怪也攻击 |
| 推进 | g + 方向 | 移动直到有趣的东西 |
| 奔跑 | G + 方向 或 Ctrl+方向 | 类似g但忽略岔路 |

### 4.4 基本命令一览

| 按键 | 命令 | 需要额外输入 | 说明 |
|------|------|-------------|------|
| `?` | help | 无 | 帮助菜单 |
| `/` | whatis | 位置或符号 | 查询符号含义 |
| `&` | whatdoes | 按键 | 查询按键功能 |
| `<` | up | 无 | 上楼 |
| `>` | down | 无 | 下楼 |
| `.` | wait | 无 | 等待一回合 |
| `a` | apply | 物品选择 | 使用工具 |
| `A` | takeoffall | 菜单 | 脱下所有装备 |
| `^A` | repeat | 无 | 重复上一命令 |
| `c` | close | 方向 | 关门 |
| `C` | call/name | 文本输入 | 命名 |
| `^C` | quit | 确认 | 退出游戏 |
| `d` | drop | 物品选择(可带数量) | 丢弃物品 |
| `D` | droptype | 类型选择+菜单 | 按类丢弃 |
| `^D` | kick | 方向 | 踢 |
| `e` | eat | 物品选择 | 吃东西 |
| `E` | engrave | 工具+文本 | 刻字 |
| `f` | fire | 方向 | 发射箭袋中物品 |
| `i` | inventory | 无 | 显示背包 |
| `I` | inventtype | 类型字符 | 显示指定类型物品 |
| `o` | open | 方向 | 开门 |
| `O` | options | 菜单 | 设置选项 |
| `^O` | overview | 无 | 显示地牢概览 |
| `p` | pay | 无 | 付款 |
| `P` | puton | 物品选择 | 佩戴饰品 |
| `^P` | prevmsg | 无 | 查看历史消息 |
| `q` | quaff | 物品选择 | 喝药水 |
| `Q` | quiver | 物品选择 | 选择箭袋物品 |
| `r` | read | 物品选择 | 阅读卷轴/法术书 |
| `R` | remove | 物品选择 | 摘下饰品 |
| `^R` | redraw | 无 | 重绘屏幕 |
| `s` | search | 无 | 搜索暗门/陷阱 |
| `S` | save | 无 | 保存退出 |
| `t` | throw | 物品选择+方向 | 投掷 |
| `T` | takeoff | 物品选择 | 脱下护甲 |
| `^T` | teleport | 无 | 传送 |
| `v` | chronicle | 无 | 显示重要事件 |
| `V` | versionshort | 无 | 显示版本号 |
| `w` | wield | 物品选择 | 装备武器 |
| `W` | wear | 物品选择 | 穿戴护甲 |
| `x` | swap | 无 | 交换主副武器 |
| `X` | twoweapon | 无 | 切换双武器模式 |
| `^X` | attributes | 无 | 显示详细属性 |
| `z` | zap | 物品选择+方向 | 使用魔杖 |
| `Z` | cast | 法术选择+方向 | 施放法术 |
| `:` | look | 无 | 查看脚下 |
| `;` | glance | 位置 | 查看符号类型 |
| `,` | pickup | 无/菜单 | 拾取 |
| `@` | autopickup | 无 | 切换自动拾取 |
| `^` | showtrap | 方向 | 查看已知陷阱 |
| `)` | seeweapon | 无 | 查看当前武器 |
| `[` | seearmor | 无 | 查看当前护甲 |
| `=` | seerings | 无 | 查看当前戒指 |
| `"` | seeamulet | 无 | 查看当前护符 |
| `(` | seetools | 无 | 查看当前工具 |
| `*` | seeall | 无 | 查看所有装备 |
| `$` | showgold | 无 | 查看金币 |
| `+` | showspells | 无 | 查看已知法术 |
| `\` | known | 无 | 查看已发现物品 |
| `` ` `` | knownclass | 类型选择 | 查看某类已发现物品 |
| `\|` | perminv | 无 | 操作持久背包显示 |
| `!` | shell | 无 | shell 逃逸 |
| `Del` | terrain | 无 | 显示无遮挡地图 |
| `#` | extended | 命令名 | 扩展命令前缀 |
| `_` | travel | 位置 | 旅行到指定位置 |

### 4.5 主要扩展命令 (行 1283-2157)

| 扩展命令 | 默认键 | 功能 |
|----------|--------|------|
| #adjust | M-a | 调整背包字母 |
| #annotate | M-A | 为当前层级添加注释 |
| #chat | M-c | 与相邻NPC对话 |
| #conduct | M-C | 查看自愿挑战 |
| #dip | M-d | 浸泡物品 |
| #enhance | M-e | 提升武器/法术技能 |
| #force | M-f | 撬锁 |
| #invoke | M-i | 激活物品特殊能力 |
| #jump | M-j | 跳跃 |
| #loot | M-l | 搜刮箱子/马鞍 |
| #monster | M-m | 使用怪物特殊能力 |
| #name | N, M-n | 命名 |
| #offer | M-o | 祭祀 |
| #overview | ^O, M-O | 地牢概览 |
| #pray | M-p | 祈祷 |
| #ride | M-R | 骑乘 |
| #rub | M-r | 擦拭 |
| #sit | M-s | 坐下 |
| #tip | M-T | 倾倒容器 |
| #turn | M-t | 驱散不死生物 |
| #untrap | M-u | 拆除陷阱 |
| #twoweapon | X, M-2 | 双武器切换 |
| #wipe | M-w | 擦脸 |
| #vanquished | M-V | 查看击杀列表 |

### API 设计要点
- 命令输入是分步的: 先是命令键，然后可能需要方向/物品/文本
- 物品选择使用字母标识 (a-zA-Z)，可用 `?` 列出候选，`*` 列出全部
- 方向是固定的8方向 + 自身(.)
- 扩展命令支持自动补全
- `m` 前缀修改很多命令的行为（跳过地板物品等）
- 数字前缀用于重复命令或指定数量
- ESC 键用于取消当前命令

---

## 5. 背包与物品显示 (行 2805-2920, 950-964)

### 概述
每个物品有一个背包字母标识 (a-zA-Z)，物品描述包含多个可选字段。

### 物品显示格式
典型物品描述格式:
```
字母 - [BUC状态] [数量] [附魔] 物品名称 [额外信息]
```

示例:
```
a - a blessed +1 long sword (weapon in hand)
b - an uncursed rusty iron chain mail (being worn)
c - 3 uncursed scrolls of identify
d - a potion of healing
e - a wand of fire (0:4)
```

### 物品属性字段

| 字段 | 说明 | 显示条件 |
|------|------|----------|
| 背包字母 | a-zA-Z | 始终显示 |
| BUC 状态 | blessed/uncursed/cursed/(无) | 已知时显示，implicit_uncursed控制uncursed是否省略 |
| 数量 | 数字 | >1时显示 |
| 附魔(enchantment) | +N 或 -N | 已鉴定时显示 |
| 腐蚀状态 | rusty/corroded/burnt/rotted | 存在时显示 |
| 物品名称 | 类型名或外观描述 | 始终显示 |
| 用途标记 | (weapon in hand)/(being worn)/(on left hand) 等 | 使用中时显示 |
| 魔杖充能 | (充能次数:当前充能) 如 (0:4) | 完全鉴定时显示 |
| 容器内容 | (containing N items) | 已知内容时显示 |
| 命名 | named "xxx" 或 called "xxx" | 有命名时显示 |

### 物品类型符号 (用于 I 命令和 pickup_types)

| 符号 | 类型 |
|------|------|
| `$` | 金币 |
| `)` | 武器 |
| `[` | 护甲 |
| `%` | 食物 |
| `?` | 卷轴 |
| `/` | 魔杖 |
| `=` | 戒指 |
| `!` | 药水 |
| `(` | 工具 |
| `"` | 护符 |
| `*` | 宝石 |
| `+` | 法术书 |
| `0` | 铁球 |
| `_` | 铁链 |
| `` ` `` | 巨石/雕像 |

### 特殊背包查询

| 命令 | 功能 |
|------|------|
| `I*` | 列出所有宝石 |
| `Iu` | 列出所有未付款物品 |
| `Ix` | 列出已用完的未付款物品 |
| `IB` | 列出所有已知祝福物品 |
| `IU` | 列出所有已知未诅咒物品 |
| `IC` | 列出所有已知诅咒物品 |
| `IX` | 列出 BUC 状态未知物品 |
| `IP` | 列出最近拾取的物品 |
| `I$` | 统计金币 |

### API 设计要点
- 每个物品有唯一字母标识符 (inventory slot)
- BUC 状态有4种: blessed, uncursed, cursed, unknown
- 物品可以堆叠 (同类合并，显示数量)
- 物品有多重属性: 类型、BUC、附魔、腐蚀、名称、使用状态
- 容器可嵌套包含其他物品
- perm_invent 选项可以持久显示背包

---

## 6. 菜单交互系统 (行 636-651, 4670-4786)

### 概述
NetHack 使用多种菜单模式与玩家交互。菜单样式由 menustyle 选项控制。

### 菜单样式 (menustyle)

| 值 | 说明 |
|----|------|
| traditional | 先选物品类别字符，再逐项确认 |
| combination | 先选类别，再显示完整菜单 |
| partial | 先显示菜单，可选类别缩小范围 |
| full | 直接显示完整菜单（默认） |

### 菜单操作键

| 键 | 功能 | 选项名 |
|----|------|--------|
| `^` | 第一页 | menu_first_page |
| `<` | 上一页 | menu_previous_page |
| `>` | 下一页 | menu_next_page |
| `\|` | 最后一页 | menu_last_page |
| `.` | 全选 | menu_select_all |
| `-` | 取消全选 | menu_deselect_all |
| `,` | 选择本页全部 | menu_select_page |
| `~` | 反选本页 | menu_invert_page |
| `:` | 搜索 | menu_search |
| `{` | 左滚 | menu_shift_left |
| `}` | 右滚 | menu_shift_right |

### 物品选择提示格式
典型格式: `What do you want to use? [a-zA-Z ?*]`
- 字母范围表示有效选项
- `?` 列出这些选项的详情
- `*` 列出全部背包
- ESC 取消操作

### 丢弃命令的高级过滤 (D命令, 行 850-898)
过滤类别:
- 物品类型: `!`(药水), `?`(卷轴), `%`(食物) 等
- BUC 状态: `B`(祝福), `U`(未诅咒), `C`(诅咒), `X`(未知)
- 商店状态: `u`(未付款)
- 新近性: `P`(最近拾取)
- 特殊: `a`(全部不确认), `i`(先查看), `m`(用菜单)

### API 设计要点
- 菜单是选项列表，每项有字母标识
- 支持单选和多选模式
- 多选菜单支持全选、反选、按页操作
- 物品选择有过滤机制（按类型、BUC、商店状态等）
- 需要处理分页（屏幕不够大时）
- 菜单可以有头信息(header)

---

## 7. 消息系统 (行 496-506, 6178-6222)

### 概述
消息显示在屏幕顶部，是游戏事件的文本描述。

### 消息显示机制
- 单行显示在屏幕顶部
- 多条消息时显示 "--More--" 等待玩家按空格
- `^P` 可回看历史消息 (数量由 msghistory 控制，默认20)
- msg_window 选项控制回看方式: single/combination/full/reversed

### 消息类型配置 (MSGTYPE)
| 类型 | 效果 |
|------|------|
| show | 正常显示 |
| hide | 不显示 |
| stop | 显示并等待 more 提示 |
| norep | 不重复显示 |

### API 设计要点
- 消息是纯文本字符串
- 需要缓冲和分页机制
- 可配置消息过滤和显示行为
- 消息可能包含怪物名、物品名、数值等结构化信息

---

## 8. 游戏实体 (行 2669-3611)

### 8.1 怪物 (Monsters, 行 2669-2803)

#### 怪物分类 (按符号字母)
完整的怪物字母-类型映射 (来自符号表):

| 符号 | S_名称 | 类型 |
|------|--------|------|
| `a` | S_ant | 蚂蚁/昆虫 |
| `b` | S_blob | 粘液 |
| `c` | S_cockatrice | 石化鸡 |
| `d` | S_dog | 犬类 |
| `e` | S_eye | 眼球/球体 |
| `f` | S_feline | 猫科 |
| `g` | S_gremlin | 小妖精 |
| `h` | S_humanoid | 类人生物 |
| `i` | S_imp | 小恶魔 |
| `j` | S_jelly | 果冻 |
| `k` | S_kobold | 狗头人 |
| `l` | S_leprechaun | 小妖精 |
| `m` | S_mimic | 拟态怪 |
| `n` | S_nymph | 仙女 |
| `o` | S_orc | 兽人 |
| `p` | S_piercer | 穿刺者 |
| `q` | S_quadruped | 四足兽 |
| `r` | S_rodent | 啮齿类 |
| `s` | S_spider | 蛛形纲/蜈蚣 |
| `t` | S_trapper | 陷阱怪 |
| `u` | S_unicorn | 独角兽/马 |
| `v` | S_vortex | 漩涡 |
| `w` | S_worm | 蠕虫 |
| `x` | S_xan | 特殊昆虫 |
| `y` | S_light | 光 |
| `z` | S_zruty | zruty |
| `A` | S_angel | 天使 |
| `B` | S_bat | 蝙蝠/鸟 |
| `C` | S_centaur | 半人马 |
| `D` | S_dragon | 龙 |
| `E` | S_elemental | 元素 |
| `F` | S_fungus | 真菌/霉菌 |
| `G` | S_gnome | 侏儒 |
| `H` | S_giant | 巨人 |
| `J` | S_jabberwock | 贾巴沃克 |
| `K` | S_kop | Kop |
| `L` | S_lich | 巫妖 |
| `M` | S_mummy | 木乃伊 |
| `N` | S_naga | 那伽 |
| `O` | S_ogre | 食人魔 |
| `P` | S_pudding | 布丁/软泥 |
| `Q` | S_quantmech | 量子力学师 |
| `R` | S_rustmonst | 锈蚀怪 |
| `S` | S_snake | 蛇 |
| `T` | S_troll | 巨魔 |
| `U` | S_umber | 地穴怪 |
| `V` | S_vampire | 吸血鬼 |
| `W` | S_wraith | 幽灵 |
| `X` | S_xorn | 地灵 |
| `Y` | S_yeti | 猿类 |
| `Z` | S_zombie | 僵尸 |
| `@` | S_human | 人类/精灵 |
| `&` | S_demon | 主恶魔 |
| `'` | S_golem | 魔像 |
| `:` | S_lizard | 蜥蜴 |
| `;` | S_eel | 海怪 |

#### 怪物特殊标记
- `I` - 不可见怪物的记忆位置（怪物可能已移动）
- `1-5` - 通过 Warning 属性感知的怪物危险等级

#### 宠物 (行 2724-2745)
- 起始宠物: 小狗(`d`)、小猫(`f`)或小马(`u`)
- 宠物跟随上下楼梯（需相邻）
- 宠物可升级、成长
- hilite_pet 选项可高亮宠物

### 8.2 物品类型 (行 2805-3611)

| 类型 | 符号 | 使用命令 | 特点 |
|------|------|----------|------|
| 武器 | `)` | w(装备), t(投掷), f(发射) | 有附魔值，可腐蚀 |
| 护甲 | `[` | W(穿), T(脱) | AC值，可附魔，有位置（身体/斗篷/头盔/手套/靴子/盾牌） |
| 食物 | `%` | e(吃) | 有保质期，可腐烂 |
| 卷轴 | `?` | r(读) | 一次性，有随机标签名 |
| 药水 | `!` | q(喝), t(投掷) | 一次性，有随机颜色描述 |
| 魔杖 | `/` | z(使用) | 有充能次数，可充能 |
| 戒指 | `=` | P(戴), R(摘) | 最多戴2个，增加饥饿 |
| 法术书 | `+` | r(学习) | 学习后获得法术，有耐久 |
| 工具 | `(` | a(使用) | 多样用途 |
| 护符 | `"` | P(戴), R(摘) | 最多戴1个 |
| 宝石 | `*` | - | 可用弹弓发射 |
| 金币 | `$` | - | 无BUC状态 |
| 巨石 | `` ` `` | - | 阻碍通行，可推动 |

### 8.3 陷阱类型 (行 2392-2468)

所有陷阱发现后显示为 `^`，类型包括:
- 坑 (pit), 带刺坑 (spiked pit)
- 熊夹 (bear trap)
- 箭陷阱 (arrow trap), 飞镖陷阱 (dart trap)
- 落石陷阱 (falling rock trap)
- 火陷阱 (fire trap)
- 睡眠气体陷阱 (sleeping gas trap)
- 锈蚀陷阱 (rust trap)
- 传送陷阱 (teleportation trap)
- 层间传送 (level teleporter)
- 落门 (trap door), 洞 (hole)
- 魔法传送门 (magic portal)
- 反魔场 (anti-magic field)
- 变形陷阱 (polymorph trap)
- 滚石陷阱 (rolling boulder trap)
- 地雷 (land mine)
- 吱呀板 (squeaky board)
- 雕像陷阱 (statue trap)
- 蜘蛛网 (web)
- 振动方块 (vibrating square) - 特殊标记

### 8.4 地形特征 (行 2312-2503)

| 地形 | 说明 |
|------|------|
| 房间 | 有光照/黑暗之分 |
| 走廊 | 有秘密走廊（需搜索发现） |
| 门 | 开/关/锁/隐藏 4种状态 |
| 楼梯/梯子 | 连接上下层级 |
| 喷泉 | 可饮水/浸泡 |
| 祭坛 | 可祭祀/鉴定BUC |
| 王座 | 可坐 |
| 水槽(sink) | 可饮水 |
| 水池/护城河 | 阻碍通行 |
| 岩浆 | 致命地形 |
| 冰面 | 可能滑倒 |
| 树 | 阻碍通行 |

---

## 9. 角色系统 (行 68-171)

### 角色职业 (Roles)
Archeologist, Barbarian, Caveman/Cavewoman, Healer, Knight, Monk, Priest/Priestess, Ranger, Rogue, Samurai, Tourist, Valkyrie, Wizard

### 种族 (Races)
Human, Dwarf, Elf, Gnome, Orc

### 阵营 (Alignment)
Lawful, Neutral, Chaotic

### 性别 (Gender)
Male, Female

### API 设计要点
- 角色由 role + race + alignment + gender 组合确定
- 不是所有组合都合法
- 每个职业有9个等级称号 (experience level 1,3,6,10,14,18,22,26,30)

---

## 10. 位置选择模式 (getpos, 行 6030-6176)

### 概述
当游戏需要玩家选择地图位置时（如旅行、查看、施法目标），进入位置选择模式。

### 位置选择操作键

| 键 | 功能 |
|----|------|
| 方向键 | 移动光标 |
| `@` | 回到自身位置 |
| `.` | 选择位置（可能询问更多信息） |
| `,` | 选择位置（不询问更多） |
| `;` | 选择位置（快速退出） |
| `:` | 选择位置（显示详细信息） |
| `m` | 下一个怪物 |
| `M` | 上一个怪物 |
| `o` | 下一个物品 |
| `O` | 上一个物品 |
| `d` | 下一个门 |
| `D` | 上一个门 |
| `a` | 下一个有趣目标 |
| `A` | 上一个有趣目标 |
| `x` | 下一个未探索位置 |
| `X` | 上一个未探索位置 |
| `#` | 切换自动描述 |
| `!` | 切换菜单显示 |
| `*` | 切换跳跃移动方式 |
| `"` | 切换过滤模式 |
| `$` | 显示有效目标 |
| `?` | 帮助 |
| ESC | 取消 |

### API 设计要点
- 位置选择是一个独立的交互模式
- 支持自动描述光标下的内容
- 支持快速跳转到各类目标
- whatis_coord 选项控制坐标显示格式

---

## 11. 法术系统 (行 3420-3476)

### 法术列表显示 (`+` 命令)
每个法术显示:
- 法术名称
- 法术等级
- 技能类别
- 失败率
- 记忆强度估计

### 法术操作
- `r` 阅读法术书学习法术
- `Z` 施放法术
- 法术记忆会随时间衰减
- 法术有方向型、目标型和无方向型
- 施法消耗 Power (Pw)
- 护甲影响施法

---

## 12. 商店系统 (行 2515-2565)

### 商店交互
- 拾取物品后用 `p` 付款购买
- 放下物品会被收购
- `#chat` 站在物品上询问价格
- `$` 查看信用/欠款
- `Iu` 查看未付款物品
- `Ix` 查看已用完的计费物品

---

## 13. 选项系统概要 (行 3926-5800)

### 与API相关的关键选项

| 选项 | 类型 | 默认 | 说明 |
|------|------|------|------|
| autopickup | bool | off | 自动拾取 |
| autoopen | bool | on | 自动开门 |
| autounlock | compound | apply-key | 自动解锁行为 |
| color | bool | - | 彩色显示 |
| hilite_pet | bool | off | 高亮宠物 |
| hilite_pile | bool | off | 高亮物品堆 |
| hitpointbar | bool | off | HP条显示 |
| menustyle | enum | full | 菜单样式 |
| number_pad | bool | off | 小键盘方向 |
| perm_invent | bool | off | 持久背包显示 |
| pickup_types | string | all | 自动拾取类型 |
| pile_limit | int | 5 | 堆叠描述阈值 |
| showexp | bool | off | 显示经验值 |
| time | bool | off | 显示回合数 |
| statushilites | int | - | 状态高亮超时 |
| statuslines | int | 2 | 状态行数(2或3) |
| verbose | bool | on | 详细消息 |
| msg_window | enum | s | 消息回看方式 |
| msghistory | int | 20 | 历史消息数量 |

---

## 14. 关键行号索引

| 内容 | 起始行 | 结束行 |
|------|--------|--------|
| 游戏简介 | 12 | 67 |
| 角色职业描述 | 68 | 171 |
| 屏幕布局说明 | 173 | 232 |
| 屏幕示例图 | 271 | 285 |
| 状态行说明 | 343 | 494 |
| 消息行说明 | 496 | 506 |
| 地图符号说明 | 508 | 627 |
| 命令总说明 | 629 | 676 |
| 基本命令列表 | 677 | 1283 |
| 扩展命令列表 | 1283 | 2157 |
| Meta键命令 | 2180 | 2248 |
| Number_pad额外命令 | 2250 | 2265 |
| 房间和走廊 | 2312 | 2324 |
| 门 | 2326 | 2391 |
| 陷阱 | 2392 | 2468 |
| 楼梯 | 2470 | 2502 |
| 商店 | 2515 | 2565 |
| 移动反馈 | 2581 | 2651 |
| Rogue层 | 2653 | 2667 |
| 怪物 | 2669 | 2803 |
| 物品总论 | 2805 | 2920 |
| 神器 | 2921 | 2963 |
| 武器 | 2977 | 3115 |
| 武器技能 | 3117 | 3201 |
| 护甲 | 3203 | 3273 |
| 食物 | 3275 | 3307 |
| 卷轴 | 3309 | 3341 |
| 药水 | 3343 | 3354 |
| 魔杖 | 3356 | 3397 |
| 戒指 | 3399 | 3418 |
| 法术书与法术 | 3420 | 3476 |
| 工具与容器 | 3478 | 3546 |
| 护符 | 3548 | 3574 |
| 宝石 | 3576 | 3611 |
| 行为挑战(Conduct) | 3659 | 3818 |
| 成就(Achievements) | 3835 | 3924 |
| 选项设置方式 | 3926 | 4234 |
| 选项详细列表 | 4236 | 5800 |
| 键位绑定 | 5977 | 6176 |
| 消息类型配置 | 6178 | 6222 |
| 菜单颜色配置 | 6224 | 6282 |
| 状态高亮配置 | 6320 | 6500 |
| 符号系统 | 6504 | 6789 |
| Unicode自定义 | 6781 | 6820 |
| 盲人辅助 | 6823 | 6935 |
| 评分系统 | 7072 | 7093 |
| 探索模式 | 7095 | 7140 |

---

## 15. API 协议设计关键总结

### 游戏状态数据结构
1. **地图**: 21x80 字符网格 + 颜色/属性层
2. **状态行**: 结构化键值对（约20+字段）
3. **消息队列**: 字符串列表
4. **背包**: 物品列表，每项有字母ID和描述
5. **当前位置**: (x, y) 坐标

### 输入交互模式
1. **命令模式**: 等待单键/方向输入
2. **菜单模式**: 显示选项列表等待选择
3. **位置选择模式**: 光标在地图上移动
4. **文本输入模式**: 等待字符串输入
5. **yes/no模式**: 等待确认
6. **--More--模式**: 等待按键继续
7. **方向输入模式**: 等待8方向+自身

### 显示更新触发
- 每次命令执行后地图可能更新
- 状态行字段值变化时更新
- 新消息产生时更新消息行
- 背包变化时更新（如果perm_invent开启）

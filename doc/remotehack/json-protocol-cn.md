# RemoteHack JSON 通信协议 V1

本文档定义 RemoteHack 前后端之间的 HTTP+JSON 通信协议。

---

## 一、协议总览

### 1.1 通信模型

NetHack 的游戏循环是阻塞式的：游戏核心产生输出后，在需要玩家输入时阻塞等待。
RemoteHack 将此模型直接映射为 HTTP 请求-响应：

```
前端                                后端
  |                                   |
  |--- POST /api/input {输入数据} --->|
  |                                   | （处理输入，执行游戏逻辑，产生输出）
  |<--- 200 {累积的输出 + 下一个提示} -|
  |                                   |
  |--- POST /api/input {输入数据} --->|
  |<--- 200 {累积的输出 + 下一个提示} -|
```

游戏启动时，前端发送一个初始请求获取初始状态：

```
前端                                后端
  |--- GET /api/start -------------->|
  |<--- 200 {初始状态 + 首个提示} ---|
```

### 1.2 核心原则

1. **一问一答**：每个 HTTP 请求携带一个玩家输入，响应携带从上次输入到本次阻塞之间的所有累积输出。
2. **输出完整性**：响应中包含所有类型的输出（地图、状态栏、消息、菜单等），不遗漏。
3. **提示驱动**：响应中的 `prompt` 字段告知前端当前需要什么类型的输入。
4. **未知输出兜底**：对于协议未定义的 window_procs 调用，后端必须记录到 `warnings` 字段，不得静默丢弃。

### 1.3 端点定义

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/start` | GET | 启动游戏，获取初始状态和首个提示 |
| `/api/input` | POST | 发送玩家输入，获取游戏响应 |

---

## 二、响应结构（后端 → 前端）

每个 HTTP 响应的 JSON 结构如下：

```json
{
  "map": { ... },
  "status": { ... },
  "messages": [ ... ],
  "prompt": { ... },
  "inventory_update": true,
  "events": [ ... ],
  "windows": [ ... ],
  "warnings": [ ... ]
}
```

所有顶层字段都是可选的，仅在有对应数据时出现。
唯一必须出现的字段是 `prompt`（告知前端下一步该做什么）。

---

### 2.1 地图（map）

地图为 80×21 的格子网格。每个格子包含前景和背景两层 glyph 信息。

```json
{
  "map": {
    "cells": [
      {
        "x": 30,
        "y": 10,
        "fg": {
          "glyph": 2041,
          "ch": "@",
          "color": 7,
          "tileidx": 395,
          "flags": ["hero"]
        },
        "bg": {
          "glyph": 1923,
          "ch": ".",
          "color": 0,
          "tileidx": 280,
          "flags": []
        }
      }
    ],
    "cursor": {
      "x": 30,
      "y": 10
    }
  }
}
```

#### 字段说明

**cell 对象**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `x` | int | 列坐标（1-79） |
| `y` | int | 行坐标（0-20） |
| `fg` | glyph_obj | 前景（怪物、物品、或可见地形特征） |
| `bg` | glyph_obj | 背景（地面/地形） |

**glyph_obj 对象**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `glyph` | int | NetHack 内部 glyph ID（用于 tile 索引） |
| `ch` | string | ASCII 显示字符（单字符） |
| `color` | int | 颜色索引（0-15，对应终端 16 色） |
| `tileidx` | int | Tile 图块索引（用于图形渲染） |
| `flags` | string[] | 特殊标志列表 |

**flags 可能的值**：

| 值 | 对应 MG_* | 含义 | 前端可利用方式 |
|----|-----------|------|---------------|
| `"hero"` | MG_HERO | 玩家角色 | 特殊高亮/居中 |
| `"pet"` | MG_PET | 宠物 | 高亮标记 |
| `"ridden"` | MG_RIDDEN | 被骑乘 | 叠加骑乘图标 |
| `"corpse"` | MG_CORPSE | 尸体 | 特殊渲染 |
| `"invis"` | MG_INVIS | 隐形 | 半透明/问号 |
| `"detect"` | MG_DETECT | 被侦测到 | 边框高亮 |
| `"statue"` | MG_STATUE | 雕像 | 灰色渲染 |
| `"objpile"` | MG_OBJPILE | 物品堆 | 叠加标记 |
| `"lava"` | MG_BW_LAVA | 岩浆高亮 | 特殊背景 |
| `"ice"` | MG_BW_ICE | 冰面高亮 | 特殊背景 |
| `"unexplored"` | MG_UNEXPL | 未探索 | 深色/隐藏 |
| `"nothing"` | MG_NOTHING | 空无 | 不渲染 |
| `"male"` | MG_MALE | 雄性 | Tooltip 信息 |
| `"female"` | MG_FEMALE | 雌性 | Tooltip 信息 |

#### V1 策略

V1 发送**全量地图**（所有有内容的格子）。后续版本可优化为仅发送变化的格子（增量更新），
通过添加 `"incremental": true` 字段来标识。

全量地图最多 1680 个 cell（80×21），JSON 大小约 50-100KB，对 HTTP 来说完全可接受。

#### 前景/背景双层设计说明

原版 TTY 界面每个格子只显示一个字符（优先级：怪物 > 物品 > 地形）。
RemoteHack 的改进之一是同时显示前景和背景，例如：

- 格子上有怪物时：`fg` = 怪物，`bg` = 该格子的地面（走廊/房间地板/冰面等）
- 格子上有物品时：`fg` = 物品，`bg` = 地面
- 格子只有地形时：`fg` = 地形本身，`bg` 可能为空或相同

这些数据直接来自 `win_print_glyph()` 的 `glyphinfo`（前景）和 `bkglyphinfo`（背景）参数。

---

### 2.2 状态栏（status）

状态栏包含 27 个字段和一组条件标志。后端在每轮 `BL_FLUSH` 时汇总所有变更字段。

```json
{
  "status": {
    "fields": {
      "title":      { "value": "Player the Rambler", "color": 7, "attr": 0 },
      "str":        { "value": "16", "color": 7, "attr": 0 },
      "dx":         { "value": "14", "color": 7, "attr": 0 },
      "co":         { "value": "18", "color": 7, "attr": 0 },
      "in":         { "value": "8", "color": 7, "attr": 0 },
      "wi":         { "value": "9", "color": 7, "attr": 0 },
      "ch":         { "value": "10", "color": 7, "attr": 0 },
      "align":      { "value": "Neutral", "color": 7, "attr": 0 },
      "score":      { "value": "42", "color": 7, "attr": 0 },
      "cap":        { "value": "", "color": 7, "attr": 0 },
      "gold":       { "value": "108", "color": 14, "attr": 0 },
      "ene":        { "value": "3", "color": 7, "attr": 0 },
      "enemax":     { "value": "5", "color": 7, "attr": 0 },
      "xp":         { "value": "1", "color": 7, "attr": 0 },
      "ac":         { "value": "7", "color": 7, "attr": 0 },
      "hd":         { "value": "", "color": 7, "attr": 0 },
      "time":       { "value": "156", "color": 7, "attr": 0 },
      "hunger":     { "value": "", "color": 7, "attr": 0 },
      "hp":         { "value": "15", "color": 10, "attr": 0, "percent": 93 },
      "hpmax":      { "value": "16", "color": 7, "attr": 0 },
      "leveldesc":  { "value": "Dlvl:1", "color": 7, "attr": 0 },
      "exp":        { "value": "19", "color": 7, "attr": 0 },
      "weapon":     { "value": "a long sword", "color": 7, "attr": 0 },
      "armor":      { "value": "chain mail", "color": 7, "attr": 0 },
      "terrain":    { "value": "", "color": 7, "attr": 0 },
      "vers":       { "value": "5.0.0", "color": 7, "attr": 0 }
    },
    "conditions": {
      "mask": 0,
      "active": []
    }
  }
}
```

#### 字段索引对照表

| 键名 | BL_* 枚举 | 含义 | 特殊说明 |
|------|-----------|------|----------|
| `title` | BL_TITLE | 玩家名+称号 | |
| `str` | BL_STR | 力量 | 可能是 "18/50" 或 "18/**" 格式 |
| `dx` | BL_DX | 敏捷 | |
| `co` | BL_CO | 体质 | |
| `in` | BL_IN | 智力 | |
| `wi` | BL_WI | 感知 | |
| `ch` | BL_CH | 魅力 | |
| `align` | BL_ALIGN | 阵营 | "Lawful" / "Neutral" / "Chaotic" |
| `score` | BL_SCORE | 分数 | 可选显示 |
| `cap` | BL_CAP | 负重 | "" / "Burdened" / "Stressed" / "Strained" / "Overtaxed" / "Overloaded" |
| `gold` | BL_GOLD | 金币 | |
| `ene` | BL_ENE | 当前魔力 | |
| `enemax` | BL_ENEMAX | 最大魔力 | |
| `xp` | BL_XP | 经验等级 | |
| `ac` | BL_AC | 护甲等级 | 可为负值，越低越好 |
| `hd` | BL_HD | Hit Dice | 变形时显示 |
| `time` | BL_TIME | 游戏回合数 | 可选显示 |
| `hunger` | BL_HUNGER | 饥饿状态 | "" / "Satiated" / "Hungry" / "Weak" / "Fainting" |
| `hp` | BL_HP | 当前生命 | 含 percent 字段 |
| `hpmax` | BL_HPMAX | 最大生命 | |
| `leveldesc` | BL_LEVELDESC | 地下城层级 | 如 "Dlvl:3" 或 "Home 1" |
| `exp` | BL_EXP | 经验值 | 可选显示 |
| `weapon` | BL_WEAPON | 武器状态 | 可选字段 |
| `armor` | BL_ARMOR | 护甲状态 | 可选字段 |
| `terrain` | BL_TERRAIN | 地形状态 | 可选字段 |
| `vers` | BL_VERS | 版本信息 | 可选字段 |

#### 状态字段的补充字段

- `color`（int）：颜色索引（0-15），来自 status_update 的 color 参数低 8 位
- `attr`（int）：文本属性掩码，来自 color 参数高 8 位
- `percent`（int）：百分比值（仅 hp 字段有意义，-1 表示不适用）

#### conditions 对象

| 字段 | 类型 | 说明 |
|------|------|------|
| `mask` | int | 原始 30 位位掩码 |
| `active` | string[] | 当前激活的条件名称列表 |

**条件名称列表**（完整 30 项）：

| 名称 | 位 | 含义 | 致命性 |
|------|-----|------|--------|
| `"bare"` | 0x1 | 赤手空拳 | 非致命 |
| `"blind"` | 0x2 | 失明 | 非致命 |
| `"busy"` | 0x4 | 忙碌（多回合动作中） | 非致命 |
| `"conf"` | 0x8 | 混乱 | 非致命 |
| `"deaf"` | 0x10 | 耳聋 | 非致命 |
| `"elf_iron"` | 0x20 | 精灵触铁 | 非致命 |
| `"fly"` | 0x40 | 飞行中 | 非致命 |
| `"foodpois"` | 0x80 | 食物中毒 | **致命** |
| `"glow"` | 0x100 | 手部发光 | 非致命 |
| `"grab"` | 0x200 | 被抓（即将溺水） | 非致命 |
| `"hallu"` | 0x400 | 幻觉 | 非致命 |
| `"held"` | 0x800 | 被抓住 | 非致命 |
| `"icy"` | 0x1000 | 站在冰面 | 非致命 |
| `"inlava"` | 0x2000 | 陷入岩浆 | **致命** |
| `"lev"` | 0x4000 | 漂浮 | 非致命 |
| `"parlyz"` | 0x8000 | 麻痹 | 非致命 |
| `"ride"` | 0x10000 | 骑乘中 | 非致命 |
| `"sleeping"` | 0x20000 | 睡眠中 | 非致命 |
| `"slime"` | 0x40000 | 粘液感染 | **致命** |
| `"slippery"` | 0x80000 | 手滑 | 非致命 |
| `"stone"` | 0x100000 | 石化中 | **致命** |
| `"strngl"` | 0x200000 | 被勒颈 | **致命** |
| `"stun"` | 0x400000 | 眩晕 | 非致命 |
| `"submerged"` | 0x800000 | 水下 | 非致命 |
| `"termill"` | 0x1000000 | 绝症 | **致命** |
| `"tethered"` | 0x2000000 | 被铁球拴住 | 非致命 |
| `"trapped"` | 0x4000000 | 被困 | 非致命 |
| `"unconscious"` | 0x8000000 | 昏迷 | 非致命 |
| `"woundedl"` | 0x10000000 | 腿伤 | 非致命 |
| `"holding"` | 0x20000000 | 英雄抓住怪物 | 非致命 |

---

### 2.3 消息（messages）

游戏产生的文本消息列表，按产生顺序排列。

```json
{
  "messages": [
    {
      "text": "You hit the goblin!",
      "attr": 0
    },
    {
      "text": "The goblin misses you.",
      "attr": 0
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` | string | 消息文本 |
| `attr` | int | 文本属性位掩码 |

**attr 属性值**：

| 值 | 含义 |
|----|------|
| 0 | 无特殊属性（ATR_NONE） |
| 1 | 粗体（ATR_BOLD） |
| 2 | 暗淡（ATR_DIM） |
| 3 | 斜体（ATR_ITALIC） |
| 4 | 下划线（ATR_ULINE） |
| 5 | 闪烁（ATR_BLINK） |
| 7 | 反色（ATR_INVERSE） |

高位标志（可与上述组合）：

| 值 | 含义 |
|----|------|
| 16 | 紧急消息（ATR_URGENT） |
| 32 | 不记入历史（ATR_NOHISTORY） |

---

### 2.4 提示（prompt）

`prompt` 字段描述后端当前阻塞等待的输入类型。**这是协议中最关键的字段**——
前端据此决定显示什么 UI 以及接受什么类型的输入。

#### 2.4.1 按键提示（getkey）

后端在 `nhgetch()` 或 `nh_poskey()` 处阻塞，等待一个按键或鼠标点击。

```json
{
  "prompt": {
    "type": "getkey",
    "poskey": true
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"getkey"` | 按键提示 |
| `poskey` | bool | 是否接受鼠标点击（true = nh_poskey，false = nhgetch） |

这是最常见的提示类型，覆盖主循环的命令输入、"--More--" 确认、方向选择等。

#### 2.4.2 是/否提示（yn）

后端在 `yn_function()` 处阻塞。

```json
{
  "prompt": {
    "type": "yn",
    "query": "Really quit?",
    "choices": "ynq",
    "default": "n"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"yn"` | 是/否提示 |
| `query` | string | 提示文字 |
| `choices` | string \| null | 有效字符集合，null 表示接受任意字符 |
| `default` | string | 默认选择（单字符） |

#### 2.4.3 文本输入提示（getlin）

后端在 `getlin()` 处阻塞。

```json
{
  "prompt": {
    "type": "getlin",
    "query": "What do you want to call this?"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"getlin"` | 文本输入提示 |
| `query` | string | 提示文字 |

#### 2.4.4 菜单提示（menu）

后端在 `select_menu()` 处阻塞。

```json
{
  "prompt": {
    "type": "menu",
    "window_id": 4,
    "how": "pick_one",
    "prompt_text": "Pick up what?",
    "items": [
      {
        "id": 1,
        "ch": "a",
        "group_ch": "",
        "text": "a long sword",
        "attr": 0,
        "color": 7,
        "preselected": false,
        "glyph": {
          "glyph": 1500,
          "ch": ")",
          "color": 7,
          "tileidx": 200
        }
      },
      {
        "id": 0,
        "ch": "",
        "group_ch": "",
        "text": "Weapons",
        "attr": 4,
        "color": 15,
        "preselected": false,
        "glyph": null
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"menu"` | 菜单提示 |
| `window_id` | int | 窗口 ID（用于响应） |
| `how` | string | 选择模式 |
| `prompt_text` | string \| null | 菜单顶部提示文字 |
| `items` | item[] | 菜单项列表 |

**how 取值**：

| 值 | 含义 |
|----|------|
| `"pick_none"` | 仅展示，不可选择（如帮助文本） |
| `"pick_one"` | 只能选一个 |
| `"pick_any"` | 可选多个 |

**item 对象**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int | 菜单项标识符（0 = 不可选的标题/分隔行） |
| `ch` | string | 快捷键字符（空字符串 = 自动分配） |
| `group_ch` | string | 分组加速键 |
| `text` | string | 显示文本 |
| `attr` | int | 文本属性（同消息的 attr） |
| `color` | int | 文本颜色 |
| `preselected` | bool | 是否预选中 |
| `glyph` | glyph_obj \| null | 关联图形（物品图标等） |

#### 2.4.5 扩展命令提示（ext_cmd）

后端在 `get_ext_cmd()` 处阻塞。

```json
{
  "prompt": {
    "type": "ext_cmd",
    "commands": [
      { "index": 0, "name": "adjust", "description": "adjust inventory letters" },
      { "index": 1, "name": "annotate", "description": "name current level" },
      { "index": 2, "name": "chat", "description": "talk to someone" }
    ]
  }
}
```

#### 2.4.6 阻塞显示提示（display_block）

后端在 `display_nhwindow(blocking=TRUE)` 处阻塞，等待用户确认。

```json
{
  "prompt": {
    "type": "display_block",
    "window_id": 5
  }
}
```

前端应显示"按任意键继续"，然后发送一个 `getkey` 类型的输入。

#### 2.4.7 角色选择提示（player_selection）

游戏启动时的角色创建流程。V1 可简化为预设角色。

```json
{
  "prompt": {
    "type": "player_selection",
    "phase": "role",
    "options": ["Valkyrie", "Wizard", "Rogue", "..."],
    "allow_random": true
  }
}
```

phase 依次为 `"role"` → `"race"` → `"gender"` → `"alignment"`。

#### 2.4.8 名字输入提示（askname）

```json
{
  "prompt": {
    "type": "askname"
  }
}
```

#### 2.4.9 游戏结束（game_over）

游戏结束时不再需要输入：

```json
{
  "prompt": {
    "type": "game_over",
    "tombstone": {
      "name": "Player",
      "how": "killed by a goblin",
      "score": 142,
      "turns": 523
    }
  }
}
```

---

### 2.5 事件（events）

特殊事件列表，按发生顺序排列。

```json
{
  "events": [
    { "type": "bell" },
    { "type": "delay", "ms": 50 },
    { "type": "delay", "ms": 50 },
    { "type": "raw_print", "text": "Strstrstr.", "bold": false },
    {
      "type": "file_display",
      "filename": "help",
      "content": "..."
    },
    {
      "type": "inventory_changed"
    }
  ]
}
```

| 事件类型 | 字段 | 说明 |
|----------|------|------|
| `bell` | 无 | 提示音 |
| `delay` | `ms` (int) | 延迟（用于动画，约 50ms/次） |
| `raw_print` | `text`, `bold` | 原始文本输出（窗口系统之外） |
| `file_display` | `filename`, `content` | 文件内容展示 |
| `inventory_changed` | 无 | 背包内容已变更（通知前端刷新） |
| `preference_update` | `pref` (string) | 选项设置变更 |
| `sync` | 无 | 同步标记（mark_synch/wait_synch） |

#### delay 事件的前端处理

`delay` 事件在弹道动画等场景中可能连续出现多次。前端有两种处理方式：
1. **顺序回放**：按 `ms` 间隔依次渲染中间帧（用户体验好但增加延迟）
2. **跳过延迟**：立即渲染最终帧（响应快但无动画效果）

建议 V1 先跳过延迟，后续版本实现动画回放。

---

### 2.6 窗口操作（windows）

窗口生命周期事件。

```json
{
  "windows": [
    { "action": "create", "id": 4, "type": "menu" },
    { "action": "clear", "id": 3 },
    { "action": "destroy", "id": 4 },
    {
      "action": "text",
      "id": 5,
      "lines": [
        { "text": "帮助标题", "attr": 1 },
        { "text": "这是帮助内容...", "attr": 0 }
      ]
    }
  ]
}
```

| action | 说明 |
|--------|------|
| `create` | 创建窗口（含 id 和 type） |
| `clear` | 清空窗口 |
| `destroy` | 销毁窗口 |
| `text` | 向窗口写入文本行（putstr 到非 MESSAGE 窗口） |

window type 取值：`"message"`, `"status"`, `"map"`, `"menu"`, `"text"`, `"perminvent"`

---

### 2.7 警告（warnings）

**兜底机制**：当后端收到协议未定义的 window_procs 调用时，
不得静默丢弃，必须记录到 warnings 中。

```json
{
  "warnings": [
    {
      "source": "win_putmixed",
      "message": "Unhandled putmixed call with embedded glyph",
      "args": { "window": 1, "attr": 0, "str": "\\GXXXXNNNN text" }
    },
    {
      "source": "win_outrip",
      "message": "Tombstone display not fully implemented",
      "args": { "how": 3 }
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `source` | string | 产生警告的 window_procs 函数名 |
| `message` | string | 人类可读的描述 |
| `args` | object | 调用参数的 JSON 表示（用于调试） |

前端应在开发模式下将 warnings 显示在控制台或 UI 中，方便定位未实现的功能。

---

## 三、请求结构（前端 → 后端）

所有输入通过 `POST /api/input` 发送。

### 3.1 按键输入

响应 `prompt.type == "getkey"` 或 `"display_block"`。

```json
{
  "type": "key",
  "value": 107
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `value` | int | ASCII 码。ESC = 27, Enter = 13 |

特殊键值：

| 键 | ASCII 值 | 说明 |
|----|----------|------|
| ESC | 27 | 取消 |
| Enter | 13 | 确认 |
| Space | 32 | 空格（常用于 More 确认） |
| Ctrl+A | 1 | 重复上一命令 |
| Ctrl+C | 3 | 退出 |
| Ctrl+P | 16 | 查看历史消息 |

### 3.2 鼠标点击

响应 `prompt.type == "getkey"` 且 `poskey == true`。

```json
{
  "type": "click",
  "x": 35,
  "y": 10,
  "button": 1
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `x` | int | 地图列坐标 |
| `y` | int | 地图行坐标 |
| `button` | int | 1 = 左键，2 = 右键 |

### 3.3 是/否回答

响应 `prompt.type == "yn"`。

```json
{
  "type": "yn",
  "value": "y"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `value` | string | 单字符回答 |

### 3.4 文本行输入

响应 `prompt.type == "getlin"` 或 `"askname"`。

```json
{
  "type": "line",
  "value": "Excalibur"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `value` | string | 输入文本。`"\033"` 或空字符串表示取消 |

### 3.5 菜单选择

响应 `prompt.type == "menu"`。

```json
{
  "type": "menu_select",
  "selections": [
    { "id": 1, "count": -1 },
    { "id": 3, "count": 5 }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `selections` | array | 选中项列表。空数组 = 无选择。`null` = 按 ESC 取消 |
| `selections[].id` | int | 菜单项的 id（对应 prompt 中的 item.id） |
| `selections[].count` | int | 选中数量。-1 = 全部 |

### 3.6 扩展命令选择

响应 `prompt.type == "ext_cmd"`。

```json
{
  "type": "ext_cmd",
  "index": 15
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `index` | int | 命令索引（对应 prompt 中的 commands[].index）。-1 = 取消 |

### 3.7 角色选择

响应 `prompt.type == "player_selection"`。

```json
{
  "type": "player_selection",
  "choice": "Valkyrie"
}
```

或选择随机：

```json
{
  "type": "player_selection",
  "choice": "random"
}
```

---

## 四、完整交互示例

### 4.1 游戏启动

```
GET /api/start
→ 200 {
    prompt: { type: "askname" }
  }

POST /api/input { type: "line", value: "Hero" }
→ 200 {
    prompt: { type: "player_selection", phase: "role", options: [...] }
  }

POST /api/input { type: "player_selection", choice: "Valkyrie" }
→ 200 {
    prompt: { type: "player_selection", phase: "race", options: [...] }
  }

... (gender, alignment) ...

POST /api/input { type: "player_selection", choice: "Neutral" }
→ 200 {
    map: { cells: [...] },
    status: { fields: {...}, conditions: {...} },
    messages: [{ text: "Hello Hero, welcome to NetHack!", attr: 0 }],
    prompt: { type: "getkey", poskey: true }
  }
```

### 4.2 普通回合

```
POST /api/input { type: "key", value: 106 }          // 'j' = 向下移动
→ 200 {
    map: { cells: [...changed cells...], cursor: {x:30, y:11} },
    status: { fields: { time: { value: "157", ... } } },
    messages: [],
    prompt: { type: "getkey", poskey: true }
  }
```

### 4.3 战斗

```
POST /api/input { type: "key", value: 108 }          // 'l' = 向右攻击怪物
→ 200 {
    map: { cells: [...] },
    status: { fields: { hp: { value: "13", percent: 81, ... }, time: ... } },
    messages: [
      { text: "You hit the goblin!", attr: 0 },
      { text: "The goblin hits you!", attr: 0 }
    ],
    prompt: { type: "getkey", poskey: true }
  }
```

### 4.4 打开背包

```
POST /api/input { type: "key", value: 105 }          // 'i' = 背包
→ 200 {
    prompt: {
      type: "menu",
      how: "pick_none",
      prompt_text: null,
      items: [
        { id: 0, text: "Weapons", attr: 4, ... },
        { id: 1, ch: "a", text: "a +0 long sword (weapon in hand)", ... },
        { id: 0, text: "Armor", attr: 4, ... },
        { id: 2, ch: "b", text: "an uncursed +0 small shield (being worn)", ... }
      ]
    }
  }

POST /api/input { type: "menu_select", selections: [] }  // ESC 关闭
→ 200 {
    prompt: { type: "getkey", poskey: true }
  }
```

### 4.5 拾取物品（多选菜单）

```
POST /api/input { type: "key", value: 44 }            // ',' = 拾取
→ 200 {
    prompt: {
      type: "menu",
      how: "pick_any",
      prompt_text: "Pick up what?",
      items: [
        { id: 1, ch: "a", text: "a dagger", ... },
        { id: 2, ch: "b", text: "3 gold pieces", ... }
      ]
    }
  }

POST /api/input {
  type: "menu_select",
  selections: [
    { id: 1, count: -1 },
    { id: 2, count: -1 }
  ]
}
→ 200 {
    map: { cells: [...] },
    messages: [
      { text: "You pick up a dagger.", attr: 0 },
      { text: "You pick up 3 gold pieces.", attr: 0 }
    ],
    events: [{ type: "inventory_changed" }],
    prompt: { type: "getkey", poskey: true }
  }
```

---

## 五、V1 实现范围

### 输出：完整实现

| 输出类型 | 状态 | 说明 |
|----------|------|------|
| 地图（全量） | V1 必需 | 双层 glyph（前景+背景） |
| 状态栏（全部 27 字段） | V1 必需 | 含 conditions |
| 消息 | V1 必需 | 含 attr |
| 菜单（完整四步流程） | V1 必需 | start → add → end → select |
| yn 提示 | V1 必需 | |
| getlin 提示 | V1 必需 | |
| ext_cmd 提示 | V1 必需 | |
| 事件（bell, delay, raw_print） | V1 必需 | |
| 窗口操作 | V1 必需 | create/clear/destroy/text |
| 警告兜底 | V1 必需 | 未实现的调用不得静默 |

### 输入：分阶段实现

| 输入类型 | 状态 | 说明 |
|----------|------|------|
| 按键（key） | V1 必需 | 覆盖所有命令 |
| 鼠标点击（click） | V1 可选 | poskey 支持 |
| yn 回答 | V1 必需 | |
| 文本行（line） | V1 必需 | |
| 菜单选择 | V1 必需 | |
| 扩展命令 | V1 必需 | |
| 角色选择 | V1 简化 | 可先用预设角色 |

### V1 不实现（后续版本）

- 增量地图更新
- 持久背包窗口（perminvent）
- 动画帧序列（delay 事件的顺序回放）
- 位置选择模式的特殊 UI（getpos）——V1 通过普通按键操作
- 选项配置 UI

---

## 六、颜色对照表

NetHack 使用 16 色终端色板：

| 索引 | 颜色 | 十六进制参考 |
|------|------|-------------|
| 0 | 黑色 | #000000 |
| 1 | 红色 | #AA0000 |
| 2 | 绿色 | #00AA00 |
| 3 | 棕色/暗黄 | #AA5500 |
| 4 | 蓝色 | #0000AA |
| 5 | 品红 | #AA00AA |
| 6 | 青色 | #00AAAA |
| 7 | 灰色 | #AAAAAA |
| 8 | 无色/默认 | — |
| 9 | 亮红 | #FF5555 |
| 10 | 亮绿 | #55FF55 |
| 11 | 黄色 | #FFFF55 |
| 12 | 亮蓝 | #5555FF |
| 13 | 亮品红 | #FF55FF |
| 14 | 亮青 | #55FFFF |
| 15 | 白色 | #FFFFFF |

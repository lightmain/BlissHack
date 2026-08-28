# NetHack window_procs 接口完整分析

本文档对 NetHack 5.0 的 `window_procs` 接口进行全面分析，作为 RemoteHack JSON HTTP API 协议设计的直接参考。

---

## 一、整体架构

### 1.1 接口定义位置

- 结构体定义：`include/winprocs.h`
- 窗口类型定义：`include/wintype.h`
- 状态栏字段定义：`include/botl.h`
- TTY 参考实现：`win/tty/wintty.c`
- 最小存根实现：`win/shim/winshim.c`
- HTTP 存根实现：`win/http/winhttp.c`

### 1.2 窗口类型（NHW_*）

| 常量 | 值 | 用途 |
|------|---|------|
| `NHW_MESSAGE` | 1 | 消息窗口，显示游戏文本消息（如"You hit the goblin"） |
| `NHW_STATUS` | 2 | 状态栏窗口，显示HP、属性、条件等 |
| `NHW_MAP` | 3 | 地图窗口，80x21格子的迷宫显示 |
| `NHW_MENU` | 4 | 菜单窗口，用于物品选择、命令列表等 |
| `NHW_TEXT` | 5 | 文本窗口，用于帮助文本、信息展示 |
| `NHW_PERMINVENT` | 6 | 持久背包窗口 |

### 1.3 地图尺寸

- `COLNO` = 80（列数）
- `ROWNO` = 21（行数）

### 1.4 游戏循环核心模式

NetHack 的游戏循环本质上是**阻塞式的请求-响应模型**：
1. 游戏核心处理逻辑，产生输出（通过 window_procs 的 OUTPUT 函数）
2. 游戏核心调用输入函数（如 `nhgetch`/`nh_poskey`），阻塞等待玩家输入
3. 收到输入后返回第1步

这与 HTTP 请求-响应模型天然吻合。

---

## 二、输出通道（游戏核心→前端显示）

### 2.1 地图输出（Map Output）

#### print_glyph

```c
void (*win_print_glyph)(winid window, coordxy x, coordxy y,
                         const glyph_info *glyphinfo,
                         const glyph_info *bkglyphinfo);
```

**功能**：在地图指定坐标绘制一个图形符号。

**调用频率**：每次 `flush_screen()` 时对所有改变的格子调用，即每回合多次。

**参数详解**：

- `window`：目标窗口ID（通常为 WIN_MAP）
- `x, y`：地图坐标（x: 1~79, y: 0~20）
- `glyphinfo`：前景图形信息（怪物、物品、地形等）
- `bkglyphinfo`：背景图形信息（地面、特殊标记框色）

**glyph_info 结构体**（定义在 `include/wintype.h`）：

```c
typedef struct glyphinfo {
    int glyph;            /* 唯一图形标识符（用于 tile 索引） */
    int ttychar;          /* ASCII 显示字符 */
    uint32 framecolor;    /* 边框/背景色 */
    glyph_map gm;        /* 详细映射信息 */
} glyph_info;
```

**glyph_map 结构体**：

```c
typedef struct glyph_map_entry {
    unsigned glyphflags;           /* 特殊标志位 */
    struct classic_representation sym;  /* 颜色+符号索引 */
    uint32 customcolor;            /* 自定义颜色 */
    uint16 color256idx;            /* 256色索引 */
    short int tileidx;             /* tile图块索引 */
} glyph_map;
```

**glyphflags 标志位**（定义在 `include/display.h`）：

| 标志 | 值 | 含义 |
|------|---|------|
| `MG_HERO` | 0x00001 | 代表英雄角色 |
| `MG_CORPSE` | 0x00002 | 代表尸体 |
| `MG_INVIS` | 0x00004 | 代表隐形怪物 |
| `MG_DETECT` | 0x00008 | 代表被侦测到的怪物 |
| `MG_PET` | 0x00010 | 代表宠物 |
| `MG_RIDDEN` | 0x00020 | 代表被骑乘的怪物 |
| `MG_STATUE` | 0x00040 | 代表雕像 |
| `MG_OBJPILE` | 0x00080 | 代表物品堆 |
| `MG_BW_LAVA` | 0x00100 | 高亮岩浆 |
| `MG_BW_ICE` | 0x00200 | 高亮冰面 |
| `MG_NOTHING` | 0x00400 | 代表"无" |
| `MG_UNEXPL` | 0x00800 | 代表未探索区域 |
| `MG_MALE` | 0x01000 | 雄性怪物/雕像 |
| `MG_FEMALE` | 0x02000 | 雌性怪物/雕像 |

**对 JSON API 的意义**：

前端需要同时获取**前景**（怪物/物品）和**背景**（地面）信息。这是 RemoteHack 改进方案中"同时显示怪物和脚下地面"的核心数据来源。

#### cliparound

```c
void (*win_cliparound)(int x, int y);
```

**功能**：提示窗口端以指定坐标为中心进行视口裁剪（用于大地图的滚动）。

**调用频率**：英雄移动时调用。

#### display_nhwindow (MAP)

```c
void (*win_display_nhwindow)(winid window, boolean blocking);
```

**功能**：刷新指定窗口的显示。对地图窗口来说，表示本帧地图更新完成。

**调用频率**：每次 `flush_screen()` 末尾调用。

---

### 2.2 状态栏输出（Status Output）

#### status_init

```c
void (*win_status_init)(void);
```

**功能**：初始化状态栏系统。只在游戏启动时调用一次。

#### status_enablefield

```c
void (*win_status_enablefield)(int fieldidx, const char *nm,
                                const char *fmt, boolean enable);
```

**功能**：启用/禁用某个状态字段，告知窗口端该字段是否有效。

**调用频率**：启动时和选项变更时。

#### status_update

```c
void (*win_status_update)(int fldidx, genericptr_t ptr, int chg,
                           int percent, int color, unsigned long *colormasks);
```

**功能**：更新状态栏的一个字段值。这是状态栏的核心数据推送函数。

**调用频率**：每回合调用多次（每个变化的字段调用一次，最后以 BL_FLUSH 结束）。

**参数详解**：

- `fldidx`：字段索引（见下表），特殊值 BL_FLUSH(-1) 表示刷新、BL_RESET(-2) 表示重绘全部
- `ptr`：字段值指针，对大多数字段是 `char*`（已格式化文本），对 BL_CONDITION 是 `unsigned long*`（位掩码）
- `chg`：变化方向（0=无变化, 1=增加, -1=减少, 2=强制重绘）
- `percent`：百分比值（如HP百分比，-1表示不适用）
- `color`：高亮颜色（低8位为颜色索引，高8位为属性掩码）
- `colormasks`：条件着色掩码数组（仅 BL_CONDITION 使用）

**全部状态字段（BL_* 枚举，定义在 `include/botl.h`）**：

| 索引 | 枚举名 | 字段名 | 数据类型 | 格式 | 说明 |
|------|--------|--------|---------|------|------|
| 0 | BL_TITLE | title | ANY_STR | "%s" | 玩家名+称号（如"Player the Valkyrie"） |
| 1 | BL_STR | strength | ANY_INT | "St:%s" | 力量（特殊格式如"18/**"） |
| 2 | BL_DX | dexterity | ANY_INT | "Dx:%s" | 敏捷 |
| 3 | BL_CO | constitution | ANY_INT | "Co:%s" | 体质 |
| 4 | BL_IN | intelligence | ANY_INT | "In:%s" | 智力 |
| 5 | BL_WI | wisdom | ANY_INT | "Wi:%s" | 感知 |
| 6 | BL_CH | charisma | ANY_INT | "Ch:%s" | 魅力 |
| 7 | BL_ALIGN | alignment | ANY_STR | "%s" | 阵营（Lawful/Neutral/Chaotic） |
| 8 | BL_SCORE | score | ANY_LONG | "S:%s" | 分数 |
| 9 | BL_CAP | carrying-capacity | ANY_INT | "%s" | 负重（Burdened/Stressed/...） |
| 10 | BL_GOLD | gold | ANY_LONG | "%s" | 金币（格式"$:数量"） |
| 11 | BL_ENE | power | ANY_INT | "Pw:%s" | 当前魔力 |
| 12 | BL_ENEMAX | power-max | ANY_INT | "(%s)" | 最大魔力 |
| 13 | BL_XP | experience-level | ANY_INT | "Xp:%s" | 经验等级 |
| 14 | BL_AC | armor-class | ANY_INT | "AC:%s" | 护甲等级 |
| 15 | BL_HD | HD | ANY_INT | "HD:%s" | 怪物等级（变身时） |
| 16 | BL_TIME | time | ANY_LONG | "T:%s" | 游戏回合数 |
| 17 | BL_HUNGER | hunger | ANY_INT | "%s" | 饥饿状态 |
| 18 | BL_HP | hitpoints | ANY_INT | "HP:%s" | 当前生命 |
| 19 | BL_HPMAX | hitpoints-max | ANY_INT | "(%s)" | 最大生命 |
| 20 | BL_LEVELDESC | dungeon-level | ANY_STR | "%s" | 地下城层级描述 |
| 21 | BL_EXP | experience | ANY_LONG | "/%s" | 经验值 |
| 22 | BL_CONDITION | condition | ANY_MASK32 | "%s" | 状态条件位掩码 |
| 23 | BL_WEAPON | weapon | ANY_STR | "%s" | 武器状态（可选） |
| 24 | BL_ARMOR | armor | ANY_STR | "%s" | 护甲状态（可选） |
| 25 | BL_TERRAIN | terrain | ANY_STR | "%s" | 地形状态（可选） |
| 26 | BL_VERS | version | ANY_STR | "%s" | 版本信息（可选） |

**BL_CONDITION 位掩码详解（30个条件）**：

| 位掩码 | 条件标识 | 全文 | 含义 |
|--------|---------|------|------|
| 0x00000001 | bl_bareh | Bare | 赤手空拳 |
| 0x00000002 | bl_blind | Blind | 失明 |
| 0x00000004 | bl_busy | Busy | 忙碌（多回合动作中） |
| 0x00000008 | bl_conf | Conf | 混乱 |
| 0x00000010 | bl_deaf | Deaf | 耳聋 |
| 0x00000020 | bl_elf_iron | Iron | 精灵接触铁器 |
| 0x00000040 | bl_fly | Fly | 飞行中 |
| 0x00000080 | bl_foodpois | FoodPois | 食物中毒 |
| 0x00000100 | bl_glowhands | Glow | 手部发光 |
| 0x00000200 | bl_grab | Grab | 被抓取（即将溺水） |
| 0x00000400 | bl_hallu | Hallu | 幻觉 |
| 0x00000800 | bl_held | Held | 被抓住 |
| 0x00001000 | bl_icy | Icy | 站在冰面上 |
| 0x00002000 | bl_inlava | InLava | 陷入岩浆 |
| 0x00004000 | bl_lev | Lev | 漂浮 |
| 0x00008000 | bl_parlyz | Parlyz | 麻痹 |
| 0x00010000 | bl_ride | Ride | 骑乘中 |
| 0x00020000 | bl_sleeping | Zzz | 睡眠中 |
| 0x00040000 | bl_slime | Slime | 被粘液感染 |
| 0x00080000 | bl_slippery | Slip | 手滑 |
| 0x00100000 | bl_stone | Stone | 石化中 |
| 0x00200000 | bl_strngl | Strngl | 被勒颈 |
| 0x00400000 | bl_stun | Stun | 眩晕 |
| 0x00800000 | bl_submerged | Submrg | 水下 |
| 0x01000000 | bl_termill | TermIll | 绝症 |
| 0x02000000 | bl_tethered | Teth | 被铁球拴住 |
| 0x04000000 | bl_trapped | Trap | 被困 |
| 0x08000000 | bl_unconsc | Out | 昏迷 |
| 0x10000000 | bl_woundedl | WLegs | 腿伤 |
| 0x20000000 | bl_holding | UHold | 英雄抓住怪物 |

---

### 2.3 消息输出（Message Output）

#### putstr

```c
void (*win_putstr)(winid window, int attr, const char *str);
```

**功能**：向指定窗口输出一行文本字符串。这是 NetHack 最核心的文本输出函数。

**调用频率**：极其频繁，每回合可能多次。

**参数详解**：

- `window`：目标窗口ID
  - `WIN_MESSAGE` → 消息栏（如"You hit the goblin."）
  - `NHW_MENU/NHW_TEXT` 窗口 → 菜单/文本内容行
- `attr`：文本属性（可组合）

| 属性常量 | 值 | 含义 |
|---------|---|------|
| ATR_NONE | 0 | 无特殊属性 |
| ATR_BOLD | 1 | 粗体 |
| ATR_DIM | 2 | 暗淡 |
| ATR_ITALIC | 3 | 斜体 |
| ATR_ULINE | 4 | 下划线 |
| ATR_BLINK | 5 | 闪烁 |
| ATR_INVERSE | 7 | 反色 |
| ATR_URGENT | 16 | 紧急（可与上述组合） |
| ATR_NOHISTORY | 32 | 不记入消息历史 |

- `str`：文本内容

#### putmixed

```c
void (*win_putmixed)(winid window, int attr, const char *str);
```

**功能**：类似 putstr，但字符串中可能嵌入编码的图形符号（`\GXXXXNNNN` 格式）。

#### raw_print / raw_print_bold

```c
void (*win_raw_print)(const char *str);
void (*win_raw_print_bold)(const char *str);
```

**功能**：在窗口系统初始化前或出错时输出原始文本。不依赖窗口ID。

**调用频率**：极少，仅在启动/崩溃时。

#### getmsghistory / putmsghistory

```c
char *(*win_getmsghistory)(boolean init);
void (*win_putmsghistory)(const char *msg, boolean restoring);
```

**功能**：获取/恢复消息历史记录。用于游戏存档恢复时重建消息窗口。

---

### 2.4 菜单系统输出（Menu Output）

菜单系统使用四步流程：start_menu → add_menu（多次）→ end_menu → select_menu。

#### start_menu

```c
void (*win_start_menu)(winid window, unsigned long mbehavior);
```

**功能**：开始构建一个菜单。

**参数**：
- `window`：菜单窗口ID
- `mbehavior`：行为标志
  - `MENU_BEHAVE_STANDARD` (0) - 普通菜单
  - `MENU_BEHAVE_PERMINV` (1) - 持久背包菜单

#### add_menu

```c
void (*win_add_menu)(winid window, const glyph_info *glyphinfo,
                     const ANY_P *identifier, char ch, char gch,
                     int attr, int clr, const char *str,
                     unsigned int itemflags);
```

**功能**：向菜单添加一个条目。

**参数详解**：

- `window`：菜单窗口ID
- `glyphinfo`：菜单项关联的图形（如物品图标），可为空
- `identifier`：菜单项标识符（返回选择结果时使用）。若为 null/zero 则为不可选标题行
- `ch`：选择快捷键（如 'a', 'b'...），0表示自动分配
- `gch`：分组加速键（如按类别分组），0表示无分组
- `attr`：文本属性（同 putstr 的 attr）
- `clr`：文本颜色
- `str`：菜单项文本
- `itemflags`：标志位
  - `MENU_ITEMFLAGS_SELECTED` (0x01) - 预选中
  - `MENU_ITEMFLAGS_SKIPINVERT` (0x02) - 全选/反选时跳过
  - `MENU_ITEMFLAGS_SKIPMENUCOLORS` (0x04) - 跳过菜单颜色规则

#### end_menu

```c
void (*win_end_menu)(winid window, const char *prompt);
```

**功能**：结束菜单构建，设置菜单提示语。

**参数**：
- `prompt`：显示在菜单顶部的提示文字（如"Pick up what?"）

#### select_menu

```c
int (*win_select_menu)(winid window, int how, MENU_ITEM_P **menu_list);
```

**功能**：显示菜单并等待用户选择。**注意：此函数既是输出也是输入**。

**参数**：
- `how`：选择模式
  - `PICK_NONE` (0) - 仅显示，不可选择
  - `PICK_ONE` (1) - 只能选一个
  - `PICK_ANY` (2) - 可选多个
- `menu_list`：输出参数，返回选中项数组

**返回值**：选中的数目（-1=取消，0=无选择）

**返回的 menu_item 结构**：
```c
typedef struct mi {
    anything item;     /* 选中项的标识符 */
    long count;        /* 选中数量（-1=全部） */
    unsigned itemflags;
} menu_item;
```

#### message_menu

```c
char (*win_message_menu)(char let, int how, const char *mesg);
```

**功能**：在消息行显示一个简单菜单（如"--More--"提示）。

---

### 2.5 窗口管理输出

#### create_nhwindow

```c
winid (*win_create_nhwindow)(int type);
```

**功能**：创建一个指定类型的窗口，返回窗口ID。

**参数**：`type` - NHW_MESSAGE / NHW_STATUS / NHW_MAP / NHW_MENU / NHW_TEXT

#### clear_nhwindow

```c
void (*win_clear_nhwindow)(winid window);
```

**功能**：清空窗口内容。

#### display_nhwindow

```c
void (*win_display_nhwindow)(winid window, boolean blocking);
```

**功能**：显示/刷新窗口。

**参数**：
- `blocking`：若为 TRUE，等待用户确认（如"--More--"），此时既是输出也是输入。

#### destroy_nhwindow

```c
void (*win_destroy_nhwindow)(winid window);
```

**功能**：销毁窗口。

#### curs

```c
void (*win_curs)(winid window, int x, int y);
```

**功能**：在指定窗口移动光标位置。

---

### 2.6 特殊输出

#### display_file

```c
void (*win_display_file)(const char *fname, boolean complain);
```

**功能**：显示一个文件内容（如帮助文件）。

#### outrip

```c
void (*win_outrip)(winid tmpwin, int how, time_t when);
```

**功能**：显示死亡画面/墓碑。

**参数**：
- `how`：死亡方式
- `when`：死亡时间

#### nhbell

```c
void (*win_nhbell)(void);
```

**功能**：发出提示音。

#### delay_output

```c
void (*win_delay_output)(void);
```

**功能**：短暂延迟（约50ms），用于动画效果（如弹道显示）。

**调用频率**：动画序列中多次调用。

#### mark_synch / wait_synch

```c
void (*win_mark_synch)(void);
void (*win_wait_synch)(void);
```

**功能**：同步标记，确保所有待刷新内容已显示。

#### preference_update

```c
void (*win_preference_update)(const char *pref);
```

**功能**：通知窗口端某个选项设置已更改。

#### update_inventory

```c
void (*win_update_inventory)(int arg);
```

**功能**：通知窗口端背包内容已变更，需要刷新持久背包窗口。

**调用频率**：任何物品变更时（拾取、丢弃、使用等）。

#### ctrl_nhwindow

```c
win_request_info *(*win_ctrl_nhwindow)(winid window, int request,
                                        win_request_info *wri);
```

**功能**：窗口控制/查询接口，用于双向配置信息交换。

**请求类型**（`enum from_core_requests`）：
- `set_mode` (1) - 设置模式（如持久背包显示模式）
- `request_settings` (2) - 请求窗口端能力设置
- `set_menu_promptstyle` (3) - 设置菜单提示样式

**返回的信息**（`struct to_core`）：
- `tocore_flags`：窗口端状态标志（active, too_small, prohibited, etc.）
- `maxslot`：最大显示槽位数
- `needrows/needcols`：需要的行数/列数
- `haverows/havecols`：拥有的行数/列数

---

## 三、输入通道（前端→游戏核心）

### 3.1 按键输入

#### nhgetch

```c
int (*win_nhgetch)(void);
```

**功能**：获取一个字符输入。阻塞等待直到用户按键。

**返回值**：按键的 ASCII 码（或 ESC = 27 表示取消）。

**调用场景**：
- 读取命令（如 'h'=左移, 'k'=上移, 'i'=打开背包）
- "--More--" 确认
- 各种单字符提示

#### nh_poskey

```c
int (*win_nh_poskey)(coordxy *x, coordxy *y, int *mod);
```

**功能**：获取按键输入或鼠标点击。这是主要的输入入口点。

**返回值**：
- 非零：按键字符（与 nhgetch 相同）
- 零：鼠标点击事件，通过 x, y, mod 输出参数返回位置和按钮

**鼠标修饰符（mod）**：
- `CLICK_1` (1) - 左键点击
- `CLICK_2` (2) - 右键点击

**调用频率**：这是游戏主循环的核心等待点，每回合至少调用一次。

---

### 3.2 Yes/No 提示输入

#### yn_function

```c
char (*win_yn_function)(const char *query, const char *resp, char def);
```

**功能**：显示是/否问题并等待单字符回答。

**参数**：
- `query`：提示文字（如 "Really quit?"）
- `resp`：有效响应字符集（如 "ynq"）。NULL 表示接受任何字符
- `def`：默认选择（用户按 Enter/Space 时使用）

**返回值**：用户输入的字符。

**调用场景举例**：
- "Really quit? [yn]" → resp="yn", def='n'
- "What do you want to use or apply? [a-zA-Z?*]" → resp包含有效选项
- "In what direction?" → resp=NULL（接受方向键）

---

### 3.3 文本行输入

#### getlin

```c
void (*win_getlin)(const char *prompt, char *outbuf);
```

**功能**：显示提示并获取一行文本输入。

**参数**：
- `prompt`：提示文字（如 "What do you want to call this?"）
- `outbuf`：输出缓冲区（最大 BUFSZ=256 字符）

**特殊返回**：若用户按 ESC 取消，outbuf 包含 "\033"。

**调用场景**：
- 命名物品/宠物
- 刻字
- 搜索文本

---

### 3.4 扩展命令输入

#### get_ext_cmd

```c
int (*win_get_ext_cmd)(void);
```

**功能**：获取扩展命令（'#' 前缀命令）的选择。

**返回值**：命令在 extcmdlist 数组中的索引，-1 表示取消。

**调用场景**：用户按 '#' 后，选择诸如 "#pray", "#dip", "#ride" 等扩展命令。

---

### 3.5 菜单选择输入

`select_menu` 既是输出也是输入，见第 2.4 节。

---

### 3.6 上翻消息

#### doprev_message

```c
int (*win_doprev_message)(void);
```

**功能**：向上翻看之前的消息（Ctrl+P 功能）。

---

## 四、生命周期/初始化函数

### 4.1 系统初始化

#### init_nhwindows

```c
void (*win_init_nhwindows)(int *argcp, char **argv);
```

**功能**：初始化窗口系统。程序启动时调用一次。

#### player_selection

```c
void (*win_player_selection)(void);
```

**功能**：处理玩家角色选择（种族、职业、性别、阵营）。

#### askname

```c
void (*win_askname)(void);
```

**功能**：询问玩家角色名字。

#### exit_nhwindows

```c
void (*win_exit_nhwindows)(const char *str);
```

**功能**：关闭窗口系统。`str` 可能是退出消息。

#### suspend_nhwindows / resume_nhwindows

```c
void (*win_suspend_nhwindows)(const char *str);
void (*win_resume_nhwindows)(void);
```

**功能**：挂起/恢复窗口系统（如 Unix 的 Ctrl+Z）。

#### get_nh_event

```c
void (*win_get_nh_event)(void);
```

**功能**：处理异步窗口事件（如窗口大小变化）。

#### number_pad

```c
void (*win_number_pad)(int state);
```

**功能**：通知窗口端数字键盘模式状态变更。

#### can_suspend

```c
boolean (*win_can_suspend)(void);
```

**功能**：查询是否支持挂起操作。

---

## 五、按功能分组的 JSON API 设计建议

### 5.1 输出消息（游戏→前端），通过 HTTP 响应返回

#### 地图更新组

```
map_update: {
    cells: [{
        x, y,
        foreground: { glyph, ttychar, color, flags, tileidx, customcolor },
        background: { glyph, ttychar, color, flags, tileidx, framecolor }
    }, ...],
    cursor: { x, y }  // cliparound 位置
}
```

**触发时机**：每次 flush_screen()
**频率**：每回合

#### 状态栏更新组

```
status_update: {
    fields: {
        title: { value, color, attr },
        str: { value, color, attr },
        hp: { value, max, percent, color, attr },
        ...
    },
    conditions: {
        mask: 0x...,       // 原始位掩码
        active: ["blind", "conf", ...]  // 活跃条件列表
    }
}
```

**触发时机**：BL_FLUSH 到达时
**频率**：每回合

#### 消息组

```
messages: [{
    text: "You hit the goblin.",
    attr: 0,
    turn: 12345,
    urgent: false,
    no_history: false
}, ...]
```

**触发时机**：每次 putstr(WIN_MESSAGE)
**频率**：每回合多条

#### 菜单/提示组

```
prompt: {
    type: "menu" | "yn" | "getlin" | "ext_cmd" | "direction",
    // 对于 menu:
    menu: {
        prompt: "Pick up what?",
        how: "pick_any",
        items: [{
            id: ...,
            ch: "a",
            gch: "",
            text: "a long sword",
            glyph: {...},
            attr: 0,
            color: 7,
            preselected: false
        }, ...]
    },
    // 对于 yn:
    yn: { query: "Really quit?", choices: "yn", default: "n" },
    // 对于 getlin:
    getlin: { prompt: "What do you want to call this?" },
    // 对于 ext_cmd:
    ext_cmd: { commands: ["pray", "dip", "ride", ...] }
}
```

#### 特殊事件组

```
events: {
    bell: true,
    delay: 50,        // 延迟毫秒
    game_over: { how: ..., tombstone: {...} },
    file_display: { filename: "...", content: "..." }
}
```

### 5.2 输入消息（前端→游戏），通过 HTTP 请求发送

#### 按键输入

```
{ type: "key", value: 107 }  // ASCII 码
```

响应 `nhgetch` 和 `nh_poskey`（按键模式）。

#### 鼠标点击输入

```
{ type: "click", x: 35, y: 10, button: 1 }
```

响应 `nh_poskey`（鼠标模式）。

#### Yes/No 回答

```
{ type: "yn", value: "y" }
```

响应 `yn_function`。

#### 文本行输入

```
{ type: "line", value: "Excalibur" }
```

响应 `getlin`。特殊值 "\033" 表示取消。

#### 菜单选择

```
{ type: "menu_select", items: [
    { id: ..., count: -1 },
    { id: ..., count: 5 }
] }
```

响应 `select_menu`。空数组表示取消。

#### 扩展命令选择

```
{ type: "ext_cmd", index: 15 }
```

响应 `get_ext_cmd`。-1 表示取消。

---

## 六、调用频率与性能分析

| 函数 | 调用频率 | 对 API 的影响 |
|------|---------|--------------|
| print_glyph | 每帧0~1680次（最大80x21） | 应批量传输，增量更新 |
| status_update | 每回合约5~27次（加BL_FLUSH） | 一次刷新合并所有字段 |
| putstr(MESSAGE) | 每回合0~10次 | 累积后一起返回 |
| nhgetch/nh_poskey | 每回合1次（主循环等待点） | HTTP 请求的自然时机 |
| select_menu | 特定操作时 | 单独的请求-响应周期 |
| yn_function | 特定操作时 | 单独的请求-响应周期 |
| delay_output | 动画时连续多次 | 需要特殊处理（批量或跳过） |
| update_inventory | 物品变更时 | 可与回合更新合并 |

---

## 七、HTTP 交互模型建议

### 核心原则

1. **一问一答**：游戏每次需要输入时暂停，等待 HTTP 请求带来输入。
2. **响应携带全部累积输出**：每次 HTTP 响应包含从上次输入到本次等待之间的所有输出。
3. **增量更新**：地图只传输变化的格子，状态栏只传输变化的字段。

### 交互流程

```
前端 → POST /input {type: "key", value: 107}
后端 ← 200 OK {
    map: { cells: [...changed...], cursor: {x,y} },
    status: { fields: {...changed...}, conditions: {...} },
    messages: [...new messages...],
    prompt: null | { type: "yn", ... },
    events: { delay_count: 3 }
}
```

### 特殊情况处理

1. **游戏初始化**：`player_selection` 和 `askname` 需要多轮交互，可设计为特殊的初始化流程。
2. **delay_output**：在动画序列中多次调用，可选择：(a) 在响应中返回延迟标记让前端处理；(b) 服务端累积后一次性返回完整动画帧序列。
3. **嵌套输入**：某些操作在处理过程中会触发新的输入请求（如打开菜单后需要 nhgetch），需要支持重入式交互。
4. **display_nhwindow(blocking=TRUE)**：需要等待用户确认，等同于一次输入请求。

---

## 八、需要特别注意的设计点

### 8.1 前景与背景分离

`print_glyph` 的双参数设计（`glyphinfo` + `bkglyphinfo`）天然支持 RemoteHack 的"同时显示怪物和地面"需求。前端可以直接利用这两层信息进行渲染。

### 8.2 状态栏的分字段更新

status_update 是逐字段推送的，最后以 BL_FLUSH 触发刷新。JSON API 应在 BL_FLUSH 时汇总所有变更字段一次性发送。

### 8.3 菜单的完整性

菜单数据（add_menu 的参数）包含图形信息、快捷键、分组键、颜色、属性、预选状态——足够前端进行完整的 UI 渲染。

### 8.4 输入的多样性

游戏核心可能在任何时候请求不同类型的输入。前端需要明确知道当前等待的输入类型：
- 普通按键（nhgetch/nh_poskey）
- 是/否选择（yn_function）
- 文本行（getlin）
- 菜单选择（select_menu）
- 扩展命令（get_ext_cmd）
- 方向选择（通过 yn_function 或 nhgetch 实现）

响应中的 `prompt` 字段应明确标记输入类型及其参数。

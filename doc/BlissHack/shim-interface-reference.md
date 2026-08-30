# Shim Graphics 接口完整参考文档

> 本文档是 BlissHack 项目的核心技术参考，面向从未接触过 WASM 开发的前端工程师。
> 源码版本：NetHack 5.0 (`win/shim/winshim.c`, `sys/libnh/libnhmain.c`)

---

## 目录

1. [概述](#1-概述)
2. [所有 Shim 回调接口详解](#2-所有-shim-回调接口详解)
3. [WASM 与 Module 内存机制](#3-wasm-与-module-内存机制)
4. [回调注册机制](#4-回调注册机制)
5. [全局变量暴露](#5-全局变量暴露)
6. [附录：类型速查表](#6-附录类型速查表)

---

## 1. 概述

### 1.1 什么是 shim_graphics

`shim_graphics` 是 NetHack 5.0 官方提供的一种**伪窗口端口**（fake window port）。它不是一个真正的图形界面实现（如 tty、curses、X11、Qt），而是一个**中间层 / 适配器**：把 NetHack 游戏核心对窗口系统的所有调用，统一转化为**回调事件**，转发给外部消费者。

它存在于 `win/shim/winshim.c`，只有 325 行代码，是所有窗口端口中最简单的一个。

### 1.2 为什么需要它

NetHack 的架构是：游戏核心（C 代码）通过 `window_procs` 结构体中的函数指针来与界面通信。每种界面（tty、curses、X11 等）都实现这些函数指针，把游戏事件渲染到各自的图形系统上。

但如果你想在**浏览器**中运行 NetHack，就不能使用这些传统界面——浏览器没有 ncurses，没有 X11。`shim_graphics` 的做法是：

- 它实现了 `window_procs` 的所有函数指针
- 每个函数被调用时，不做任何渲染，而是把**函数名、参数、返回值指针**统一转发给一个外部回调
- 在 WASM 构建中，这个外部回调就是 TypeScript 函数（编译为 JavaScript 后由 Emscripten 调用）

这样，C 代码完全不需要修改，所有渲染逻辑都由 TypeScript 侧接管。

### 1.3 与 tty/curses/X11 的区别

| 特性 | tty/curses | X11/Qt | shim_graphics |
|------|-----------|--------|---------------|
| 渲染在哪里 | 终端 | X Window/Qt 窗口 | 不渲染，转发事件 |
| 实现语言 | C | C/C++ | C（桥接到 JS） |
| 代码量 | 数千行 | 上万行 | ~325 行 |
| 目标用途 | 直接使用 | 直接使用 | 作为 API 暴露给外部 |
| 构建目标 | 原生可执行文件 | 原生可执行文件 | WASM 模块 / .a 静态库 |

### 1.4 shim 声明的窗口能力

`shim_procs` 在注册时声明了以下能力标志（`wincap` / `wincap2`）：

**wincap（第一组能力）：**
- `WC_ASCII_MAP` — 支持 ASCII 字符地图
- `WC_MOUSE_SUPPORT` — 支持鼠标输入
- `WC_COLOR` — 支持颜色显示
- `WC_HILITE_PET` — 支持宠物高亮
- `WC_INVERSE` — 支持反色显示
- `WC_EIGHT_BIT_IN` — 支持 8 位字符输入

**wincap2（第二组能力）：**
- `WC2_SELECTSAVED` — 支持存档选择菜单
- `WC2_HILITE_STATUS` — 支持状态行高亮
- `WC2_HITPOINTBAR` — 支持生命值条
- `WC2_FLUSH_STATUS` — 支持状态刷新调用
- `WC2_RESET_STATUS` — 支持状态重置调用
- `WC2_DARKGRAY` — 支持深灰色（加粗黑色）
- `WC2_SUPPRESS_HIST` — 支持抑制消息历史（前端完全控制消息显示，核心不强制 `--More--`）
- `WC2_STATUSLINES` — 支持切换 2/3 行状态显示

### 1.5 架构总览

```
NetHack C 游戏核心
    ↓  调用 window_procs 中的函数指针
win/shim/winshim.c  (shim_procs)
    ↓  DECLCB / VDECLCB 宏
    ↓  调用 local_callback()
EM_JS(local_callback)  [C→JS 桥接]
    ↓  Asyncify.handleSleep() 包裹
    ↓  解析 fmt 字符串，将 WASM 指针参数转为 JS 值
    ↓  调用 globalThis[cbName](name, ...jsArgs)
TypeScript 回调函数 (nethack-bridge.ts)
    ↓  处理事件，返回 Promise
    ↓  通过 setPointerValue 写回返回值
    ↓  调用 wakeUp() 恢复 C 执行流
```

---

## 2. 所有 Shim 回调接口详解

### 2.1 格式字符串（fmt）约定

每个回调都有一个格式字符串（如 `"vib"`、`"iiip"`），由 `DECLCB` / `VDECLCB` 宏传递给 `local_callback`。

**第一个字符是返回值类型**，其余字符是参数类型，从左到右对应参数列表。

| 字符 | 含义 | C 类型 | JS 类型 | 说明 |
|------|------|--------|---------|------|
| `v` | void | void | undefined | 无返回值 / 无参数 |
| `i` | integer | int / winid / coordxy | number (整数) | 32 位整数 |
| `s` | string | const char * | string | C 字符串，桥接层自动调用 UTF8ToString |
| `p` | pointer | void * / struct * | number (地址) | WASM 线性内存中的地址 |
| `b` | boolean | boolean (实际 i8) | boolean | 0=false, 1=true |
| `c` | char | char | number (ASCII) | 返回时是 ASCII 码数字 |
| `0` | byte | int8 | number | 2^0 = 1 字节 |
| `1` | short | int16 | number | 2^1 = 2 字节 |
| `2` | int32 | int32 | number | 2^2 = 4 字节（等同 `i`）|
| `f` | float | float | number | 浮点数 |
| `d` | double | double | number | 双精度浮点 |
| `n` | number | int | number | 等同 `i` |

**DECLCB 和 VDECLCB 的区别：**
- `VDECLCB` — 声明返回 `void` 的回调，`ret_ptr` 传 `NULL` 给 `local_callback`，JS 侧无需返回有意义的值
- `DECLCB` — 声明有返回值的回调，`ret_ptr` 指向返回值存储位置，JS 侧的 Promise resolve 值会通过 `setPointerValue` 写回

### 2.2 参数传递宏

```c
#define A2P &    /* Argument to Pointer — 取地址，用于值类型参数 */
#define P2V (void *)  /* Pointer to Void — 强制转换，用于本身就是指针的参数 */
```

- 值类型参数（int, char, boolean）使用 `A2P`（取地址），因为 `void *args[]` 数组需要指针
- 指针类型参数（const char *, struct *）使用 `P2V`（直接转换），因为它们本身就是地址

---

### 2.3 初始化与生命周期

#### shim_init_nhwindows

```c
VDECLCB(shim_init_nhwindows, (int *argcp, char **argv), "vpp", P2V argcp, P2V argv)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vpp"` — 返回 void，两个 pointer 参数 |
| **参数** | `argcp` (pointer): 指向命令行参数个数的指针；`argv` (pointer): 命令行参数数组指针 |
| **返回值** | 无 |
| **调用时机** | 游戏启动时，初始化窗口系统。在 `main()` 中由 `init_nhwindows(&argc, argv)` 调用 |
| **JS 侧处理** | 通常用于初始化前端状态，可以忽略参数 |

#### shim_exit_nhwindows

```c
VDECLCB(shim_exit_nhwindows, (const char *str), "vs", P2V str)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vs"` — 返回 void，一个 string 参数 |
| **参数** | `str` (string): 退出原因描述，可能为 NULL |
| **返回值** | 无 |
| **调用时机** | 游戏结束，准备关闭窗口系统 |
| **JS 侧处理** | 显示退出原因，清理前端状态 |

#### shim_suspend_nhwindows

```c
VDECLCB(shim_suspend_nhwindows, (const char *str), "vs", P2V str)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vs"` — 返回 void，一个 string 参数 |
| **参数** | `str` (string): 暂停原因描述 |
| **返回值** | 无 |
| **调用时机** | 游戏暂停（如 Unix 上的 Ctrl+Z），在 WASM 中一般不会触发 |

#### shim_resume_nhwindows

```c
VDECLCB(shim_resume_nhwindows, (void), "v")
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"v"` — 返回 void，无参数 |
| **调用时机** | 从暂停状态恢复 |

#### shim_get_nh_event

```c
VDECLCB(shim_get_nh_event, (void), "v")
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"v"` — 返回 void，无参数 |
| **调用时机** | 心跳事件，游戏核心定期调用。窗口端口可用来处理各种 X 事件 |
| **JS 侧处理** | 通常为空实现 |

---

### 2.4 角色选择与命名

#### shim_player_selection (WASM 版本，非回调)

```c
// 注意：WASM 版本是特殊实现，不使用 VDECLCB 宏
void shim_player_selection() {
    boolean do_genl_player_setup = shim_player_selection_or_tty();
    if (do_genl_player_setup) {
        genl_player_setup(80);
    }
}
```

WASM 版本的角色选择分两步：先调用 `shim_player_selection_or_tty()`，如果它返回 `true`，则由 C 侧的 `genl_player_setup(80)` 自动完成角色分配（如随机选择未确定的角色/种族/性别/阵营）。

#### shim_player_selection_or_tty

```c
DECLCB(boolean, shim_player_selection_or_tty, (void), "b")
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"b"` — 返回 boolean，无参数 |
| **返回值** | `true`: 让 C 侧用 `genl_player_setup()` 自动完成角色选择；`false`: JS 侧已完全处理角色选择 |
| **调用时机** | 新游戏开始时。JS 侧应在此让玩家选择角色、种族、性别、阵营 |
| **JS 侧处理** | 显示角色选择界面。通过 `nethackGlobal.globals.flags.initrole` 等全局变量设置选择结果，然后返回 `true` |

#### shim_askname

```c
VDECLCB(shim_askname, (void), "v")
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"v"` — 返回 void，无参数 |
| **调用时机** | 需要玩家输入角色名称时 |
| **JS 侧处理** | 显示名称输入界面。通过 `nethackGlobal.globals.svp.plname` 全局变量设置玩家名称 |

---

### 2.5 窗口管理

#### shim_create_nhwindow

```c
DECLCB(winid, shim_create_nhwindow, (int type), "ii", A2P type)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"ii"` — 返回 int，一个 int 参数 |
| **参数** | `type` (int): 窗口类型，取值为以下常量：|
| | `NHW_MESSAGE = 1` — 消息窗口（显示游戏消息）|
| | `NHW_STATUS = 2` — 状态窗口（显示生命值、等级等）|
| | `NHW_MAP = 3` — 地图窗口（显示地牢地图）|
| | `NHW_MENU = 4` — 菜单窗口（显示物品列表等）|
| | `NHW_TEXT = 5` — 文本窗口（显示帮助文档等）|
| **返回值** | `winid` (int): 分配的窗口标识符，后续操作通过此 ID 引用窗口 |
| **调用时机** | 游戏核心需要新窗口时调用 |
| **JS 侧处理** | 创建对应的前端窗口实例，返回一个唯一的整数 ID |

#### shim_clear_nhwindow

```c
VDECLCB(shim_clear_nhwindow, (winid window), "vi", A2P window)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vi"` — 返回 void，一个 int 参数 |
| **参数** | `window` (int): 要清空的窗口 ID |
| **调用时机** | 需要清空窗口内容时，尤其是地图窗口在切换关卡时 |

#### shim_display_nhwindow

```c
VDECLCB(shim_display_nhwindow, (winid window, boolean blocking), "vib", A2P window, A2P blocking)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vib"` — 返回 void，一个 int + 一个 boolean |
| **参数** | `window` (int): 窗口 ID；`blocking` (boolean): 是否阻塞等待用户交互 |
| **调用时机** | 游戏核心要求显示窗口内容。如果 `blocking` 为 true，应等待用户按键后再返回 |
| **JS 侧处理** | 渲染窗口内容。对于菜单/文本窗口的 blocking 显示，需要等待用户关闭后 resolve |

#### shim_destroy_nhwindow

```c
VDECLCB(shim_destroy_nhwindow, (winid window), "vi", A2P window)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vi"` — 返回 void，一个 int 参数 |
| **参数** | `window` (int): 要销毁的窗口 ID |
| **调用时机** | 窗口不再需要时 |

#### shim_curs

```c
VDECLCB(shim_curs, (winid a, int x, int y), "viii", A2P a, A2P x, A2P y)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"viii"` — 返回 void，三个 int 参数 |
| **参数** | `a` (int): 窗口 ID；`x` (int): 列坐标；`y` (int): 行坐标 |
| **调用时机** | 移动指定窗口内的光标到 (x, y) 位置 |

#### shim_ctrl_nhwindow (WASM 版本，非回调)

```c
// WASM 版本直接返回 NULL，不使用回调
win_request_info *
shim_ctrl_nhwindow(winid window UNUSED, int request UNUSED, win_request_info *wri UNUSED) {
    return (win_request_info *) 0;
}
```

| 项目 | 说明 |
|------|------|
| **说明** | WASM 版本中此函数直接返回 NULL，不通过回调转发 |
| **调用时机** | 游戏核心对窗口发出控制请求时 |

---

### 2.6 文本输出

#### shim_putstr

```c
VDECLCB(shim_putstr, (winid w, int attr, const char *str), "viis", A2P w, A2P attr, P2V str)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"viis"` — 返回 void，两个 int + 一个 string |
| **参数** | `w` (int): 目标窗口 ID；`attr` (int): 文本样式（见下方常量）；`str` (string): 要显示的文本 |
| **调用时机** | 在窗口中输出一行文本。最常见的调用场景：消息窗口 (`NHW_MESSAGE`)、菜单标题、文本窗口内容 |

文本样式常量 (`attr`)：

| 常量 | 值 | 含义 |
|------|---|------|
| `ATR_NONE` | 0 | 无特殊样式 |
| `ATR_BOLD` | 1 | 粗体 |
| `ATR_DIM` | 2 | 暗淡 |
| `ATR_ITALIC` | 3 | 斜体 |
| `ATR_ULINE` | 4 | 下划线 |
| `ATR_BLINK` | 5 | 闪烁 |
| `ATR_INVERSE` | 7 | 反色 |
| `ATR_URGENT` | 16 | 紧急（可与其他样式组合） |
| `ATR_NOHISTORY` | 32 | 不记入消息历史（可与其他样式组合） |

#### shim_display_file

```c
VDECLCB(shim_display_file, (const char *name, boolean complain), "vsb", P2V name, A2P complain)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vsb"` — 返回 void，一个 string + 一个 boolean |
| **参数** | `name` (string): 文件名；`complain` (boolean): 如果文件不存在是否报错 |
| **调用时机** | 显示帮助文件、新闻等文本文件内容 |

#### shim_raw_print

```c
VDECLCB(shim_raw_print, (const char *str), "vs", P2V str)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vs"` — 返回 void，一个 string |
| **参数** | `str` (string): 要输出的文本 |
| **调用时机** | 在窗口系统初始化之前或关闭之后输出消息（如错误信息、版本信息） |

#### shim_raw_print_bold

```c
VDECLCB(shim_raw_print_bold, (const char *str), "vs", P2V str)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vs"` — 返回 void，一个 string |
| **参数** | `str` (string): 要加粗输出的文本 |
| **调用时机** | 同 `shim_raw_print`，但文本应加粗显示 |

---

### 2.7 地图渲染

#### shim_print_glyph

```c
VDECLCB(shim_print_glyph,
    (winid w, coordxy x, coordxy y, const glyph_info *glyphinfo, const glyph_info *bkglyphinfo),
    "vi11pp",
    A2P w, A2P x, A2P y, P2V glyphinfo, P2V bkglyphinfo)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vi11pp"` — 返回 void；`i`=窗口ID(int)，`1`=x(int16)，`1`=y(int16)，`p`=前景glyph指针，`p`=背景glyph指针 |
| **参数** | |
| | `w` (int): 地图窗口 ID |
| | `x` (int16/number): 地图列坐标（0-79） |
| | `y` (int16/number): 地图行坐标（0-20） |
| | `glyphinfo` (pointer): 前景 `glyph_info` 结构体指针——通常是怪物、物品等 |
| | `bkglyphinfo` (pointer): 背景 `glyph_info` 结构体指针——通常是地板、墙壁等 |
| **返回值** | 无 |
| **调用时机** | 地图上每个格子需要更新时。是最频繁调用的回调之一 |
| **JS 侧处理** | 从两个指针中读取 glyph_info 结构体字段（见第 3 章），确定在该坐标显示什么 |

**这是 BlissHack 最核心的回调之一。** 前景/背景双 glyph 设计天然支持双层渲染：怪物脚下的地面可以同时显示。

#### shim_cliparound

```c
VDECLCB(shim_cliparound, (int x, int y), "vii", A2P x, A2P y)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vii"` — 返回 void，两个 int |
| **参数** | `x` (int): 列坐标；`y` (int): 行坐标 |
| **调用时机** | 需要确保某个坐标在视口可见区域内（通常是玩家移动后）。仅在 `CLIPPING` 编译选项启用时有效 |

#### shim_update_positionbar

```c
VDECLCB(shim_update_positionbar, (char *posbar), "vs", P2V posbar)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vs"` — 返回 void，一个 string |
| **参数** | `posbar` (string): 位置条数据 |
| **调用时机** | 更新位置条显示。仅在 `POSITIONBAR` 编译选项启用时有效 |

---

### 2.8 用户输入

#### shim_nhgetch

```c
DECLCB(int, shim_nhgetch, (void), "i")
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"i"` — 返回 int，无参数 |
| **返回值** | 用户按下的按键的 ASCII 码 |
| **调用时机** | 游戏等待用户输入单个按键时（如 `--More--` 提示、方向键） |
| **JS 侧处理** | 必须等待用户按键，返回按键的 ASCII 码。**这是一个异步回调——C 侧会阻塞等待返回** |

#### shim_nh_poskey

```c
DECLCB(int, shim_nh_poskey, (coordxy *x, coordxy *y, int *mod), "ippp", P2V x, P2V y, P2V mod)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"ippp"` — 返回 int，三个 pointer 参数 |
| **参数** | `x` (pointer→int16): 鼠标点击的 x 坐标（输出参数）；`y` (pointer→int16): 鼠标点击的 y 坐标（输出参数）；`mod` (pointer→int32): 鼠标按钮修饰符（输出参数）|
| **返回值** | 如果是键盘输入，返回按键 ASCII 码；如果是鼠标点击，返回 0，同时通过指针参数填写坐标和修饰符 |
| **调用时机** | 主输入循环中等待用户输入（键盘或鼠标） |
| **JS 侧处理** | 等待用户输入。如果是键盘按键，返回 ASCII 码。如果是鼠标点击，需要通过 `Module.setValue()` 把坐标写回 x/y/mod 指针，返回 0 |

鼠标修饰符常量：
- `CLICK_1 = 1` — 左键点击
- `CLICK_2 = 2` — 右键点击

#### shim_yn_function

```c
DECLCB(char, shim_yn_function,
    (const char *query, const char *resp, char def),
    "css0",
    P2V query, P2V resp, A2P def)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"css0"` — 返回 char，两个 string + 一个 byte(int8) 参数 |
| **参数** | `query` (string): 问题文本（如 "Really quit?"）；`resp` (string): 可接受的回答字符串（如 "ynq"），可能为 NULL；`def` (int8/number): 默认回答字符的 ASCII 码 |
| **返回值** | 用户选择的字符的 ASCII 码 |
| **调用时机** | 需要用户回答 yes/no 或从有限选项中选择时 |
| **JS 侧处理** | 显示问题和选项，等待用户选择，返回所选字符的 ASCII 码 |

#### shim_getlin

```c
VDECLCB(shim_getlin, (const char *query, char *bufp), "vsp", P2V query, P2V bufp)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vsp"` — 返回 void，一个 string + 一个 pointer |
| **参数** | `query` (string): 提示文本（如 "What do you want to call it?"）；`bufp` (pointer): 输出缓冲区指针 |
| **返回值** | 无（通过 `bufp` 指针写回用户输入的字符串） |
| **调用时机** | 需要用户输入一行文本时（如命名物品、搜索命令） |
| **JS 侧处理** | 显示输入框，等待用户输入。使用 `Module.stringToUTF8(userInput, bufp, maxLen)` 将结果写回 `bufp` 指针 |

#### shim_get_ext_cmd

```c
DECLCB(int, shim_get_ext_cmd, (void), "iv")
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"iv"` — 返回 int，无参数 |
| **返回值** | 扩展命令在 `extcmdlist` 中的索引号，-1 表示取消 |
| **调用时机** | 用户按 `#` 键进入扩展命令模式时 |
| **JS 侧处理** | 显示可用的扩展命令列表（通过 `nethackGlobal.pointers.extcmdlist` 获取），让用户选择，返回对应索引 |

#### shim_doprev_message

```c
DECLCB(int, shim_doprev_message, (void), "iv")
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"iv"` — 返回 int，无参数 |
| **返回值** | 0 = 成功 |
| **调用时机** | 用户按 Ctrl+P 查看上一条消息时 |

#### shim_nhbell

```c
VDECLCB(shim_nhbell, (void), "v")
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"v"` — 返回 void，无参数 |
| **调用时机** | 需要发出警告铃声时（如非法操作） |

#### shim_number_pad

```c
VDECLCB(shim_number_pad, (int state), "vi", A2P state)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vi"` — 返回 void，一个 int 参数 |
| **参数** | `state` (int): 1 = 启用数字小键盘模式，0 = 禁用 |
| **调用时机** | 数字小键盘模式改变时 |

---

### 2.9 菜单系统

NetHack 的菜单系统遵循固定的调用序列：`start_menu` → 多次 `add_menu` → `end_menu` → `select_menu`。

#### shim_start_menu

```c
VDECLCB(shim_start_menu, (winid window, unsigned long mbehavior), "vii", A2P window, A2P mbehavior)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vii"` — 返回 void，两个 int 参数 |
| **参数** | `window` (int): 菜单窗口 ID；`mbehavior` (int): 菜单行为标志 |
| **调用时机** | 开始构建一个新菜单 |

菜单行为常量：
- `MENU_BEHAVE_STANDARD = 0` — 标准菜单
- `MENU_BEHAVE_PERMINV = 1` — 持久背包窗口

#### shim_add_menu

```c
VDECLCB(shim_add_menu,
    (winid window, const glyph_info *glyphinfo, const ANY_P *identifier,
     char ch, char gch, int attr, int clr, const char *str, unsigned int itemflags),
    "vipi00iisi",
    A2P window, P2V glyphinfo, P2V identifier, A2P ch, A2P gch, A2P attr, A2P clr, P2V str, A2P itemflags)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vipi00iisi"` — 返回 void，9 个参数 |
| **参数** | |
| | `window` (int): 菜单窗口 ID |
| | `glyphinfo` (pointer): 物品的 `glyph_info` 指针（用于显示图标），可为 0 |
| | `identifier` (pointer): `ANY_P` 联合体指针，包含菜单项标识符。如果 `identifier->a_void == 0`，则此项为不可选的标题/分隔行 |
| | `ch` (int8/byte): 快捷键字符（如 'a', 'b'），0 表示由系统分配 |
| | `gch` (int8/byte): 分组快捷键字符，0 表示不分组 |
| | `attr` (int): 文本样式（ATR_NONE 等） |
| | `clr` (int): 颜色索引 |
| | `str` (string): 菜单项文本 |
| | `itemflags` (int): 菜单项标志位 |

菜单项标志常量（`itemflags`）：
- `MENU_ITEMFLAGS_NONE = 0x0` — 无特殊标志
- `MENU_ITEMFLAGS_SELECTED = 0x1` — 预选中
- `MENU_ITEMFLAGS_SKIPINVERT = 0x2` — 全选/反选时跳过此项
- `MENU_ITEMFLAGS_SKIPMENUCOLORS = 0x4` — 不应用菜单颜色规则

**注意**：`ch` 和 `gch` 在 fmt 中标记为 `0`（即 int8/1字节），不是 `i`（int32）。读取时按 `getValue(ptr, "i8")` 处理。

#### shim_end_menu

```c
VDECLCB(shim_end_menu, (winid window, const char *prompt), "vis", A2P window, P2V prompt)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vis"` — 返回 void，一个 int + 一个 string |
| **参数** | `window` (int): 菜单窗口 ID；`prompt` (string): 菜单顶部提示文本，可能为 NULL |
| **调用时机** | 所有菜单项添加完毕后调用 |

#### shim_select_menu

```c
DECLCB(int, shim_select_menu,
    (winid window, int how, MENU_ITEM_P **menu_list),
    "iiip",
    A2P window, A2P how, P2V menu_list)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"iiip"` — 返回 int，两个 int + 一个 pointer |
| **参数** | `window` (int): 菜单窗口 ID；`how` (int): 选择模式；`menu_list` (pointer): 输出参数，指向选中项数组的指针 |
| **返回值** | 选中的项数（-1 = 取消/ESC，0 = 无选中） |
| **调用时机** | 显示菜单并等待用户选择 |

选择模式常量（`how`）：
- `PICK_NONE = 0` — 纯展示，不允许选择
- `PICK_ONE = 1` — 只能选一个
- `PICK_ANY = 2` — 可以多选

**重要提示**：`menu_list` 是一个输出参数（指向指针的指针）。JS 侧需要分配 WASM 内存来存放选中项的 `menu_item` 数组，并将数组地址写回 `*menu_list`。这是 shim 接口中最复杂的部分之一。

#### shim_message_menu

```c
DECLCB(char, shim_message_menu, (char let, int how, const char *mesg), "ciis", A2P let, A2P how, P2V mesg)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"ciis"` — 返回 char，两个 int + 一个 string |
| **参数** | `let` (int): 默认选择字符；`how` (int): 选择模式（PICK_NONE/PICK_ONE）；`mesg` (string): 消息文本 |
| **返回值** | 用户选择的字符的 ASCII 码 |
| **调用时机** | 在消息窗口中显示带选项的消息 |

---

### 2.10 状态栏系统

#### shim_status_init

```c
VDECLCB(shim_status_init, (void), "v")
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"v"` — 返回 void，无参数 |
| **调用时机** | 初始化状态显示系统 |

#### shim_status_enablefield

```c
VDECLCB(shim_status_enablefield,
    (int fieldidx, const char *nm, const char *fmt, boolean enable),
    "vippb",
    A2P fieldidx, P2V nm, P2V fmt, A2P enable)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vippb"` — 返回 void，一个 int + 两个 pointer + 一个 boolean |
| **参数** | `fieldidx` (int): 状态字段索引（见下方常量）；`nm` (pointer→string): 字段名称；`fmt` (pointer→string): 显示格式字符串；`enable` (boolean): 是否启用此字段 |
| **调用时机** | 初始化阶段，告知前端哪些状态字段可用 |

**注意**：虽然 `nm` 和 `fmt` 实际上是字符串，但 fmt 标记中用的是 `p`（pointer），所以 JS 侧收到的是 WASM 内存地址，需要用 `Module.UTF8ToString(ptr)` 手动转换。

#### shim_status_update

```c
VDECLCB(shim_status_update,
    (int fldidx, genericptr_t ptr, int chg, int percent, int color, unsigned long *colormasks),
    "vipiiip",
    A2P fldidx, P2V ptr, A2P chg, A2P percent, A2P color, P2V colormasks)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vipiiip"` — 返回 void，一个 int + 一个 pointer + 三个 int + 一个 pointer |
| **参数** | |
| | `fldidx` (int): 状态字段索引 |
| | `ptr` (pointer): 字段值（**类型取决于 fldidx**——见下方说明） |
| | `chg` (int): 变化方向（正数=增加，负数=减少，0=不变） |
| | `percent` (int): HP 百分比（仅 `BL_HP` 时有效） |
| | `color` (int): 颜色索引 |
| | `colormasks` (pointer): 颜色掩码数组指针 |
| **调用时机** | 状态字段值发生变化时 |

**关于 `ptr` 参数的双重含义**（源码注释也提到这个问题）：
- 当 `fldidx == BL_CONDITION` 时，`ptr` 实际上是一个整数（条件位掩码），不是指针
- 其他情况下，`ptr` 通常是一个指向格式化字符串的指针（用 `UTF8ToString` 读取）
- 特殊索引 `BL_FLUSH` 和 `BL_RESET` 用于控制状态刷新

状态字段索引常量 (`fldidx`)：

| 常量 | 含义 |
|------|------|
| `BL_TITLE` | 角色标题 |
| `BL_STR` | 力量 |
| `BL_DX` | 敏捷 |
| `BL_CO` | 体质 |
| `BL_IN` | 智力 |
| `BL_WI` | 感知 |
| `BL_CH` | 魅力 |
| `BL_ALIGN` | 阵营 |
| `BL_SCORE` | 分数 |
| `BL_CAP` | 负重等级 |
| `BL_GOLD` | 金币 |
| `BL_ENE` | 魔力 |
| `BL_ENEMAX` | 魔力上限 |
| `BL_XP` | 经验等级 |
| `BL_AC` | 护甲等级 |
| `BL_HD` | Hit Dice (怪物等级) |
| `BL_TIME` | 游戏时间 |
| `BL_HUNGER` | 饥饿状态 |
| `BL_HP` | 生命值 |
| `BL_HPMAX` | 生命值上限 |
| `BL_LEVELDESC` | 当前层描述 |
| `BL_EXP` | 经验值 |
| `BL_CONDITION` | 状态条件（位掩码） |
| `BL_CHARACTERISTICS` | 所有属性 |
| `BL_RESET` | 重置信号 |
| `BL_FLUSH` | 刷新信号 |
| `MAXBLSTATS` | 字段总数 |

---

### 2.11 消息历史

#### shim_getmsghistory

```c
DECLCB(char *, shim_getmsghistory, (boolean init), "sb", A2P init)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"sb"` — 返回 string，一个 boolean 参数 |
| **参数** | `init` (boolean): `true` = 开始新的遍历；`false` = 获取下一条 |
| **返回值** | 消息字符串，NULL 表示遍历结束 |
| **调用时机** | 保存游戏时，核心遍历消息历史以保存 |

#### shim_putmsghistory

```c
VDECLCB(shim_putmsghistory, (const char *msg, boolean restoring_msghist), "vsb", P2V msg, A2P restoring_msghist)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vsb"` — 返回 void，一个 string + 一个 boolean |
| **参数** | `msg` (string): 消息文本；`restoring_msghist` (boolean): 是否正在恢复存档中的消息历史 |
| **调用时机** | 恢复游戏存档时，核心将保存的消息历史送回给窗口端口 |

---

### 2.12 同步与延迟

#### shim_mark_synch

```c
VDECLCB(shim_mark_synch, (void), "v")
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"v"` |
| **调用时机** | 标记需要同步输出。窗口端口可在此刷新缓冲区 |

#### shim_wait_synch

```c
VDECLCB(shim_wait_synch, (void), "v")
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"v"` |
| **调用时机** | 等待所有输出完成。在重要输出（如 `raw_print`）后调用 |

#### shim_delay_output

```c
VDECLCB(shim_delay_output, (void), "v")
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"v"` |
| **调用时机** | 请求短暂延迟（约 50ms）。用于动画效果（如投射物飞行路径） |

---

### 2.13 偏好与配置

#### shim_preference_update

```c
VDECLCB(shim_preference_update, (const char *pref), "vp", P2V pref)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vp"` — 返回 void，一个 pointer 参数 |
| **参数** | `pref` (pointer→string): 变更的偏好名称。注意 fmt 标记为 `p` 不是 `s`，需要手动 `UTF8ToString` |
| **调用时机** | 游戏选项改变时（如颜色设置、高亮设置） |

---

### 2.14 颜色系统

这些函数仅在 `CHANGE_COLOR` 编译选项启用时有效。

#### shim_change_color

```c
VDECLCB(shim_change_color, (int color, long rgb, int reverse), "viii", A2P color, A2P rgb, A2P reverse)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"viii"` — 返回 void，三个 int 参数 |
| **参数** | `color` (int): 颜色索引；`rgb` (int): RGB 值；`reverse` (int): 是否是反色的颜色 |

#### shim_change_background

```c
VDECLCB(shim_change_background, (int white_or_black), "vi", A2P white_or_black)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"vi"` — 返回 void，一个 int 参数 |
| **参数** | `white_or_black` (int): 背景色（0=黑色，1=白色） |
| **说明** | 仅在 MAC 平台构建时存在 |

#### set_shim_font_name

```c
DECLCB(short, set_shim_font_name, (winid window_type, char *font_name), "2is", A2P window_type, P2V font_name)
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"2is"` — 返回 short(int16)，一个 int + 一个 string 参数 |
| **参数** | `window_type` (int): 窗口类型；`font_name` (string): 字体名称 |
| **返回值** | short/int16 |
| **说明** | 仅在 MAC 平台构建时存在 |

#### shim_get_color_string

```c
DECLCB(char *, shim_get_color_string, (void), "sv")
```

| 项目 | 说明 |
|------|------|
| **fmt** | `"sv"` — 返回 string，无参数 |
| **返回值** | 颜色配置字符串 |

---

### 2.15 背包更新 (WASM 版本，非回调)

#### shim_update_inventory

```c
// WASM 版本特殊实现，不通过 VDECLCB
void shim_update_inventory(int a1 UNUSED) {
    if(iflags.perm_invent) {
        repopulate_perminvent();
    }
}
```

| 项目 | 说明 |
|------|------|
| **说明** | WASM 版本中直接调用 `repopulate_perminvent()`，不使用回调。注释解释：如果通过 shim 回调再调回 `repopulate_perminvent()`，会产生重入问题导致 Asyncify 崩溃 |
| **调用时机** | 背包内容变化时 |
| **效果** | 如果 `perm_invent` 标志启用，核心会重新通过菜单系统（`start_menu` → `add_menu` → `end_menu` → `select_menu`）发送完整背包 |

---

### 2.16 所有回调一览表

| 回调名 | 格式字符串 | 类型 | 分组 |
|--------|-----------|------|------|
| `shim_init_nhwindows` | `vpp` | VDECLCB | 初始化 |
| `shim_player_selection_or_tty` | `b` | DECLCB | 角色选择 |
| `shim_askname` | `v` | VDECLCB | 角色选择 |
| `shim_get_nh_event` | `v` | VDECLCB | 生命周期 |
| `shim_exit_nhwindows` | `vs` | VDECLCB | 生命周期 |
| `shim_suspend_nhwindows` | `vs` | VDECLCB | 生命周期 |
| `shim_resume_nhwindows` | `v` | VDECLCB | 生命周期 |
| `shim_create_nhwindow` | `ii` | DECLCB | 窗口管理 |
| `shim_clear_nhwindow` | `vi` | VDECLCB | 窗口管理 |
| `shim_display_nhwindow` | `vib` | VDECLCB | 窗口管理 |
| `shim_destroy_nhwindow` | `vi` | VDECLCB | 窗口管理 |
| `shim_curs` | `viii` | VDECLCB | 窗口管理 |
| `shim_putstr` | `viis` | VDECLCB | 文本输出 |
| `shim_display_file` | `vsb` | VDECLCB | 文本输出 |
| `shim_start_menu` | `vii` | VDECLCB | 菜单系统 |
| `shim_add_menu` | `vipi00iisi` | VDECLCB | 菜单系统 |
| `shim_end_menu` | `vis` | VDECLCB | 菜单系统 |
| `shim_select_menu` | `iiip` | DECLCB | 菜单系统 |
| `shim_message_menu` | `ciis` | DECLCB | 菜单系统 |
| `shim_mark_synch` | `v` | VDECLCB | 同步 |
| `shim_wait_synch` | `v` | VDECLCB | 同步 |
| `shim_cliparound` | `vii` | VDECLCB | 地图渲染 |
| `shim_update_positionbar` | `vs` | VDECLCB | 地图渲染 |
| `shim_print_glyph` | `vi11pp` | VDECLCB | 地图渲染 |
| `shim_raw_print` | `vs` | VDECLCB | 文本输出 |
| `shim_raw_print_bold` | `vs` | VDECLCB | 文本输出 |
| `shim_nhgetch` | `i` | DECLCB | 输入 |
| `shim_nh_poskey` | `ippp` | DECLCB | 输入 |
| `shim_nhbell` | `v` | VDECLCB | 输入 |
| `shim_doprev_message` | `iv` | DECLCB | 消息 |
| `shim_yn_function` | `css0` | DECLCB | 输入 |
| `shim_getlin` | `vsp` | VDECLCB | 输入 |
| `shim_get_ext_cmd` | `iv` | DECLCB | 输入 |
| `shim_number_pad` | `vi` | VDECLCB | 配置 |
| `shim_delay_output` | `v` | VDECLCB | 同步 |
| `shim_change_color` | `viii` | VDECLCB | 颜色 |
| `shim_change_background` | `vi` | VDECLCB | 颜色 |
| `set_shim_font_name` | `2is` | DECLCB | 颜色 |
| `shim_get_color_string` | `sv` | DECLCB | 颜色 |
| `shim_preference_update` | `vp` | VDECLCB | 配置 |
| `shim_getmsghistory` | `sb` | DECLCB | 消息 |
| `shim_putmsghistory` | `vsb` | VDECLCB | 消息 |
| `shim_status_init` | `v` | VDECLCB | 状态栏 |
| `shim_status_enablefield` | `vippb` | VDECLCB | 状态栏 |
| `shim_status_update` | `vipiiip` | VDECLCB | 状态栏 |
| `shim_update_inventory` | *(特殊)* | 直接实现 | 背包 |
| `shim_player_selection` | *(特殊)* | 直接实现 | 角色选择 |
| `shim_ctrl_nhwindow` | *(特殊)* | 直接实现 | 窗口管理 |

此外，`shim_procs` 中还使用了以下**通用实现**（不经过 shim 回调，直接用 NetHack 内置函数）：
- `genl_putmixed` — 混合文本输出（ASCII + 特殊符号编码）
- `genl_outrip` — 死亡墓碑
- `genl_status_finish` — 状态系统清理
- `genl_status_enablefield` — 状态字段启用（注意：`shim_procs` 实际注册的是 `genl_status_enablefield`，而不是 `shim_status_enablefield`。但 `shim_status_enablefield` 也声明了并可能在其他路径被调用）
- `genl_status_update` — 在 `STATUS_HILITES` 未启用时使用的通用状态更新
- `genl_can_suspend_yes` — 返回是否可暂停

---

## 3. WASM 与 Module 内存机制

本章面向从未接触过 WebAssembly 的开发者，解释 C 代码如何在浏览器中运行，以及 JS 如何与 C 共享数据。

### 3.1 什么是 Emscripten Module

[Emscripten](https://emscripten.org/) 是一个编译器工具链，能把 C/C++ 代码编译为 WebAssembly（WASM）。编译产物是两个文件：
- `nethack.wasm` — 二进制的 WASM 模块（相当于 .exe）
- `nethack.js` — JavaScript "胶水代码"（加载 .wasm、提供运行时 API）

加载 WASM 模块后，JavaScript 会得到一个 `Module` 对象，它提供以下关键 API：

| API | 用途 |
|-----|------|
| `Module.ccall(funcName, retType, argTypes, args)` | 调用 C 函数 |
| `Module.cwrap(funcName, retType, argTypes)` | 包装 C 函数为 JS 函数 |
| `Module.getValue(ptr, type)` | 从 WASM 内存地址读取值 |
| `Module.setValue(ptr, value, type)` | 向 WASM 内存地址写入值 |
| `Module.UTF8ToString(ptr)` | 将 C 字符串（WASM 内存中的 char*）转为 JS 字符串 |
| `Module.stringToUTF8(str, ptr, maxLen)` | 将 JS 字符串写入 WASM 内存 |
| `Module.HEAP8 / HEAP16 / HEAP32 / HEAPU8` | TypedArray 视图，直接访问 WASM 内存 |
| `Module._malloc(size)` | 在 WASM 堆上分配内存 |
| `Module._free(ptr)` | 释放 WASM 堆内存 |

**注意**：在 `EM_JS` 宏（即 `local_callback` 函数体）内，这些 API 可以**直接使用**，不需要 `Module.` 前缀。这是因为 Emscripten 编译时会把它们注入到作用域中。所以你会看到源码中直接写 `getValue(ptr, "*")`、`UTF8ToString(ptr)` 等。

### 3.2 WASM 线性内存（Linear Memory）

WASM 的内存模型非常简单：

```
┌─────────────────────────────────────────┐
│            WASM 线性内存                  │
│  （一个巨大的 ArrayBuffer，默认 256MB）    │
│                                          │
│  地址 0x00000000 ┌──────────────┐        │
│                  │ 静态数据区    │        │
│                  │ 全局变量      │        │
│                  ├──────────────┤        │
│                  │ 栈 (Stack)   │        │
│                  ├──────────────┤        │
│                  │ 堆 (Heap)    │        │
│                  │ malloc分配   │        │
│  地址 0x10000000 └──────────────┘        │
│                                          │
└─────────────────────────────────────────┘
```

**关键概念：所有 C 中的指针，在 WASM 中就是这个 ArrayBuffer 的偏移量（整数）。**

当 shim 回调传递一个"指针"参数（fmt 中的 `p`）时，JS 侧收到的就是一个 **number**，代表 WASM 内存中的一个地址。

在 JavaScript 中，可以通过以下方式访问这块内存：

```javascript
// Module.HEAPU8 是一个 Uint8Array 视图，覆盖整个 WASM 内存
// Module.HEAP32 是一个 Int32Array 视图
// getValue / setValue 是封装好的便捷函数

// 读取地址 ptr 处的 32 位整数
let value = Module.getValue(ptr, 'i32');

// 读取地址 ptr 处的指针（在 32 位 WASM 中等同于 i32）
let addr = Module.getValue(ptr, '*');

// 读取地址 ptr 处的 C 字符串
let str = Module.UTF8ToString(ptr);
```

### 3.3 指针参数在回调中的映射

当 `local_callback` 被调用时，格式字符串中每个参数的处理方式如下：

```javascript
// local_callback 内部的参数解析逻辑（简化版）
function getArg(name, ptr, type) {
    if (type === "p") {
        // pointer 类型：读取指针值本身（一个地址）
        return getValue(ptr, "*");
    } else {
        // 其他类型：先读取指针指向的值，再根据类型转换
        return getPointerValue(name, getValue(ptr, "*"), type);
    }
}
```

**两步解引用过程**：
1. `args` 是一个 `void*` 数组。`args + (4*i)` 得到第 i 个元素的地址
2. `getValue(args + 4*i, "*")` 读取这个元素的值
3. 如果类型是 `p`（指针），这个值本身就是最终值（一个 WASM 内存地址）
4. 如果类型是 `s`（字符串），这个值是一个 char* 地址，`getPointerValue` 会调用 `UTF8ToString()` 转换
5. 如果类型是 `i`（整数），由于值类型参数在 C 侧使用 `A2P`（取地址），这个值是局部变量的地址，`getPointerValue` 会再解一次引得到实际的整数值

### 3.4 如何从指针读取结构体字段

这是 BlissHack 开发中最常用的技能。当回调传递一个结构体指针时（如 `glyph_info*`），你需要知道结构体的**内存布局**来读取各个字段。

#### glyph_info 结构体定义（来自 `include/wintype.h`）

```c
typedef struct glyphinfo {
    int glyph;            // 偏移 +0, 4 字节：glyph 编号
    int ttychar;          // 偏移 +4, 4 字节：终端字符
    uint32 framecolor;    // 偏移 +8, 4 字节：帧颜色
    glyph_map gm;         // 偏移 +12：嵌套结构体
} glyph_info;

typedef struct glyph_map_entry {
    unsigned glyphflags;              // 偏移 +0 (结构体内), 4 字节：标志位（MG_HERO, MG_PET 等）
    struct classic_representation sym; // 偏移 +4 (结构体内)
    uint32 customcolor;               // 自定义颜色
    uint16 color256idx;               // 256 色索引
    short int tileidx;                // tile 索引
    // 可能还有 unicode_representation *u (如果 ENHANCED_SYMBOLS 启用)
} glyph_map;

struct classic_representation {
    int color;    // 偏移 +0, 4 字节：颜色索引
    int symidx;   // 偏移 +4, 4 字节：符号索引
};
```

#### 具体示例：从 shim_print_glyph 读取 glyph_info

```javascript
// shim_print_glyph 的回调签名：
// callback("shim_print_glyph", w, x, y, glyphinfo_ptr, bkglyphinfo_ptr)

async function nethackCallback(name, ...args) {
    if (name === "shim_print_glyph") {
        let [w, x, y, glyphinfo_ptr, bkglyphinfo_ptr] = args;

        // glyphinfo_ptr 是一个 WASM 内存地址（number）

        // 读取前景 glyph_info 的字段
        let glyph     = Module.getValue(glyphinfo_ptr + 0, 'i32');   // glyph 编号
        let ttychar   = Module.getValue(glyphinfo_ptr + 4, 'i32');   // 终端字符
        let framecolor = Module.getValue(glyphinfo_ptr + 8, 'i32');  // 帧颜色

        // 读取嵌套的 gm (glyph_map) 字段
        let gm_offset = 12;  // glyph_map 在 glyph_info 中的偏移

        let glyphflags = Module.getValue(glyphinfo_ptr + gm_offset + 0, 'i32');   // MG_* 标志
        let sym_color  = Module.getValue(glyphinfo_ptr + gm_offset + 4, 'i32');   // classic sym.color
        let sym_idx    = Module.getValue(glyphinfo_ptr + gm_offset + 8, 'i32');   // classic sym.symidx
        let customcolor = Module.getValue(glyphinfo_ptr + gm_offset + 12, 'i32'); // 自定义颜色
        let color256   = Module.getValue(glyphinfo_ptr + gm_offset + 16, 'i16');  // 256色索引（2字节）
        let tileidx    = Module.getValue(glyphinfo_ptr + gm_offset + 18, 'i16');  // tile索引（2字节）

        // 判断这个格子的特性
        let isHero   = (glyphflags & 0x00001) !== 0;  // MG_HERO
        let isPet    = (glyphflags & 0x00010) !== 0;  // MG_PET
        let isCorpse = (glyphflags & 0x00002) !== 0;  // MG_CORPSE

        // 读取背景 glyph_info（同样的方式）
        let bk_glyph = Module.getValue(bkglyphinfo_ptr + 0, 'i32');
        // ...

        // 用 ttychar 的 ASCII 值来渲染字符
        let char_to_display = String.fromCharCode(ttychar);
    }
}
```

**重要注意事项：**
- 偏移量取决于编译器的对齐规则。WASM (Emscripten) 的默认对齐方式与 x86 一致
- 以上偏移量基于 32 位 WASM 构建（Emscripten 默认是 32 位）
- 如果不确定偏移量，可以在 C 代码中用 `offsetof()` 宏确认，或在运行时打印结构体大小和偏移
- `glyph_map` 中的 `color256idx` 和 `tileidx` 各占 2 字节（int16），注意对齐

### 3.5 字符串的传递方式

C 字符串和 JS 字符串完全不同：

| | C 字符串 | JS 字符串 |
|---|---------|----------|
| 存储位置 | WASM 线性内存中 | JS 堆中（V8 引擎管理） |
| 编码 | 通常是 UTF-8，以 `\0` 结尾 | UTF-16 (内部) |
| 表示方式 | 一个指针（char*）= 内存地址 | 一个 string 对象 |

**C→JS 方向（读取）**：当 fmt 标记为 `s` 时，`getPointerValue` 会自动调用 `UTF8ToString(ptr)` 将 C 字符串转为 JS 字符串。当 fmt 标记为 `p` 时，你得到的是原始地址，需要手动调用 `UTF8ToString`。

**JS→C 方向（写入）**：用 `stringToUTF8(jsString, wasmPtr, maxBytesIncludingNull)`。例如 `shim_getlin` 中需要将用户输入写回 `bufp` 指针：

```javascript
if (name === "shim_getlin") {
    let [query, bufp] = args;
    // query 已经是 JS 字符串（fmt 标记为 's'）
    // bufp 是 WASM 内存地址（fmt 标记为 'p'）

    let userInput = await showInputDialog(query);
    Module.stringToUTF8(userInput, bufp, 1024);  // 写回 C 缓冲区
}
```

### 3.6 Asyncify 机制

#### 问题

C 代码是同步的——当 `shim_nhgetch()` 被调用时，它期望立即返回一个字符。但在浏览器中，我们不能阻塞 JS 主线程来等待用户输入。

#### 解决方案：Asyncify

[Asyncify](https://emscripten.org/docs/porting/asyncify.html) 是 Emscripten 提供的一种机制，让 C 代码可以"暂停"执行，等待异步操作完成后"恢复"执行。

工作原理：
1. 当 C 调用 `shim_nhgetch()`，最终进入 `local_callback` 的 `EM_JS` 代码
2. `Asyncify.handleSleep(wakeUp => { ... })` 开始——C 的调用栈被保存（"展开"）
3. JS 代码可以自由地做异步操作（等待用户按键、网络请求等）
4. 操作完成后，调用 `wakeUp()`——C 的调用栈被恢复（"重建"）
5. C 代码继续执行，就好像什么都没发生

```
C 调用栈:  main() → moveloop() → rhack() → ... → shim_nhgetch() → local_callback()
                                                                        │
                                     ┌──── Asyncify 保存调用栈 ←────────┘
                                     │
                                     ↓  JS 事件循环继续运行
                                     │  等待用户按键...
                                     │  用户按了 'j'
                                     │
                                     └──→ wakeUp() → Asyncify 恢复调用栈
                                                                        │
C 调用栈:  main() → moveloop() → rhack() → ... → shim_nhgetch() 返回 'j'
```

#### 关键限制：禁止重入

Asyncify 有一个关键限制：在一个 `handleSleep` 尚未完成（`wakeUp` 尚未调用）时，不能开始另一个 `handleSleep`。这就是源码中 `reentryMutexLock` 的作用——它检测并报告重入。

这也解释了为什么 WASM 版本的 `shim_update_inventory` 不使用回调：如果通过 shim 回调调用 JS，JS 在处理过程中可能再次触发 C 函数（如 `repopulate_perminvent()`），导致嵌套的 Asyncify 调用。

#### JS 回调必须返回 Promise

`local_callback` 的设计要求 JS 回调函数必须返回一个 Promise：

```javascript
// local_callback 中的关键代码
userCallback.call(this, name, ...jsArgs).then((retVal) => {
    setPointerValue(name, ret_ptr, retType, retVal);
    reentryMutexUnlock();
    wakeUp();
});
```

所以你的回调函数应该是 `async function` 或返回 Promise。

---

## 4. 回调注册机制

### 4.1 shim_graphics_set_callback

WASM 构建中，注册回调只需一步：

```javascript
// 1. 定义回调函数并注册到 globalThis
globalThis.nethackCallback = async function(name, ...args) {
    switch (name) {
        case "shim_init_nhwindows": /* ... */ break;
        case "shim_create_nhwindow": /* ... */ return windowId;
        // ... 处理所有回调
    }
};

// 2. 调用 C 函数注册回调名称
Module.ccall(
    "shim_graphics_set_callback",  // C 函数名
    null,                           // 返回类型
    ["string"],                     // 参数类型
    ["nethackCallback"],            // 参数值——回调函数在 globalThis 上的名称
    { async: true }                 // 必须指定 async
);
```

**原理**：
1. `shim_graphics_set_callback(char *cbName)` 将字符串 `"nethackCallback"` 保存到 `shim_callback_name` 静态变量
2. 之后每次游戏核心调用窗口函数（如 `shim_print_glyph`），DECLCB/VDECLCB 宏会检查 `shim_callback_name` 是否为 NULL
3. 如果不为 NULL，调用 `local_callback(shim_callback_name, "shim_print_glyph", ret_ptr, "vi11pp", args)`

### 4.2 local_callback 的完整流程

`local_callback` 是通过 `EM_JS` 宏内联在 C 文件中的 JavaScript 代码。它是 C→JS 的核心桥接。

完整流程：

```
1. C 侧：DECLCB/VDECLCB 宏收集参数到 void *args[] 数组
2. C 侧：调用 local_callback(cb_name, shim_name, ret_ptr, fmt, args)
3. EM_JS 进入 JavaScript 执行环境
4. Asyncify.handleSleep(wakeUp => { ... }) 开始，C 调用栈被保存
5. 将 C 字符串参数转为 JS 字符串：UTF8ToString(shim_name), UTF8ToString(fmt_str), UTF8ToString(cb_name)
6. reentryMutexLock(name) — 检查是否有重入
7. 解析 fmt 字符串：第一个字符是返回类型，其余是参数类型
8. 遍历参数类型，逐个从 args 数组中提取 JS 值：
   - 计算第 i 个参数的地址：args + (4 * i)
   - 读取该地址的值：getValue(args + 4*i, "*")
   - 根据类型字符调用 getPointerValue 进行类型转换
9. 调用用户回调：globalThis[cbName].call(this, name, ...jsArgs)
10. 用户回调返回 Promise，等待 .then()
11. 在 .then() 中：
    a. 调用 setPointerValue(name, ret_ptr, retType, retVal) 写回返回值
    b. reentryMutexUnlock() — 释放重入锁
    c. wakeUp() — 恢复 C 执行
```

### 4.3 getPointerValue / setPointerValue

这两个辅助函数在 `js_helpers_init()` 中定义（`sys/libnh/libnhmain.c`），并注册到 `globalThis.nethackGlobal.helpers`。

**getPointerValue(name, ptr, type)** — 根据类型从 WASM 内存读取值：

| type | 读取方式 | 返回 JS 类型 |
|------|---------|-------------|
| `"s"` | `UTF8ToString(ptr)` | string |
| `"p"` | `getValue(ptr, "*")` | number (地址) |
| `"c"` | `String.fromCharCode(getValue(ptr, "i8"))` | string (单字符) |
| `"b"` | `getValue(ptr, "i8") == 1` | boolean |
| `"0"` | `getValue(ptr, "i8")` | number (1 字节) |
| `"1"` | `getValue(ptr, "i16")` | number (2 字节) |
| `"2"`, `"i"`, `"n"` | `getValue(ptr, "i32")` | number (4 字节) |
| `"f"` | `getValue(ptr, "float")` | number |
| `"d"` | `getValue(ptr, "double")` | number |
| `"v"` | — | undefined |

**setPointerValue(name, ptr, type, value)** — 根据类型向 WASM 内存写入值（用于设置返回值）：

| type | 写入方式 | 期望 JS 类型 |
|------|---------|-------------|
| `"s"` | `stringToUTF8(value, ptr, 1024)` | string |
| `"p"` | `setValue(ptr, value, "*")` | number |
| `"i"` | `setValue(ptr, value, "i32")` | number (整数) |
| `"1"` | `setValue(ptr, value, "i16")` | number (整数) |
| `"c"` | `setValue(ptr, value, "i8")` | number (0-128) |
| `"b"` | `setValue(ptr, value ? 1 : 0, "i8")` | boolean |
| `"f"`, `"d"` | `setValue(ptr, value, "double")` | number |
| `"v"` | 不做任何操作 | — |

**注意**：`setPointerValue` 中 `"s"` 类型的写入使用了硬编码的 1024 字节限制，源码注释标记为 `// TODO: uhh... danger will robinson`——这是一个潜在的缓冲区溢出风险。

---

## 5. 全局变量暴露

### 5.1 初始化顺序

在 WASM 的 `main()` 函数中，紧跟目录切换之后，依次调用三个初始化函数：

```c
#ifdef __EMSCRIPTEN__
    js_helpers_init();     // 1. 注册辅助函数（getPointerValue 等）
    js_constants_init();   // 2. 暴露 C 常量到 JS
    js_globals_init();     // 3. 暴露 C 全局变量到 JS（带 getter/setter）
#endif
```

所有数据都挂载到 `globalThis.nethackGlobal` 对象上。

### 5.2 js_helpers_init — 辅助函数

在 `globalThis.nethackGlobal.helpers` 上注册三个函数：

| 函数名 | 用途 |
|--------|------|
| `displayInventory()` | 触发背包重新填充（调用 `_repopulate_perminvent()`） |
| `getPointerValue(name, ptr, type)` | 根据类型从 WASM 内存读取值（见第 4.3 节） |
| `setPointerValue(name, ptr, type, value)` | 根据类型向 WASM 内存写入值（见第 4.3 节） |

### 5.3 js_constants_init — 常量暴露

将 C 头文件中定义的常量暴露到 `globalThis.nethackGlobal.constants` 对象中。

每个常量组是一个**双向映射**：既可以用名称查值，也可以用值查名称。

```javascript
// 例如：
nethackGlobal.constants.WIN_TYPE.NHW_MAP     // => 3
nethackGlobal.constants.WIN_TYPE[3]           // => "NHW_MAP"
```

暴露的常量分组：

| 分组名 | 内容 | 示例 |
|--------|------|------|
| `WIN_TYPE` | 窗口类型 | `NHW_MESSAGE=1`, `NHW_STATUS=2`, `NHW_MAP=3`, `NHW_MENU=4`, `NHW_TEXT=5` |
| `STATUS_FIELD` | 状态字段索引 | `BL_TITLE`, `BL_STR`, `BL_HP`, `BL_CONDITION`, `MAXBLSTATS` 等 |
| `ATTR` | 文本属性 | `ATR_NONE=0`, `ATR_BOLD=1`, `ATR_ULINE=4` 等 |
| `CONDITION` | 状态条件掩码 | `BL_MASK_BLIND`, `BL_MASK_CONF`, `BL_MASK_STUN` 等 |
| `MENU_SELECT` | 菜单选择模式 | `PICK_NONE=0`, `PICK_ONE=1`, `PICK_ANY=2` |
| `COPYRIGHT` | 版权文本 | `COPYRIGHT_BANNER_A` ~ `COPYRIGHT_BANNER_D` |
| `GLYPH` | glyph 偏移常量 | `GLYPH_MON_OFF`, `GLYPH_OBJ_OFF`, `MAX_GLYPH`, `NO_GLYPH` 等 |
| `COLORS` | 颜色常量 | `CLR_BLACK=0`, `CLR_RED=1`, ... `CLR_WHITE=15`, `CLR_MAX=16` |
| `COLOR_ATTR` | 颜色属性 | `HL_ATTCLR_BOLD`, `HL_ATTCLR_INVERSE` 等 |
| `BL_MASK` | 状态条件位掩码 | 与 CONDITION 相同的一组值 |
| `ROLE_RACEMASK` | 种族掩码 | `MH_HUMAN`, `MH_ELF`, `MH_DWARF`, `MH_GNOME`, `MH_ORC` |
| `ROLE_GENDMASK` | 性别掩码 | `ROLE_MALE`, `ROLE_FEMALE`, `ROLE_NEUTER` |
| `ROLE_ALIGNMASK` | 阵营掩码 | `ROLE_LAWFUL`, `ROLE_NEUTRAL`, `ROLE_CHAOTIC` |
| `blconditions` | 状态条件枚举 | `bl_blind`, `bl_conf`, `bl_stun` 等，加上 `CONDITION_COUNT` |
| `HL` | 高亮类型 | `HL_NONE`, `HL_BOLD`, `HL_INVERSE` 等 |
| `MG` | glyph 标志 | `MG_HERO`, `MG_PET`, `MG_CORPSE`, `MG_INVIS` 等 |

此外还暴露了指针：

| 指针名 | 访问路径 | 说明 |
|--------|---------|------|
| `extcmdlist` | `nethackGlobal.pointers.extcmdlist` | 扩展命令列表数组指针 |
| `conditions` | `nethackGlobal.pointers.conditions` | 状态条件定义数组指针 |
| `condtests` | `nethackGlobal.pointers.condtests` | 状态条件测试数组指针 |
| `roles` | `nethackGlobal.pointers.roles` | 角色定义数组指针 |
| `races` | `nethackGlobal.pointers.races` | 种族定义数组指针 |
| `genders` | `nethackGlobal.pointers.genders` | 性别定义数组指针 |
| `aligns` | `nethackGlobal.pointers.aligns` | 阵营定义数组指针 |

这些指针指向 WASM 内存中的结构体数组，需要用 `getValue` + 偏移量来逐字段读取。

### 5.4 js_globals_init — 全局变量（带 getter/setter）

将 C 全局变量暴露到 `globalThis.nethackGlobal.globals`，**使用 JavaScript 的 getter/setter 属性绑定到 WASM 内存地址**。

这意味着读写这些 JS 属性，会**直接读写 WASM 内存中的 C 变量**——零拷贝，实时同步。

```javascript
// 读取玩家名称（实际上是从 WASM 内存中的 svp.plname 地址读取）
let name = nethackGlobal.globals.svp.plname;

// 设置初始角色（实际上是向 WASM 内存中的 flags.initrole 地址写入）
nethackGlobal.globals.flags.initrole = 3;
```

暴露的全局变量：

| JS 路径 | C 变量 | 类型 | 用途 |
|---------|--------|------|------|
| `globals.svp.plname` | `svp.plname` | string | 玩家名称 |
| `globals.WIN_MAP` | `WIN_MAP` | int | 地图窗口 ID |
| `globals.WIN_MESSAGE` | `WIN_MESSAGE` | int | 消息窗口 ID |
| `globals.WIN_INVEN` | `WIN_INVEN` | int | 背包窗口 ID |
| `globals.WIN_STATUS` | `WIN_STATUS` | int | 状态窗口 ID |
| `globals.iflags.window_inited` | `iflags.window_inited` | boolean | 窗口系统是否已初始化 |
| `globals.iflags.wc2_hitpointbar` | `iflags.wc2_hitpointbar` | boolean | 是否显示 HP 条 |
| `globals.iflags.wc_hilite_pet` | `iflags.wc_hilite_pet` | boolean | 是否高亮宠物 |
| `globals.iflags.hilite_pile` | `iflags.hilite_pile` | boolean | 是否高亮物品堆 |
| `globals.flags.initrole` | `flags.initrole` | int | 初始角色（角色选择时设置） |
| `globals.flags.initrace` | `flags.initrace` | int | 初始种族 |
| `globals.flags.initgend` | `flags.initgend` | int | 初始性别 |
| `globals.flags.initalign` | `flags.initalign` | int | 初始阵营 |
| `globals.flags.showexp` | `flags.showexp` | boolean | 是否显示经验值 |
| `globals.flags.time` | `flags.time` | boolean | 是否显示游戏时间 |

### 5.5 globalThis.nethackGlobal 结构总览

```javascript
globalThis.nethackGlobal = {
    shimFunctionRunning: null | string,  // 重入检测用

    helpers: {
        displayInventory: Function,
        getPointerValue: Function,
        setPointerValue: Function,
    },

    constants: {
        WIN_TYPE: { NHW_MESSAGE: 1, NHW_MAP: 3, ... , 1: "NHW_MESSAGE", 3: "NHW_MAP", ... },
        STATUS_FIELD: { BL_HP: 20, ... },
        GLYPH: { GLYPH_MON_OFF: 0, ... },
        COLORS: { CLR_RED: 1, ... },
        MENU_SELECT: { PICK_NONE: 0, PICK_ONE: 1, PICK_ANY: 2 },
        MG: { MG_HERO: 1, MG_PET: 16, ... },
        // ... 更多分组
    },

    pointers: {
        extcmdlist: number,   // WASM 地址
        roles: number,
        races: number,
        genders: number,
        aligns: number,
        conditions: number,
        condtests: number,
    },

    globals: {
        svp: { plname: "Gandalf" },          // getter/setter 绑定
        WIN_MAP: 3,                           // getter/setter 绑定
        WIN_MESSAGE: 1,
        WIN_INVEN: 5,
        WIN_STATUS: 2,
        iflags: { window_inited: true, ... },
        flags: { initrole: -1, initrace: -1, ... },
    },
};
```

---

## 6. 附录：类型速查表

### C 类型与 JS 类型的映射

| C 类型 | 大小 | WASM getValue 类型 | JS 类型 |
|--------|------|-------------------|---------|
| `int` | 4 字节 | `"i32"` | number |
| `winid` (= int) | 4 字节 | `"i32"` | number |
| `coordxy` (= int16_t) | 2 字节 | `"i16"` | number |
| `char` | 1 字节 | `"i8"` | number / string |
| `boolean` (= char) | 1 字节 | `"i8"` | boolean (0/1) |
| `unsigned int` | 4 字节 | `"i32"` | number |
| `unsigned long` | 4 字节 (WASM32) | `"i32"` | number |
| `short` | 2 字节 | `"i16"` | number |
| `uint16` | 2 字节 | `"i16"` | number |
| `uint32` | 4 字节 | `"i32"` | number |
| `const char *` | 4 字节 (指针) | `"*"` → UTF8ToString | string |
| `void *` / 任何指针 | 4 字节 | `"*"` 或 `"i32"` | number (地址) |
| `genericptr_t` (= void *) | 4 字节 | `"*"` | number (地址) |

### glyph_info 字段偏移量速查

| 字段路径 | 相对于 glyph_info 基址的偏移 | 大小 | getValue 类型 |
|---------|---------------------------|------|--------------|
| `glyph` | +0 | 4 | `"i32"` |
| `ttychar` | +4 | 4 | `"i32"` |
| `framecolor` | +8 | 4 | `"i32"` |
| `gm.glyphflags` | +12 | 4 | `"i32"` |
| `gm.sym.color` | +16 | 4 | `"i32"` |
| `gm.sym.symidx` | +20 | 4 | `"i32"` |
| `gm.customcolor` | +24 | 4 | `"i32"` |
| `gm.color256idx` | +28 | 2 | `"i16"` |
| `gm.tileidx` | +30 | 2 | `"i16"` |

> **注意**：以上偏移量基于无 `ENHANCED_SYMBOLS` 的 32 位 WASM 构建。如果启用了 `ENHANCED_SYMBOLS`，`glyph_map` 末尾会多一个 `unicode_representation *u` 指针（4 字节），总结构体大小会增加。建议在实际项目中通过编译时 `offsetof` 或运行时检测来确认。

### 关键源文件索引

| 文件 | 路径 | 内容 |
|------|------|------|
| winshim.c | `win/shim/winshim.c` | shim 窗口接口全部实现（325 行） |
| libnhmain.c | `sys/libnh/libnhmain.c` | WASM 主入口 + JS 辅助/常量/全局初始化 |
| wintype.h | `include/wintype.h` | winid、glyph_info、menu_item、ANY_P 等类型定义 |
| winprocs.h | `include/winprocs.h` | window_procs 结构体、WC_/WC2_ 能力标志 |
| display.h | `include/display.h` | MG_* glyph 标志定义 |
| global.h | `include/global.h` | coordxy (int16_t) 等基础类型定义 |
| botl.h | `include/botl.h` | BL_* 状态字段索引、条件定义 |
| func_tab.h | `include/func_tab.h` | extcmdlist 扩展命令定义 |
| README.md | `sys/libnh/README.md` | libnh 库的构建和 API 说明 |
| window.txt | `doc/window.txt` | NetHack 官方窗口接口文档 |

# NetHack 浏览器按键编码参考

本文描述浏览器 `KeyboardEvent` 如何转换为 NetHack 5.0 接收的单字节输入。
依据为 `include/global.h`、`src/cmd.c`、`src/options.c`、
`win/curses/cursmisc.c`、`doc/guidebook.txt` 和 `win/shim/winshim.c`。

## 1. 输入边界

`shim_nhgetch` 和 `shim_nh_poskey` 的键盘返回值最终由核心按
`key & 0xff` 查找命令，因此前端统一返回 `1..255` 的无符号整数。
数值 `0` 专门表示 `nh_poskey` 的鼠标事件，不能作为键盘输入返回。

Shim 声明了 `WC_EIGHT_BIT_IN`，所以 Meta 使用第 8 位，不使用两个事件组成的
ESC 前缀：

```text
普通字符：ASCII(character)
Ctrl：    ASCII(upper(character)) & 0x1f
Meta：    ASCII(character) | 0x80
Ctrl+Meta：(ASCII(upper(character)) & 0x1f) | 0x80
```

示例：

| 输入 | 十进制 | 十六进制 |
|---|---:|---:|
| `a` | 97 | `0x61` |
| `A` | 65 | `0x41` |
| `Ctrl+A` | 1 | `0x01` |
| `Ctrl+P` | 16 | `0x10` |
| `Meta+a` | 225 | `0xe1` |
| `Meta+A` | 193 | `0xc1` |
| `Meta+?` | 191 | `0xbf` |
| `Meta+Ctrl+A` | 129 | `0x81` |

`M(c)` 在 C 中可能以有符号 `char` 显示为负数，但其 8 位模式与上述无符号值
相同。TypeScript 和 WASM 边界必须使用 `0..255`。

## 2. Ctrl 对照表

| 组合 | 值 | 组合 | 值 | 组合 | 值 |
|---|---:|---|---:|---|---:|
| Ctrl+A | 1 | Ctrl+J | 10 | Ctrl+S | 19 |
| Ctrl+B | 2 | Ctrl+K | 11 | Ctrl+T | 20 |
| Ctrl+C | 3 | Ctrl+L | 12 | Ctrl+U | 21 |
| Ctrl+D | 4 | Ctrl+M | 13 | Ctrl+V | 22 |
| Ctrl+E | 5 | Ctrl+N | 14 | Ctrl+W | 23 |
| Ctrl+F | 6 | Ctrl+O | 15 | Ctrl+X | 24 |
| Ctrl+G | 7 | Ctrl+P | 16 | Ctrl+Y | 25 |
| Ctrl+H | 8 | Ctrl+Q | 17 | Ctrl+Z | 26 |
| Ctrl+I | 9 | Ctrl+R | 18 | | |

Ctrl 不区分字母大小写。`Ctrl+[`、`Ctrl+\`、`Ctrl+]`、`Ctrl+^`、
`Ctrl+_` 分别对应 27、28、29、30、31。

## 3. 特殊键

| 浏览器按键 | NetHack 值 | 说明 |
|---|---:|---|
| Escape | 27 | 取消 |
| Enter / NumpadEnter | 10 | LF |
| Backspace | 8 | 等同 Ctrl+H |
| Delete | 127 | 独立按键，不能与 Backspace 合并 |
| Tab | 9 | 等同 Ctrl+I |
| Space | 32 | 普通空格 |

Shift 没有独立修饰位。它通过 `event.key` 改变字符，例如 `a → A`、
`1 → !`。

## 4. 方向键

方向键复制 curses 窗口端口的移动转换：

| 浏览器按键 | `number_pad=false` | `number_pad=true` |
|---|---|---|
| ArrowLeft | `h` | `4` |
| ArrowDown | `j` | `2` |
| ArrowUp | `k` | `8` |
| ArrowRight | `l` | `6` |
| Home | `y` | `7` |
| PageUp | `u` | `9` |
| End | `b` | `1` |
| PageDown | `n` | `3` |

浏览器方向键按照窗口端口的特殊方向键处理：Shift、Ctrl 和 Alt 不改变上述
映射，也不会由前端合成奔跑命令。浏览器 Meta（macOS Command、Windows 键）
组合由前端保留给系统，不传入核心。需要奔跑时直接使用 NetHack 已绑定的
大写方向字符或 Meta 方向字符。

`Numpad0..9` 按 `KeyboardEvent.code` 固定转换为 ASCII `0..9`，避免 NumLock
改变 `event.key`。NumLock 关闭而浏览器报告方向键语义时，先按上表转换。
小键盘运算键分别转换为 `. + - * / , =`。

`shim_number_pad(int state)` 只收到核心传给窗口端口的布尔值 `0` 或 `1`。
`number_pad:-1/2/3/4` 的交换 Y/Z、MSDOS 兼容和电话键盘布局保存在核心的
`iflags.num_pad_mode` 中，没有通过当前 shim ABI 暴露。前端不能推测该模式，
只能依据 `state` 在 vi 方向字符和数字方向字符之间切换。

## 5. 浏览器事件规则

1. 普通字符优先读取布局感知的 `event.key`。
2. macOS Option 等组合可能让 `event.key` 变成非 ASCII 字符或 `Dead`；
   当 `altKey` 为真时使用 `event.code` 恢复物理 ASCII 键，再设置 Meta
   高位。例如 `Option+U` 必须编码为 `M-u`，不能被当作重音符 dead key 丢弃。
3. `altKey` 表示 NetHack Meta；浏览器 `metaKey` 表示系统 Command/Windows
   修饰键，默认不传入核心，以免吞掉系统快捷键。
4. `AltGraph`、IME composing、非 Alt 的 Dead、Process、Unidentified、
   非 ASCII 字符和未支持的功能键不传入核心。
5. 只有成功转换的事件调用 `preventDefault()`。Tab、Space、方向键、
   Backspace、Delete、Enter 以及已接受的 Ctrl/Alt 组合都必须阻止浏览器
   默认行为；被保留的浏览器 Meta 组合不阻止默认行为。
6. 文本输入框由 `getlin`/`askname` 独立处理，不能经过单字节按键转换。

系统和浏览器保留组合（例如部分平台上的 Cmd+Q、Cmd+L、Ctrl+W）不保证网页能
截获，因此不能作为唯一操作路径。

## 6. 源码依据

- `include/global.h:474-490`：`C(c)`、`M(c)` 定义。
- `src/cmd.c:3680-3687`、`5163-5170`：命令键按无符号低 8 位查表。
- `src/cmd.c:5282-5294`：`altmeta` 的 ESC 前缀仅是终端兼容路径。
- `doc/guidebook.txt:780-800`：Ctrl 键说明。
- `doc/guidebook.txt:2139-2157`：Meta 设置第 8 位。
- `win/curses/cursmisc.c:819-913`：方向键转换；特殊方向键分支不调用
  普通字符的修饰键转换。
- `src/options.c:2583-2629`：核心保存完整 `number_pad` 模式，但仅向窗口端口
  传递 `0` 或 `1`。
- `win/shim/winshim.c:207-213`：`WC_EIGHT_BIT_IN` 能力声明。

前端实现位于 `frontend/src/keyboard.ts`，对应单元测试位于
`frontend/src/keyboard.test.ts`。

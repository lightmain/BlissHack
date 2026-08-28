# NetHack 构建技能

## 概述

本 skill 记录在 macOS 上编译 NetHack (RemoteHack 分支) 的完整流程，包括原版 TTY 和 HTTP 窗口接口两种构建方式。

## 前置条件

- macOS（已在 macOS 26.5.1 / arm64 上测试通过）
- Apple Clang（Xcode Command Line Tools）
- 无需额外安装任何包，TTY 和 HTTP 构建都使用系统自带的工具链

## 原版 TTY 构建

```bash
# 1. 运行 setup.sh 生成 Makefile（使用 macOS hints 文件）
cd sys/unix && sh setup.sh hints/macOS.500 && cd ../..

# 2. 获取 Lua（只需要执行一次，除非 lib/ 被删除）
make fetch-Lua

# 3. 编译
make all

# 编译产物在 src/nethack
```

## HTTP 窗口接口构建

在原版基础上增加 HTTP 窗口接口的构建：

```bash
# 1. 运行 setup.sh（同原版）
cd sys/unix && sh setup.sh hints/macOS.500 && cd ../..

# 2. 获取 Lua（同原版）
make fetch-Lua

# 3. 编译时指定 WANT_WIN_HTTP=1
make WANT_WIN_HTTP=1 all
```

这会同时编译 TTY 和 HTTP 两个窗口接口到同一个二进制文件中。
如果只想编译 HTTP 接口（不含 TTY），需要同时指定 `WANT_WIN_TTY=` （空值）。

## 切换构建模式的注意事项

**重要：** 在 TTY 和 HTTP 构建之间切换时，必须清理受影响的 .o 文件，
否则会出现链接错误。原因是 `windows.o`、`rip.o`、`mdlib.o` 等文件
的内容取决于 `HTTP_GRAPHICS` 宏是否被定义。

```bash
# 安全的切换方法：删除所有 .o 文件后重新编译
rm -f src/*.o src/nethack src/hacklib.a util/*.o util/makedefs util/recover util/dlb
cd sys/unix && sh setup.sh hints/macOS.500 && cd ../..
make all  # 或 make WANT_WIN_HTTP=1 all
```

`make spotless` 应该也能清理，但在沙箱环境中可能不够彻底。

## 踩坑记录

### 1. nroff 未找到（无影响）

```
/bin/sh: nroff: command not found
expr: syntax error
```

这两行警告出现在每个 make 步骤中，来自 hints 文件中的版本检测逻辑。
**不影响编译结果**，可以安全忽略。如果想消除，可以 `brew install groff`。

### 2. 重复链接 ncurses（无影响）

```
ld: warning: ignoring duplicate libraries: '-lncurses'
```

hints 文件的 curses 配置逻辑导致 `-lncurses` 被添加两次。
**不影响编译结果**，链接器自动忽略重复。

### 3. genl_outrip 未定义（已修复）

第一次编译 HTTP 版本时链接失败：
```
Undefined symbols: "_genl_outrip"
```

原因：`src/rip.c` 中的 `TEXT_TOMBSTONE` 宏仅在已知窗口系统
（TTY、X11、curses 等）被定义时才启用。

修复：在 `src/rip.c` 第 11 行的条件列表中添加 `HTTP_GRAPHICS`。

### 4. makedefs 不认识 HTTP_GRAPHICS（已修复）

`makedefs -v` 报错：
```
Configuration error: no windowing systems (TTY_GRAPHICS, &c) enabled.
```

原因：`src/mdlib.c` 中的 `window_opts[]` 数组没有 HTTP 的条目。

修复：在 `src/mdlib.c` 的 `window_opts[]` 中添加 HTTP 条目。

### 5. 切换构建模式导致链接错误

从 HTTP 构建切换回 TTY 构建时：
```
Undefined symbols: "_http_procs" / "_extcmd_via_menu"
```

原因：`windows.o` 等文件中编译了对 `http_procs` 的引用（因为上次
编译定义了 `HTTP_GRAPHICS`），但 TTY 构建不包含 `winhttp.o`。

修复：切换构建模式前必须删除所有 .o 文件重新编译。

## 修改的原版文件清单

为支持 HTTP 窗口接口，修改了以下原版 NetHack 文件：

| 文件 | 修改内容 |
|------|----------|
| `include/winprocs.h` | 在 `wp_ids` 枚举中添加 `wp_http` |
| `include/config.h` | 添加 `HTTP_GRAPHICS` 的 `DEFAULT_WINDOW_SYS` 和 `CHDIR` 排除 |
| `src/windows.c` | 添加 `http_procs` 的 extern 声明和 `winchoices` 注册 |
| `src/mdlib.c` | 在 `window_opts[]` 中添加 HTTP 条目 |
| `src/rip.c` | 在 `TEXT_TOMBSTONE` 条件中添加 `HTTP_GRAPHICS` |
| `sys/unix/Makefile.src` | 添加 `WINHTTPSRC`/`WINHTTPOBJ` 定义和编译规则 |
| `sys/unix/hints/include/multiw-2.500` | 添加 `WANT_WIN_HTTP` 处理逻辑 |

## 新增文件

| 文件 | 说明 |
|------|------|
| `win/http/winhttp.c` | HTTP 窗口接口的 `window_procs` 存根实现 |

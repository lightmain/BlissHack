# NetHack 原项目心智模型

本文介绍 NetHack 原项目的代码组织和运行方式。这里的“原项目”指
NetHack 自己的 C 语言代码、构建脚本、数据文件和界面代码。本文不会讲
GodotHack 新增的 Godot 客户端和 TCP JSON 协议。

阅读本文只需要你熟悉 C 语言的基本语法、函数调用、结构体、数组和头文件。
如果一个概念对理解 NetHack 很重要，本文会先给出定义，再继续使用同一个
名称。

## 先建立几个固定概念

NetHack 是一个 C 语言项目。C 语言项目通常由两类文件组成：

- 源文件：文件名通常以 `.c` 结尾。源文件包含函数实现。例如
  `src/hack.c` 包含角色移动相关的实现。
- 头文件：文件名通常以 `.h` 结尾。头文件包含结构体定义、常量定义、函数
  声明和一部分可重复包含的数据表。例如 `include/permonst.h` 定义怪物类型
  使用的结构体。

NetHack 的构建系统大量使用 Makefile。Makefile 是一种文本文件，里面写着
“哪些源文件要编译、生成哪些中间文件、最终生成哪些可执行文件”。`make`、
`nmake` 和 Visual Studio 都可以读取某种形式的构建规则，然后调用编译器和
链接器。

本文统一使用下面几个名称：

- 工具链：编译器、链接器、构建工具和必要脚本的组合。编译器把 `.c` 文件
  编译成目标文件，链接器把目标文件和库组合成可执行文件，构建工具根据
  Makefile 或 Visual Studio 项目文件决定执行顺序。
- 目标文件：单个源文件编译后的中间文件。目标文件还不能独立运行，需要由
  链接器和其他目标文件、库一起生成可执行文件。
- 库：已经编译好的可复用代码集合。链接器可以把库里的函数接入可执行文件。
- 可执行文件：操作系统可以直接运行的程序文件。Windows 上常见后缀是
  `.exe`，Linux 和 macOS 上通常没有固定后缀。
- 解决方案文件：Visual Studio 使用的顶层项目文件。它记录一组相关项目、
  构建配置和项目之间的依赖关系。
- 平台适配代码：负责处理不同操作系统差异的代码。例如 Windows 的路径、
  控制台、进程入口函数，Linux 和 macOS 的用户目录、权限、终端行为。
- 窗口接口：NetHack 内部对“显示内容、读取按键、弹出菜单、刷新地图”的
  抽象。原项目代码里经常称为 window port。本文统一称为窗口接口。
- TTY：传统文本终端。TTY 窗口接口把地图、消息、菜单等内容显示为字符界面。
- curses：一类终端界面库。curses 窗口接口可以在终端里控制光标位置、颜色
  和局部刷新。
- X11：Linux 和其他 Unix 系统上常见的图形窗口系统协议。X11 窗口接口通过
  X11 显示图形界面。
- Qt：一套跨平台图形界面库。Qt 窗口接口通过 Qt 显示图形界面。
- 类型数据：描述一种东西的固定属性。例如“长剑”这种物品类型的重量、价格、
  伤害。
- 实例数据：描述游戏运行中某一个具体东西的当前状态。例如“地上那把被诅咒
  的 +1 长剑”的位置、祝福状态、强化值。
- 枚举：C 语言中给一组整数常量命名的机制。例如怪物类型编号可以用
  `PM_KILLER_BEE` 这样的名字表示。
- 条件编译：C 预处理器根据 `#ifdef`、`#if` 等条件决定是否把某段代码交给
  编译器。NetHack 用条件编译支持不同平台和不同窗口接口。
- Windows SDK：微软提供的 Windows 开发工具集合。SDK 是 Software
  Development Kit 的缩写，意思是软件开发工具包。
- 处理器架构：处理器执行指令的格式和约定。x64 和 ARM64 是两种处理器架构。

## 编译方式

编译 NetHack 时，你需要把源码树放在标准目录结构中。源码树是项目根目录及
其所有子目录。项目根目录里能看到 `src`、`include`、`dat`、`sys`、`win`、
`util`、`doc` 等目录。NetHack 的 Makefile 假设这些目录位置固定。

### Windows：Visual Studio 图形界面

Windows 上最直接的方式是使用 Visual Studio。这里的 Visual Studio 指微软
提供的集成开发环境，它可以打开解决方案文件、调用 MSVC 编译器并启动调试。
MSVC 是微软的 C/C++ 编译器。

主要文件和步骤：

1. 安装 Visual Studio Community，并安装目标平台需要的 MSVC 构建组件。
2. 在源码树根目录执行 `sys\windows\fetch.cmd lua`。NetHack 5.0 的 Windows
   构建需要 Lua 源码。Lua 是一种脚本语言，NetHack 用它描述部分关卡。
3. 如果你想编译 curses 窗口接口，执行
   `sys\windows\fetch.cmd pdcursesmod`。pdcursesmod 是 Windows 上可用的
   curses 实现。
4. 打开 `sys\windows\vs\NetHack.sln`。
5. 在 Visual Studio 中选择目标平台，例如 x64 或 ARM64，再构建解决方案。

这个方式会生成两个主要程序：

- `nethack.exe`：控制台版本，可以包含 TTY 窗口接口和 curses 窗口接口。
- `nethackw.exe`：Windows 图形版本，可以包含 Windows 图形窗口接口和 curses
  窗口接口。

### Windows：nmake 命令行

`nmake` 是 Visual Studio 附带的 Makefile 构建工具。当前机器的 PowerShell
配置里有 `vs64` 函数。`vs64` 会加载 Visual Studio 2022 x64 开发环境，让
命令行能够找到 MSVC、`nmake` 和 Windows SDK。MSVC 是微软的 C/C++ 编译器。

当前仓库建议直接使用 `sys/windows/Makefile.nmake`，避免运行 `nhsetup.bat`
覆盖 `src/Makefile`。`src/Makefile` 可能来自旧版本，不应作为 NetHack 5.0
的 nmake 构建入口。

当前可验证流程：

1. 在 PowerShell 中执行 `vs64`。这个`vs64`是我在`$PROFILE`中自定义的函数，用于启动Visual Studio x64命令行环境：

   ```powershell
   function vs64 {
       Push-Location
       & "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\Launch-VsDevShell.ps1" -Arch amd64
       Pop-Location
   }
   ```

2. 进入源码树的 `src` 目录。

3. 执行
   `nmake /f ..\sys\windows\Makefile.nmake GIT_AVAILABLE=N TARGET_CPU=x64 CURSES_CONSOLE=N CURSES_GRAPHICAL=N package`。

这个流程会在 `binary` 目录放置中间产物，并在 `package` 目录生成 Windows
发布包。中间产物是构建过程中生成、供后续步骤使用的文件，例如目标文件和
构建工具程序。

### Windows：MSYS2

MSYS2 是 Windows 上的一套类 Unix 命令行环境。类 Unix 命令行环境提供
`sh`、`make`、`gcc` 等工具。`gcc` 是 GNU Compiler Collection 的 C 编译器。
UCRT64 shell 是 MSYS2 提供的一种命令行入口，适合构建 64 位 Windows 程序。

官方流程的核心步骤：

1. 安装 MSYS2，并打开 UCRT64 shell。
2. 安装构建依赖，例如 `gcc`、`git`、`make`。
3. 在源码树根目录执行 `sh sys/windows/fetch.sh lua`。
4. 如需 curses 窗口接口，执行 `sh sys/windows/fetch.sh pdcursesmod`。
5. 在源码树根目录执行 `cp sys/windows/GNUmakefile* src`。
6. 进入 `src`。
7. 执行 `make clean`、`make depend`、`make`。

`make depend` 会更新依赖关系。依赖关系说明“某个源文件依赖哪些头文件”。
当头文件改变时，构建工具据此决定哪些源文件需要重新编译。

### Linux

Linux 上推荐从新的 hints 系统开始。hints 文件是 NetHack 提供的一组构建
配置文件。hints 文件会设置编译选项、安装目录、权限和窗口接口选择。Linux
常用的 hints 文件是 `sys/unix/hints/linux.500`。

基础工具链包括 C 编译器、`make`、`sh` 和常见 Unix 工具。很多发行版默认
提供 `gcc` 或 `clang`。`clang` 是 LLVM 项目的 C/C++ 编译器。

典型流程：

1. 进入 `sys/unix`。
2. 执行 `sh setup.sh hints/linux.500`。
3. 回到源码树根目录。
4. 执行 `make fetch-Lua`。
5. 执行 `make all`。
6. 如需安装到 hints 文件指定的位置，执行 `make install`。

默认构建通常只启用 TTY 窗口接口。你可以在 `make all` 时指定窗口接口：

```sh
make WANT_WIN_TTY=1 WANT_WIN_CURSES=1 all
```

这个例子会构建包含 TTY 窗口接口和 curses 窗口接口的程序。若要启用 X11
窗口接口，需要安装 X11 开发包。若要启用 Qt 窗口接口，需要安装 Qt 开发包。

### macOS

macOS 有两条常见路径：Unix Makefile 路径和 Xcode 路径。

Unix Makefile 路径和 Linux 接近。macOS 常用的 hints 文件是
`sys/unix/hints/macOS.500`。基础工具链通常来自 Xcode Command Line Tools，
其中包括 Apple Clang、`make` 和系统头文件。

典型流程：

1. 进入 `sys/unix`。
2. 执行 `sh setup.sh hints/macOS.500`。
3. 回到源码树根目录。
4. 执行 `make fetch-Lua`。
5. 执行 `make all`。
6. 如需安装，执行 `make install`。

Xcode 路径使用 `sys/unix/NetHack.xcodeproj`。Xcode 是 Apple 的集成开发环境。
如果使用 Xcode 构建，官方说明要求在 `sys/unix` 下创建
`XCodeLocal.xcconfig`，并写入 `DEVELOPMENT_TEAM = XXXXXXXXXX`。这里的
`DEVELOPMENT_TEAM` 是 Apple 开发者团队标识。Xcode 构建结果默认放在
`~/nethackdir`。

## 运行时主线

NetHack 的运行可以按“启动、初始化、进入主循环、处理命令、更新时间”来理解。

启动入口在平台适配代码里。Linux 和 macOS 常用
`sys/unix/unixmain.c`，Windows 使用 `sys/windows/windmain.c`。这些文件里的
入口函数负责读取命令行参数、选择窗口接口、设置目录、检查存档，然后进入
通用游戏逻辑。

通用初始化在 `src/allmain.c`。`early_init()` 会初始化多组全局状态，包括
物品类型数据和怪物类型数据。这里的全局状态指整个程序都能访问的一组变量。
例如：

- `objects_globals_init()` 把物品类型数据复制到运行期数组。
- `monst_globals_init()` 把怪物类型数据复制到运行期数组。

新游戏会调用 `newgame()`。`newgame()` 会初始化玩家角色、创建初始关卡、
放置初始物品、设置可见区域，并创建消息窗口、地图窗口、状态窗口和物品栏
窗口。这里的“窗口”是 NetHack 内部概念，可以映射到终端区域，也可以映射到
图形界面控件。

主循环函数是 `moveloop()`，位置在 `src/allmain.c`。主循环是一个不会主动
返回的循环。每一次循环调用 `moveloop_core()`。`moveloop_core()` 会处理
输入事件、玩家行动、怪物行动、生命恢复、魔法恢复、计时效果、随机生成怪物
等事情。

一个具体例子是“玩家向东移动”：

1. 窗口接口读取按键。TTY 窗口接口的实现位于 `win/tty`，Windows 图形窗口
   接口的实现位于 `win/win32`。
2. `src/cmd.c` 的命令解析代码把按键映射到命令函数。向东移动最终会调用
   `do_move_east()`。
3. `do_move_east()` 设置移动方向，并返回“这个命令消耗游戏时间”的结果。
4. `src/hack.c` 中的移动代码检查目标格子。检查内容包括墙、门、陷阱、怪物、
   水、岩石、负重和特殊状态。
5. 如果移动成功，玩家位置和关卡状态发生变化。随后主循环让怪物移动，处理
   计时效果，并刷新窗口接口显示的内容。

这个例子说明一个重要事实：窗口接口负责输入和显示，规则代码负责判断行动
是否成立。想改键盘、鼠标、菜单、地图绘制时，通常先看 `win` 目录和
`src/windows.c`。想改移动规则、战斗规则、物品效果时，通常先看 `src` 目录。

## 代码整体结构

### `src`

`src` 是核心游戏逻辑目录。核心游戏逻辑指不依赖某个特定操作系统和特定窗口
接口的规则代码。

常见文件分组：

- `allmain.c`：通用初始化和主循环。
- `cmd.c`：命令表、命令解析、扩展命令。扩展命令指以 `#` 触发或拥有完整
  命令名的命令，例如 `#chat`。
- `hack.c`：玩家移动、推动岩石、地形检查、走到特殊格子后的处理。
- `uhitm.c`、`mhitm.c`、`mhitu.c`：战斗相关代码。文件名里的 `u` 表示玩家，
  `m` 表示怪物。
- `mklev.c`、`mkmap.c`、`mkmaze.c`、`mkroom.c`：关卡生成相关代码。
- `mkobj.c`：创建物品实例。
- `makemon.c`：创建怪物实例。
- `mon.c`、`monmove.c`、`dog.c`、`dogmove.c`：怪物行为和宠物行为。
- `objects.c`：根据 `include/objects.h` 初始化物品类型数据。
- `monst.c`：根据 `include/monsters.h` 初始化怪物类型数据。
- `role.c`：角色、种族、阵营、职业任务相关的固定数据。
- `artifact.c`：神器逻辑。神器指拥有特殊名称和特殊效果的物品。
- `invent.c`、`pickup.c`、`do_wear.c`、`wield.c`：物品栏、拾取、穿戴、持用。
- `save.c`、`restore.c`、`sfbase.c`、`sfstruct.c`：存档和读档。
- `sp_lev.c`、`nhlua.c`、`nhlobj.c`、`nhlsel.c`：Lua 关卡脚本支持。
- `windows.c`：窗口接口选择和窗口接口公共包装逻辑。

例子：如果你想知道“为什么玩家不能斜向挤过某些地形”，可以从 `src/hack.c`
开始，因为这个问题属于玩家移动规则。随后再看 `include/rm.h`，因为地形类型
的结构体和常量在那一类头文件中定义。

### `include`

`include` 是头文件目录。头文件承担三类职责：

1. 定义结构体。例如 `include/obj.h` 定义物品实例，`include/monst.h` 定义
   怪物实例，`include/you.h` 定义玩家状态。
2. 定义常量和编号。例如 `include/objclass.h` 定义物品类型编号，
   `include/permonst.h` 定义怪物类型编号。
3. 提供可被多次包含的数据表。例如 `include/objects.h` 和
   `include/monsters.h`。

“可被多次包含的数据表”需要单独解释。普通头文件通常只包含一次，避免重复
定义。`include/objects.h` 和 `include/monsters.h` 的设计不同：不同 `.c`
文件在包含它们之前先定义不同的宏，同一份数据就能生成不同结果。

例子：`include/objects.h` 中一行 `WEAPON("spear", ...)` 在一种宏定义下会
变成物品类型编号，在另一种宏定义下会变成 `objects` 数组的一项。这种写法
避免手写两份容易不一致的数据。

### `dat`

`dat` 存放运行时数据和关卡脚本。运行时数据指程序运行时会读取的文本、脚本
或生成后的数据文件。

重要类别：

- `*.lua`：特殊关卡和任务关卡脚本。Lua 关卡脚本会调用 `des.room()`、
  `des.monster()`、`des.object()` 等函数描述关卡内容。
- `dungeon.lua`：地牢结构定义。这里的地牢结构指不同区域和楼层之间的组织
  关系。
- `quest.lua`：职业任务相关的关卡组织。
- `data.base`：游戏内百科信息的源数据之一。
- `rumors.tru`、`rumors.fal`：真传闻和假传闻。
- `oracles.txt`：神谕文本。
- `cmdhelp`、`help`、`hh`、`opthelp`、`keyhelp`：帮助文本。

例子：`dat/air.lua` 描述空气元素位面。文件里会出现
`des.monster({ id = "air elemental", peaceful = 0 })`。这行代码表示在关卡
上放置一个非和平的空气元素。这里的 `"air elemental"` 会和怪物类型数据中的
名称匹配。

### `util`

`util` 存放构建时使用的小程序。构建时使用的小程序指“先由工具链编译出来，
再在构建过程中运行”的辅助程序。

最重要的是 `util/makedefs.c`。`makedefs` 会从源数据生成若干数据文件和头文件
片段。例如帮助数据、传闻数据、枚举信息、部分索引信息都可能经过它处理。

其他常见工具：

- `recover.c`：恢复异常中断后的游戏文件。
- `dlb_main.c`：生成或读取数据包文件。数据包文件是把多个运行时数据文件
  合并后的文件，便于发布和读取。
- `sftags.c`、`sfctool.c`：存档格式相关工具。

### `sys`

`sys` 存放平台适配代码和平台构建文件。

和 Windows、Linux、macOS 最相关的目录：

- `sys/windows`：Windows 构建脚本、Windows 启动代码、Windows 配置模板。
- `sys/windows/vs`：Visual Studio 解决方案和项目文件。
- `sys/unix`：Linux 和 macOS 使用的 Makefile、hints 系统、Unix 启动代码。
- `sys/share`：多个平台共用的平台适配代码。

例子：`sys/unix/unixmain.c` 和 `sys/windows/windmain.c` 都会调用
`choose_windows()` 选择窗口接口，然后进入相同的核心游戏逻辑。两者的差异
主要来自操作系统，游戏规则仍然走相同的核心游戏逻辑。

### `win`

`win` 存放窗口接口实现。窗口接口实现负责把 NetHack 核心逻辑的显示请求和
输入请求连接到具体界面。

常见目录：

- `win/tty`：传统文本终端。
- `win/curses`：curses 终端界面。
- `win/win32`：Windows 图形界面。
- `win/X11`：X11 图形界面。
- `win/Qt`：Qt 图形界面。
- `win/share`：多种窗口接口共享的图块处理代码。

`include/winprocs.h` 定义 `struct window_procs`。这个结构体包含大量函数指针。
函数指针是保存函数地址的变量。NetHack 通过这些函数指针调用当前选择的窗口
接口。

例子：核心逻辑调用 `print_glyph()` 显示地图格子。`print_glyph()` 最终会
调用当前窗口接口提供的函数。TTY 窗口接口会把格子显示成字符，Windows 图形
窗口接口可以把格子显示成图形元素。

### `doc`、`DEVEL`、`test`

`doc` 是玩家文档和传统手册页。手册页是一种 Unix 风格的命令行文档格式。
`doc/Guidebook.txt` 是玩家手册文本版。

`DEVEL` 是开发者资料。这里有代码风格、开发流程、版本信息等内容。

`test` 存放测试脚本。测试脚本主要覆盖配置、Lua 关卡脚本、物品数据和部分
源码约束。它们适合在修改数据表或关卡脚本后做基本检查。

## 游戏数据存放位置

NetHack 的游戏数据分为类型数据和实例数据。理解这两个概念会降低阅读源码的
难度。

类型数据描述“这一类东西是什么”。类型数据通常写在源码或脚本中，编译或加载
后进入内存。实例数据描述“当前游戏中某一个具体东西的状态”。实例数据在运行
时创建，保存游戏时写入存档。

### 物品类型数据

物品类型数据的核心位置是 `include/objects.h`。物品类型使用 `OBJECT()`、
`WEAPON()`、`PROJECTILE()` 等宏写成。宏是 C 预处理器在编译前展开的文本
规则。C 预处理器是 C 编译器前置的一步，它会处理 `#include`、`#define` 等
指令。

`include/objclass.h` 定义 `struct objclass`。这个结构体说明每个物品类型有
哪些字段。字段包括：

- 物品类别，例如武器、盔甲、药水、卷轴、魔杖。
- 出现概率。
- 重量。
- 商店基础价格。
- 武器伤害。
- 盔甲防御值。
- 营养值。
- 材质。
- 颜色。

`src/objects.c` 包含 `include/objects.h`，并生成两个运行期数组：

- `obj_descr`：物品名称和未鉴定描述。
- `objects`：物品类型属性。

例子：`include/objects.h` 中的 `WEAPON("spear", ...)` 描述长矛这种物品类型。
这一行包含名称、出现概率、重量、价格、小型怪物伤害、大型怪物伤害、技能
类别、材质和颜色。游戏运行时创建一把长矛时，`src/mkobj.c` 会使用
`objects[SPEAR]` 作为基础属性，再给具体物品实例设置位置、数量、祝福状态、
强化值等实例数据。

物品实例的结构体是 `struct obj`，定义在 `include/obj.h`。如果你想改“长矛
这种物品的基础伤害”，看 `include/objects.h`。如果你想理解“某一把长矛被
烧毁、被拾起、在背包里叠放”的逻辑，看 `include/obj.h`、`src/mkobj.c`、
`src/invent.c`、`src/pickup.c` 和相关使用点。

### 怪物类型数据

怪物类型数据的核心位置是 `include/monsters.h`。怪物类型使用 `MON()` 宏
写成。

`include/permonst.h` 定义 `struct permonst`。这个结构体说明每个怪物类型有
哪些字段。字段包括：

- 名称。
- 地图符号。
- 基础等级。
- 移动速度。
- 基础防御值。
- 魔法抗性。
- 阵营倾向。
- 生成规则。
- 最多六个攻击方式。
- 重量。
- 营养值。
- 声音类型。
- 体型。
- 抗性。
- 被吃掉后可能给予的抗性。
- 行为标志。
- 难度。
- 颜色。

`src/monst.c` 包含 `include/monsters.h`，并生成运行期数组 `mons`。`mons`
是怪物类型的主表。

例子：`include/monsters.h` 中的 `MON(NAM("killer bee"), ...)` 描述杀人蜂
这种怪物类型。它的攻击方式包含螫刺和毒伤害，它有毒抗性，它的生成规则允许
成群生成。游戏运行时创建一只杀人蜂时，`src/makemon.c` 会使用
`mons[PM_KILLER_BEE]` 作为基础属性，再给具体怪物实例设置坐标、生命值、
和平状态、携带物品等实例数据。

怪物实例的结构体是 `struct monst`，定义在 `include/monst.h`。如果你想改
“杀人蜂这种怪物的速度或攻击”，看 `include/monsters.h`。如果你想理解“一只
已经在地图上的杀人蜂如何移动、攻击、死亡”，看 `include/monst.h`、
`src/makemon.c`、`src/monmove.c`、`src/mhitu.c` 和 `src/mon.c`。

### 神器数据

神器数据主要在 `include/artilist.h`。神器是特殊命名物品。每个神器都基于
一个物品类型，并附加特殊条件和特殊效果。

`include/artifact.h` 定义神器结构体。`src/artifact.c` 实现神器创建、神器
攻击、神器防御、神器调用等逻辑。

例子：`Excalibur` 基于 `LONG_SWORD`。`LONG_SWORD` 是长剑这种物品类型，
定义在 `include/objects.h`。`Excalibur` 的限制、阵营、特殊攻击和价值定义
在 `include/artilist.h`。因此，修改长剑的基础重量会影响普通长剑，也会影响
基于长剑的神器；修改 `Excalibur` 的特殊攻击只需要看神器数据和神器逻辑。

### 角色、种族和初始状态

角色、种族、阵营、职业任务信息主要在 `src/role.c`。这里的角色指
Archeologist、Barbarian、Wizard 等职业。种族指 Human、Dwarf、Elf、Gnome、
Orc 等可选血统。阵营指 Lawful、Neutral、Chaotic。

`src/u_init.c` 负责玩家初始物品和初始状态。玩家状态结构体定义在
`include/you.h`。

例子：如果你想知道“法师开局为什么有某些物品”，应该先看 `src/u_init.c`。
如果你想知道“哪些种族可以选择法师”，应该先看 `src/role.c`。

### 关卡和地牢结构

关卡脚本主要在 `dat/*.lua`。NetHack 5.0 使用 Lua 描述许多特殊关卡。Lua
脚本通过 `des` 开头的函数描述地图、房间、怪物、物品、陷阱、楼梯、传送
区域等内容。

地牢结构主要在 `dat/dungeon.lua`。职业任务结构主要在 `dat/quest.lua`。
Lua 关卡脚本的 C 语言支持代码在 `src/nhlua.c`、`src/sp_lev.c`、
`src/nhlobj.c` 和 `src/nhlsel.c`。

例子：`dat/Arc-goal.lua` 是 Archeologist 职业任务的目标关卡。文件中
`des.object({ id = "crystal ball", ... name = "The Orb of Detection" })`
表示放置一个名为 The Orb of Detection 的水晶球。这个例子同时关联了关卡
脚本、物品类型数据和神器数据。

### 文本、帮助和显示符号

玩家可见的许多长文本在 `dat` 和 `doc` 中。游戏内帮助常见于 `dat/help`、
`dat/hh`、`dat/cmdhelp`、`dat/opthelp`。玩家手册在 `doc/Guidebook.txt`。

显示符号相关文件包括 `include/defsym.h`、`src/symbols.c` 和 `dat/symbols`。
显示符号指地图上墙、门、怪物、物品、陷阱等东西对应的字符或图形编号。

图块素材相关源文件主要在 `win/share`。`win/share/objects.txt`、
`win/share/monsters.txt` 和 `win/share/other.txt` 描述图块和游戏概念之间
的对应关系。图块指图形界面中用于显示地图格子的图片单元。

## 建议的熟悉路线

第一步，先编译一个最简单的 TTY 版本。TTY 版本最接近核心逻辑，调试时变量
和函数调用关系也更直接。Windows 上可以用 Visual Studio 或 `nmake`，Linux
和 macOS 上可以用 hints 系统加 `make all`。

第二步，运行游戏并观察一次完整启动。你可以从入口文件开始读：

- Linux 和 macOS：`sys/unix/unixmain.c`
- Windows：`sys/windows/windmain.c`
- 通用主循环：`src/allmain.c`

读的时候只追踪一条路径：新游戏从入口函数到 `newgame()`，再到 `moveloop()`。
不要一开始就展开每个配置选项和每个条件编译分支。

第三步，追踪一个普通命令。推荐追踪“向东移动”：

- `src/cmd.c`：按键如何变成命令函数。
- `src/hack.c`：移动规则如何检查目标格子。
- `src/allmain.c`：玩家行动后为什么轮到怪物行动和计时效果。

第四步，追踪一个物品类型。推荐从 `spear` 开始：

- `include/objects.h`：长矛的类型数据。
- `include/objclass.h`：每个字段的含义。
- `src/objects.c`：类型数据如何进入运行期数组。
- `src/mkobj.c`：如何创建具体物品实例。

第五步，追踪一个怪物类型。推荐从 `killer bee` 开始：

- `include/monsters.h`：杀人蜂的类型数据。
- `include/permonst.h`：每个字段的含义。
- `src/monst.c`：类型数据如何进入运行期数组。
- `src/makemon.c`：如何创建具体怪物实例。
- `src/monmove.c` 和 `src/mhitu.c`：怪物如何移动和攻击玩家。

第六步，追踪一个特殊关卡。推荐从 `dat/air.lua` 或某个职业任务关卡开始。
先读 Lua 文件里的 `des.level_init()`、`des.map()`、`des.monster()`、
`des.object()`，再回到 `src/sp_lev.c` 和 `src/nhlua.c` 看 C 语言如何执行这些
关卡描述。

第七步，做一个很小的实验。小实验应该只改一处类型数据，并验证结果。例如：

- 改一个普通物品的出现概率。
- 改一个普通怪物的颜色。
- 改一个特殊关卡中某个固定怪物的数量。

实验时要记录修改了哪个文件、重新编译了什么、运行时看到了什么。NetHack 的
全局状态和条件编译很多，短记录能帮助你避免把偶然现象误认为规则。

## 窗口接口 `struct window_procs` 的完整调用链

本节里的调用链指“从一个入口函数开始，经过哪些函数和数据结构，最后执行到
目标函数实现”的路径。窗口接口调用链解决的问题是：核心游戏逻辑只调用
`print_glyph()`、`putstr()`、`nh_poskey()` 这样的统一名字，为什么最后会进入
TTY、curses、Windows 图形界面、X11 或 Qt 的具体实现。

`struct window_procs` 定义在 `include/winprocs.h`。这个结构体的字段大多是
函数指针。函数指针是保存函数地址的变量。NetHack 把“初始化窗口、创建窗口、
显示字符串、显示地图格子、读取按键、弹出菜单、刷新状态栏”等操作都放进
这个结构体。

一个窗口接口实现会创建一个 `struct window_procs` 变量，并把字段填成自己的
函数。例如：

- `win/tty/wintty.c` 定义 `tty_procs`。
- `win/curses/cursmain.c` 定义 `curses_procs`。
- `win/win32/mswproc.c` 定义 `mswin_procs`。
- `win/X11/winX.c` 定义 `X11_procs`。

调用链的第一段发生在构建阶段。构建配置会决定哪些窗口接口参与编译。例如
启用 TTY 窗口接口时会定义 `TTY_GRAPHICS`，启用 Windows 图形窗口接口时会
定义 `MSWIN_GRAPHICS`。这些条件编译开关会影响 `src/windows.c` 中哪些
`extern struct window_procs ...` 声明生效，也会影响 `winchoices` 数组中出现
哪些窗口接口。

调用链的第二段发生在程序启动阶段。Linux 和 macOS 的启动入口通常在
`sys/unix/unixmain.c`，Windows 的启动入口在 `sys/windows/windmain.c`。启动
代码会调用 `choose_windows()`。`choose_windows()` 定义在 `src/windows.c`。
它会在 `winchoices` 数组中查找名字匹配的窗口接口，然后把对应的
`struct window_procs` 复制到全局变量 `windowprocs`。

全局变量 `windowprocs` 是当前正在使用的窗口接口。复制完成后，核心逻辑通过
`windowprocs` 调用函数，不需要知道当前界面来自 `win/tty` 还是 `win/win32`。

调用链的第三段由 `include/winprocs.h` 中的宏完成。宏是 C 预处理器在编译前
展开的文本规则。`include/winprocs.h` 把很多统一名字定义成 `windowprocs` 的
字段调用。例如：

```c
#define create_nhwindow (*windowprocs.win_create_nhwindow)
#define print_glyph (*windowprocs.win_print_glyph)
#define nh_poskey (*windowprocs.win_nh_poskey)
```

这表示核心逻辑写 `print_glyph(...)` 时，C 预处理器会把它展开成对
`windowprocs.win_print_glyph` 的函数指针调用。当前 `windowprocs` 来自哪个
窗口接口，最终就进入哪个窗口接口的具体函数。

一个地图显示路径可以这样追踪：

1. 核心逻辑判断某个地图格子需要显示。
2. 核心逻辑调用 `print_glyph()`。
3. `include/winprocs.h` 把 `print_glyph()` 展开成
   `(*windowprocs.win_print_glyph)(...)`。
4. 如果当前窗口接口是 TTY，调用会进入 `win/tty/wintty.c` 中对应的显示函数。
5. 如果当前窗口接口是 Windows 图形界面，调用会进入 `win/win32` 中对应的
   显示函数。

这个路径说明：地图格子的游戏含义由核心逻辑决定，地图格子的显示方式由窗口
接口决定。

一个玩家输入路径可以这样追踪：

1. 主循环在 `src/allmain.c` 中执行。
2. 命令解析代码在 `src/cmd.c` 中需要读取玩家输入。
3. 输入读取会经过 `readchar()`、`readchar_core()`。
4. `readchar_core()` 调用 `nh_poskey()`。
5. `include/winprocs.h` 把 `nh_poskey()` 展开成
   `(*windowprocs.win_nh_poskey)(...)`。
6. 当前窗口接口返回按键、鼠标位置或修饰键状态。
7. `src/cmd.c` 根据返回值查找命令表，并执行对应命令函数。

这个路径说明：窗口接口负责把操作系统输入转换成 NetHack 能理解的输入值；
命令是否消耗游戏时间、命令会改变哪些游戏状态，仍由核心游戏逻辑决定。

`src/windows.c` 还包含几层公共包装逻辑。公共包装逻辑指“所有窗口接口共用的
前后处理”。例如 `add_menu()`、`select_menu()`、`getlin()`、`yn_function()`
在 NetHack 5.0 中有核心层实现，然后核心层再调用 `windowprocs` 中的具体
函数。这样做可以把菜单颜色、输入长度检查、选择结果整理等共同行为放在一处。

调试窗口接口调用链时，可以按下面顺序打断点：

1. `src/windows.c` 的 `choose_windows()`：确认启动时选择了哪个窗口接口。
2. `src/allmain.c` 的 `init_sound_disp_gamewindows()`：观察消息窗口、地图窗口、
   状态窗口和物品栏窗口的创建。
3. `src/cmd.c` 的 `readchar_core()`：观察输入如何进入命令解析。
4. 当前窗口接口的 `win_nh_poskey` 对应函数：观察具体平台如何返回按键。
5. 当前窗口接口的 `win_print_glyph` 对应函数：观察地图格子如何显示。

如果你只是静态阅读代码，推荐阅读顺序是：

1. `include/winprocs.h`：先看 `struct window_procs` 有哪些字段。
2. `src/windows.c`：再看 `winchoices` 和 `choose_windows()`。
3. `win/tty/wintty.c`：用 TTY 窗口接口作为第一个具体实现。
4. `src/cmd.c`：看输入值如何变成命令函数。
5. `src/display.c` 和 `src/allmain.c`：看显示刷新从哪里发起。

## NetHack 原项目测试与调试入口

本节把测试入口和调试入口分开说明。测试入口指“运行一组预先写好的检查，让
程序自己报告是否失败”。调试入口指“让开发者观察或控制一次运行过程，定位
具体问题”。

### Lua 测试入口

NetHack 原项目的 `test` 目录里有一组 Lua 测试文件，例如 `test_sel.lua`、
`test_obj.lua`、`test_des.lua`、`test_shk.lua`、`test_src.lua`。这些文件主要
检查 Lua 关卡脚本相关功能、选择区域相关功能、物品描述相关功能和商店区域
相关功能。

官方 `test/README.md` 给出的流程是：

1. 编译一个不使用 DLB 的 NetHack。
2. 安装这个 NetHack。
3. 把 `test` 目录里的 Lua 测试文件复制到 NetHack 的 playground 目录。
4. 用调试模式启动 NetHack。
5. 使用 `#wizloadlua` 扩展命令加载并运行某个测试文件。

这里的 DLB 指 data librarian。DLB 会把多个运行时数据文件打包到一个数据包
文件中。测试流程要求“不使用 DLB”，原因是测试文件需要作为独立 Lua 文件被
调试模式加载。

playground 目录是 NetHack 运行时读写数据文件、存档文件和辅助文件的目录。
具体位置由构建配置和安装配置决定。Linux 和 macOS 上常由 hints 文件决定；
Windows 上常由 Windows 构建脚本和程序启动逻辑决定。

调试模式是 NetHack 给开发者使用的特殊运行模式。原项目注释里经常把它叫
wizard mode。本文统一称为调试模式。调试模式会开放创建物品、传送、加载 Lua
脚本、运行模糊测试等开发命令。

### 调试模式入口

调试模式的权限由配置控制。`include/config.h` 中有两个相关概念：

- `WIZARD_NAME`：编译期默认允许进入调试模式的用户名。
- `WIZARDS`：系统配置文件中的用户名列表。如果启用了系统配置文件，
  `WIZARDS` 会覆盖 `WIZARD_NAME`。

调试模式可以通过选项请求。`src/options.c` 中的注释明确提到
`OPTIONS=playmode:debug`。旧式启动方式也可能使用 `-D`。不同平台启动代码
对命令行参数的处理位置不同，因此阅读时应从对应平台入口开始：

- Linux 和 macOS：`sys/unix/unixmain.c`
- Windows：`sys/windows/windmain.c`
- 选项解析：`src/options.c`

调试模式进入后，`src/cmd.c` 的扩展命令表会开放带有 `WIZMODECMD` 标志的
命令。`WIZMODECMD` 定义在 `include/func_tab.h`，含义是“这个命令只允许在
调试模式中执行”。

常见调试模式命令包括：

- `#wizloadlua`：加载 Lua 文件，适合运行 `test` 目录中的 Lua 测试。
- `#debugfuzzer`：启动模糊测试。模糊测试指自动生成大量输入，观察程序是否
  出现崩溃、断言失败或内部错误。
- `#wizwish` 或相关许愿命令：创建指定物品，用于验证物品逻辑。
- `#levelchange`、`#levelport`、`#wizwhere`：改变或查看位置，用于验证关卡
  和地牢结构。
- `#stats`、`#timeout`、`#vision`：查看内部状态，用于验证计时效果、视野和
  状态变化。

命令名字以源码中的扩展命令表为准。扩展命令表位于 `src/cmd.c` 的
`extcmdlist`。

### 断点调试入口

断点调试指用调试工具暂停程序，逐行执行代码，并查看变量值。Windows 上常用
Visual Studio。Linux 上常用 gdb。macOS 上常用 lldb。gdb 是 GNU Debugger 的
缩写。lldb 是 LLVM 项目的调试工具。

Windows 上最方便的断点调试入口是 `sys/windows/vs/NetHack.sln`。打开解决方案
后，可以选择 Debug 配置，给下面函数打断点：

- `sys/windows/windmain.c` 的入口函数：观察 Windows 启动流程。
- `src/windows.c` 的 `choose_windows()`：观察窗口接口选择。
- `src/allmain.c` 的 `newgame()`：观察新游戏初始化。
- `src/allmain.c` 的 `moveloop_core()`：观察每一轮主循环。
- `src/cmd.c` 的 `readchar_core()`：观察输入读取。
- `src/cmd.c` 的具体命令函数，例如 `do_move_east()`。
- `src/hack.c` 的移动处理函数：观察移动规则。

Linux 和 macOS 上，可以用带调试信息的构建产物配合 gdb 或 lldb。调试信息是
编译器写入可执行文件的源码位置、变量名和类型信息。没有调试信息时，调试工具
仍可运行程序，但源码级单步和变量查看会困难很多。

建议的断点策略是先少后多。先在入口函数、`choose_windows()`、`moveloop_core()`
和一个具体命令函数打断点。确认主路径后，再给更深的规则函数打断点。这样能
避免程序频繁停在与当前问题无关的公共函数里。

### 内部一致性检查和崩溃回溯

NetHack 还有一些内部一致性检查入口。内部一致性检查指程序主动检查自己的
关键数据结构是否满足约束。例如物品链表、怪物链表、计时队列、光源、陷阱等
结构是否仍然一致。相关状态在 `include/flag.h` 中可以看到，例如
`sanity_check`。

崩溃回溯入口主要在 `src/report.c`。崩溃回溯指程序崩溃或触发严重错误时，
记录当前函数调用栈，帮助开发者定位错误来源。`include/config.h` 中的
`GDBPATH` 指定 gdb 路径，`src/report.c` 中的 `NH_panictrace_gdb()` 会尝试
调用 gdb 获取回溯信息。

如果你在研究一个具体 bug，推荐按这个顺序使用入口：

1. 先写出最小复现步骤。最小复现步骤指能稳定触发问题的最短操作序列。
2. 如果问题涉及 Lua 关卡脚本，优先尝试写成 `test/*.lua` 风格的 Lua 测试。
3. 如果问题涉及玩家命令或怪物行动，用断点调试观察 `moveloop_core()` 和
   具体命令函数。
4. 如果问题表现为崩溃，查看崩溃回溯，再回到回溯中最靠近游戏规则的函数。
5. 如果问题表现为数据结构逐渐损坏，开启或调用内部一致性检查，尽量找到第一
   次损坏发生的位置。

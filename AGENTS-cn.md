# RemoteHack

## 项目目的

当前项目是基于NetHack 5.0的分支RemoteHack，该项目的目的是将NetHack游戏设计成一个前后端分离的、画面和体验更加现代化的版本。

### 后端和前端

为NetHack开发一个网络适配层，通过HTTP+json的结构来与负责画面显示的前端进行交互。目的是能够将原本所有的对于游戏核心的输入和来自游戏核心的输出都转化为json格式的数据。

根据我前期的调研，nethack原本的游戏循环是阻塞等待键盘输入、对每次输入进行处理并输出游戏内容到屏幕，这种结构天生适合http的一问一答机制，而且http传输也有利于调试，还可以简单地在浏览器和以浏览器为核心的窗口上游玩。

同时，前端的开发也是本项目的一部分。选择使用react框架来进行UI、游戏画面的渲染，后续可能考虑使用更高效率的工具来渲染动画、地图等。

### 相对于原版的改进

游戏的设计会有很多原版nethack没有的改进游戏体验的改进。包括但不限于：

1. 对于一个包含了地面和怪物的格子（举例），可以同时显示怪物和怪物脚下的地面。这在用ASCII表示格子的游戏中是不存在的需求，但是在Qt等图形化界面中可能已经有了实现。
2. 更加易于操作的背包。
3. 对于游戏的各种元素添加的说明框。这种说明框在当代游戏中很常见，比如哈迪斯和博得之门3，可以对于说明框里的某些概念展开更多说明框。
4. 消息栏的改进，不再需要手动Enter以查看更多信息。
5. 操作上的改进。可以直接鼠标移动来查看某一格的信息，而不用Ctrl K并移动光标来移动过去查看这个格子上有什么。
6. 操作提示。对于可以采取的操作提供游戏内的提示，提供使用鼠标来进行选择的选项，而不用像原版NetHack一样需要记忆各种操作的按键。比如穿戴装备、装备武器等。

这些改进都是后续版本的需求，第一个版本应当先实现整体游戏能够像原版游戏一样运行，暂时不追求这些改进。



## 项目目录结构

### NetHack 原有目录

```
src/            游戏核心源代码（C），包含游戏逻辑、战斗、地图生成等
include/        头文件，包含数据结构定义、函数声明（winprocs.h 尤为重要）
dat/            游戏数据文件（Lua 关卡定义、文本数据、帮助文件等）
doc/            文档（guidebook.txt 游戏说明、各版本修复日志等）
win/            窗口界面实现目录，每个子目录是一种图形前端：
  win/tty/        终端文本界面
  win/curses/     curses 库界面
  win/Qt/         Qt 图形界面
  win/X11/        X11 图形界面
  win/win32/      Windows 图形界面
  win/share/      各界面共享的 tile 处理代码
  win/chain/      窗口调用链机制（用于调试追踪）
  win/shim/       最小化存根界面（用于自动化测试等）
  win/macosx/     macOS 特定代码
sys/            系统平台相关代码：
  sys/unix/       Unix/macOS 构建系统（Makefile、setup 脚本、XCode 工程）
  sys/windows/    Windows 构建系统
  sys/share/      跨平台共享代码
  sys/libnh/      NetHack 库接口
  sys/msdos/      MS-DOS 支持
  sys/amiga/      Amiga 支持
  sys/vms/        VMS 支持
util/           构建工具（makedefs、dlb 打包、存档恢复等）
test/           测试用 Lua 脚本
sound/          音效相关代码和资源
submodules/     Git 子模块（Lua 解释器、PDCurses）
DEVEL/          开发者文档（代码风格、git 工作流等）
outdated/       已过时的文件
```

### RemoteHack 新增目录

```
win/http/           HTTP 窗口界面适配层（C 代码）
                    实现 window_procs 接口，将游戏输出序列化为 JSON，
                    通过嵌入式 HTTP 服务器与前端通信
frontend/           React 前端应用（TypeScript）
                    负责游戏画面渲染、用户交互
doc/remotehack/     RemoteHack 项目文档
                    包含技术选型讨论、架构设计等
.agents/skills/     AI Agent 技能文件
```

## 参考文档

有关设计方法、选型等的信息可以参考这些：

1. NetHack官方wiki：https://nethackwiki.com/wiki/Main_Page
2. 项目内的游戏玩法说明，你可能会需要开发一些脚本或每章节行数说明来避免这个过长的文档耗尽模型上下文：doc/guidebook.txt
3. Qt等前人开发等图形化界面的具体实现。
4. Agent自行撰写的文档，包括 `doc/remotehack/tech-selection.md`（技术选型讨论）。
5. 其他网络搜索信息。

## SKILLS说明

Skills 是 AI Agent 的可复用技能脚本，存放在 `.agents/skills/` 目录下。
当前项目可能用到的 skill 类型包括：

1. **NetHack 代码导航**：帮助 Agent 理解 NetHack 的 C 代码结构，快速定位
   `window_procs` 接口函数、游戏循环逻辑、glyph 系统等关键代码。

2. **guidebook 阅读辅助**：`doc/guidebook.txt` 超过 5000 行，需要分段摘要
   脚本来避免耗尽上下文窗口。可开发按章节索引的 skill。

3. **构建与测试**：封装 NetHack 在 macOS/Unix 下的编译流程（setup.sh、
   make），以及前端的 npm/vite 命令。

4. **JSON API 测试**：封装 curl 命令或脚本，用于快速测试 HTTP 接口的
   输入输出。

具体 skill 文件将在开发过程中按需创建。

## AI约束

### 开发约束

对于原版NetHack代码尽可能减少修改。

对于新开发的代码，要对于每一个函数的功能、参数、返回值等信息进行注释。

### 其他约束

用户使用中文，和用户说话时保持使用中文，文档也使用中文。代码注释使用英文。

每次对话开始进行修改之前都要进行git commit。是之前而不是之后是因为我需要进行审核。使用标准的commit message格式，commit message使用英文。
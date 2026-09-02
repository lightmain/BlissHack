# BlissHack

## 新 Session 启动

每个 Agent 在新 session 开始工作时，必须先完整阅读
`doc/BlissHack/session-start.md`，并按其中的清单读取基础文档、检查 Git
现场和选择任务相关资料。不得默认沿用上一 session 的仓库状态、当前阶段或
测试结果。

## 项目目的

当前项目是基于 NetHack 5.0 的独立衍生项目 BlissHack，该项目的目的是将
NetHack 游戏设计成一个画面和体验更加现代化的浏览器版本。

### 技术架构

利用 NetHack 5.0 官方提供的 shim_graphics 窗口接口和 Emscripten WASM 交叉编译支持，将整个 NetHack 游戏核心编译为 WebAssembly，在浏览器中直接运行。shim 回调通过 Emscripten 的 EM_JS + Asyncify 机制桥接到 TypeScript 回调函数，前端 React 应用（TSX）在同一个浏览器标签页中接收所有游戏事件并渲染 UI。

```
NetHack C 核心 (编译为 WASM)
    ↓ window_procs
win/shim/winshim.c (shim 窗口接口)
    ↓ EM_JS + Asyncify
TypeScript 回调函数 (nethack-bridge.ts)
    ↓
React 前端 (TSX + Vite)
```

这个架构的优势：
- 零网络开销、零序列化——C 代码和 JS 在同一进程中通信
- 绝大多数功能通过官方 shim 接口在 TypeScript 侧实现
- 允许对 C 侧 shim 做少量、经过验证且有测试覆盖的功能补全；具体修改记录在
  `doc/BlissHack/shim-interface-reference.md` 的“当前项目对 shim 接口的修改”
  章节
- shim ABI 存在已知限制，不能假定所有 `window_procs` 数据都能无损传递；
  必须以接口文档和实际源码为准
- 游戏状态在浏览器内存中，通过 IndexedDB (IDBFS) 实现存档持久化

### 前端

选择使用 React 框架来进行 UI、游戏画面的渲染，后续可能考虑使用 Canvas 或更高效率的工具来渲染动画、地图等。

### 相对于原版的改进

游戏的设计会有很多原版 NetHack 没有的改进游戏体验的改进。包括但不限于：

1. 对于一个包含了地面和怪物的格子（举例），可以同时显示怪物和怪物脚下的地面。shim 的 `shim_print_glyph` 回调会传递前景和背景两个 `glyph_info` 指针，天然支持双层渲染。
2. 更加易于操作的背包。shim 的 `add_menu` 回调传递完整的物品 glyph、标识符、快捷键、样式和选中状态。
3. 对于游戏的各种元素添加的说明框。这种说明框在当代游戏中很常见，比如哈迪斯和博得之门3，可以对于说明框里的某些概念展开更多说明框。
4. 消息栏的改进，不再需要手动 Enter 以查看更多信息。shim 声明了 `WC2_SUPPRESS_HIST`，前端完全控制消息显示，核心不强制 `--More--`。
5. 操作上的改进。可以直接鼠标移动来查看某一格的信息。shim 声明了 `WC_MOUSE_SUPPORT`，核心已内建 `clicklook` 和 `therecmdmenu` 命令。
6. 操作提示。对于可以采取的操作提供游戏内的提示，提供使用鼠标来进行选择的选项，而不用像原版 NetHack 一样需要记忆各种操作的按键。核心已有 context-aware 操作菜单（`therecmdmenu`），通过标准菜单系统传递。
7. 浏览器本地存档。
8. 可以在游戏内配置通常需要手动修改配置文件的项，包括自动拾取、是否显示教程、键位设置等。
9. 语言。接入多语言支持，包括提前翻译好的本地化文本和本地传统翻译模型的实时翻译功能。

这些改进都是后续版本的需求，第一个版本应当先实现整体游戏能够像原版游戏一样运行，暂时不追求这些改进。



## 项目目录结构

### NetHack 原有目录

```
src/            游戏核心源代码（C），包含游戏逻辑、战斗、地图生成等
include/        头文件，包含数据结构定义、函数声明（winprocs.h 尤为重要）
dat/            游戏数据文件（Lua 关卡定义、文本数据、帮助文件等）
doc/            文档（Guidebook.txt 游戏说明、各版本修复日志等）
win/            窗口界面实现目录，每个子目录是一种图形前端：
  win/tty/        终端文本界面
  win/curses/     curses 库界面
  win/Qt/         Qt 图形界面
  win/X11/        X11 图形界面
  win/win32/      Windows 图形界面
  win/share/      各界面共享的 tile 处理代码
  win/chain/      窗口调用链机制（用于调试追踪）
  win/shim/       shim 窗口接口（WASM 构建的关键组件）
  win/macosx/     macOS 特定代码
sys/            系统平台相关代码：
  sys/unix/       Unix/macOS 构建系统（Makefile、setup 脚本、XCode 工程）
  sys/windows/    Windows 构建系统
  sys/share/      跨平台共享代码
  sys/libnh/      NetHack 库接口（包含 libnhmain.c，WASM 的 JS 桥接层）
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

### BlissHack 新增目录

```
frontend/           React 前端应用（TypeScript + Vite）
                    加载 WASM 模块，注册 shim 回调，渲染游戏 UI
doc/BlissHack/      BlissHack 项目文档
                    包含技术选型讨论、架构设计等
.agents/skills/     AI Agent 技能文件
```

### WASM 相关的关键原版文件

```
win/shim/winshim.c          shim 窗口接口实现，包含 EM_JS 桥接代码
sys/libnh/libnhmain.c       WASM 主入口，JS 辅助函数/常量/全局变量初始化
sys/libnh/libnethack.c      libnethack 库封装
sys/libnh/test/libtest.c    原生库模式测试用例
sys/libnh/test/run.sh       构建脚本（支持 lib/wasm/bin 三种模式）
sys/unix/hints/include/cross-pre2.500   WASM 交叉编译配置
```

## 参考文档

有关设计方法、选型等的信息可以参考这些：

1. NetHack 官方 wiki：https://nethackwiki.com/wiki/Main_Page
2. 项目内的游戏玩法说明：`doc/Guidebook.txt`（超过 5000 行，先参见
   `doc/BlissHack/guidebook-index-cn.md` 获取章节索引）
3. shim 窗口接口的具体实现：win/shim/winshim.c
4. WASM 桥接层的具体实现：sys/libnh/libnhmain.c
5. 现有的 WASM NetHack 项目可供参考：
   - NetHack 3D (github.com/JamesIV4/nethack-3d)：React + Zustand + Vite + Three.js，技术栈最接近
   - NetHackWeb (github.com/guillaumebrunerie/nethackweb)：React + shim_graphics，最"正统"的移植
   - Nethack-wasm-webUI (github.com/e3sh/Nethack-wasm-webUI)：Canvas + Web Audio
6. Agent 自行撰写的文档，位于 `doc/BlissHack/` 目录下
7. 其他网络搜索信息

## SKILLS 说明

Skills 是 AI Agent 的可复用技能脚本，存放在 `.agents/skills/` 目录下。
当前项目可能用到的 skill 类型包括：

1. **NetHack 代码导航**：帮助 Agent 理解 NetHack 的 C 代码结构，快速定位
   shim 回调事件、游戏循环逻辑、glyph 系统等关键代码。

2. **Guidebook 阅读辅助**：`doc/Guidebook.txt` 超过 5000 行，需要分段摘要
   脚本来避免耗尽上下文窗口。可开发按章节索引的 skill。

3. **构建与测试**：封装 WASM 交叉编译流程（Emscripten + make CROSS_TO_WASM=1），
   以及前端的 npm/vite 命令。

4. **shim 回调测试**：封装测试脚本，用于验证 shim 回调事件的正确性和完整性。

具体 skill 文件将在开发过程中按需创建。

## AI 约束

### 开发约束

优先通过 shim 回调在 TypeScript 侧实现功能，不修改 NetHack 游戏逻辑核心。
只有在官方接口文档和实际源码共同证明 shim C 实现存在缺失或错误，且前端无法
正确修复时，才允许对 C 侧 shim 做最小修改。修改前必须检查相关调用链，修改后
必须补充测试并重新构建、提交成对的 `frontend/public/nethack.js` 和
`frontend/public/nethack.wasm`。

修改任何上游 NetHack 文件时，必须依照 NetHack General Public License，在
文件中显著注明 BlissHack 修改者、日期和修改目的，并在
`doc/BlissHack/shim-interface-reference.md` 的“当前项目对 shim 接口的修改”
章节记录行为差异。

不得猜测未暴露的 WASM 地址、结构布局或回调语义。官方文档与当前实现冲突时，
必须检查实际调用链；确认文档过时后才以代码为准。

对于新开发的代码，要对于每一个函数的功能、参数、返回值等信息进行注释。

### 其他约束

用户使用中文，和用户说话时保持使用中文，文档也使用中文。代码注释使用英文。

每次对话开始进行修改之前都要进行 git commit。是之前而不是之后是因为我需要进行审核。使用标准的 commit message 格式，commit message 使用英文。

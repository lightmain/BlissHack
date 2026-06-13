# 构建 NetHack 5.0.0 基线

本文档记录已经验证可用的 NetHack 5.0.0 Windows 后端构建流程，以及第一个
GodotHack 专属服务端目标。

后续修改后端集成代码前，优先用这里的流程确认上游基线仍然可编译。
这个流程刻意和 GodotHack 专属 `NetHackServer.exe` 工作分开。

## 环境

- 在 MSVC 开发者命令行中执行，推荐：
  `x64 Native Tools Command Prompt for VS 2022`。
- 仓库根目录：
  `E:\Develop\Game\GodotHackProject\GodotHack`
- 构建模板：
  `sys\windows\Makefile.nmake`

## 已验证的最小构建流程

该流程构建原版 NetHack 5.0.0 Windows 可执行文件，不启用 curses 支持。
这样依赖面更小，已在当前工作区验证能正常产出编译结果。

```bat
cd /d E:\Develop\Game\GodotHackProject\GodotHack

sys\windows\fetch.cmd lua

cd src
nmake /f ..\sys\windows\Makefile.nmake GIT_AVAILABLE=N TARGET_CPU=x64 CURSES_CONSOLE=N CURSES_GRAPHICAL=N package
```

预期产物包括：

```text
binary\NetHack.exe
binary\NetHackW.exe
package\nethack-500-win-x64.zip
```

## GodotHack 服务端目标

第一个 NetHack 5.0.0 `NetHackServer.exe` 目标是刻意保持最小的版本。它只验证
TCP newline-delimited JSON 传输，还不会启动游戏。

```bat
cd /d E:\Develop\Game\GodotHackProject\GodotHack\src
nmake /f ..\sys\windows\Makefile.nmake GIT_AVAILABLE=N TARGET_CPU=x64 CURSES_CONSOLE=N CURSES_GRAPHICAL=N godothack-server
```

预期产物：

```text
binary\NetHackServer.exe
```

如果沙箱自动化会话在覆盖 `binary\NetHackServer.exe` 时报告
`LINK : fatal error LNK1104`，请在普通 MSVC 开发者命令行中重试同一条命令。
该命令已经在非沙箱环境验证通过。

## 当前后端提交前检查

如果改动涉及当前后端服务端切片，提交前运行以下检查：

```bat
cd /d E:\Develop\Game\GodotHackProject\GodotHack\src
nmake /f ..\sys\windows\Makefile.nmake GIT_AVAILABLE=N TARGET_CPU=x64 CURSES_CONSOLE=N CURSES_GRAPHICAL=N godothack-server

cd ..
powershell -ExecutionPolicy Bypass -File .\tools\smoke-test-nethack-server.ps1

cd src
nmake /f ..\sys\windows\Makefile.nmake GIT_AVAILABLE=N TARGET_CPU=x64 CURSES_CONSOLE=N CURSES_GRAPHICAL=N package
```

## 注意事项

- 使用 `/f ..\sys\windows\Makefile.nmake`，直接指定权威的 Windows 构建模板。
- 不要把现有 `src\Makefile` 当作事实来源。它可能包含旧的本地 GodotHack
  服务端改动，并且可能被 `sys\windows\nhsetup.bat` 覆盖。
- 原版 NetHack 5.0.0 package 构建产出 `NetHack.exe` 和 `NetHackW.exe`。
  GodotHack 的 `NetHackServer.exe` 由单独的 `godothack-server` 目标构建。
- 旧 NetHack 3.6.7 编译出的 `NetHackServer.exe` 只作为历史产物参考，不能视为
  5.0.0 的有效构建结果。

## 完整 curses 构建

默认完整包会启用 curses 支持，因此除 Lua 外还需要 `pdcursesmod`。这不属于上面
已经验证通过的最小基线流程。

当前本地执行 `sys\windows\fetch.cmd pdcursesmod` 会失败，原因是该 batch 脚本在
括号块内设置变量后又立即用 `%VAR%` 引用，变量会提前展开为空。按当前决策，不在
本阶段修复该脚本。除非项目明确决定如何管理 curses 依赖，否则先使用上面的最小
构建流程。

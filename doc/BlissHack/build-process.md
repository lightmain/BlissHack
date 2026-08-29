# BlissHack WASM 构建流程

## 概述

本文档记录将 NetHack 5.0 编译为 WebAssembly 的完整流程，以及 WASM 产物如何与 React 前端集成。

## 前置依赖

- macOS（已在 macOS 26.5.1 / arm64 上测试）
- Emscripten SDK（emsdk）

### 安装 Emscripten

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

验证安装：
```bash
emcc --version
# 应输出类似：emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 3.x.x
```

**注意：** 每次打开新终端都需要 `source emsdk_env.sh`，或者将其加入 shell profile。

## WASM 构建步骤

```bash
cd /Users/bytedance/home/Develop/PlayGround/NetHack

# 1. 运行 setup.sh 生成 Makefile
cd sys/unix && sh setup.sh hints/macOS.500 && cd ../..

# 2. 获取 Lua（如果还没有）
make fetch-Lua

# 3. 编译 WASM
make CROSS_TO_WASM=1
```

也可以用官方提供的一键脚本：
```bash
./sys/libnh/test/run.sh wasm
```

### 构建产物

构建完成后，产物位于项目根目录的 `targets/wasm/` 下：

```
targets/wasm/
  nethack.js      Emscripten 生成的 ES6 模块（胶水代码 + Asyncify 运行时）
  nethack.wasm    编译后的 WebAssembly 二进制（整个 NetHack C 核心 + Lua）
  wasm-data/      游戏数据文件，通过 --embed-file 打包进 .wasm 中
    nhdat         打包后的游戏数据（关卡、文本等）
    sysconf       系统配置
    perm          权限文件
    record        记录文件
    ...
```

**关键理解：** `nethack.js` + `nethack.wasm` 是一体的。JS 文件是 WASM 的加载器和运行时，
不能分开使用。`wasm-data/` 中的文件在编译时被 `--embed-file` 嵌入到 .wasm 二进制中，
运行时通过 Emscripten 的虚拟文件系统 (FS) 访问，不需要单独部署。

### 编译标志说明

`make CROSS_TO_WASM=1` 触发的关键编译标志（定义在 `sys/unix/hints/include/cross-pre2.500`）：

| 标志 | 说明 |
|------|------|
| `-DSHIM_GRAPHICS` | 使用 shim 窗口接口 |
| `-DNOTTYGRAPHICS` | 不编译 TTY 接口 |
| `-DLIBNH` | 编译为库模式 |
| `-DCROSSCOMPILE -DCROSS_TO_WASM` | 交叉编译到 WASM |
| `-s ASYNCIFY` | 启用 Asyncify（允许 C 阻塞调用被 JS 异步化） |
| `-s MODULARIZE -s EXPORT_ES6=1` | 输出 ES6 模块格式 |
| `-s EXPORTED_FUNCTIONS` | 导出 `_main`, `_shim_graphics_set_callback` 等函数 |
| `-s EXPORTED_RUNTIME_METHODS` | 导出 `cwrap`, `ccall`, `FS`, `IDBFS` 等运行时方法 |
| `--embed-file wasm-data@/` | 将游戏数据嵌入 WASM 虚拟文件系统根目录 |

## WASM 产物不是"静态库"

传统的 C 静态库（`.a` 文件）是链接时使用的中间产物。WASM 的产物是**最终可执行模块**，
更接近于一个"可以被浏览器加载运行的程序"。

对比：

| | 静态库 (.a) | WASM 产物 (.js + .wasm) |
|--|------------|------------------------|
| 何时使用 | 编译时链接 | 运行时加载 |
| 包含什么 | 目标文件集合 | 完整的可执行程序 |
| 谁消费它 | 链接器 (ld) | 浏览器 / Node.js |
| 能否独立运行 | 不能 | 能（需要 JS 宿主环境） |

**注意：** 中间过程中确实会生成 `libnh.a`（NetHack 静态库），但 Emscripten 会将其与
Lua 库一起链接成最终的 `nethack.js` + `nethack.wasm`。我们只需要最终产物。

## 与 React 前端的集成方式

### React 应用的编译前状态（开发时）

```
frontend/
  public/
    nethack.js        ← 从 src/targets/ 复制过来的 Emscripten 产物
    nethack.wasm      ← 同上
  src/
    main.tsx          React 入口
    App.tsx           主组件
    nethack-bridge.ts 我们写的：加载 WASM 模块、注册 shim 回调、桥接游戏事件到 React
    components/       UI 组件（地图、消息栏、状态栏等）
    stores/           Zustand 状态管理
  index.html
  package.json
  vite.config.ts
  tsconfig.json
```

### React 应用的编译后状态（`npm run build`）

```
frontend/dist/
  index.html              入口 HTML
  assets/
    index-[hash].js       打包压缩后的 React 应用
    index-[hash].css      样式
  nethack.js              原样复制（不经过 Vite 打包）
  nethack.wasm            原样复制
```

**关键点：**
- `nethack.js` 和 `nethack.wasm` 放在 `public/` 目录中，Vite 会原样复制到 `dist/`，
  不对其进行打包、压缩或 tree-shaking
- React 代码在运行时通过 `import()` 动态加载 `nethack.js`，后者自动加载同目录下的 `nethack.wasm`
- 最终部署只需要把 `dist/` 目录整个放到任意静态文件服务器上

### 加载流程

```
浏览器加载 index.html
  → 加载 React 应用 (assets/index-[hash].js)
    → nethack-bridge.ts 动态 import('nethack.js')
      → nethack.js 自动 fetch('nethack.wasm') 并实例化
        → WASM 模块初始化，挂载 globalThis.nethackGlobal
          → 我们的 JS 回调被注册到 shim
            → 调用 Module._main() 启动游戏
              → NetHack 游戏循环开始运行
```

## 切换构建模式的注意事项

在 WASM 构建和原生 TTY 构建之间切换时，必须先清理：

```bash
make spotless
cd sys/unix && sh setup.sh hints/macOS.500 && cd ../..
# 然后选择其中一种：
make                     # 原生 TTY
make CROSS_TO_WASM=1     # WASM
```

`make spotless` 会清理所有编译产物，确保干净的构建环境。

## 开发工作流（后续）

```
终端 1: 修改前端代码
  cd frontend && npm run dev    # Vite 开发服务器，HMR

终端 2: 如果修改了 C 代码（通常不需要）
  make CROSS_TO_WASM=1          # 重新编译 WASM
  cp targets/wasm/nethack.* frontend/public/  # 复制到前端
```

正常开发中只改前端代码，WASM 模块编译一次后很少需要重新编译。

# BlissHack WASM 构建流程

## 概述

本文档记录将 NetHack 5.0 编译为 WebAssembly 的完整流程，以及 WASM 产物如何与 React 前端集成。

## 前置依赖

- macOS 或 Linux
- 根目录 `.nvmrc` 指定的 Node.js 主版本
- 根目录 `.emscripten-version` 指定的 Emscripten SDK 完整版本
- GNU Make、宿主 C 编译器、POSIX shell、awk、sed、curl、tar、xz 和 Python 3

Node.js 和 Emscripten 的版本文件是权威来源。不得在文档或 CI 中改用
`lts/*` 或 `latest`。

### 安装 Node.js

使用支持 `.nvmrc` 的版本管理器，例如：

```bash
cd /path/to/BlissHack
nvm install
nvm use
node --version
```

### 安装 Emscripten

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
EMSCRIPTEN_VERSION="$(cat /path/to/BlissHack/.emscripten-version)"
./emsdk install "$EMSCRIPTEN_VERSION"
./emsdk activate "$EMSCRIPTEN_VERSION"
source ./emsdk_env.sh
```

验证安装：
```bash
emcc --version
# 必须与 .emscripten-version 完全一致
```

**注意：** 每次打开新终端都需要 `source emsdk_env.sh`，或者将其加入 shell profile。

## 工具链预检

在清理或编译前可以单独运行只读预检：

```bash
cd /path/to/BlissHack/frontend
npm run check:toolchain
```

CI 或需要明确目标平台时使用：

```bash
npm run check:toolchain -- --hints sys/unix/hints/linux.500
```

该命令与 `build:wasm` 共用 `scripts/build-wasm.sh` 中的同一段预检，验证：

- Node.js 主版本和 Emscripten 完整版本与仓库版本文件一致。
- `emcc`、`emar` 和 `emranlib` 来自同一个 Emscripten SDK 目录。
- host compiler、Make、Python、shell、下载、归档和文件操作命令存在。
- 首次获取 Lua 时存在 `shasum` 或 `sha256sum`。
- hints、官方 tile manifest、仓库、runtime 目录和 staging 父目录可用。
- WASM 目标固定为 `targets/wasm`，runtime 固定发布到 `frontend/public`。

`check:toolchain` 不运行 setup、`make spotless`、编译或 runtime 发布。完整
`build:wasm` 会再次执行相同预检，不能通过跳过独立命令绕过检查。

## WASM 构建步骤

```bash
cd /path/to/BlissHack/frontend
npm ci
npm run build:wasm
```

该命令自动完成：

1. 在清理或编译前执行与 `check:toolchain` 相同的预检。
   `emcc`、`emar` 和 `emranlib` 必须解析到同一个 emsdk 目录。
2. 执行 `make spotless`。
3. macOS 使用 `sys/unix/hints/macOS.500`，Linux 使用
   `sys/unix/hints/linux.500`。
4. 生成 Makefile，并在缺失时通过 `make fetch-Lua` 获取经过上游 checksum
   校验的 Lua 5.4.8。
5. 执行 `make CROSS_TO_WASM=1`。
6. 在 staging 目录生成并校验完整运行时三件套。
7. 以 `0644` 权限更新 `frontend/public` 并运行 WASM 集成测试；发布或测试
   失败时恢复更新前的完整三件套。

CI 或需要明确 hints 时使用：

```bash
cd frontend
npm run build:wasm -- --hints sys/unix/hints/linux.500
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

统一构建命令随后更新：

```text
frontend/public/
  nethack.js
  nethack.wasm
  nethack-runtime.json
```

`nethack-runtime.json` 记录 Emscripten、Node.js、Lua、hints、宿主编译器、
Make，以及两个运行时文件的字节长度和 SHA-256。摘要只用于检查产物配对和
意外改写，不表示存档兼容性。

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
| `-DTILES_IN_GLYPHMAP` | 让核心在 `glyph_info.gm.tileidx` 中提供官方 tile index |
| `-DCROSSCOMPILE -DCROSS_TO_WASM` | 交叉编译到 WASM |
| `-s ASYNCIFY` | 启用 Asyncify（允许 C 阻塞调用被 JS 异步化） |
| `-s MODULARIZE -s EXPORT_ES6=1` | 输出 ES6 模块格式 |
| `-s EXPORTED_FUNCTIONS` | 导出 `_main`, `_shim_graphics_set_callback` 等函数 |
| `-s EXPORTED_RUNTIME_METHODS` | 导出 `cwrap`, `ccall`, `FS`, `IDBFS` 等运行时方法 |
| `--embed-file wasm-data@/` | 将游戏数据嵌入 WASM 虚拟文件系统根目录 |

WASM 构建还会使用 host `tilemap` 生成 `src/tile.c`，再以 Emscripten
编译为 `targets/wasm/tile.o` 并链接进最终模块。`tile.o` 与
`frontend/public/tiles/nethack-classic.json` 的分段顺序必须保持一致。

## 官方 Tiles 生成与校验

浏览器不在运行时解析 NetHack 的文本 tile 文件。开发者显式执行：

```bash
cd frontend
npm run generate:tiles
npm run verify:tiles
```

生成器读取 `win/share/monsters.txt`、`objects.txt`、`other.txt`、
`decals.txt` 和权威映射 `tilemap.c`，输出：

```text
frontend/public/tiles/
  nethack-classic.png
  nethack-classic.json
```

当前 atlas 包含 2307 个 16×16 tile，按 40 列、58 行排列，PNG 尺寸为
640×928。manifest 记录输入 SHA-256、分段范围和 blank、unexplored、pet、
pile 特殊索引。pet/pile decal 仅把官方 delimiter 左上角背景色转为透明，
普通 tile 不执行颜色猜测或黑色抠除。

`npm run build` 的 `prebuild` 会执行 `verify:tiles`，只校验现有产物而不重写
工作树。修改任一输入、生成器或 `tilemap.c` 后，必须重新生成并同时提交 PNG
和 JSON；WASM tile 映射也发生变化时，还必须重新运行 `npm run build:wasm`
并提交运行时三件套。

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
    nethack.js        ← 从 targets/wasm/ 复制过来的 Emscripten 产物
    nethack.wasm      ← 同上
    nethack-runtime.json ← 运行时版本、工具链和文件摘要
    tiles/            ← 官方 classic atlas 与 manifest
  src/
    main.tsx              React 入口
    App.tsx               应用状态与页面组合
    nethack-bridge.ts     稳定 shim callback façade
    bridge/               module loader、WASM 解码、输入控制和存档校验
    map/                  ASCII/Canvas renderer、atlas loader 和绘制逻辑
    session/              module/session 生命周期与 Home 数据操作
    screens/game/         游戏终端、状态栏、modal 和暂停组件
    screens/settings/     Settings 字段、数据操作和 modal 组件
    styles/               按页面职责拆分的全局样式
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
  nethack-runtime.json    原样复制的 runtime manifest
  tiles/                  原样复制的 atlas 与 manifest
```

**关键点：**
- `nethack.js` 和 `nethack.wasm` 放在 `public/` 目录中，Vite 会原样复制到 `dist/`，
  不对其进行打包、压缩或 tree-shaking
- `frontend/public/nethack.js`、`frontend/public/nethack.wasm` 和
  `frontend/public/nethack-runtime.json` 必须提交到仓库。GitHub Pages
  工作流不安装 Emscripten，而是先校验再发布这三个文件。重新编译 WASM 后，
  必须同时更新并提交完整三件套。
- React 代码在运行时通过 `import()` 动态加载 `nethack.js`，后者自动加载同目录下的 `nethack.wasm`
- 最终部署只需要把 `dist/` 目录整个放到任意静态文件服务器上

### 加载流程

```
浏览器加载 index.html
  → 加载 React 应用 (assets/index-[hash].js)
    → bridge/emscripten-module.ts 动态 import('nethack.js')
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
  cd frontend
  npm run build:wasm            # 重建、复制、校验并运行 WASM 测试
```

正常开发中只改前端代码，WASM 模块编译一次后很少需要重新编译。

## 运行时校验

`npm run build` 会在 TypeScript 和 Vite 构建前运行
`frontend/scripts/verify-runtime-assets.mjs`。以下任一情况都会使生产构建
失败：

- manifest 或任一运行时文件缺失。
- `nethack.js` 不是 Emscripten ES module。
- `nethack.wasm` 没有合法的八字节 WASM 头。
- 文件长度或 SHA-256 与 manifest 不一致。
- manifest 的 Emscripten、Node.js 主版本或 Lua 版本与仓库固定值不一致。

## 手动 GitHub Actions

`.github/workflows/rebuild-wasm.yml` 使用固定的 `ubuntu-24.04`、Node.js 主版本
和 Emscripten 完整版本重建正式运行时。安装依赖后先调用
`npm run check:toolchain`，完整构建再复用同一预检。随后执行单元测试、生产
构建、WASM 集成测试和 Chromium 浏览器测试，并上传运行时三件套供审核。

该 workflow 不自动提交产物。下载产物后应检查三个文件的 diff，再按
`doc/BlissHack/upstream-modifications.md` 复核上游修改和测试。

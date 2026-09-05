# prealpha-3 阶段一：版本信息和可复现构建实施计划

## 1. 文档状态

本文定义 prealpha-3 阶段一的实施边界、文件职责、执行顺序和验收方法。
本文只完成实现规划；用户确认第 12 节中的工具版本和实施方案前，不开始修改
版本代码、构建脚本、CI 或 WebAssembly 产物。

阶段一开始前的 Git 检查点为：

```text
3bdb01c72 chore: checkpoint before prealpha 3 stage one planning
```

## 2. 当前基线

### 2.1 版本信息

- Home 页头和页脚分别硬编码了 `prealpha-2`。
- 诊断日志只有 `buildId`，本地默认值硬编码为
  `prealpha-2-development`，没有独立的产品版本字段。
- GitHub Actions 已通过 `VITE_BUILD_ID=${{ github.sha }}` 提供构建编号。
- `frontend/package.json` 的 `version` 是 `0.0.0`，不能作为产品版本。
- 个人配置和完整备份尚未实现；后续阶段必须复用阶段一建立的产品版本来源。

### 2.2 Node.js 和 Emscripten

- 本地当前 Node.js 是 `22.21.1`。
- `.github/workflows/test.yml` 和 `deploy-pages.yml` 都使用会随时间变化的
  `lts/*`。
- 仓库没有 `.nvmrc`、`.node-version` 或其他 Node.js 版本文件。
- `doc/BlissHack/build-process.md` 要求 `emsdk install latest`，没有固定版本。
- 当前 shell 中没有 `emcc`，因此无法证明已提交运行时由哪个 Emscripten
  版本生成。
- Node.js 官方发布计划中，24 是当前 Active LTS，支持期长于已进入
  Maintenance LTS 的 22。阶段一建议统一使用 Node.js 24 主版本。
- 阶段一建议固定 Emscripten `6.0.9`。该版本于 2026-09-01 发布；它是计划
  编写时最新的正式版本。升级到 6.x 可能暴露旧构建参数兼容问题，因此首次
  重建必须先在手动工作流中完成完整验证，不直接覆盖正式产物。

### 2.3 WASM 构建和运行时校验

- 当前手工流程是运行 `setup.sh`、获取 Lua、执行
  `make CROSS_TO_WASM=1`，然后手工复制两个产物。
- `sys/libnh/test/run.sh wasm` 使用固定的 macOS hints，但不检查工具版本、
  不复制产物、不生成校验记录，也不运行前端集成测试。
- `frontend/scripts/verify-runtime-assets.mjs` 只检查：
  - `nethack.js` 包含 `export default`。
  - `nethack.wasm` 具有 WASM 魔数。
- 当前运行时基线是：

| 文件 | 字节长度 | SHA-256 |
|------|---------:|---------|
| `nethack.js` | 95,026 | `44754cd461ca65cb3b8fd821a676a26336b14b29a5bce4826d96afc33baa1bf5` |
| `nethack.wasm` | 6,444,119 | `328c56e96e14309cb8b995dd63f1cd37663b35620a23f12104366362216f4541` |

这些摘要只能描述当前文件，不能补写未知的 Emscripten 版本。第一份正式校验
记录必须来自确认版本后的全量重建。

### 2.4 上游修改

相对于 `upstream/NetHack-5.0`，当前与 WASM/shim 直接相关的上游文件改动只有：

- `win/shim/winshim.c`
- `sys/unix/hints/include/cross-pre2.500`

现有 `shim-interface-reference.md` 记录了行为，但没有按“文件、目的、提交、
测试”组织成可在上游合并前逐项检查的清单。

## 3. 已选实现方向

### 3.1 产品版本

在仓库根目录新增纯文本 `VERSION`：

```text
prealpha-3
```

该文件是唯一可编辑的产品版本来源。实现方式如下：

1. `frontend/vite.config.ts` 在配置加载时读取并校验根目录 `VERSION`。
2. Vite 通过编译期常量把值提供给前端。
3. `frontend/src/version.ts` 导出 `PRODUCT_VERSION` 和 `BUILD_ID`。
4. Home、诊断导出，以及后续个人配置和完整备份只导入
   `PRODUCT_VERSION`，不得再次写版本字面量。
5. `BUILD_ID` 优先读取 `VITE_BUILD_ID`；本地未设置时固定为
   `prealpha-3-development`。
6. `frontend/package.json` 继续保持 `0.0.0`，不承担产品版本职责。

文档不能在运行时导入 TypeScript 常量，因此 README 和计划中的里程碑文本由
人工维护，但构建文档会明确 `VERSION` 才是权威来源。阶段一不把 README 项目
状态改成“prealpha-3 已完成”。

### 3.2 工具版本

新增：

```text
.nvmrc                 # 24
.emscripten-version    # 6.0.9
```

- Node.js 固定主版本，允许同一受支持主版本内获得安全和缺陷修复。
- Emscripten 固定完整版本，因为编译器补丁版本也可能改变 JS/WASM 输出。
- 所有普通前端 workflow 从 `.nvmrc` 读取版本，不再使用 `lts/*`。
- WASM 构建脚本从两个文件读取期望值，不在脚本中复制版本常量。
- Lua 固定为 NetHack 当前 Makefile 和 `submodules/CHKSUMS` 已定义的
  `5.4.8`；缺失时只通过 `make fetch-Lua` 获取并使用上游校验值。
- `emcc`、`emar` 和 `emranlib` 必须来自激活后的同一 emsdk。
- GNU Make 和宿主 C 编译器负责生成 `makedefs` 等构建时工具。它们使用宿主
  版本，不在阶段一引入 Homebrew 或自编译工具链；manifest 和 workflow
  summary 记录实际版本。当前 macOS Make 基线是 GNU Make `3.81`。
- `sh`、`awk`、`sed`、`curl`、`tar` 和 Python 3 仍是构建或 emsdk 安装依赖；
  文档列出用途，Linux workflow 显式安装缺失的系统包。

### 3.3 运行时校验记录

新增 `frontend/public/nethack-runtime.json`，结构固定为：

```json
{
  "schemaVersion": 1,
  "emscriptenVersion": "6.0.9",
  "nodeMajor": 24,
  "luaVersion": "5.4.8",
  "hintsFile": "sys/unix/hints/linux.500",
  "buildTools": {
    "node": "v24.x.x",
    "make": "GNU Make x.y",
    "hostCompiler": "gcc x.y.z"
  },
  "files": {
    "nethack.js": {
      "bytes": 0,
      "sha256": ""
    },
    "nethack.wasm": {
      "bytes": 0,
      "sha256": ""
    }
  }
}
```

正式内容由生成脚本写入，不能手工计算。记录不包含生成时间、绝对路径或构建
机器名称，避免没有诊断价值的变化。`buildTools` 使用各命令的规范化版本，
不保存本机路径。`hintsFile` 记录产生当前已提交运行时所用的 hints；正式
产物以手动 GitHub Actions 的 Linux 构建为准。

`frontend/scripts/verify-runtime-assets.mjs` 扩展为同时验证：

- manifest 存在且结构、字段类型和版本受支持。
- 两个运行时文件存在且都是普通文件。
- JS 是 Emscripten ES module。
- WASM 至少包含完整八字节标准头，而不只检查前四字节魔数。
- 两个文件的字节长度和 SHA-256 与 manifest 完全一致。
- manifest 中只接受固定的两个运行时文件名。

校验失败必须指出具体文件和失败类别，但不输出文件内容。

## 4. 构建命令

在根目录新增 `scripts/build-wasm.sh`，并在 `frontend/package.json` 暴露：

```bash
cd frontend
npm run build:wasm
```

脚本使用 `set -eu`，从脚本位置解析仓库根目录，不依赖调用者当前目录。完整
顺序为：

1. 读取 `.nvmrc` 和 `.emscripten-version`。
2. 检查 Node.js 主版本以及 `emcc` 的完整版本。
3. 检查 `emcc`、`emar`、`emranlib`、`cc`、`make`、`sh`、`awk`、`sed`、
   `curl`、`tar` 和 `python3`。
4. 输出实际 Node.js、npm、Emscripten、宿主编译器、Make、Lua 和 hints
   信息。
5. 工具检查全部通过后，才对已有 Makefile 执行 `make spotless`。
6. 根据宿主系统选择 `sys/unix/hints/macOS.500` 或
   `sys/unix/hints/linux.500`；允许 `--hints` 显式指定其中之一。
7. 运行 `sys/unix/setup.sh` 生成 Makefile。
8. Lua 5.4.8 不存在时运行 `make fetch-Lua`，随后确认
   `lib/lua-5.4.8/src/lua.h` 存在。
9. 运行 `make CROSS_TO_WASM=1`。
10. 检查 `targets/wasm/nethack.js` 和 `nethack.wasm` 均为普通非空文件。
11. 把两个文件复制到临时 staging 目录并生成 manifest。
12. 对 staging 内容执行完整运行时校验。
13. 用完整 staging 集合替换 `frontend/public` 中的三个运行时文件。
14. 再次执行校验并运行 `npm run test:integration:wasm`。

错误 Emscripten 或 Node.js 版本必须在第 5 步之前失败。两个编译产物未全部
生成时不得改动 `frontend/public`。脚本不执行 `git add` 或 `git commit`。

新增共享的运行时 manifest 模块和单独的生成入口，避免生成器与验证器各自
实现一套摘要逻辑。新函数按项目规则说明用途、参数和返回值。

## 5. GitHub Actions

### 5.1 普通测试和部署

修改：

- `.github/workflows/test.yml`
- `.github/workflows/deploy-pages.yml`

两个 workflow 都通过 `node-version-file: .nvmrc` 使用 Node.js 24，并继续把
当前提交 SHA 注入 `VITE_BUILD_ID`。普通 CI 只校验仓库中已提交的运行时，不
安装 Emscripten，也不重建 WASM。

### 5.2 手动 WASM 工作流

新增 `.github/workflows/rebuild-wasm.yml`：

- 只允许 `workflow_dispatch`。
- 使用固定的 `ubuntu-24.04` runner。
- 从 `.nvmrc` 安装 Node.js。
- 从 `.emscripten-version` 安装并激活 emsdk。
- 显式安装 `build-essential`、`curl` 和 Python 3 等宿主依赖，不依赖 runner
  镜像的偶然预装状态。
- 执行 `npm ci`。
- 显式使用 `sys/unix/hints/linux.500` 运行统一构建命令。
- 运行 `npm run lint`、`npm test`、`npm run build` 和
  `npm run test:integration:wasm`。
- 安装 Chromium 后运行 `npm run test:integration:browser`。
- 无论成功或失败都保留必要测试报告；成功时上传
  `nethack.js`、`nethack.wasm` 和 `nethack-runtime.json` 三件套。

workflow 不自动提交二进制文件。开发者下载成功构建的三件套，确认 diff 和
测试结果后再纳入阶段改动。

## 6. 上游修改清单

新增 `doc/BlissHack/upstream-modifications.md`，首版记录：

| 文件 | 修改 | 引入提交 | 必须复查的测试 |
|------|------|----------|----------------|
| `win/shim/winshim.c` | 保留角色选择退出语义 | `2f1688501` | bridge、session、角色选择浏览器回归 |
| `win/shim/winshim.c` | 增加玩家名、强制恢复和存档 fingerprint helper | `be7b8d035` | WASM helper、存储、Continue 浏览器流程 |
| `sys/unix/hints/include/cross-pre2.500` | 导出上述 helper 及 `_free` | `be7b8d035` | 运行时导出与 WASM 集成测试 |
| `win/shim/winshim.c` | 补充 BlissHack 修改和许可证说明 | `18d0818bb` | 静态审查 |

清单还要记录：

- 比较基线为 `upstream/NetHack-5.0`。
- 上游合并前使用的 diff 命令。
- 每项修改对应的 `shim-interface-reference.md` 章节。
- 重新构建三件套和执行测试的要求。

阶段一不修改这些上游文件的行为。

## 7. 文件级改动

预计新增：

```text
VERSION
.nvmrc
.emscripten-version
scripts/build-wasm.sh
frontend/src/version.ts
frontend/scripts/runtime-assets.mjs
frontend/scripts/generate-runtime-manifest.mjs
frontend/public/nethack-runtime.json
.github/workflows/rebuild-wasm.yml
doc/BlissHack/upstream-modifications.md
```

预计修改：

```text
frontend/package.json
frontend/vite.config.ts
frontend/scripts/verify-runtime-assets.mjs
frontend/src/screens/HomeScreen.tsx
frontend/src/screens/HomeScreen.test.ts
frontend/src/diagnostics/diagnostic-log.ts
frontend/src/diagnostics/diagnostic-log.test.ts
frontend/test/integration-tests/browser/helpers/diagnostic-artifact.ts
frontend/test/integration-tests/browser/fatal-paths.spec.ts
frontend/public/nethack.js
frontend/public/nethack.wasm
.github/workflows/test.yml
.github/workflows/deploy-pages.yml
README.md
README-cn.md
doc/BlissHack/build-process.md
doc/BlissHack/session-start.md
```

测试文件可根据实现时的模块边界命名，但不把构建逻辑塞入 React 组件测试。

## 8. 实施顺序

### 8.1 版本来源

1. 新增 `VERSION`、Vite 注入和 `version.ts`。
2. 替换 Home 的两个硬编码版本。
3. 给诊断导出增加 `productVersion`，保留独立 `buildId`。
4. 更新相关单元测试和浏览器诊断 artifact 类型。

### 8.2 运行时 manifest

1. 提取摘要、长度和结构校验的共享模块。
2. 实现 manifest 生成器。
3. 扩展生产构建前校验。
4. 用临时 fixture 覆盖缺失、截断、摘要错误、长度错误、非法 manifest 和正常
   三件套。

### 8.3 工具和统一构建命令

1. 新增 Node.js 和 Emscripten 版本文件。
2. 实现构建前检查和完整构建顺序。
3. 验证错误 Emscripten 版本在 `make spotless` 前失败。
4. 更新本地构建文档。

### 8.4 CI 和首次可信重建

1. 固定普通 workflow 的 Node.js 版本。
2. 新增手动 WASM workflow。
3. 先在 workflow 中用 Emscripten 6.0.9 重建和测试。
4. 下载并审查成功产物，再更新仓库中的运行时三件套。
5. 在本地重新执行前端完整测试。

### 8.5 修改清单和文档收尾

1. 建立上游修改清单。
2. 更新中英文 README 的开发工具说明，但不提前宣布 prealpha-3 完成。
3. 更新 session 启动清单和 WASM 构建文档。
4. 搜索并消除仍在运行代码中的 `prealpha-2` 版本字面量。

## 9. 测试矩阵

### 9.1 快速自动测试

- `VERSION` 缺失、为空或格式非法时，Vite 配置明确失败。
- Home 页头和页脚都显示 `PRODUCT_VERSION`。
- 本地 `BUILD_ID` 是明确的 `prealpha-3-development`。
- 诊断 JSON 同时包含 `productVersion` 和 `buildId`。
- manifest 生成结果对同一输入稳定。
- 缺失或替换任一运行时文件时验证失败。
- 文件长度正确但内容变化时 SHA-256 验证失败。
- JS 非 ES module 或 WASM 头非法时验证失败。
- 错误 Emscripten 版本在清理、setup 和 make 前失败。

### 9.2 首次工具链验证

使用 Emscripten 6.0.9 重建后执行：

```bash
cd frontend
npm run lint
npm test
npm run build
npm run test:integration:wasm
npm run test:integration:browser
npm run test:long
```

手动 workflow 至少执行到普通浏览器集成测试。`test:long` 在本地或现有手动
long-test job 中执行，避免在同一个 workflow 重复长流程。

### 9.3 负向验收

- 临时伪造 `emcc` 报告 `6.0.8`，确认构建命令在编译前退出。
- 临时删除 manifest、JS 或 WASM，确认 `npm run build` 在 TypeScript/Vite
  构建前退出。
- 分别替换 JS 和 WASM，确认错误信息指出对应文件摘要不匹配。
- 恢复三件套后，生产构建和 WASM 集成测试通过。

## 10. 人工验收

1. 在 Node.js 24 和 emsdk 6.0.9 的新环境中按文档完成一次构建。
2. Home 页头、页脚和诊断导出显示同一个 `prealpha-3`。
3. 本地诊断构建编号显示 `prealpha-3-development`。
4. GitHub Actions 产物中的三件套通过本地生产构建校验。
5. 错误 Node.js、Emscripten、Lua 或运行时文件的报错能够指出期望值和实际值。
6. 新游戏、保存、刷新和继续流程没有因工具链升级回归。

## 11. 风险和回退

- **Emscripten 6.x 兼容性**：先在手动 workflow 重建，不直接替换正式产物；
  如编译参数已移除，只做最小 hints 修正并补充清单和测试，不降级绕过错误。
- **不同宿主输出不同**：本阶段承诺步骤和输入可重复，不承诺 macOS 与 Linux
  二进制逐字节相同；已提交正式产物统一来自固定 Linux workflow。
- **manifest 与产物部分更新**：构建脚本先在 staging 中形成完整三件套并校验，
  生产构建始终再次校验。
- **产品版本与构建编号混淆**：类型和字段名称保持分离，不把 Git SHA 写入
  `VERSION`，也不从 `package.json` 推导产品版本。
- **上游合并覆盖本地 shim 修改**：清单和基线 diff 在每次上游合并前后执行，
  合并后必须重新构建运行时。

如果 Emscripten 6.0.9 的正式构建无法在不扩大 C/shim 修改范围的情况下通过，
停止阶段一实现并提交失败日志和最小复现供用户重新决定工具版本，不静默改用
`latest` 或其他版本。

## 12. 实现前确认

开始阶段一实现前需要用户明确确认：

1. Node.js 固定为主版本 `24`。
2. Emscripten 固定为完整版本 `6.0.9`。
3. 正式运行时以 `ubuntu-24.04` 手动 workflow 的产物为准；macOS 保留为本地
   支持环境，但不作为正式二进制来源。
4. 根目录 `VERSION` 是产品版本唯一来源，值为 `prealpha-3`。
5. 运行时校验记录采用 `frontend/public/nethack-runtime.json`，并与 JS/WASM
   一起提交和发布。
6. 阶段一不修改 NetHack C/shim 行为，不提前更新 README 为“prealpha-3
   已完成”。

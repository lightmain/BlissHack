# BlissHack Electron 三个发行包构建流程

本文是当前 Electron 桌面发行包的权威构建流程。它面向已经完成开发和自动测试、
需要把当前提交打成以下三个文件的场景：

1. macOS Apple Silicon DMG
2. macOS Apple Silicon ZIP
3. Windows x64 ZIP

当前不生成 Linux 包、Windows 安装器或 macOS Intel 包，也不在构建过程中上传
GitHub Release。三个产物都位于已被 Git 忽略的 `frontend/out/`。

## 1. 构建边界

Electron 没有另一套游戏实现。构建链路是：

```text
React、TypeScript、WASM 和静态资源
  -> frontend/dist
  -> Electron Forge 将 dist 和 electron/ 打入 app.asar
  -> macOS ZIP、macOS DMG、Windows ZIP
```

普通前端修改不需要同步修改 Electron 主进程。它只要求重新执行本文流程，让新的
`frontend/dist` 进入三个包。只有新增原生窗口、文件系统、菜单、IPC、退出流程
或其他桌面专属能力时，才需要修改 `frontend/electron/` 或
`frontend/src/desktop/`。

修改 NetHack C 核心或 shim 时，应先按
[WASM 构建流程](build-process.md)重新生成并验证运行时三件套，再执行本文流程。
只修改 React、CSS、TypeScript 或普通静态资源时，不需要重编 WASM。

## 2. 构建环境

三个包可以在一台 Apple Silicon Mac 上完成。当前流程要求：

- macOS Apple Silicon。
- 根目录 `.nvmrc` 指定的 Node.js 24。
- npm 和可访问 npm/Electron 下载源的网络。
- macOS 自带的 `/usr/bin/codesign`、`/usr/bin/ditto`、`hdiutil`、`zip` 和
  `shasum`。
- 足够空间安装依赖并生成约 1 GB 的中间文件和产物。

Windows ZIP 可以从 macOS 交叉生成，不要求 Wine、Mono 或 Windows SDK。它仍
必须在真实 Windows 10/11 x64 机器上完成启动和游戏人工测试。DMG 使用 macOS
系统工具，因此不能在 Windows 上完成本文的整个流程。

## 3. 版本检查

在仓库根目录确认本次要构建的提交和工作树：

```sh
git status --short
git rev-parse HEAD
cat VERSION
```

正式打包前 `git status --short` 必须没有输出。未提交修改会进入产物，但
`VITE_BUILD_ID` 仍只记录 `HEAD`，导致二进制内容与标记提交不一致。若工作树
不为空，先完成审核和提交，再从该提交打包。

构建 `alpha-2.6` 时，以下值应一致：

| 用途 | 文件或位置 | 当前值 |
| --- | --- | --- |
| 玩家可见产品版本 | `VERSION` | `alpha-2.6` |
| Electron/Forge 包版本 | `frontend/package.json` | `0.2.6-alpha.0` |
| Electron About 版本 | `frontend/electron/main.mjs` | `alpha-2.6` |
| DMG 文件名和卷名 | `frontend/electron/scripts/create-dmg.mjs` | `alpha-2.6` |

同一版本只重新打包时不要修改这些值。升级到后续版本时，先完成以下同步：

1. 更新根目录 `VERSION` 和 `doc/BlissHack/releases/manifest.json`。
2. 在 `frontend/` 运行
   `npm version <semver> --no-git-tag-version`，同时更新
   `package.json` 和 `package-lock.json`，例如
   `npm version 0.2.7-alpha.0 --no-git-tag-version`。
3. 更新 `frontend/electron/main.mjs` 中的 About 版本。
4. 更新 `frontend/electron/scripts/create-dmg.mjs` 中的 DMG 文件名和卷名。
5. 更新 `frontend/src/version.test.ts` 和
   `frontend/electron/packaging-contract.test.mjs` 中的版本断言。
6. 在 `frontend/` 运行 `npm run docs:generate` 和
   `npm run docs:check`，同步由版本清单生成的当前状态和发布索引。
7. 运行 `rg -n 'alpha-2\.6|0\.2\.6-alpha\.0' VERSION frontend
   doc/BlissHack`，确认旧版本只保留在确实属于历史记录的位置。

## 4. 安装依赖

从仓库根目录执行：

```sh
nvm use
node --version
node -p "process.arch"
cd frontend
npm ci
```

预期 Node.js 主版本为 `24`，构建机架构为 `arm64`。不要用本机其他 Node.js
版本生成发布包。`npm ci` 必须使用已提交的 `package-lock.json`，不要在发布
构建时临时升级 Electron 或 Forge。

## 5. 发布前验证

以下命令不负责生成最终包，但应在打包当前提交前通过：

```sh
npm test
npm run lint
npm run test:integration:wasm
npm run test:integration:browser
npm run test:desktop
```

`test:desktop` 会先构建 renderer，再启动真实 Electron 进行桌面冒烟测试。若
发布前完整测试已经在同一提交、同一依赖锁文件上通过，可以保留对应记录，不必
因为重复打包而反复运行耗时测试。

## 6. 清理旧产物

仍在 `frontend/` 目录时执行：

```sh
rm -rf ./out
```

只删除 `frontend/out/`。这一步很重要，因为严格包验证会扫描该目录，旧版包或
不同架构的残留文件可能造成误判，也可能在上传时混入本次 Release。

## 7. 构建三个包

先记录当前提交作为诊断日志中的 build ID，并只构建一次 renderer：

```sh
VITE_BUILD_ID="$(git -C .. rev-parse HEAD)" npm run desktop:build
```

然后生成 macOS Apple Silicon ZIP：

```sh
./node_modules/.bin/electron-forge make \
  --platform=darwin \
  --arch=arm64 \
  --targets=@electron-forge/maker-zip
```

Forge 会同时保留
`out/BlissHack-darwin-arm64/BlissHack.app`。直接使用这个刚生成的 `.app`
创建 DMG，不再重复构建 renderer：

```sh
node electron/scripts/create-dmg.mjs arm64
```

最后生成 Windows x64 ZIP：

```sh
./node_modules/.bin/electron-forge make \
  --platform=win32 \
  --arch=x64 \
  --targets=@electron-forge/maker-zip
```

不要省略 Windows 的 `--targets=@electron-forge/maker-zip`。Forge 配置还包含
Squirrel maker；当前 macOS 流程只保证跨平台 ZIP，不把未在 Windows 环境验证
的安装器当作发布产物。

## 8. alpha-2.6 预期产物

完成后应存在：

```text
frontend/out/make/BlissHack-alpha-2.6-darwin-arm64.dmg
frontend/out/make/zip/darwin/arm64/BlissHack-darwin-arm64-0.2.6-alpha.0.zip
frontend/out/make/zip/win32/x64/BlissHack-win32-x64-0.2.6-alpha.0.zip
```

可以在 `frontend/` 中用以下命令一次确认：

```sh
PRODUCT_VERSION="$(cat ../VERSION)"
PACKAGE_VERSION="$(
  node -p "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).version"
)"
DMG="out/make/BlissHack-${PRODUCT_VERSION}-darwin-arm64.dmg"
MAC_ZIP="out/make/zip/darwin/arm64/BlissHack-darwin-arm64-${PACKAGE_VERSION}.zip"
WIN_ZIP="out/make/zip/win32/x64/BlissHack-win32-x64-${PACKAGE_VERSION}.zip"
test -f "$DMG" && test -f "$MAC_ZIP" && test -f "$WIN_ZIP"
du -h "$DMG" "$MAC_ZIP" "$WIN_ZIP"
```

当前包体通常约为：

- macOS DMG：约 130 MB。
- macOS ZIP：约 130 MB。
- Windows ZIP：约 155 MB。

依赖和压缩结果会让大小小幅变化；明显缺少几十 MB 时应视为构建异常。

## 9. 产物验证

三个包全部生成后，在 `frontend/` 运行严格包验证：

```sh
npm run desktop:verify-package
```

它会检查 `app.asar` 内容、版本、图标、许可证、macOS ZIP 和 DMG。然后执行
容器完整性与签名检查：

```sh
unzip -t "$MAC_ZIP"
unzip -t "$WIN_ZIP"
hdiutil verify "$DMG"
codesign --verify --deep --strict \
  out/BlissHack-darwin-arm64/BlissHack.app
```

当前 macOS 包默认使用 ad-hoc 签名，不是 Apple Developer ID 签名，也没有
notarization。Windows 包没有 Authenticode 签名。首次启动时出现 Gatekeeper
或 SmartScreen 提示属于当前发布方式的预期限制，不代表 ZIP/DMG 已损坏。

生成便于发布页核对的 SHA-256：

```sh
shasum -a 256 "$DMG" "$MAC_ZIP" "$WIN_ZIP" \
  | tee out/make/SHA256SUMS.txt
```

最后确认 Git 工作树没有被构建产物污染：

```sh
git -C .. status --short
```

`frontend/out/` 已被 `.gitignore` 忽略，不应提交三个二进制文件。

## 10. 人工测试和失败处理

macOS 上至少分别测试 DMG 安装和 ZIP 解压启动，确认：

- 图标、Home 和 About 显示正确版本。
- 离线进入游戏、保存退出、重新启动并继续存档。
- `Cmd+Q` 关闭确认和原生文件导出正常。

把 Windows ZIP 完整传到真实 Windows 10/11 x64 机器，完整解压后运行
`BlissHack.exe`，确认离线启动、存档恢复、`Alt+F4`、Alt/Meta 输入和原生导出。
不能只复制 ZIP 中的 `.exe`。

任何步骤失败时不要从旧 `out/` 中挑文件补齐。修复源码或环境后重新执行
“清理旧产物”及后续步骤，确保三个包来自同一提交和同一次版本配置。

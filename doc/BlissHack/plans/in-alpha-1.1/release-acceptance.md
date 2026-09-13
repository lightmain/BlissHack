# alpha-1.1 发布验收

本文记录 alpha-1.1 地图交互与定向基建工作的自动与人工验收结果。人工验收于
2026-09-14 通过，随后以 `eec1a4b41` 合入 `BlissHack`。当前尚未 push，在线
站点仍是 prealpha-4；部署后的生产 smoke test 仍需执行。

## 1. 测试环境

- 日期：2026-09-13。
- 机器：Apple M4 Pro，arm64。
- 系统：macOS 26.5.1。
- 固定构建工具：Node.js 24.19.0、Emscripten 6.0.9、GNU Make 3.81、
  Apple Clang 21.0.0。
- 前端测试 shell：Node.js 22.21.1。
- Playwright：1.62.1。
- 主要视口：1280×900；窄桌面视口：900×700。

## 2. 实现结果

- `MapViewport` 统一拥有 scroll container、renderer、camera 和 pointer 输入。
- 原生 scrollbar chrome 隐藏，真实 overflow 与触控板滚动保留。
- 右键小于 5 CSS px 是格子操作；达到阈值后成为带 pointer capture 的拖动。
- Follow 开启时允许手动浏览；相同坐标回合和右键查看不抢回 camera，有效
  Follow target 的坐标变化后重新居中。
- renderer 或布局变化恢复归一化 anchor；Follow 关闭时移动不改变 camera。
- 浏览器测试通过 renderer、cursor、revision、command 和 scroll anchor 的
  稳定 contract 观察地图，不读取 ASCII 行。
- profile v1/v2 通过显式 migration registry 进入同一当前类型。
- `npm run check:toolchain` 与完整 WASM 构建共用预检，且不执行清理或编译。

## 3. 运行时产物

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `nethack-classic.png` | 459,374 | `bd41a419de9df7cc9b6533438087b4aabf7a087fad3726e5f615dbe9f2f83de6` |
| `nethack-classic.json` | 1,877 | `09c7bf5998cd86d7d58a5b9a62b42c852d8a9a8c44d7b067740e3cd1ca02fc09` |
| `nethack.js` | 95,047 | `98754a6473f57c8ceb76eb8a6620319f15889fe3835a11194a5c1679d755f633` |
| `nethack.wasm` | 6,627,270 | `8ddae29128b295184f8d534dd4190a667f4601bc984b8497edeac1697d998b6c` |
| `nethack-runtime.json` | 575 | `ec450bc50e211059f4487e635ef9f15af15ed2fa100f1ea5170f311ed26e1563` |

WASM 的 2-byte 变化来自重新构建后内嵌的 `alpha-1.1` 版本、提交和构建时间；
`nethack.js` 与 alpha-1 字节一致。staging 中的 runtime、ABI 和 tile mapping
测试通过后才发布三件套。

## 4. 自动验收

| 命令/套件 | 结果 |
| --- | --- |
| `npm run check:toolchain` | 固定版本、同源 wrappers、hints 和目标路径通过 |
| `npm run build:wasm` | 固定工具链完整重建、staging 50/50、发布校验通过 |
| `npm run verify:tiles` | 2307 tiles 与全部输入 checksum 通过 |
| `npm test` | 44 files，486/486 |
| `npm run lint` | 0 warnings，0 errors |
| `npm run build` | TypeScript 与 Vite production build 通过 |
| `npm run test:integration:wasm` | 50/50 |
| `npm run test:integration:browser` | Chromium 43/43 |
| `npm run test:integration:compat` | Firefox 9/9，WebKit 9/9 |
| `npm run test:performance` | 2/2 |
| `npm run test:long` | 4/4 |
| `git diff --check` | 通过 |

Canvas 性能 harness 的 30 轮全图绘制结果：

| 指标 | 本地结果 |
| --- | ---: |
| 总耗时 | 141.8 ms |
| 平均 | 4.73 ms |
| p95 | 4.90 ms |
| 最大 | 8.30 ms |

开发阶段每部分均经过测试 subagent、实现、独立只读审查和 finding 修正。最终
覆盖审计额外发现并修复了“同坐标的新 `clipCenter` 对象错误拉回 camera”的
问题。

## 5. 人工验收

以下项目已由用户于 2026-09-14 完成并确认通过。

### 5.1 地图与滚动

1. 打开本地验收地址，保持 DevTools Console 可见，开始一局默认 Tiles 游戏。
2. 把窗口缩到约 900×700，并将永久背包设为 Right；确认地图没有可见横向或
   纵向 scrollbar，地图、状态和背包不重叠。
3. 使用触控板两指横向滚动，确认能查看远离玩家的地图。
4. 保持 Follow player 开启，右键拖动约 40px；确认地图随手势平移，松开后
   停在手动位置，并且浏览器 context menu 不出现。
5. 从地图内开始右键拖动，移出地图边界后松开；再次点击和拖动仍正常，cursor
   不会停留在 grabbing。

### 5.2 右键与 Follow

1. 按 `;` 进入位置输入；若出现 Farlooking 提示菜单，关闭提示后继续。
2. 左键选择一个远处格子，确认原有位置选择能够正常提交；然后重新按 `;`。
3. 在远处格子右键短按，确认执行原有右键格子操作且 camera 不跳回玩家。
4. 再做一次约 3px 的轻微右键移动，确认仍按 click 处理。
5. 在 position input 中右键拖动约 40px，确认只平移、不选择格子，输入仍等待。
6. 退出 position input，手动拖离玩家后按 `.` 等待一回合；玩家坐标不变，
   camera 也不回中。
7. 向可通行的相邻格移动；Follow 开启时 camera 应重新以玩家为目标。
8. 关闭 Follow player，再拖离并移动玩家；camera 应保持手动位置。

### 5.3 Renderer 与布局

1. 手动滚到易识别的远处区域，执行 Tiles→ASCII→Tiles；确认 camera 区域、
   玩家位置和 session 都不丢失。
2. 改变窗口宽度，确认 camera 保持同一归一化地图区域；边缘允许正常 clamp。
3. 将永久背包在 Right 与 Below 间切换，并测试展开、折叠；地图和背包内容
   正常，camera 不无故跳回。

### 5.4 数据兼容

1. 保存并返回 Home，刷新页面后 Continue；确认角色、地图、renderer 和设置。
2. 导出 profile，打开导入预览并重新导入；确认 Map display 与 Follow 设置。
3. 导出完整 backup，执行导入预览和恢复；确认存档与 profile 均可恢复。
4. 复制刚导出的 `.bhprofile`，把顶层 `schemaVersion` 改为 `1` 并删除
   `interface.mapRenderer`；导入后确认预览和应用结果为 ASCII。
5. 对 `.bhbackup` 内嵌的 `profile` 做同样修改，保持 backup 外层
   `schemaVersion: 1` 和 saves 不变；确认预览可读取并能单独应用 profile。
6. 验收结束时检查 Console，没有 pointer capture、Canvas、React、tile 越界或
   runtime manifest 错误。

## 6. 当前结论

自动与人工验收均已通过。alpha-1.1 已通过 merge commit `eec1a4b41` 合入部署
分支，但尚未 push。push 并完成 GitHub Pages 部署后，还需在线重复一次
Tiles/ASCII、右键 click/drag、Follow 和 Continue 的生产 smoke test。

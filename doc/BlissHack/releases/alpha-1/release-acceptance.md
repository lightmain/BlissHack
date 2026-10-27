# alpha-1 发布验收

本文记录 alpha-1 官方 Tileset 引入的自动验收结果和待人工检查项目。自动测试
通过不代表已经发布；当前 `alpha-1` 分支尚未合入或 push 到部署分支。

## 1. 测试环境

- 日期：2026-09-12。
- 机器：Apple M4 Pro，arm64。
- 系统：macOS 26.5.1。
- 仓库固定 Node.js 主版本：24；本地 Playwright shell：Node.js 22.21.1。
- 固定 Emscripten：6.0.9。
- Chromium：151.0.7922.34。
- Firefox：153.0。
- WebKit：26.5。
- 主要视口：1280×900；窄桌面视口：900×700。
- 生产构建 base path：`/BlissHack/`。

## 2. 生成产物

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `nethack-classic.png` | 459,374 | `bd41a419de9df7cc9b6533438087b4aabf7a087fad3726e5f615dbe9f2f83de6` |
| `nethack-classic.json` | 1,877 | `09c7bf5998cd86d7d58a5b9a62b42c852d8a9a8c44d7b067740e3cd1ca02fc09` |
| `nethack.js` | 95,047 | `98754a6473f57c8ceb76eb8a6620319f15889fe3835a11194a5c1679d755f633` |
| `nethack.wasm` | 6,627,268 | `8b1ecc93595784df74f1821bcb2f67476619d6e41027c5e8f8d226c12af40df1` |
| `nethack-runtime.json` | 575 | `bd542c8512c27de2a3fbfd6d0212647fada5fdb1aed4c0ed32ed280d001002bc` |

Atlas 是 40×58、640×928、共 2307 个 16×16 tile。阶段二已经使用固定工具链
完整重建 WASM，并由 staging 目录先执行 runtime 与 tile mapping 校验，再更新
上述运行时三件套。

## 3. 自动验收

| 命令/套件 | 结果 |
| --- | --- |
| `npm run verify:tiles` | 2307 tiles 与全部输入 checksum 通过 |
| `npm test` | 43 files，472/472 |
| `npm run lint` | 0 warnings，0 errors |
| `npm run build` | TypeScript 与 Vite production build 通过 |
| `npm run test:integration:wasm` | 50/50 |
| `npm run test:integration:browser` | Chromium 38/38 |
| `npm run test:integration:compat` | Firefox 7/7，WebKit 7/7 |
| `npm run test:performance` | 2/2 |
| `npm run test:long` | 4/4 |
| `git diff --check` | 通过 |

浏览器专项还确认：

- Canvas 不是全透明、全黑或单色，玩家附近至少多个 tile 有不同像素签名。
- 1280×900 和 900×700 下 CSS 尺寸、DPR backing store、pixelated 和状态区
  边界正确；截图作为 Playwright attachment 保存。
- Tiles→ASCII→Tiles 不创建新 session、不改变 cursor，并保留手动滚动中心。
- manifest 和 PNG 每个页面只请求一次。
- PNG 不可用或 2D context 不可用时回退 ASCII，保留 Tiles 偏好并记录诊断。
- Firefox 和 WebKit 均执行真实 Tiles 像素及切换流程。

Canvas 性能 harness 每帧执行与生产 renderer 相同的 backing-store resize、
context reset 和 80×21 全图绘制。当前 30 轮结果：

| 指标 | 本地结果 |
| --- | ---: |
| 总耗时 | 147.0 ms |
| 平均 | 4.9 ms |
| p95 | 5.5 ms |
| 最大 | 8.3 ms |

门禁同时使用参考平均值倍率和宽松绝对上限，防止明显退化且避免共享 CI 抖动。

## 4. 待人工验收

1. 用全新浏览器配置开始新游戏，确认首屏默认是 Tiles。
2. 检查玩家、宠物、怪物、物品、墙、门、楼梯和未探索区域。
3. 完成移动、开门、拾取、战斗和上下楼。
4. 使用 `;` 进入位置选择，分别测试地图左键和右键。
5. 在游戏内 Settings 连续执行 Tiles→ASCII→Tiles，确认游戏和位置不重启。
6. 分别开启和关闭 Follow player，调整窗口宽度并手动滚动地图。
7. 启用永久背包，分别检查右侧和下方布局、折叠、拾取与丢弃更新。
8. 保存退出、刷新页面、Continue，确认身份、地图和 renderer 偏好。
9. 导出 profile 和完整备份，再完成导入预览与恢复。
10. 在浏览器 Console 确认没有图片解码、Canvas、React 或 tile 越界错误。

atlas/Canvas 故障回退已有自动化注入测试，不要求人工破坏部署资源。

## 5. 当前结论

自动验收已通过。alpha-1 当前停在人工验收门槛；在人工检查通过前，不合入
部署分支、不 push 触发 GitHub Pages。

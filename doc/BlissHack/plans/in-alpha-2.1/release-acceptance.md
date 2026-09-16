# BlissHack alpha-2.1 发布验收

## 状态

alpha-2.1 实现、独立复审和自动门禁已完成，当前等待人工验收。尚未 push 或部署。

## 交付内容

- 永久背包退出浏览器键盘所有权和 Tab 顺序；其 accelerator 字符仍显示，鼠标
  点击、右键菜单和拖放保持可用。
- 永久背包元素即使持有 DOM focus，`hjkl` 等按键仍进入 NetHack；`i` 命令
  打开的核心背包菜单继续支持 accelerator。
- Below HUD 使用顶部固定 80×21 地图和底部左右分栏：状态栏在左，永久背包
  在右并取得更多宽度，两者共同填充剩余高度且最小高度为 11rem。
- 地图内容可容纳时水平居中；Tiles 等宽地图溢出时保留安全起点和现有滚动相机，
  不缩放地图。
- 320×240 等极端 viewport 由 Below Grid 自身提供纵向滚动，不产生页面横向
  overflow。
- 地图右键菜单关闭后仍恢复地图 focus，但不再显示浏览器默认蓝色 outline。
- 产品版本更新为 `alpha-2.1`。本版本没有 C/WASM 修改，运行时三件套保持
  alpha-2.0 已验证内容。

## 自动验证

| 门禁 | 结果 |
| --- | --- |
| `npm test` | 600/600 |
| `npm run lint` | 0 warnings / 0 errors |
| `npm run check:toolchain` | Node 24.19.0 / Emscripten 6.0.9 |
| `VITE_BASE_PATH=/BlissHack/ npm run build` | 通过 |
| `npm run test:integration:wasm` | 88/88 |
| `npm run test:integration:browser` | Chromium 72/72 |
| `npm run test:integration:compat` | Firefox/WebKit 60/60 |
| `npm run test:performance` | 2/2 |
| `npm run test:long` | 4/4 |

独立 reviewer 的初审 findings 包括兼容白名单遗漏、极端 viewport 恢复入口和
两项测试精度问题；修复后复审确认没有剩余 P0、P1 或 P2。

## 人工验收

1. 启用永久背包，分别点击背包空白、物品行和折叠按钮附近；按 `hjkl`，确认
   角色继续移动，背包不会按字母跳转或选择物品。
2. 按 `i` 打开核心背包，按任一可见物品字母，确认进入该物品的
   `Do what with ...?` 动作菜单。
3. 将永久背包位置设为 Right，确认布局与 alpha-2.0 一致。
4. 切换为 Below：确认地图位于顶部且不缩放；ASCII 在宽屏中水平居中；地图
   下方状态栏在左、永久背包在右，两者一直延伸到 viewport 底部。
5. 在 900×700 等较小窗口检查 Below：状态字段可换行，背包仍有足够高度，
   页面没有横向滚动或区域重叠。
6. 在地图上右键打开菜单后按 Escape，或执行任一菜单动作；确认键盘继续控制
   游戏，地图周围不出现浏览器默认蓝框。

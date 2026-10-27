# alpha-2.0 发布验收

本文记录 alpha-2.0 交互式 HUD 的自动验收结果和待人工检查项目。自动测试通过
不代表已经发布；当前 `alpha-2.0` 分支尚未合入、push 或部署。

## 1. 测试环境

- 日期：2026-09-15。
- 机器：Apple M4 Pro，arm64。
- 系统：macOS 26.5.1。
- 固定工具链：Node.js 24.19.0、Emscripten 6.0.9、GNU Make 3.81、
  Apple Clang 21.0.0。
- Playwright：1.62.1。
- 主要视口：1280×900；最低桌面视口：900×700。
- 生产构建 base path：`/BlissHack/`。

## 2. 实现结果

- `GameHudLayout` 独占 viewport Grid，消息、地图、状态和永久背包各自拥有明确
  区域与 overflow；永久背包支持 Right、Below 和折叠。Below 模式把背包放在
  状态栏上方，并为展开状态保留 11rem 至 15rem 的响应式高度。
- 状态栏使用核心结构化字段显示 HP、Energy、XP、属性、AC、金币、回合、地点
  和 conditions，不从展示文本反推资源百分比；关闭 Experience 后隐藏经验点
  和 XP 进度条，但继续显示角色等级。
- 地图、背包和状态共用 anchored overlay。地图悬停说明来自核心
  `clicklook`，不写入普通消息历史。
- 普通地图左键使用核心 `mouseaction`；相邻关闭或锁定门按普通方向移动进入
  autoopen/autounlock。右键菜单使用核心 `therecmdmenu`，显式 Kick 仍带目标
  方向；永久背包右键菜单使用核心 `itemactions()`。
- `GameActionController` 独占高层动作编排，只在真实 command/menu 边界推进，
  遇到非预期 prompt、过期 session、snapshot 或背包 revision 时安全取消。
- 永久背包拖放使用 Pointer Events。只有地图接受 drop，落点固定为玩家脚下；
  物品选择、装备/诅咒拒绝、数量和回合语义由核心原生 drop 流程决定。
- 两键 typeahead、显式位置输入、Tiles/ASCII、save、Continue、profile、
  backup 和多页面锁保持兼容。

## 3. 运行时产物

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `nethack-classic.png` | 459,374 | `bd41a419de9df7cc9b6533438087b4aabf7a087fad3726e5f615dbe9f2f83de6` |
| `nethack-classic.json` | 1,877 | `09c7bf5998cd86d7d58a5b9a62b42c852d8a9a8c44d7b067740e3cd1ca02fc09` |
| `nethack.js` | 95,047 | `cf00ebd0276440ff61c58e6e07bd5fe396918150c8be63662346100dfa951208` |
| `nethack.wasm` | 6,629,237 | `d206a483d770edfc6f91ff571c9b2799430cd1c90d48c54ed580ab87f5777056` |
| `nethack-runtime.json` | 575 | `9c7dd6c02ec1e331e7a78cfc3b3b2cf75003d9fac35ad74ad6641e278a7e09e0` |

运行时 manifest 已验证 Node、Emscripten、Lua、hints、host compiler、文件长度
和 SHA-256。`nethack.js` 与阶段六重建前保持字节一致。

## 4. 自动验收

| 命令/套件 | 结果 |
| --- | --- |
| `npm run check:toolchain` | 固定 Node 24.19.0、Emscripten 6.0.9、同源 wrappers、hints 和目标路径通过 |
| `npm run verify:tiles` | 2307 tiles 与全部输入 checksum 通过 |
| `npm test` | 53 files，599/599 |
| `npm run lint` | 0 warnings，0 errors |
| `npm run build` | TypeScript 与 Vite production build 通过 |
| `npm run test:integration:wasm` | 88/88 |
| `npm run test:integration:browser` | Chromium 70/70 |
| `npm run test:integration:compat` | Firefox 28/28，WebKit 28/28 |
| `npm run test:performance` | 2/2 |
| `npm run test:long` | 4/4 |
| `git diff --check` | 通过 |

Chromium 保存 8 张 HUD 像素基线，覆盖：

```text
Tiles × Right × 1280×900 / 900×700
Tiles × Below × 1280×900 / 900×700
ASCII × Right × 1280×900 / 900×700
ASCII × Below × 1280×900 / 900×700
```

随机地图、消息、背包内容区和状态值被稳定遮罩；资源条、背包面板、区域尺寸、
分隔线、布局拓扑与 viewport 边界仍参与像素比较。截图前还直接确认背包包含
核心发布的装备项、Tiles Canvas 非空且包含多种颜色、ASCII 包含 21 行有效
内容。三个浏览器都另外执行严格几何断言，确认四个 HUD 区域无重叠、无
document/body overflow，且四个 overflow owner 唯一。

本机最终性能结果：

| 指标 | 本地结果 |
| --- | ---: |
| Canvas 30 轮总耗时 | 150.8 ms |
| Canvas 平均 | 5.03 ms |
| Canvas p95 | 5.40 ms |
| Canvas 最大 | 8.20 ms |
| 300 项背包 React commit | 12.30 ms |
| 300 项背包滚动帧 | 8.70 ms |

长流程重复验证十次正常退出、十次 Continue/save/reload、五次 raw save
导出/删除/导入/继续，以及五次后台返回后的存档扫描。

## 5. 独立复审

阶段七独立 reviewer 重点检查：

1. command、menu、snapshot 和 inventory revision 之间的竞态。
2. 过期 session、地图目标和背包 accelerator 的 fail-closed 行为。
3. Context Menu 的焦点进入、Escape/外部点击关闭和触发点焦点恢复。
4. Right/Below、Tiles/ASCII、1280×900 和 900×700 的布局与 overflow。
5. drop 成功、核心拒绝和取消路径的物品与回合语义。

首次复审发现的两个 P2（禁用背包后的 Below 折叠空轨道、地图菜单关闭后的
焦点恢复）和一个 P3（视觉基线遮罩过多）均已修复，并由第二位独立 reviewer
确认关闭；没有剩余 P1、P2 或 P3。

人工验收反馈修复的独立复审未发现功能问题，并确认 Below Grid、门左键普通
移动、Experience 动态隐藏和 runtime 三件套实现正确。复审提出的截图随机背包
噪声、门源码契约范围过宽和本文 runtime 摘要过期均已修正。

## 6. 待人工验收

### 6.1 HUD 与布局

1. 用本地验收地址开始一局默认 Tiles 游戏，保持 DevTools Console 可见。
2. 分别在 1280×900 和 900×700 检查消息栏固定在顶部、状态栏固定在底部，
   地图、消息、状态和背包互不重叠。
3. 将永久背包切换为 Right 和 Below，并测试展开、折叠与模式切换。
4. 在 Tiles 与 ASCII 间往返切换，确认 session、玩家位置和 camera 合理保持。
5. 改变消息行数、窗口尺寸和 Follow，确认各区域无页面级 scrollbar 或溢出。

### 6.2 地图交互

1. 悬停墙、门、怪物、物品、楼梯和未知目标，核对 Tooltip 是核心描述。
2. 快速移动指针、滚动地图、按键和暂停，确认旧 Tooltip 会及时关闭。
3. 左键相邻门、敌人、空地和远处格子，核对核心默认动作。
4. 右键相同目标，确认菜单动作来自实际上下文；取消菜单不消耗回合。
5. 测试 3px 抖动、达到 5px 的右键拖动和拖出边界，确认 click/pan 阈值。
6. 在 `;`、Travel 和方向选择中确认左右键仍提交显式位置而不打开普通菜单。

### 6.3 永久背包

1. 右键武器、护甲、食物、工具和未知物品，核对核心 `itemactions()` 菜单。
2. 选择实际动作后核对结果与键盘路径一致；Escape 与外部点击恢复焦点。
3. 把普通物品和整组物品拖到地图，确认高亮玩家格且物品落在玩家脚下。
4. 尝试拖动装备或不可丢弃物品，确认保留物品、显示核心反馈且不消耗回合。
5. 用 Escape、pointer cancel、lost capture 和背包变化中断拖动，确认没有误丢。

### 6.4 状态与数据

1. 受伤、治疗、消耗能量、升级和属性变化时检查状态值、进度和变化提示。
2. 触发 Hunger、Blind、Confusion 等状态并检查标签与 Tooltip。
3. 保存退出、刷新并 Continue，确认 HUD、背包和交互仍正常。
4. 导出并重新导入 profile、完整 backup 和 raw save。
5. 用第二个页面触发游戏锁冲突，关闭 owner 后重试。
6. 验收结束时确认 Console 没有 stale intent、pointer capture、menu、React、
   layout overflow 或 WASM 错误。

## 7. 当前结论

alpha-2.0 实现和自动发布门禁已完成，当前停在人工验收门槛。在用户确认人工
验收通过前，不合入部署分支、不 push，也不部署 GitHub Pages。

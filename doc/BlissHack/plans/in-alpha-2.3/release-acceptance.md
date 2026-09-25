# BlissHack alpha-2.3 发布验收

本文记录 alpha-2.3 动作栏、动作次级输入和 Original TTY 状态的自动验收结果
及待人工检查项目。自动测试通过不代表已经发布；当前不 push、不部署。

## 1. 状态

alpha-2.3 实现、独立复审和自动门禁已完成，当前停在人工验收门槛。

## 2. 测试环境

- 日期：2026-09-25。
- 机器：Apple M4 Pro，arm64。
- 系统：macOS 26.5.1。
- 固定工具链：Node.js 24.19.0、Emscripten 6.0.9、GNU Make 3.81、
  Apple Clang 21.0.0。
- Playwright：1.62.1。
- 主要视口：1280×900；窄桌面视口：900×700。
- 生产构建 base path：`/BlissHack/`。

## 3. 交付内容

- profile v4 持久化 Original/BlissHack 动作栏模式、1 至 4 行、分类、锁定和
  自定义布局；`.bhactions` v1 支持预览、原子导入和导出。
- 104 个可见非方向核心命令构成 session-scoped catalog；动作通过不透明命令
  ID 在安全 command boundary 执行，不把默认快捷键当作执行协议。
- 动作栏支持分类 Tab、完整列拟合、横向 overflow、拖动移动/交换/覆盖/删除、
  分隔线调整、键盘编辑和 All Actions 搜索。
- `getobj()` 物品候选使用 nonce、provenance 和 menu generation 三重身份；
  物品、方向、坐标和其他输入只根据核心实际 callback 逐步推进。
- 物品、方向、`yn`/`ynq` 和普通 `PICK_ONE` 共用动作次级弹窗；快捷键启动的
  `getdir()` 同样显示八个邻格目标并允许点击，提示不再占用动作栏高度。
- Messages 区域提供小型历史按钮，经真实 `prevmsg` catalog action 打开扩大
  后的历史窗口。
- Original 模式使用结构化 BL 字段绘制 TTY 风格两行状态，不含 HP、Energy、
  XP 图形条；BlissHack 图形状态与动作栏保持原有展示。
- 当前 callback 不能区分远程与近程方向操作，也不提供射程、未知区域或固体
  阻挡语义。本版本不按提示、动作名或物品名猜测射线。

## 4. 运行时产物

阶段八没有修改上游 C 或 WASM，运行时三件套保持阶段四已验证内容：

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `nethack.js` | 97,200 | `380484b97cc891b243c22368c22356182691d06acbf1158523a59238703ec44b` |
| `nethack.wasm` | 6,635,329 | `5027e8b8ac26a2ad8ad020a058042251f02ec47f5c45932926e1a2ee952dbcfe` |
| `nethack-runtime.json` | 575 | `5f8a11aab863f10b525dffe662c20ee5874e0c1516c07662d5f402778f372a5a` |

manifest 记录 Node 24.19.0、Emscripten 6.0.9、Lua 5.4.8、
`sys/unix/hints/macOS.500` 和 Apple Clang 21.0.0。

## 5. 自动验收

| 命令/套件 | 结果 |
| --- | --- |
| `npm run check:toolchain` | Node.js 24.19.0、Emscripten 6.0.9 及同源 wrappers 通过 |
| `npm run verify:tiles` | 2307 tiles 与输入 checksum 通过 |
| `npm test` | 82 files，894/894 |
| `npm run lint` | 0 warnings，0 errors |
| `npm run build` | TypeScript 与 Vite production build 通过 |
| `npm run test:integration:wasm` | 152/152 |
| `npm run test:integration:browser` | Chromium 141/141 |
| `npm run test:integration:compat` | Firefox + WebKit 172/172 |
| `npm run test:performance` | 2/2；Canvas 全图 p95 4.7 ms |
| `npm run test:long` | 4/4 |
| `git diff --check` | 通过 |

Chromium HUD 基线共 24 张，覆盖 Original 与 BlissHack、Tiles/ASCII、
Right/Below、1280×900 和 900×700；BlissHack 还覆盖 2 行与 4 行动作栏。
阶段八更新了 8 张 Original 基线，BlissHack 的 16 张基线保持不变。三个浏览器
继续执行区域无重叠、页面无 overflow、固定地图尺寸和动作槽最小尺寸断言。

新增真实 Chromium 流程确认：

- 快捷键启动 `getdir()` 时动作栏不跳动，次级弹窗和八个邻格目标同时出现。
- `getdir()` 保留核心的 `?` 帮助键，关闭帮助后重新进入方向输入；方向按钮保留
  Tab 导航以及 Enter、Space 原生激活。
- `throw` 按物品后再进入方向步骤，两个阻塞输入严格串行。
- `yn`/`ynq` 默认与非默认按钮、键盘 `y`/`n`/`q` 与 Escape 保持核心原有
  语义。
- Messages 按钮通过 `prevmsg` 打开扩大后的真实消息历史窗口。

## 6. 独立复审

首轮独立复审发现并修正了 `yn` 默认按钮、Messages 历史按钮键盘事件、
紧凑单选菜单取消键、动作方向取消状态机和验收文档状态五类问题。第二轮独立
复审发现方向弹窗会吞掉核心合法特殊键，以及非默认 `yn` 按钮的 Enter、Space
会提交默认答案。补充真实浏览器回归并修正后，最终独立复审未发现剩余 P1/P2
问题；修正后的方向帮助、Tab、Enter、Space、Escape、`ynq`、方向取消和消息
历史路径均有 Chromium、Firefox 和 WebKit 覆盖。

## 7. 待人工验收

1. 在 1280×900 与 900×700 下分别检查 Original/BlissHack、Tiles/ASCII、
   Right/Below，确认消息、地图、状态、背包和动作栏无重叠。
2. 用动作栏和键盘分别执行 `eat`、`throw`、`kick`、`loot`；确认物品、方向和
   `Do what with the chest?` 按核心请求顺序逐个出现，取消不消耗额外回合。
3. 在方向步骤点击角色周围八格，并用 vi 方向键、方向键和数字小键盘复核。
4. 触发 `yn` 与 `ynq`，分别点击按钮并按 `y`、`n`、`q`、Escape。
5. 点击 Messages 历史按钮，再通过角色上下文的 Access memories 打开历史，
   确认内容和关闭行为一致。
6. 在 Original 下检查正常、受伤、缺能量、升级、变形和多 conditions 状态；
   确认两行顺序、动态字段、颜色和属性正确且没有图形进度条。
7. 导出并重新导入 profile、完整 backup 和 `.bhactions`，确认动作栏布局与
   其他设置保持。
8. 验收结束时确认 Console 没有 stale intent、重复输入、React、layout、
   Canvas 或 WASM 错误。

## 8. 当前结论

alpha-2.3 的实现、自动门禁和独立复审已完成，当前等待用户人工验收。在用户确认
前不 push、不部署 GitHub Pages。

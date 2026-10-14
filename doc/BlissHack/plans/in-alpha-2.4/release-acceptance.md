# BlissHack alpha-2.4 发布验收

本文记录 alpha-2.4 Examine 观察窗口、资料资产和可见身份边界的自动验收结果，
并保留仍需用户完成的人工验收清单。完成自动验收不代表已经发布；当前不 push、
不部署。

## 1. 状态

alpha-2.4 已完成实现、独立复审和自动门禁。人工验收仍待用户确认；在用户确认
前，不得把 alpha-2.4 标记为完成。

## 2. 测试环境

- 最终自动复验日期：2026-10-14。
- 机器：Apple M4 Pro，arm64。
- 系统：macOS 26.5.1。
- 固定工具链：Node.js 24.19.0、npm 11.17.0、Emscripten 6.0.9、
  GNU Make 3.81、Apple Clang 21.0.0、Lua 5.4.8。
- Playwright：1.62.1。
- 生产构建 base path：`/BlissHack/`。

## 3. 交付内容

- Detailed 地图与永久背包右键菜单为受支持目标增加判别联合形式的
  synthetic `Examine` 行；Original 与全部核心原有动作保持不变。
- `GameActionController` 只取消一次核心菜单，并等待 resolver、窗口消失和新
  command boundary 后发布本地窗口请求；查看资料不消耗回合。
- 可见身份只来自核心最终 glyph 或已经公开、并与精确 glyph 对照验证的有界
  普通物品/神器 token，不读取 C 指针、对象链、隐藏陷阱、未鉴定真值或英文
  菜单文本。
- 由当前 NetHack 5.0.0 源码确定性生成 970 条实体资料，并对 9,624 个 glyph
  完成 supported 或显式 unsupported 分类。
- 独立的 926 条 normal/pile-top 精确对象 glyph 对照只用于校验核心已经公开的
  普通物品 token；公开 glyph binding 继续把静态未知类型保持为通用类别。
- 运行时严格校验并按需加载 core/Wiki manifest、glyph binding 和 entity
  chunk；并发请求合并，失败与 stale 请求 fail closed。
- 响应式观察窗口包含事实、Wiki Tab、分离的来源与许可、焦点限制、键盘导航和
  关闭后焦点恢复；窄屏使用单一内容滚动区域。
- `nethack-runtime.json` schema v3 同时绑定 loader、WASM、core manifest、
  Wiki manifest 和 core source fingerprint。

## 4. 内容与覆盖

完整数字和 unsupported 原因见
[核心资料覆盖报告](catalog-coverage-report.md)，Wiki 选择、revision 与许可
结果见 [Wiki 发布审查报告](wiki-review-report.md)。

- core records：970；supported glyph：6,444；unsupported glyph：3,180。
- core JSON：1,888,798 B；首次 Detailed 基础索引最坏 107,686 B。普通物品
  token 首次校验另按需读取 45,095 B 精确索引，合计最坏 152,781 B，均低于
  预算。
- Wiki 只发布 `Newt` revision 205110 的 1 条记录、4 个完整原文段落：
  Strategy 2 段、History 1 段、Dudley's dungeon 1 段。
- 两段不安全的 Overview 内容未发布；运行时没有 Overview Tab，也没有摘要、
  翻译、改写、截句、合并或拼接。
- 969 个无 Wiki 记录的实体按设计保持 core facts-only。

## 5. 运行时产物

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `nethack.js` | 96,199 | `dd9572c4775b10009a05904cc8a090d8713762425d42f4a1462fdf1f121a970f` |
| `nethack.wasm` | 6,647,378 | `7dd34483bb310434aa55025319a663ed3c7084f3b5518cf4fd2172a9f7fc5343` |
| `nethack-runtime.json` | 1,007 | `54402df051d3f1be5e00e90590d1193e94ee9d734eedc3881889a424da71bd68` |

浏览器先校验 `nethack.js` 与 `nethack.wasm`，再从临时 Blob URL 导入 loader
并注入已校验 WASM bytes。部署 CSP 必须在 `script-src` 中允许 `blob:`。

## 6. 自动验收

| 命令/套件 | 结果 |
| --- | --- |
| `npm run check:toolchain` | 固定 Node.js、Emscripten 及同源 wrappers 通过 |
| `npm run verify:tiles` | 2,307 tiles 与输入 checksum 通过 |
| `npm run encyclopedia:verify` | 9,624 glyph、970 core records、1 Wiki record 通过 |
| 阶段六 release gates | 4/4 |
| `npm test` | 96 files，1,123/1,123 |
| `npm run lint` | 0 warnings，0 errors |
| `VITE_BASE_PATH=/BlissHack/ npm run build` | TypeScript 与 production build 通过 |
| `npm run test:integration:wasm` | 166/166 |
| `npm run test:integration:browser` | Chromium 156/156 |
| `npm run test:integration:compat` | Firefox + WebKit 192/192 |
| `npm run test:performance` | 2/2；Canvas 全图 p95 5.4 ms，300 行背包提交 15.0 ms |
| `npm run test:long` | 4/4 |
| `git diff --check` | 通过 |

真实浏览器覆盖 Newt revision 205110 的 4 段原文与无 Overview、facts-only
降级、损坏资料拒绝、慢加载关闭、核心菜单 handoff、无回合消耗、键盘与焦点
恢复，以及 1280×900、900×700、700×800、900×600 下的 Tiles/ASCII 和
Right/Below 布局。普通运行不会请求 NetHackWiki。

## 7. 独立复审

阶段六独立 reviewer 未发现 P1/P2 问题。其 P3 finding 指出默认 Emscripten
factory cache 可能跨自定义 importer 污染；实现已改为
`WeakMap<importer, Map<digest, Promise<factory>>>`，并补充 importer 隔离、
并发复用和失败驱逐测试。复审还要求记录 Blob loader 的 CSP 与加载流程，已在
README、frontend README 和 WASM 构建文档中补全。修正后的 follow-up review
没有剩余 P1/P2 finding。

- 2026-10-14 普通物品可见身份 follow-up reviewer 未发现高严重性 correctness
  或 security 问题，确认核心可见性条件、神器优先级、row-local Asyncify
  生命周期、十参数 callback ABI、hallucination/pile glyph 对照及 runtime
  manifest 绑定成立。
- reviewer 的中等级 finding 是本文件仍保留旧产物摘要；低等级 finding 是新
  精确对象索引缺少损坏摘要、长度、schema、重复/越界 glyph 和取消测试。摘要
  已更新，loader 与生成器负向测试已补齐并通过。
- 浏览器复验确认具体普通物品会新增 Wiki 页链接；Examine 现在显式推进每次
  Tab/Shift+Tab，使 Wiki、NGPL 与关闭按钮的焦点顺序在 Chromium、Firefox 和
  WebKit 一致。

## 8. 人工验收待办

- [ ] Detailed 下分别检查地图 Newt、地形、陷阱、地面物品和永久背包物品的
  `Examine`，并确认武士初始 katana 显示具体资料；Original 下确认没有
  synthetic 行。
- [ ] 记录 moves/time，反复打开、切 Tab、关闭，确认菜单先关闭、窗口后打开，
  全程不消耗回合；原有攻击、移动、拾取和物品动作保持原路径。
- [ ] 检查未鉴定 wand 等物品、hallucination、mimic/disguise、隐藏/可见陷阱
  以及未公开和已公开神器，确认没有隐藏身份泄露。
- [ ] 逐段核对 Newt revision 205110：Strategy 两段、History 一段、
  Dudley's dungeon 一段；确认没有 Overview Wiki 内容，并检查来源、历史、
  contributors、CC BY-SA 3.0、源码路径和 NGPL 标识。
- [ ] 断网打开无 Wiki 实体，确认 facts-only 自然可用且没有外部资料请求。
- [ ] 在 1280×900、900×700 和窄屏检查 Tiles/ASCII、Right/Right-short/Below
  及两种动作栏模式；确认无重叠且只有一个对话框内容滚动区域。
- [ ] 只用键盘完成菜单选择、Tab 导航、来源链接聚焦和关闭；确认对话框外不可
  聚焦，关闭后可立即继续移动。
- [ ] 验收结束时确认 Console 没有 stale intent、重复输入、React、layout、
  loader、Canvas 或 WASM 错误。

更细的身份、内容、布局和辅助功能检查步骤见
[alpha-2.4 计划的人工验收章节](../alpha-2.4.md#12-人工验收)。

## 9. 当前结论

实现、独立复审和全部自动门禁满足 alpha-2.4 的自动完成条件。版本仍等待用户
人工验收；是否 push 或部署 GitHub Pages 需要单独指令。

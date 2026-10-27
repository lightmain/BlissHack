# BlissHack alpha-2.4 发布验收

本文记录 alpha-2.4 Examine 观察窗口、资料资产和可见身份边界的自动与人工
验收结果。人工验收步骤继续保留，作为本版本最终验收范围的权威记录。

## 1. 状态

alpha-2.4 已完成实现、独立复审、自动门禁和人工验收。2026-10-27，用户确认
该版本完成。

## 2. 测试环境

- 最终自动复验日期：2026-10-23。
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
- Hallu 状态下核心与前端都清空普通对象/神器 token；地图与永久背包只放宽
  同一目标随机重绘造成的 revision/glyph 变化，仍校验 session、坐标或
  identifier/accelerator、来源与 Hallu 状态，并展示右键瞬间捕获的随机 glyph。
- Examine target 始终保留已验证 glyph binding。尸体和雕像使用对应类别标题，
  monster/statue 按 glyph 性别选择名称，雕像冠词遵循 NetHack 的
  `type_is_pname()`、`the_unique_pm()` 与 `just_an()` 顺序。
- 由当前 NetHack 5.0.0 源码确定性生成 970 条实体资料，并对 9,624 个 glyph
  完成 supported 或显式 unsupported 分类。
- core schema v2 使用 `appearance`、`artifact`、`monster`、`object`、
  `terrain`、`trap` 六个 `family` 作为加载和来源边界；物品展示只按
  `facts.objectClass` 的完整 17 类分派，`facts.subtype` 不再包含第二套
  `kind` 判别。
- 神器先使用所引用基础物品的 `objectClass` 模板，再添加 artifact overlay；
  terrain 与 trap 使用独立模板。核心事实节点始终先于可选 Wiki 文章，Wiki
  是否存在不会改变事实结构。
- 六种实体 family 共用同一个 FactDocument 骨架：首段固定为 `Key facts`，
  末段固定为 core provenance，中间保留各类型自身的攻击、生成、类别属性、
  traits 和 artifact overlay 等内容。Monster 不再使用独立的双栏页面布局。
- generic appearance 的标题、ARIA、事实和 Wiki 映射只使用安全物品类别；
  importer 拒绝 appearance 记录，loader 不请求其 Wiki 资产，显式具体页面也
  不能绕过类别映射。
- 独立的 926 条 normal/pile-top 精确对象 glyph 对照只用于校验核心已经公开的
  普通物品 token；公开 glyph binding 继续把静态未知类型保持为通用类别。
- 运行时严格校验并按需加载 core/Wiki manifest、glyph binding 和 entity
  chunk；并发请求合并，失败与 stale 请求 fail closed。
- 响应式观察窗口对所有实体使用相同的全宽 facts 主界面；经过审核的 Wiki 原文
  在 core provenance 后按来源顺序静态追加，不再创建 Tab、侧栏或隐藏 panel。
  Wiki 与核心来源许可继续分离，所有视口使用单一内容滚动区域，并保留焦点限制、
  键盘导航和关闭后焦点恢复。
- `nethack-runtime.json` schema v3 同时绑定 loader、WASM、core manifest、
  Wiki manifest 和 core source fingerprint。
- 本地开发构建在精确 loopback URL 加 `acceptance=wizard` 时提供人工验收入口：
  fresh module 的内存 `/sysconf` 只把 `WIZARDS` 改为 `*`，以
  `nethack -D` 启动并在 main settle 后释放 argv。常规 production、非 loopback
  和错误或重复 query 均 fail closed；普通会话继续使用原零参数 main。仅
  Playwright 的 `VITE_E2E_FIXTURES=1` production fixture build 可在相同
  loopback/query 门禁下启用，用于真实 WASM 自动验收。
- 本地巫师验收会话的 `#` 选择器可以搜索 `wizwish`、`wizgenesis`、`wizmap`
  等 debug 命令，但 `CMD_NOT_AVAILABLE` 和 `INTERNALCMD` 仍隐藏；普通会话不
  显示任何 `WIZMODECMD`。该会话强制使用 Original 角色创建以适配 debug 核心
  跳过姓名请求的行为，不修改保存的 profile。

## 4. 内容与覆盖

完整数字和 unsupported 原因见
[核心资料覆盖报告](catalog-coverage-report.md)，Wiki 选择、revision 与许可
结果见 [Wiki 发布审查报告](wiki-review-report.md)。

- core records：970；supported glyph：6,444；unsupported glyph：3,180。
- core JSON：1,883,839 B；首次 Detailed 基础索引最坏 107,699 B。普通物品
  token 首次校验另按需读取 45,095 B 精确索引，合计最坏 152,794 B，均低于
  预算。
- Wiki 只发布 `Newt` revision 205110 的 1 条记录、4 个完整原文段落：
  Strategy 2 段、History 1 段、Dudley's dungeon 1 段。
- 两段不安全的 Overview 内容未发布；静态文章没有 Overview section，也没有
  摘要、翻译、改写、截句、合并或拼接。
- 969 个无 Wiki 记录的实体按设计保持 core facts-only。

## 5. 运行时产物

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `nethack.js` | 96,199 | `dd9572c4775b10009a05904cc8a090d8713762425d42f4a1462fdf1f121a970f` |
| `nethack.wasm` | 6,647,395 | `23b62b2251cae08fb6e11ff5b76d63e43739b239fd0a9426b85240818901c06f` |
| `nethack-runtime.json` | 1,007 | `aaa10b764d6cf16829b06b810b5112e8bb3b17a706029c9d51d7aebbe35ba60d` |

runtime manifest 保持以下 core encyclopedia 绑定：core manifest 为 7,928 B，
SHA-256 为
`0dd2f94e886a7030aff05da9d383e833b4f67f1d6a61b8a87d5aaf01abf60fa6`，
source fingerprint 为
`9ae8f4fa29d54139de661e346c5c58dd44e78c4cd10d398fdd33e1865e2cc465`。
2026-10-23 使用固定 Emscripten 6.0.9 重新构建运行时三件套，使
`src/invent.c` 在 Hallu 状态下不发布普通对象或神器 token。loader 字节保持
不变；WASM 与 runtime manifest 已同步更新为上表摘要。

浏览器先校验 `nethack.js` 与 `nethack.wasm`，再从临时 Blob URL 导入 loader
并注入已校验 WASM bytes。部署 CSP 必须在 `script-src` 中允许 `blob:`。

## 6. 自动验收

| 命令/套件 | 结果 |
| --- | --- |
| `npm run check:toolchain` | 固定 Node.js、Emscripten 及同源 wrappers 通过 |
| `npm run verify:tiles` | 2,307 tiles 与输入 checksum 通过 |
| `npm run encyclopedia:verify` | schema v2、9,624 glyph、970 core records、1 Wiki record 通过 |
| 阶段六 release gates | 4/4 |
| `npm test` | 98 files，1,240/1,240 |
| `npm run lint` | 0 warnings，0 errors |
| `VITE_BASE_PATH=/BlissHack/ npm run build` | TypeScript 与 production build 通过 |
| `npm run test:integration:wasm` | 166/166 |
| Chromium release Playwright suite | 161/161 |
| `npm run test:integration:compat` | Firefox + WebKit 200/200 |
| `npm run test:performance` | 2/2；Canvas 全图 p95 5.8 ms，300 行背包提交 15.4 ms |
| `npm run test:long` | 4/4 |
| `git diff --check` | 通过 |

真实浏览器覆盖 Newt revision 205110 的 4 段原文与无 Overview、facts-only
降级、损坏资料拒绝、慢加载关闭、核心菜单 handoff、无回合消耗、键盘与焦点
恢复，以及 1280×900、900×700、700×800、900×600 下的 Tiles/ASCII、
Right/Below 和共享 FactDocument 多列布局。浏览器几何断言确认 Newt 与
facts-only 实体都使用全宽 facts、无横向溢出，并在全部视口只有一个内容滚动
owner；四段 Wiki 原文同时可见且没有 tab controller。普通运行不会请求
NetHackWiki。新增真实 WASM 浏览器流程还通过 `wizintrinsic` 开启 Hallu，
确认永久背包在 itemactions 重绘后仍提供 `Examine`，地面物品右键仍响应；
两者只展示捕获时的随机 glyph，不回退到真实 bullwhip 或 boulder 身份。

本地真实 Chromium 另验证：development + loopback + query 会把角色名固定为
`wizard`，进入 Original 核心角色流程；`#` 搜索 `wizwish` 后能到达
`For what do you wish?`。同一 query 放在 `/BlissHack/` 生产 preview 时仍进入
普通统一角色创建，证明生产构建不会启用巫师入口。

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
- 2026-10-14 分类重构 reviewer 首轮发现 generic appearance 仍可能通过已发布
  Wiki 记录泄露具体身份，以及 330 px 桌面事实侧栏存在横向溢出。实现已在
  importer、loader、resolver、dialog 四层拒绝 appearance Wiki 内容，并把
  monster 双栏限制到 facts-only 全宽模式、侧栏定义行改为纵向布局。
- follow-up reviewer 发现显式 `wikiPage` 决策仍可能绕过 appearance 类别映射；
  resolver 已改为先处理 appearance，且只接受与固定安全类别页完全一致的显式
  页面。对应恶意标题、正文和具体页面测试，以及真实浏览器
  `scrollWidth <= clientWidth` 几何断言均已补充。
- 2026-10-15 统一展示 reviewer 首轮指出 820 px 以下强制单列会削弱宽度驱动的
  自适应布局，且浏览器与 DOM 测试需要直接验证列数、包含关系、provenance
  位置、真实物品 fixture 和神器 section 顺序。实现已删除该断点特例，改用
  `auto-fit` 网格，并补齐对应测试。
- follow-up reviewer 要求避免以正则近似 DOM；测试已使用 XML parser 解析
  React 静态 markup，逐项验证唯一 facts aside、直接 FactDocument section、
  稳定 section ID、首段 `Key facts` 和末段 provenance。最终复审要求 artifact
  完整 Dialog 用例复用同一骨架断言，该用例已补齐。
- 2026-10-19 统一 Wiki 展示 reviewer 确认生产实现没有许可、来源、DOM 顺序或
  布局回归；首轮指出并发 cache 测试依赖异步完成顺序、浏览器矩阵覆盖不足、
  文档仍保留 Tab 交互措辞，以及 `hidden` 断言没有覆盖完整 article 子树。
  修正后四个目标视口分别验证 Wiki 和 facts-only，并实际滚动唯一
  `.examine-layout` owner；follow-up review 未发现剩余 P1/P2。
- 最终独立复审未发现剩余高、中严重性问题；生产代码和样式中不再包含 Newt
  专属事实布局、Monster 页面布局特例、Wiki Tab 或双栏渲染分支。
- 2026-10-19 本地巫师验收入口 reviewer 首轮发现默认 BlissHack 角色创建与
  debug 核心跳过姓名请求会形成空姓名死锁，并指出人工手册的 Turn 基线和幻觉
  顺序存在矛盾。实现已让验收 session 强制使用 Original、普通 session 继续
  尊重 profile，并补充重复 query、异常 `WIZARDS` 和同步 main 异常释放测试；
  手册已改为逐轮记录 Turn，并要求在幻觉前完成 Newt 内容核对。follow-up
  review 未发现剩余 P1/P2。
- 2026-10-23 Hallu Examine reviewer 确认 token 隔离、volatile currentness、
  required binding、fixture 门禁和普通/巫师启动路径成立；首轮唯一 P2 指出
  普通 `G_UNIQ` 与 `M2_PNAME` 的雕像冠词不能合并处理。实现已按核心顺序区分
  专名、普通 unique、high priest/long worm tail 例外与 `just_an()`，并补充
  Wizard of Yendor、Croesus 和 high priest 回归测试。P3 的 runtime manifest
  旧描述也已修正；独立 follow-up 未发现剩余 P1、P2 或 P3。

## 8. 人工验收执行手册

本节是 alpha-2.4 的权威人工验收步骤。验收者不需要通过正常游戏随机取得神器、
陷阱或特殊怪物，也不需要熟悉 NetHack 深层玩法；本地开发构建提供一个受限的
巫师验收入口，用来确定性制造所需场景。

### 8.1 验收入口与安全边界

巫师入口必须同时满足以下三个条件才会启用：

1. 使用 Vite development server；
2. 页面 hostname 精确为 `localhost`、`127.0.0.1` 或 `[::1]`；
3. URL 只有一个 `acceptance=wizard` 参数，且值大小写完全一致。

生产构建、GitHub Pages、非 loopback hostname、`localhost.example.com`、
`acceptance=Wizard` 和重复的 `acceptance` 参数都不会启用巫师模式。入口只会
修改当前 fresh WASM module 的内存文件系统，不会改动仓库中的 `/sysconf`，
也不会向普通会话增加巫师命令。

建议使用独立的浏览器临时配置或隐私窗口，不要选择已有存档的 `Continue`。
在仓库根目录运行：

```sh
cd frontend
npm run dev -- --host 127.0.0.1
```

打开：

```text
http://127.0.0.1:5173/?acceptance=wizard
```

若终端显示的实际端口不是 5173，以终端端口为准。不要使用 `npm run preview`；
preview 是生产构建，query 按设计无效。

进入首页后先完成以下准备：

1. 打开 `Settings`，把 `Information level` 设为 `Detailed`。
2. 打开 `Show turn count`。
3. 打开 `Enable Permanent Inventory`，`Contents` 选
   `All except gold`。
4. `Map display` 先选 `Tiles`，`Action bar` 先选 `BlissHack`，
   `Preferred position` 先选 `Right (Long)`。
5. 返回首页并选择 `New Game`。本地巫师验收会话会强制使用 Original 角色
   创建流程，避免 debug 核心跳过姓名请求后让统一角色界面停在空姓名状态；
   这不会修改 profile 中保存的 `Character setup style`。
6. 对 `Shall I pick character's race, role, gender and alignment for you?`
   回答 `n`，再依次选择 Samurai、Human、Male、Lawful。巫师模式会把角色名
   固定为 `wizard`，这是正常行为。
7. 游戏开始后按 `#`，在扩展命令界面输入 `wizwish`。能找到并执行该命令即
   证明当前是 debug/wizard mode；若提示命令不可用，立即停止并检查 URL，
   不要在普通游戏里继续验收。

### 8.2 巫师命令速查

浏览器中统一使用 `#` 打开扩展命令，再输入下表中的命令名并确认。不要使用
`Ctrl+W` 等默认快捷键，因为浏览器或操作系统可能先处理这些组合键。

| 目的 | 命令 | 随后的输入 | 结果与注意事项 |
| --- | --- | --- | --- |
| 制造任意物品、神器、陷阱或有限地形 | `wizwish` | 例如 `wand of light`、`long sword named Excalibur`、`pit`、`fountain` | 普通物品优先进入背包；超重才落地。陷阱或地形生成在角色脚下 |
| 制造指定怪物 | `wizgenesis` | 例如 `newt`、`giant mimic`、`tame little dog` | 怪物通常生成在角色附近；可接受 `tame`、`peaceful`、`sleeping` 等前缀 |
| 显示全图并显露陷阱 | `wizmap` | 无 | 会把当前层陷阱标记为已发现；用于隐藏/可见陷阱配对 |
| 探测附近隐藏内容 | `wizdetect` | 无 | 显示附近秘密门、陷阱和隐藏怪物，不消耗回合 |
| 临时查看背包真实身份 | `wizidentify` | 无 | 只用于排障；执行前不要做未鉴定物品防剧透用例 |
| 设置临时 intrinsic | `wizintrinsic` | 在菜单中选择属性 | 可制造更多状态；本手册的幻觉用 potion，避免依赖此菜单 |
| 传送到指定层 | `wizlevelport` | 层号或特殊目的地 | 本版本 Examine 基础验收不需要 |

制造物品后，如需验证地面物品，使用普通 `d` 命令把它丢在地上。`wizwish`
本身不会保证物品直接出现在地面。

### 8.3 证据记录规则

每个用例至少记录以下证据：

- 用例编号、浏览器、窗口尺寸、Tiles/ASCII、背包位置和动作栏模式；
- 打开右键菜单前的 `Turn` 数值和关闭 Examine 后的 `Turn` 数值；
- 右键菜单、Examine 标题与关键 section 的截图；
- 实际结果和预期结果是否一致；
- DevTools Console 与 Network 中的异常。

制造场景、移动、攻击、丢弃、饮用或使用 wand 本身可以消耗回合。无回合断言只
比较“场景准备完毕之后、打开右键菜单之前”的数值与“关闭 Examine 之后”的
数值，不把准备动作混入比较。

任一用例出现以下情况时停止验收并保留现场：隐藏真名或神器名泄露；一次
Examine 改变 Turn；核心菜单未先关闭；重复窗口；输入卡死；资料 family 或来源
错误；Console 出现未处理异常、stale intent、重复输入、loader、Canvas 或
WASM 错误。

### 8.4 基础流程与无回合消耗

1. 用 `#wizgenesis` 输入 `newt`。
2. 等 Newt 出现在角色附近后，记录当前 `Turn`。
3. 右键 Newt，确认核心原有动作保持原顺序，末尾另有分隔线和 `Examine`。
4. 选择 `Examine`。确认右键菜单先消失，观察窗口随后出现；不得同时显示两个
   modal。
5. 在窗口内滚动到底，再回到顶部，依次用关闭按钮、Escape 和 backdrop
   完成三轮打开/关闭。每轮打开前重新记录当时的 `Turn` 基线，并在该轮关闭后
   确认数值没有改变。
6. 三轮全部完成后只用方向键移动一次，确认游戏输入已经恢复；这次移动可以
   正常增加 Turn。
7. 再打开右键菜单，选择一个真实核心动作；确认它仍沿核心原路径执行。攻击或
   移动可以正常增加 Turn。
8. 在 Settings 把 `Information level` 切为 `Original`，再次右键同一目标，
   确认没有 synthetic `Examine`；随后切回 `Detailed`。

### 8.5 可见身份与防剧透矩阵

先按下表顺序执行 I-1 至 I-13，然后暂停本节并完成 8.6 的 Newt 内容、Wiki 与
来源检查；确认 8.6 完成后再返回执行 I-14 和 I-15。幻觉用例必须最后执行，
因为幻觉持续时间不适合人工等待。

| 编号 | 场景制造步骤 | 预期 Examine 结果 |
| --- | --- | --- |
| I-1 已知背包物品 | 右键 Samurai 初始 katana | 显示具体 katana 资料，不退化为通用武器类别 |
| I-2 地面物品 | `#wizwish` 输入 `long sword`，再用 `d` 丢下新物品并右键地面物品 | 显示 long sword；地面与背包使用同一事实结构 |
| I-3 物品堆 | 在同一格再丢一个不同物品，右键 pile glyph | 只描述当前可见的堆顶物品，不旁路显示被遮挡物品 |
| I-4 尸体与雕像 | 分别 wish `newt corpse`、`statue of a newt`，丢到地上后右键 | 标题分别为 `Newt corpse`、`Statue of a newt`，类别分别为 Corpse、Statue；可复用 Newt 物种事实，但不得呈现为活体 Newt |
| I-5 未鉴定 wand | 在尚未执行 `#wizidentify` 时 wish `wand of light`，右键背包中新出现的唯一 wand | 只显示当前外观或 wand 类别；标题、事实和链接不得出现 `wand of light` 或 light 效果 |
| I-6 已公开 wand | 用普通 `z` 选择该 wand；其 light 效果在非盲状态下使类型公开，再次右键 | 现在可以显示具体 wand of light 资料；使用 wand 的回合不属于 Examine 无回合断言 |
| I-7 地形 | 站在普通 floor 上，wish `fountain`，移动一格后右键原位置 | 显示 fountain terrain 资料；不得显示祭坛阵营等不存在的信息 |
| I-8 隐藏陷阱 | 站在普通 floor 上，wish `pit`，记住该格并移动离开；在执行 map 前右键原位置 | 地图仍按 floor 处理，不出现 pit Examine，不泄露隐藏陷阱 |
| I-9 已发现陷阱 | 执行 `#wizmap`，再次右键 I-8 的位置 | pit glyph 可见，Examine 显示 pit trap 资料 |
| I-10 普通宠物 | `#wizgenesis` 输入 `tame little dog`，右键新宠物 | 显示 little dog 物种资料；宠物标记可见但不显示驯服度等实例内部值 |
| I-11 mimic 伪装 | `#wizgenesis` 输入 `giant mimic`，在碰撞或攻击前右键其伪装 glyph | 只描述屏幕上显示的物品或设施，不显示 Giant mimic |
| I-12 mimic 揭露 | 向 I-11 的伪装格移动或攻击使其现形，再次右键 | 现在显示 Giant mimic 怪物资料 |
| I-13 已公开神器 | 在非幻觉状态 wish `long sword named Excalibur`，右键背包物品 | 标题显示 Excalibur；先有基础 long sword 事实，再有 artifact overlay |
| I-14 幻觉中的神器与背包物品 | wish `potion of hallucination`，用 `q` 喝下新 potion；状态栏出现 Hallu 后 wish `battle-axe named Cleaver` 并右键新物品 | itemactions 可以显示 `Wield this item as your weapon` 等真实可执行动作，但菜单末尾仍必须有 `Examine`；Examine 只描述右键瞬间的随机显示 glyph，不得出现 Cleaver、真实 object/artifact token、专属字段或 artifact overlay |
| I-15 幻觉中的地图目标 | Hallu 仍有效时 `#wizgenesis` 输入 `newt`，并分别右键其当前显示 glyph 与一个地图物品 | 两类核心菜单末尾都必须有 `Examine`；只描述右键瞬间捕获的幻觉 glyph，不显示真实 Newt 或真实物品。若随机恰好显示真实身份，重新制造目标再测 |

I-8 与 I-9 是同一个 trap 的前后配对；I-11 与 I-12 是同一个 mimic 的前后
配对。它们分别证明隐藏状态不会泄露、公开状态又能正常显示。I-13 与 I-14
分别证明已公开神器可显示、幻觉遮蔽的神器不会显示；无需靠正常游戏取得神器。

### 8.6 Newt 内容、Wiki 与来源

使用非幻觉状态下的 I-1 至 I-13 会话，重新制造一个 `newt` 并执行：

1. 确认所有实体共用同一个纵向 FactDocument；Newt 不得恢复双栏、侧栏或
   Wiki Tab 特例。
2. `Key facts` 必须是第一个 section。核对 Newt 基础等级 0、生成 HP 规则
   2 至 4、速度 6、AC 8、MR 0、阵营 0 和 1d2 bite。
3. 核对 attacks、generation、size、resistances、traits、corpse 与能量效果
   section；缺少的字段应省略，不显示推测值。
4. 核心 provenance 必须位于 core facts 末尾，显示 NetHack 5.0.0、相关源码
   路径和 NGPL，不得把 Wiki 许可套在核心事实上。
5. core provenance 之后应静态追加 Newt revision 205110 的四个完整原文段落：
   Strategy 两段、History 一段、Dudley's dungeon 一段。
6. 页面不得出现从 Wiki lead 选取的 Overview 正文，也不得出现项目自行摘要、
   翻译、句子拼接或改写。
7. 核对 `Newt` 页面标题、`NetHackWiki contributors`、revision 205110、
   revision history、CC BY-SA 3.0、展示变更说明和外部链接。外部链接应在新
   窗口打开并带安全 rel；许可链接应标记为 license。
8. 打开 fountain、pit、long sword 等没有 Wiki 节选的实体，确认自然显示
   facts-only，不出现空 Tab、空 article 或错误的 Newt 内容。

### 8.7 离线、布局与辅助功能

离线检查应关闭 Wi-Fi 或外部网络连接，但保留本机 Vite server；不要使用会连
localhost 请求一起拦截的 DevTools 全局 `Offline` 开关。

1. 清空 Network 记录，关闭外部网络后重载本地 URL，打开一个 facts-only
   实体和 Newt。所有游戏与资料请求应来自当前 loopback origin、`blob:` 或
   浏览器本地资源，不得请求 `nethackwiki.com`。
2. 依次检查 1280×900、900×700、700×800、900×600 四个 viewport。
3. 每个 viewport 至少检查一次 Newt 长内容和一个 facts-only 实体。
4. 在 Settings 交叉切换 `Tiles`/`ASCII`、`Right (Long)`/
   `Right (Short)`/`Below`、`BlissHack`/`Original` action bar。无需穷举
   全部 24 个组合，但每个选项至少与一个桌面和一个窄屏 viewport 配对。
5. 确认标题、标签、长名称、六次 attack、四段 Wiki 原文和来源条不重叠、不
   截断、不产生横向页面滚动。
6. 对话框只允许 `.examine-layout` 内容区滚动；facts、Wiki article、backdrop
   和页面主体不得形成第二个竞争滚动区域。
7. 右键菜单打开后不再使用鼠标：用 accelerator 或方向键选择 `Examine`，
   Enter 确认；在对话框中用 Tab/Shift+Tab 遍历关闭按钮、来源和许可链接，
   用 Escape 关闭。
8. Tab 不得离开对话框；背景游戏应不可聚焦。关闭后焦点回到合理的地图或背包
   触发位置，并能立即接受方向键。
9. 若可用，使用 VoiceOver 检查 dialog 名称、heading 层级、definition list
   和来源链接名称；不得朗读隐藏 Tab panel 或重复标题。

### 8.8 Console、清理与签署

完成全部场景后：

1. 检查 Console 没有未处理 Promise rejection、React warning、stale intent、
   重复输入、layout、loader、Canvas、存储或 WASM 错误。
2. 检查 Network 没有运行时 NetHackWiki 请求、重复 chunk 风暴或失败后循环
   重试。
3. 关闭验收标签页。若使用了普通浏览器配置，在首页
   `Settings` 的 data management 中执行 `Clear local data`，清除名为
   `wizard` 的测试存档、测试 profile、Ranking 和诊断记录；使用临时配置或
   隐私窗口时直接删除该配置或关闭所有相关窗口。
4. 在下表填写结果；任何一项失败都不签署 alpha-2.4 人工验收。

| 验收组 | 结果 | 证据或备注 |
| --- | --- | --- |
| 本地巫师入口与生产 fail-closed | [x] 通过 / [ ] 失败 | 用户确认 |
| Detailed/Original 与核心动作 | [x] 通过 / [ ] 失败 | 用户确认 |
| 无回合、菜单 handoff 与输入恢复 | [x] 通过 / [ ] 失败 | 用户确认 |
| 物品、terrain、trap、mimic 与神器身份 | [x] 通过 / [ ] 失败 | 用户确认 |
| 幻觉与未鉴定状态无泄露 | [x] 通过 / [ ] 失败 | 用户确认 |
| Newt facts、四段 Wiki 与双许可来源 | [x] 通过 / [ ] 失败 | 用户确认 |
| 离线、四 viewport、显示与布局模式 | [x] 通过 / [ ] 失败 | 用户确认 |
| 键盘、焦点、VoiceOver 与 Console | [x] 通过 / [ ] 失败 | 用户确认 |

验收者：用户　日期：2026-10-27　结论：通过

## 9. 当前结论

实现、独立复审、全部自动门禁和用户人工验收均已完成。alpha-2.4 已满足完成
定义并正式标记为完成。

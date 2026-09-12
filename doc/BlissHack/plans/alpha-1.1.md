# BlissHack alpha-1.1 地图交互与基建计划

## 1. 版本目标

alpha-1.1 是 alpha-1 Tiles 地图之后的小版本，处理两类已经在真实开发和验收中
暴露的问题：

1. 完善地图区域的滚动、拖动和 Follow player 语义。
2. 偿还 alpha-1 暴露的定向基建债务，降低下一轮图形和 UI 开发的耦合、
   环境不确定性和测试维护成本。

本版本不继续扩张 tileset 功能，不修改 NetHack 游戏规则，也不进行完整 UI
重设计。alpha-1.1 应从已经人工验收的 alpha-1 提交创建独立分支；完成前不合入
部署分支。

## 2. 顺序决策

本版本不采用“先完成全部通用基建，再处理玩家问题”的顺序。推荐顺序是：

1. 先建立地图交互的行为测试。
2. 抽取与交互直接相关的 `MapViewport` 和 camera 基础层。
3. 在新边界上实现右键拖动、隐藏滚动条和精确 Follow 规则。
4. 再处理不阻塞地图交互的通用基建债务。
5. 最后执行跨浏览器、性能和人工验收。

原因是滚动与 Follow 逻辑当前仍集中在 `GameTerminal.tsx`。直接增加拖动状态会
继续扩大该组件；但若先做所有工具链和 profile 重构，又会不必要地延迟已确认的
玩家问题。只把交互所需的基础层提前，是风险和收益最合理的顺序。

## 3. 当前问题

### 3.1 地图视口

- 16×16 tiles 的 80 列地图宽 1280px；窗口或右侧永久背包占用空间后会出现
  横向滚动条。
- 原生滚动条破坏当前地图视觉，但直接禁用滚动会削弱查看远处信息的能力。
- Follow player 当前容易因普通 snapshot 或右键查看结果刷新而抢回视角。
- Tiles/ASCII、窗口尺寸、永久背包布局和 Canvas 首帧都有不同尺寸，camera
  恢复逻辑已经超出普通渲染组件职责。
- 地图点击、scroll anchor、ResizeObserver 和 renderer dispatch 仍集中在
  `GameTerminal.tsx` 的内部 `MapGrid`。

### 3.2 通用基建

- 浏览器测试曾直接依赖 `.nh-map-row` 和 `.nh-cursor`；当前虽已有部分
  renderer-independent `data-*`，但没有集中定义的测试契约。
- WASM 开发中出现过 Node 主版本、emsdk Node、native Makefile 和 WASM
  Makefile 混用；现有脚本可以正确完整构建，但环境诊断仍不够集中。
- 产品版本在运行时代码中已经集中，浏览器测试、fixture 和文档仍可能出现
  手写版本字符串。
- profile v1→v2 迁移已经可靠，但迁移步骤仍嵌在解析函数中；继续增加 schema
  会扩大条件分支。

## 4. 产品决策

### 4.1 滚动能力

- 地图继续使用真实的 overflow scroll container，不改为裁掉不可访问内容。
- 视觉上隐藏横向和纵向原生滚动条，不实现自绘 scrollbar。
- 触控板原生横向滚动继续有效。
- 不缩放 16×16 tiles，不引入模糊的 fit-to-width 模式。
- ASCII 和 Tiles 共用完全相同的 viewport 与 camera 语义。

隐藏的是 scrollbar chrome，不是滚动能力。

### 4.2 右键点击与右键拖动

右键同时承担格子操作和视角平移，通过 Pointer Events 与移动阈值区分：

```text
pointerdown(button=2)
  -> 记录 pointerId、起点、初始 scroll offset
pointermove
  -> 位移小于阈值：保持 pending click
  -> 位移达到阈值：进入 dragging，移动 viewport
pointerup
  -> 未 dragging：发送一次原有右键格子操作
  -> dragging：只结束拖动，不发送游戏输入
pointercancel / lostpointercapture
  -> 安全清理，不发送游戏输入
```

- 默认阈值为 5 CSS px，并通过常量和测试固定。
- 使用 `setPointerCapture()`，拖出地图区域后仍能正常结束。
- dragging 时使用 `grabbing` cursor；非 dragging 状态不伪装成左键可拖动。
- 地图区域阻止浏览器 context menu，其他页面不受影响。
- 左键位置输入语义保持不变。
- 在 NetHack position input 中，右键短按仍发送原 modifier；右键拖动不发送
  坐标。
- 不引入 `@use-gesture/react`、`dnd-kit` 或 `react-draggable`。该手势是
  viewport camera，不是 DOM 元素拖放，本地 hook 更容易证明输入语义。

### 4.3 Follow player

Follow player 表示“有效 camera target 改变时重新居中”，不是“禁止手动浏览”。

- 用户滚轮、触控板或右键拖动后，视角停留在手动位置。
- 普通消息、状态、地图内容和相同坐标的 snapshot 更新不重新居中。
- 玩家移动或 NetHack 的 `clipCenter.x/y` 实际变化时重新居中。
- 右键查看格子信息不得抢回视角。
- renderer、字体、窗口或永久背包布局变化时保持归一化地图中心。
- Tiles 首帧完成后仍按新尺寸恢复 camera。
- Follow 关闭时不因玩家移动自动居中。

如果真实核心流程证明“右键查看”会短暂改变 `clipCenter`，该输入周期需要保存并
恢复原 camera anchor，而不是依赖延时或忽略任意数量的 snapshot。

## 5. 目标架构

建议结构：

```text
frontend/src/map/
├── MapViewport.tsx
├── use-map-camera.ts
├── use-right-drag-pan.ts
├── AsciiMapRenderer.tsx
├── TileMapRenderer.tsx
├── canvas-rendering.ts
└── tile-assets.ts
```

职责边界：

- `GameTerminal.tsx`
  - 组合消息、地图、状态和输入。
  - 把 `map`、`cursor`、`clipCenter`、renderer 设置和位置点击回调传给
    `MapViewport`。
  - 不直接持有 scroll ref、ResizeObserver 或 pointer gesture 状态。
- `MapViewport.tsx`
  - 唯一拥有 scroll container。
  - 组合当前 renderer。
  - 接收 camera 与 pointer hook 的结果。
  - 负责 renderer ready、布局变化和坐标转换。
- `use-map-camera.ts`
  - 管理归一化 anchor、manual pan、Follow target 和程序化滚动抑制。
  - 核心状态转换尽量提取为纯函数或 reducer。
- `use-right-drag-pan.ts`
  - 只区分右键 click、drag、cancel 和 pointer capture。
  - 不读取 NetHack、profile 或 renderer 内部状态。

不建立通用手势框架，不把 renderer 绘制状态放入 camera，也不让 Canvas 与
ASCII 分别实现滚动逻辑。

## 6. 阶段一：行为基线

### 6.1 测试优先

由独立测试 subagent 先增加预期失败或 characterization tests：

- 相同 `clipCenter.x/y` 的 snapshot 更新不改变手动 camera。
- 玩家或有效 target 坐标变化时，Follow 开启会重新居中。
- Follow 关闭时坐标变化不重新居中。
- 右键短按只发送一次现有格子操作。
- 小于阈值的抖动仍是 click。
- 达到阈值后只平移，不发送游戏输入。
- `pointercancel`、丢失 capture 和组件卸载不会遗留 dragging。
- renderer 往返、窗口变化和永久背包布局变化保持 anchor。
- 触控板/水平 wheel 保持可滚动。

先提交测试基线，再修改生产实现。

### 6.2 门禁

- 测试不得读取 ASCII 字符行来判断 camera。
- 不用固定 sleep 等待 WASM；使用 snapshot revision、command ready 或
  pointer 状态边界。
- 新测试必须在 Chromium 中覆盖真实 WASM，纯状态转换同时有单元测试。

建议提交：

```text
test: define alpha-1.1 map viewport contracts
```

## 7. 阶段二：MapViewport 与 Camera 抽取

### 7.1 实施

1. 将 `MapGrid` 的 scroll container、ResizeObserver 和 renderer dispatch
   移到 `MapViewport`。
2. 将 anchor 计算、Follow target 比较和程序化 scroll 抑制移到 camera hook。
3. 用坐标值而不是对象引用或整个 snapshot 作为 Follow effect 依赖。
4. 保持现有 CSS class、DOM 尺寸、点击坐标和 renderer props。
5. `GameTerminal` 继续暴露现有 renderer fallback diagnostics。

本阶段是行为保持重构，不隐藏 scrollbar，不加入右键拖动。

### 7.2 门禁

- 重构前后的 Tiles/ASCII 截图、scroll offset 和点击坐标一致。
- 现有 Follow、切换 renderer、fallback、永久背包和保存恢复测试全部通过。
- `GameTerminal.tsx` 不再拥有 map scroll/camera 生命周期。
- 独立 reviewer 确认没有 stale closure、重复 listener 或未取消 RAF。

建议提交：

```text
refactor: extract map viewport camera
```

## 8. 阶段三：拖动与 Follow 规则

### 8.1 实施

1. 添加 `use-right-drag-pan.ts`。
2. 将右键格子操作从 `mousedown` 延迟到确认没有 drag 的 `pointerup`。
3. 在 drag 中按起点差值更新 `scrollLeft` 和 `scrollTop`。
4. 隐藏 `.nh-map-scroll` 的 scrollbar chrome，同时保持 `overflow: auto`。
5. 普通 snapshot 不再触发 Follow；只响应有效 target 坐标变化。
6. 对右键查看命令显式保持 camera。
7. renderer 和布局变化继续使用已有归一化 anchor 恢复。

### 8.2 浏览器验证

- 右键短按的目标格和 modifier 与现状一致。
- 右键拖动后 scroll offset 与拖动距离一致。
- 拖动超过阈值后没有额外 click、context menu 或游戏回合。
- 从地图内部拖到外部再松开能清理状态。
- 拖动后右键查看远处格子不抢回视角。
- 玩家移动后 Follow 开启会回中，关闭时不会。
- ASCII、Tiles、1280×900、900×700、右侧和下方永久背包均通过。
- Chromium、Firefox 和 WebKit 至少各执行 click/drag 关键流程。

建议提交：

```text
feat: add right-drag map panning
```

## 9. 阶段四：测试与版本基建

### 9.1 稳定测试契约

- 为地图浏览器测试定义单一 helper 和类型，集中读取 renderer、cursor、
  camera anchor、command readiness 和 snapshot revision。
- 页面只暴露测试真正需要且不包含角色名、消息或地图内容的只读状态。
- 禁止新的测试直接依赖 Canvas 内部 ref 或 ASCII 行 DOM。
- 逐步替换散落的 `.nh-map-*` 状态推断；视觉 class 仍可用于可见性断言。

优先使用稳定 DOM contract，不增加默认生产环境中的全局可变 test API。

### 9.2 版本元数据

- 保持运行时 `PRODUCT_VERSION` 的现有单一来源。
- 浏览器 fixture 从根 `VERSION` 或统一测试 helper 获取期望版本，不再手写
  `alpha-*` 字符串。
- 文档中的历史版本记录不自动替换；只处理当前状态和测试断言。

### 9.3 Profile migration

- 不创建 schema v3，不改变 `blisshack.profile.v2`。
- 将“识别版本 → 严格验证该版本 → 迁移到当前类型”整理为显式迁移链。
- v1→v2 的字段、默认 ASCII、未知字段拒绝和错误文本保持不变。
- import、storage 和 backup 继续调用同一个入口。
- 只有真实 schema 版本存在时才注册迁移步骤，不建立反射式通用框架。

建议提交：

```text
refactor: stabilize frontend compatibility contracts
```

## 10. 阶段五：WASM 工具链基建

### 10.1 环境预检

新增统一预检入口，例如：

```text
npm run check:toolchain
```

至少验证：

- 当前 Node 主版本匹配 `.nvmrc`。
- emsdk 版本匹配 `.emscripten-version`。
- `emcc`、`emar` 和 `emranlib` 来自同一个 emsdk 根目录。
- Python、make 和必要命令存在。
- 当前命令明确使用 WASM hints 和目标目录，不会误落入 native 增量构建。
- staging、runtime triplet 和 tile manifest 的路径可写且一致。

### 10.2 构建边界

- `build-wasm.sh` 继续是唯一受支持的完整 WASM 发布入口。
- 为 native 与 WASM 中间产物增加可验证标记或独立目录，拒绝交叉复用。
- 保持“staging 构建 → runtime/ABI/tile 测试 → 原子发布”的顺序。
- CI 与本地调用同一个预检，不复制另一套 shell 判断。
- 本阶段不修改 C、shim ABI、Emscripten flags 或 runtime 功能。

### 10.3 门禁

- 错误 Node、错误 emsdk 和 native/WASM 混用都必须在编译前快速失败。
- 正确环境下完整 `npm run build:wasm` 和 staging 集成测试通过。
- 若构建输出发生变化，必须先解释原因；不得仅因脚本重构刷新 runtime。

建议提交：

```text
build: add deterministic WASM toolchain checks
```

## 11. 阶段六：收尾验收

### 11.1 自动门禁

```bash
cd frontend
npm run verify:tiles
npm test
npm run lint
npm run build
npm run test:integration:wasm
npm run test:integration:browser
npm run test:integration:compat
npm run test:performance
npm run test:long
```

工具链阶段还必须在固定 Node 和 emsdk 环境执行一次：

```bash
npm run check:toolchain
npm run build:wasm
```

所有可能产生长输出的命令写入临时日志，只显示状态和有限尾部。

### 11.2 人工验收

1. 在窄桌面窗口和右侧永久背包下确认没有可见 scrollbar。
2. 用触控板水平滚动地图。
3. 右键短按多个格子，确认查看信息且视角不跳回。
4. 右键按下轻微抖动，确认仍是 click。
5. 右键拖动地图，确认不触发格子操作和浏览器菜单。
6. 拖出地图边界后松开，再次点击和拖动仍正常。
7. Follow 开启时拖离玩家，再移动玩家，确认重新居中。
8. Follow 关闭时移动玩家，确认 camera 保持。
9. Tiles/ASCII 往返，确认 camera、session 和游戏位置不丢失。
10. 测试 `;` 位置选择中的左键、右键和右键拖动。
11. 测试保存退出、刷新 Continue、profile 和完整 backup。
12. 检查 Console 没有 pointer capture、Canvas、React 或 tile 错误。

### 11.3 文档

- 更新 `rendering-architecture.md` 的 camera 与 pointer 状态机。
- 更新 `build-process.md` 的工具链预检。
- 更新 `profile-v2.md` 的迁移链实现说明。
- 新增 alpha-1.1 release acceptance 记录。
- alpha-1.1 合入和部署成功后再更新 README 与 `session-start.md` 的线上版本。

## 12. 工作流与提交

每个阶段继续使用 alpha-1 已验证的流程：

1. 独立 subagent 先编写或补充测试。
2. 提交测试基线。
3. 主线程实现。
4. 独立 subagent 只读审查。
5. 修正 finding，运行阶段门禁。
6. 形成可独立回滚的阶段提交。

推荐提交序列：

```text
docs: plan alpha-1.1 map interaction and infrastructure
chore: start alpha-1.1 development
test: define alpha-1.1 map viewport contracts
refactor: extract map viewport camera
feat: add right-drag map panning
refactor: stabilize frontend compatibility contracts
build: add deterministic WASM toolchain checks
docs: complete alpha-1.1 acceptance
```

创建计划时不修改 `VERSION`。开始实施后的第一个提交再切换到 `alpha-1.1`。

## 13. 风险与停止条件

| 风险 | 处理 |
| --- | --- |
| 手抖导致 click 被判为 drag | 固定 CSS 像素阈值并覆盖边界测试 |
| drag 后仍发送游戏输入 | click 延迟到 pointerup，drag 状态不可逆 |
| pointer 离开地图导致状态残留 | pointer capture、cancel 和卸载清理 |
| Follow 与用户滚动争夺 viewport | camera reducer 区分 manual pan 和 target change |
| 隐藏 scrollbar 降低可发现性 | 保留触控板滚动，人工验收右键拖动；不删除 overflow |
| 测试接口泄露游戏内容 | 只暴露 renderer、坐标和生命周期状态 |
| 工具链检查只适配一台机器 | 本地 macOS 与 Linux CI 共用预检并分别验证 |
| profile 重构改变兼容性 | 保留 v1/v2 golden fixtures 和严格错误测试 |

出现以下情况时暂停当前阶段并单独决策：

- 必须修改 NetHack click modifier、shim callback 或 Asyncify 顺序。
- 右键查看无法与核心产生的 `clipCenter` 变化可靠区分。
- 浏览器不允许右键 pointer capture，且替代方案会破坏格子操作。
- 工具链隔离需要改变上游 NetHack 的 native 构建结构。
- profile 重构需要改变 schema、storage key 或 backup 外层格式。

## 14. 非目标

- Canvas 地图的屏幕阅读器语义或隐藏文本镜像。
- 移动端、触摸拖动或虚拟控制器。
- 自定义 scrollbar 组件或滚动条主题设计。
- 地图缩放、fit-to-width、mini-map 或多个 camera preset。
- 左键拖动地图。
- 新 tileset、动画、光照或 HUD 重设计。
- profile schema v3、backup v2 或 save 格式变化。
- NetHack 游戏规则、随机数、地图生成或 WASM ABI 修改。

## 15. 完成定义

alpha-1.1 只有同时满足以下条件才算完成：

1. `MapViewport` 和 camera 边界明确，`GameTerminal` 不再持有地图滚动生命周期。
2. scrollbar 不可见，但触控板和程序化滚动仍可用。
3. 右键 click 与 drag 在阈值、cancel 和 pointer capture 边界下行为确定。
4. 右键查看不抢回视角；有效 Follow target 变化仍正确回中。
5. Tiles/ASCII、窗口和永久背包布局变化保持 camera。
6. 地图测试不再从 ASCII DOM 推断 renderer-independent 状态。
7. 当前版本断言不再散落手写版本字符串。
8. profile v1/v2 兼容行为不变，并通过显式迁移链验证。
9. WASM 工具链错误在编译前失败，正确环境完整构建通过。
10. 单元、WASM、三浏览器、性能和长流程测试全部通过。
11. 人工地图交互和数据兼容验收通过。
12. 合入部署分支并完成线上 smoke test。

## 16. 实施状态

截至 2026-09-13，`alpha-1.1` 分支的六个开发阶段和自动验收已经完成，尚未
合入或 push：

| 阶段 | 主要提交 |
| --- | --- |
| 计划与版本 | `9486665a8 docs: plan alpha-1.1 map interaction and infrastructure`、`9509cd5a5 chore: start alpha-1.1 development` |
| 行为基线 | `5c80b2d05 test: define alpha-1.1 map viewport contracts` |
| Viewport/camera | `c69287eca refactor: extract map viewport camera` |
| 右键拖动与 Follow | `fddbab969 feat: add right-drag map panning` |
| 兼容契约 | `9a382f4cc test: define frontend compatibility contracts`、`21daaa688 refactor: stabilize frontend compatibility contracts` |
| WASM 工具链 | `fc2cce479 test: define WASM toolchain preflight contracts`、`754eebfe9 build: add deterministic WASM toolchain checks` |
| 最终覆盖与修正 | `3a73f2eee test: complete alpha-1.1 interaction coverage`、`34eeb6954 fix: preserve camera for unchanged follow targets`、`108c57f87 build: rebuild alpha-1.1 WASM runtime` |

自动门禁结果和人工检查步骤记录在
`doc/BlissHack/plans/in-alpha-1.1/release-acceptance.md`。当前完成定义中的
第 1 至 10 项已经由实现、测试和文档覆盖；第 11 项等待用户人工验收，第 12 项
在验收通过后执行。

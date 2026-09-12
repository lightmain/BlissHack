# BlissHack alpha-1 Tileset 引入计划

## 1. 版本目标

alpha-1 是 BlissHack 从字符终端进入图形界面的第一个版本。本版本专注于引入
NetHack 官方经典 tileset，建立可验证、可切换、可回退的浏览器图形地图渲染链。

alpha-1 不是完整 UI 重设计版本。只有 Canvas 地图引入后为保持布局、输入、
可访问性和视觉一致性所必需的 UI 调整属于本版本；消息区、状态栏、永久背包、
菜单和其他页面的独立视觉改版留给后续版本。

本项目没有传统 release 或 tag 门槛。部署分支 push 后即成为线上版本。因此
alpha-1 在独立分支开发，每个阶段形成可独立审核和回滚的提交，全部验收通过后
再合入并 push 到部署分支。

## 2. 当前基线

### 2.1 已有能力

- NetHack 5.0 C 核心通过 `shim_graphics` 将地图事件发送给 TypeScript。
- `shim_print_glyph` 同时传递前景和背景 `glyph_info`。
- `GlyphInfo` 已解码 `glyph`、`ttyChar`、颜色、flags、`symbolIndex` 和
  `tileIndex`。
- `MapCell` 已保存前景与背景 glyph，可以供 ASCII 和 Tiles renderer 共同
  消费。
- 当前 ASCII 地图是 80×21 的 DOM 文本网格，已经支持地图点击、自动跟随、
  光标和宠物标记。
- React UI 已将地图、状态、消息、永久背包和 modal 分成独立组件。

### 2.2 尚未具备的能力

- 当前 WASM 使用 `SHIM_GRAPHICS`，但构建参数没有启用
  `TILES_IN_GLYPHMAP`，也没有把生成的 `tile.o` 链入 WASM。
- 前端虽然读取 `glyph_info.gm.tileidx`，但在当前 WASM 构建中不得把该字段
  视为已验证、可用的 tile 映射。
- 官方 tiles 以 `win/share/*.txt` 文本像素格式保存，浏览器没有可直接加载的
  atlas。
- 当前地图 renderer 只使用前景 glyph 的字符和颜色，没有图形绘制路径。
- 当前 profile schema v1 是严格 schema，不能直接增加 renderer 字段而仍把
  文档称为同一个 v1 格式。

### 2.3 官方素材和映射来源

alpha-1 只使用仓库内随 NetHack 分发的官方资源：

```text
win/share/monsters.txt
win/share/objects.txt
win/share/other.txt
win/share/decals.txt
win/share/tilemap.c
win/share/tiletext.c
win/share/tile2bmp.c
```

四个 `.txt` 文件是构建输入，不是浏览器运行时资源。`tilemap.c` 是
glyph-to-tile 顺序的权威来源。生成的 atlas 与 WASM 必须来自同一个 commit 和
同一组 NetHack 编译选项。

## 3. 已确定的产品和技术决策

### 3.1 图形范围

- 首个 tileset 使用 NetHack 5.0 官方经典 16×16 tiles。
- 只实现二维俯视地图，不实现 3D、等距视角、动画或动态光照。
- 不在本版本制作、生成或引入新的美术素材。
- 不支持用户上传 tileset，也不支持多个第三方 tileset。
- ASCII 模式长期保留，不作为过渡代码删除。

### 3.2 资源形式

官方文本 tiles 在构建时转换为一个浏览器可加载的 PNG atlas 和一个 JSON
manifest。浏览器运行时不得解析 `monsters.txt`、`objects.txt`、
`other.txt` 或 `decals.txt`。

计划产物：

```text
frontend/public/tiles/
├── nethack-classic.png
└── nethack-classic.json
```

manifest 至少记录：

- 格子宽度和高度。
- atlas 行列数及 tile 总数。
- monsters、objects、other、decals 的连续区间。
- blank、unexplored、pet mark 和 pile mark 等特殊 tile 索引。
- 四个输入文件的 SHA-256。
- 生成器版本或格式版本。

atlas 和 manifest 作为一组受校验的生成产物提交。普通 `npm run build` 只验证
它们与源文件匹配，不应静默重写工作树。开发者通过显式命令重新生成。

### 3.3 核心映射

WASM 构建启用 `TILES_IN_GLYPHMAP`，并把当前构建生成的 `tile.o` 链入最终
模块。前端只消费核心提供的 `glyph_info.gm.tileidx`，不在 TypeScript 中
复制或猜测 glyph-to-tile 表。

这项修改只启用官方已有的 glyph 显示映射，不改变游戏规则、随机数、存档或
Asyncify 输入流程。由于需要修改上游构建文件，必须按项目规则：

- 在修改处增加 BlissHack 修改说明、日期和目的。
- 更新 `shim-interface-reference.md` 和 `upstream-modifications.md`。
- 重新构建并成对提交 `nethack.js`、`nethack.wasm` 和
  `nethack-runtime.json`。

### 3.4 浏览器渲染器

Tiles 地图使用 Canvas 2D。Three.js 不用于本版本的二维网格。

```text
MapCell[][]
├── AsciiMapRenderer：现有 DOM 文本渲染
└── TileMapRenderer：Canvas 2D atlas 裁切渲染
```

Canvas 只负责地图。消息、状态、永久背包、菜单、提示和暂停层继续由 React
和 HTML 渲染。

Tile renderer 必须：

- 保持 80×21 坐标系，包括当前未使用的第 0 列。
- 使用 `drawImage()` 从 atlas 裁切 tile。
- 关闭图像平滑，采用整数像素边界，避免像素画模糊。
- 按设备像素比设置 backing store，同时保持稳定的 CSS 尺寸。
- 复用现有滚动容器、玩家跟随和位置点击语义。
- 独立绘制光标、宠物和物品堆标记，不把 UI 状态写回地图数据。
- 缓存已解码图片，不在每次 React render 时重新加载或解码。

前景与背景都保留在 renderer contract 中。官方经典 tiles 首先按官方窗口端口
的视觉结果绘制；不得简单把所有黑色像素当成透明色。只有 atlas 格式和官方
语义能够可靠表达透明区域时才合成背景，否则使用前景 tile 并把背景数据继续
保留给未来 tileset。

### 3.5 设置与默认值

Settings 的 Interface 区增加 `Map display`：

- `Tiles`
- `ASCII`

该设置只决定地图 renderer，不改变消息、状态和其他终端文字。切换必须立即
生效，不重启 WASM，不重新开始游戏。

profile 引入 schema v2：

```text
interface.mapRenderer = "tiles" | "ascii"
```

- 新建 profile 默认使用 `tiles`。
- 已持久化的 v1 profile 迁移为 `ascii`，保证升级后原有界面不会被强制改变。
- v1 profile 导入继续受支持，并在内存中迁移为 v2。
- 新导出统一使用 v2。
- backup 恢复必须同时支持含 v1 和 v2 profile 的现有备份。
- schema 迁移不得修改 NetHack save bytes 或 backup 外层格式版本。

开发阶段在 Tiles 尚未通过完整验收前，可以临时保持默认 ASCII；完成定义要求
新 profile 的正式默认值为 Tiles。

### 3.6 故障回退

如果 atlas 加载失败、manifest 校验失败、tile index 越界或 Canvas 初始化
失败：

1. 当前 session 自动回退到 ASCII renderer。
2. 不修改玩家保存的 renderer 偏好。
3. 记录不包含游戏内容的诊断事件。
4. 页面不得出现空白地图或阻断游戏。

## 4. 版本范围

### 4.1 本版本包含

- 官方 tile 文本资源到 PNG atlas 和 manifest 的可重复生成流程。
- atlas 来源、尺寸、顺序、数量和 checksum 校验。
- WASM 的 `TILES_IN_GLYPHMAP` 与 `tile.o` 接线。
- `tileIndex` 的 ABI、范围和真实运行时集成测试。
- ASCII/Tiles 双地图 renderer。
- Tiles renderer 的 Canvas 2D 实现。
- 地图模式设置和 profile v1 到 v2 迁移。
- Canvas 所必需的地图容器、滚动、点击、焦点和布局调整。
- 光标、宠物、物品堆以及未知 tile fallback。
- Tiles 模式的单元、WASM、浏览器、像素和性能测试。
- 构建、架构、设置、上游修改和验收文档更新。

### 4.2 本版本不包含

- 全站或完整游戏 HUD 的视觉重设计。
- 角色动画、攻击动画、粒子、屏幕震动和补间移动。
- 3D、等距投影、动态光照或音效。
- 自定义、AI 生成或第三方 tileset。
- tileset 上传、编辑器或主题市场。
- 移动端、触摸控制或虚拟键盘。
- 永久背包物品动作。
- 修改 NetHack 游戏规则、地图生成或存档结构。
- 从 WASM 内存直接读取地图、怪物或物品链表。
- 为了透明背景而使用颜色猜测、抠图启发式或未经验证的黑色移除。

## 5. 阶段一：资源生成与一致性证明

### 5.1 目标

建立独立、确定性的 Web tiles 生成器，但尚不修改玩家界面。

### 5.2 实施

1. 添加 `generate:tiles` 和 `verify:tiles` 命令。
2. 生成器严格解析 palette、tile 注释和 16×16 像素块，拒绝未知字符、
   行列尺寸错误和 tile 数量不一致。
3. 使用成熟 PNG 编码库写入 RGBA PNG，不手写 PNG 压缩格式。
4. 按官方 tilemap 使用的文件顺序合并资源。
5. manifest 记录资源分段、特殊 tile 和输入 checksum。
6. 将验证接入 `prebuild` 和 CI；验证不得修改文件。

### 5.3 门禁

- 同一输入重复生成时 PNG 和 manifest 字节一致。
- 每个输入 tile 都恰好写入一次。
- 生成 tile 数量与官方工具及 `tilemap.c` 一致。
- 抽查怪物、物品、地形、未探索区域、pet mark 和 pile mark。
- `npm run build` 在资源缺失、过期或损坏时明确失败。

没有通过该阶段，不进入 WASM 和 Canvas 接线。

## 6. 阶段二：WASM tile 映射

### 6.1 实施

1. 只在 `CROSS_TO_WASM` 构建中启用 `TILES_IN_GLYPHMAP`。
2. 生成并链接与当前 NetHack 配置匹配的 `tile.o`。
3. 保持 `shim_print_glyph` ABI 不变，继续通过现有
   `glyph_info` 指针读取 `tileidx`。
4. 在运行时验证 atlas manifest 的 tile 数量与所有收到的有效
   `tileIndex` 范围一致。
5. 更新运行时三件套和修改记录。

### 6.2 测试

- C 或 WASM 测试确认 `nul_glyphinfo`、unexplored 和普通 glyph 的
  `tileidx` 不再是未启用状态。
- 真实 WASM 新游戏至少覆盖玩家、宠物、怪物、物品、墙、地面、门和楼梯。
- 前景与背景指针继续按 36 字节 `glyph_info` ABI 正确解码。
- tile mapping 不改变 `ttyChar`、颜色、glyph flags 或 symbol index。
- WASM 构建可重复性和运行时 manifest 校验通过。

## 7. 阶段三：Canvas renderer 原型

### 7.1 模块边界

建议结构：

```text
frontend/src/map/
├── AsciiMapRenderer.tsx
├── TileMapRenderer.tsx
├── canvas-rendering.ts
├── tile-assets.ts
└── map-coordinates.ts
```

现有 `map-rendering.ts` 中与 ASCII run 合并相关的逻辑迁入 ASCII 模块；滚动、
跟随和坐标换算放入 renderer 共用的领域模块。不要建立无边界的 `utils.ts`。

### 7.2 原型要求

- 首先在测试 harness 中并排显示 ASCII 和 Tiles 的同一份 `MapCell[][]`。
- Canvas 初始实现允许全图重绘，先证明正确性。
- 使用 `requestAnimationFrame` 合并同一帧内的重复更新。
- 只有性能证据证明全图重绘不满足预算时，才增加 dirty-cell 缓存。
- atlas 未就绪时显示 ASCII，而不是空白或 loading 卡住。

### 7.3 正确性

- 空白、未探索、墙、门、通道、地面、楼梯、陷阱、物品、怪物和玩家均正确。
- 光标只改变显示，不覆盖底层 tile。
- pet 和 pile 标记与 glyph flags 一致。
- 点击坐标与 ASCII 模式完全相同，左键和右键语义不变。
- 浏览器缩放和高 DPI 下没有半像素缝隙、模糊或坐标偏移。

## 8. 阶段四：产品接入和必要 UI 适配

### 8.1 接入

- `GameTerminal` 根据 profile 选择 renderer。
- Settings 增加 Map display segmented control。
- 完成 profile v2、存储迁移、导入导出、diff 预览和 backup 兼容。
- 切换 renderer 时保留地图滚动位置；开启 Follow player 时重新居中。
- Canvas 保持 `Dungeon map` 可访问名称，不进入键盘 Tab 顺序。

### 8.2 允许的 UI 调整

只有以下 Canvas 直接引起的修改属于 alpha-1：

- 地图 viewport 的稳定尺寸、边框、背景和 overflow。
- Canvas 与消息区、状态区及永久背包之间的尺寸协调。
- Tiles 加载失败时的非阻断 fallback 状态。
- renderer 设置及其说明、导入预览和诊断字段。
- 光标、pet mark、pile mark 在图形模式中的可辨识度。

以下修改即使看起来有价值，也应单独规划：

- Home、Settings 或 Data Management 的重新排版。
- 状态栏、消息栏和永久背包的全新视觉风格。
- 全局配色、品牌、字体和 modal 设计替换。
- 与 Canvas 无关的菜单交互或新快捷操作。

## 9. 阶段五：性能、兼容与完成验收

### 9.1 自动测试

- 资源 parser、manifest 和 checksum 单元测试。
- tile index 范围、特殊 tile 和 fallback 单元测试。
- Canvas draw command、DPR、resize、坐标换算和图片失败测试。
- profile v1→v2、v2 round-trip、导入导出和 backup 恢复测试。
- 真实 WASM tile mapping 测试。
- Chromium 完整浏览器测试。
- Firefox 和 WebKit 关键流程。
- 保存继续、多页面锁、永久背包和长流程回归测试。

### 9.2 Canvas 专项测试

- 对桌面和较窄桌面视口截图。
- 使用 canvas pixel 读取确认地图不是全透明、全黑或单色。
- 验证玩家附近多个预期 tile 区域存在像素差异。
- 验证 ASCII/Tiles 切换后地图坐标、输入和 session 不变。
- 记录全图绘制基线；CI 性能门禁使用相对基线和宽松绝对上限，避免机器波动
  造成假失败。
- 检查 atlas 只解码一次，连续回合不会重复网络请求或创建图片对象。

### 9.3 人工验收

至少覆盖：

1. 新游戏、角色选择和第一层地图。
2. 玩家、宠物、怪物、物品、墙、门、楼梯和未探索区域。
3. 移动、开门、拾取、战斗和切换楼层。
4. `;` 位置输入与地图左键、右键。
5. Tiles/ASCII 在游戏中来回切换。
6. Follow player 开关和窗口 resize。
7. 永久背包位于右侧和下方。
8. 保存退出、继续游戏和页面刷新。
9. atlas 加载失败时自动回退 ASCII。
10. 浏览器 Console 没有图片解码、Canvas、React 或越界错误。

## 10. 测试策略

重构和功能实现遵循以下顺序：

1. 修改前补齐当前 ASCII 行为的 characterization tests。
2. 资源生成、WASM 映射、Canvas 和 profile 分别提交。
3. 每个阶段先通过最小相关测试，再运行完整门禁。
4. 不在同一提交中同时修改 tile 顺序、renderer 算法和 UI 样式。
5. 如果发现现有 glyph 或背景语义缺陷，先用独立测试固定并单独修复。

最终门禁：

```bash
cd frontend
npm run verify:tiles
npm test
npm run lint
npm run build
npm run test:integration
npm run test:integration:compat
npm run test:performance
npm run test:long
```

涉及 WASM 的阶段还必须执行：

```bash
cd frontend
npm run build:wasm
```

并检查运行时三件套和 tile 资源的完整 diff。

## 11. 提交与分支策略

- 从最新部署分支创建长期 `alpha-1` 分支。
- 开始实现时才把根 `VERSION` 从 `prealpha-4` 切换为 `alpha-1`。
- 计划文档本身不提前切换产品版本。
- 每个阶段开始前建立 checkpoint，完成后提交可运行状态。
- C 构建改动、运行时三件套和对应测试放在同一提交。
- atlas、manifest、生成器和校验测试放在同一提交。
- 不提交调试截图、临时转换文件或本地性能日志。
- 全部阶段完成后 fast-forward 或普通 merge 到部署分支，再 push 触发部署。

建议提交顺序：

1. `build: generate verified classic tile atlas`
2. `build: enable WASM glyph tile indices`
3. `feat: add canvas tile map renderer`
4. `feat: add map renderer profile setting`
5. `style: adapt game layout for tile maps`
6. `test: complete alpha-1 tile rendering coverage`
7. `docs: complete alpha-1 tileset milestone`

## 12. 风险与控制

| 风险 | 控制 |
|------|------|
| atlas 顺序与 `tileidx` 不一致 | 同源 checksum、总数校验、WASM 代表 glyph 集成测试 |
| 构建选项导致 glyph 顺序变化 | 映射由当前 NetHack 构建生成，前端不复制表 |
| Canvas 空白但测试仍通过 | canvas pixel 检查和代表性 tile 截图 |
| 高 DPI 模糊或出现网格缝隙 | DPR backing store、整数坐标、关闭 smoothing |
| 点击位置偏移 | 共用坐标模块并在缩放、滚动后执行浏览器测试 |
| 图片失败导致无法游玩 | session 内自动回退 ASCII |
| profile v1 被新字段破坏 | 显式 v2 schema 与 v1 迁移测试 |
| 为 tiles 顺便无限扩张 UI | 仅允许第 8.2 节列出的必要适配 |
| 修改上游构建造成不可追踪差异 | 文件内标注、修改清单、独立提交和完整 WASM 重建 |
| 全图重绘性能不足 | 先测量，再按证据增加 rAF 合并或 dirty cells |

## 13. 完成定义

alpha-1 只有同时满足以下条件才算完成：

1. 官方 tile 文本可以确定性生成经过校验的 PNG atlas 和 manifest。
2. 当前 WASM 对所有实际地图 glyph 提供有效、范围内的 `tileIndex`。
3. 新建 profile 默认使用 Tiles，旧 v1 profile 可迁移且保持 ASCII。
4. 玩家可以在游戏中即时切换 Tiles 和 ASCII。
5. Tiles 模式支持光标、pet、pile、位置点击、地图跟随和 resize。
6. atlas 或 Canvas 失败时自动回退 ASCII，游戏仍可操作。
7. 保存、恢复、backup、永久背包和输入行为没有回归。
8. 单元、WASM、Chromium、Firefox、WebKit、性能和长流程测试全部通过。
9. Canvas 像素检查证明地图真实绘制且代表性 tile 不混淆。
10. 所有 C、构建、profile、架构和许可证文档已更新。
11. 线上部署成功，并完成一次 Tiles 与 ASCII 的生产环境 smoke test。

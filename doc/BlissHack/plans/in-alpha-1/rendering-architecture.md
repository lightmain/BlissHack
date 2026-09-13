# alpha-1 地图渲染架构

## 1. 数据流

NetHack 核心仍通过 `shim_print_glyph` 发送前景和背景 `glyph_info`。WASM 构建
启用 `TILES_IN_GLYPHMAP` 并链接生成的 `tile.o`，因此
`glyph_info.gm.tileidx` 是当前构建的权威 tile index。TypeScript 不复制
glyph-to-tile 表。

```text
NetHack glyph_map
  -> shim_print_glyph
  -> bridge 解码 GlyphInfo
  -> MapCell[21][80]
  -> AsciiMapRenderer 或 TileMapRenderer
```

地图第 0 列继续保留在 80×21 数据中，但点击坐标仍只接受 NetHack 的正常列
1..79。

## 2. Atlas

`frontend/scripts/tiles/` 从 NetHack 官方 `win/share` 文本资源生成
`frontend/public/tiles/nethack-classic.png` 和同名 JSON manifest。顺序为：

```text
monsters -> objects -> other -> grayscale statues -> decals
```

当前产物为 2307 个 16×16 tile，40 列、58 行，PNG 为 640×928。manifest
固定 unexplored 1469、blank 1470、pet mark 2305、pile mark 2306，并记录
所有输入文件的 SHA-256。

普通 tile 保留原始像素。pet/pile decal 以官方 delimiter 左上角颜色作为透明
背景，不使用黑色抠除或颜色猜测。

## 3. Renderer

`AsciiMapRenderer` 保留原 DOM 字符地图。`TileMapRenderer` 使用 Canvas 2D：

1. 校验地图中全部前景和背景 tile index。
2. 按背景、前景、pet/pile decal、cursor 的顺序绘制。
3. 使用 `requestAnimationFrame` 合并同一帧的重复更新。
4. 根据 `devicePixelRatio` 设置 backing store，CSS 尺寸固定为 1280×336，
   并关闭 image smoothing。
5. atlas Promise 在模块内缓存，成功后复用；失败后清除缓存以允许后续重试。

`MapViewport` 是 Canvas 与 ASCII 共用的 viewport 边界，唯一持有
`.nh-map-scroll`、`.nh-map-interaction`、ResizeObserver 和 pointer
生命周期。`GameTerminal` 只组合地图与其他游戏区域，不再管理 scroll ref 或
camera。鼠标位置按渲染边界归一化为 80×21 坐标，不依赖单个 tile DOM。

renderer 通过稳定的只读 DOM contract 暴露
`ascii`、`tiles-loading`、`tiles` 或 `tiles-fallback` 状态。浏览器测试读取该
状态、cursor 坐标、snapshot revision、command input 和归一化 scroll anchor，
不从 ASCII 行 DOM 或 Canvas 内部实现推断游戏状态。

## 4. 滚动与跟随

`use-map-camera.ts` 管理归一化 anchor、manual pan、Follow target 和程序化
scroll 抑制：

- Follow 开启时，新的 `clipCenter.x/y` 在 viewport 内居中并按边界裁剪。
- target 按坐标值比较；普通 snapshot 或相同坐标的新对象不会拉回 camera。
- 用户滚轮、触控板或右键拖动后，视角停留在手动位置；玩家实际移动时才恢复
  Follow。
- Follow 关闭时，玩家移动不改变 camera。
- renderer、字体、窗口或永久背包布局变化时，按新内容尺寸恢复归一化 anchor。
- Canvas 首帧提交后重新定位，避免沿用加载期间 ASCII fallback 的尺寸。
- 程序化恢复产生的 scroll 事件不会覆盖保存的手动 anchor。

`.nh-map-scroll` 仍使用真实 `overflow: auto`，但隐藏浏览器 scrollbar chrome；
触控板和程序化滚动保持可用。`use-right-drag-pan.ts` 使用 Pointer Events 和
pointer capture 实现右键平移。位移小于 5 CSS px 时在 `pointerup` 提交原有
右键格子操作；达到阈值后手势不可逆地成为 drag，不向 `nh_poskey` 提交坐标。
`pointercancel`、`lostpointercapture` 和组件卸载都会清理手势。

右键格子查看会在整个 position-input 周期保存 camera anchor，核心期间产生的
`clipCenter` 请求不会抢回视角；输入返回正常 command 状态后结束该保护。其他
合法且坐标变化的 Follow 请求保持原行为。

## 5. 故障回退

以下情况只终止当前 session 的 Tiles 显示并回退 ASCII：

- manifest、PNG 加载或尺寸校验失败；
- Canvas 2D context 不可用；
- 核心提供的前景或背景 tile index 越界；
- 绘制过程抛出异常。

回退不会修改 `interface.mapRenderer`。应用只记录
`map.tiles_assets_fallback` 或 `map.tiles_canvas_fallback`，不记录角色名、
地图内容或按键。

## 6. 验证

- 单元测试覆盖 atlas 单例、失败重试、DPR、绘制层次、越界拒绝、RAF 和滚动
  坐标。
- WASM 集成测试验证 36-byte `glyph_info` ABI、特殊 tile 和代表 cmap 映射。
- Chromium 全量流程使用真实 WASM 与真实 atlas 验证像素、切换、fallback、
  camera、右键手势和持久化回归。
- Firefox 和 WebKit 关键流程验证 Tiles 像素与切换、右键查看、右键拖动、
  profile、backup、save/continue 和多页面锁。
- 性能 harness 对完整 80×21 地图执行与生产一致的 resize 和全图绘制。

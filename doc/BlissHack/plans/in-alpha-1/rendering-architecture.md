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

Canvas 与 ASCII 共用 `.nh-map-scroll` 和 `.nh-map-interaction`。鼠标位置按渲染
边界归一化为 80×21 坐标，不依赖单个 tile DOM。

## 4. 滚动与跟随

Follow player 开启时，`clipCenter` 在 viewport 内居中并按边界裁剪。Canvas
首帧提交后再次定位，避免使用加载期间 ASCII fallback 的尺寸。

Follow player 关闭时，viewport 保存归一化地图中心。renderer、字体或消息区
尺寸变化后按新内容尺寸恢复；程序化恢复产生的 scroll 事件不会覆盖保存的手动
锚点，因此 Tiles 与较窄的 ASCII 地图之间往返仍能回到同一区域。

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
- Chromium、Firefox 和 WebKit 使用真实 WASM 与真实 atlas 验证像素、切换、
  fallback 和持久化回归。
- 性能 harness 对完整 80×21 地图执行与生产一致的 resize 和全图绘制。

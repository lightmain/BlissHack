# BlissHack

[English](README.md) | [简体中文](README-cn.md)

> **上游与许可证声明**
>
> BlissHack 是基于 NetHack 5.0.0 的非官方修改版。NetHack 原始 README
> 已不作内容修改地保存在 [README-NetHack](README-NetHack)，原始许可证保存在
> [dat/license](dat/license)。BlissHack 并非 NetHack DevTeam 制作或支持；
> 浏览器前端特有的问题应反馈给本项目，而不是 NetHack 上游。

BlissHack 的目标是在现代浏览器中运行更加现代化版本的 NetHack。NetHack C
内核被编译为 WebAssembly，并通过上游 shim 窗口接口连接到 React/TypeScript
终端前端。
BlissHack 对 NetHack C 代码进行了少量有针对性的修改，主要用于修复浏览器
前端所需但 shim 接口尚未完整实现的行为。详情见
[当前项目对 shim 接口的修改](doc/BlissHack/shim-interface-reference.md#6-当前项目对-shim-接口的修改)。

## 项目状态

**alpha-2.3 已完成实现、自动门禁和独立复审，等待人工验收。**

alpha-2.3 已加入 profile v4 和由核心命令目录驱动的可选 BlissHack 动作栏。
Original 模式改为结构化的 TTY 两行状态，BlissHack 模式继续使用图形状态。
启用 BlissHack 动作栏时，核心实际请求的物品、方向、确认和普通单选输入使用
紧凑的动作次级弹窗。部署分支与 GitHub Pages 可能落后，实际线上版本以页面
显示为准。

当前里程碑已经实现：

- 默认使用官方 tiles 的 80×21 Canvas 地图，并长期保留 ASCII renderer。
- viewport 全屏 HUD 固定消息区和状态区，并支持永久背包 Right 与 Below 布局。
- Original 的 TTY 两行状态和 BlissHack 的 HP、Energy、XP 图形状态均由核心
  结构化字段驱动显示。
- 可选动作栏覆盖核心公开命令目录，支持行数、分类、锁定、拖动布局、布局
  导入导出和可搜索的 All Actions。
- 物品选择、方向选择、`yn`/`ynq` 确认和普通单选菜单共用紧凑次级弹窗；即使
  使用快捷键开始方向操作，也会高亮角色周围八格并允许点击选择。
- Detailed 信息量下，状态、背包和地图共用延迟 Tooltip；Original 只关闭状态
  说明，地图与背包不受影响。
- 地图和背包右键菜单完全由核心生成，鼠标动作由高层动作控制器安全编排。
- 永久背包使用 Pointer Events 拖到玩家当前格，通过核心原生 drop 流程执行，
  并以背包 revision 防止过期操作。
- 地图隐藏原生 scrollbar 但保留滚动能力；右键拖动平移，普通右键打开核心
  操作菜单，显式位置输入仍保留原有鼠标目标语义。
- Follow 开启时允许手动浏览；右键查看和同坐标回合不会抢回视角，有效 Follow
  target 的坐标变化后重新居中。
- WASM 提供权威 `tileIndex`；Canvas 绘制背景、前景、宠物/物品堆标记和光标。
- atlas 或 Canvas 失败时自动回退 ASCII，不修改玩家保存的显示偏好。
- Settings 可即时切换 Tiles/ASCII；profile 严格按 v1→v2→v3→v4 迁移，旧
  profile v1 迁移后保持 ASCII。
- 可从核心命令或 Messages 区域按钮打开消息历史，并支持文本窗口、菜单、
  提示、扩展命令和位置输入。
- 可选择原版串行角色流程，或在统一界面完成姓名、职业、种族、性别和阵营，
  并直接继续同名存档。
- 准确的 ASCII、Ctrl、Alt/Meta、方向键和数字小键盘输入。
- 通过 Emscripten IDBFS 在浏览器本地保存和恢复游戏及本地 Ranking；完整备份
  schema v2 同时包含个人配置、存档和 Ranking，并继续兼容 schema v1。
- 单元、WASM、Chromium、Firefox、WebKit、性能和长流程测试。
- GitHub Pages 自动部署。

这仍然是早期 alpha 版本。在稳定版本之前，存档兼容性、界面细节和窗口端口覆盖
范围都可能发生变化。

## 在线游玩

<https://lightmain.github.io/BlissHack/>

存档保存在当前浏览器配置中，不会上传到服务器，也不会自动同步到其他浏览器或
设备。NetHack 写入的文件内容仍是原版二进制 save bytes；IDBFS 只负责把
Emscripten 虚拟文件及其文件系统元数据持久化到 IndexedDB。

主界面页脚和致命错误页可以导出本地诊断日志。诊断日志不会自动上传，也不记录
角色名、按键、游戏消息或存档内容。

## 操作方式

BlissHack 使用 NetHack 的标准键盘命令：

- 使用方向键或 `h`、`j`、`k`、`l` 移动角色。
- `Ctrl` 组合键编码为 ASCII 控制字符。
- `Alt` 组合键用于 NetHack Meta 命令。
- 操作系统的 `Command`/`Meta` 键保留给浏览器。
- 数字小键盘按照 NetHack 当前的 number-pad 模式工作。

完整数字对照及源码依据参见
[按键输入参考](doc/BlissHack/key-input-reference.md)。

## 本地开发

产品版本由根目录 `VERSION` 定义。前端开发和 CI 使用根目录 `.nvmrc` 指定的
Node.js 主版本。

仓库中的 `frontend/public/nethack.js`、`nethack.wasm` 和
`nethack-runtime.json` 是前端使用的 Emscripten 运行时三件套。官方 tiles
生成产物位于 `frontend/public/tiles/`。

```sh
cd frontend
npm ci
npm run dev
```

生产构建：

```sh
cd frontend
npm run build
npm run preview
```

重新编译 WebAssembly 内核需要 Emscripten。请按照
[WASM 构建流程](doc/BlissHack/build-process.md)操作，并始终一起提交运行时
三件套。`npm run check:toolchain` 可以在不清理或编译的情况下检查固定工具链。
Tiles 资源使用 `npm run generate:tiles` 显式生成，并由 `npm run verify:tiles`
校验。

## 测试

```sh
cd frontend
npm test
npm run lint
npm run test:integration
npm run test:integration:compat
npm run test:performance
npm run test:long
```

集成测试会运行真实 WASM 回调链和生产浏览器构建，覆盖启动、键盘输入、状态栏、
Tiles/ASCII、存档和恢复流程。跨浏览器基础组覆盖 Firefox 和 WebKit 的发布
关键路径，性能测试记录 Canvas 全图绘制与永久背包表现。长流程测试用于发布前
重复验证游戏会话、继续保存和存档传输。Chromium 视觉基线覆盖
Tiles/ASCII、Right/Below 在 1280×900 和 900×700 下的 HUD 组合。

## 仓库文档

- [prealpha-1 计划](doc/BlissHack/plans/prealpha-1.md)
- [prealpha-2 计划](doc/BlissHack/plans/prealpha-2.md)
- [prealpha-3 计划](doc/BlissHack/plans/prealpha-3.md)
- [prealpha-4 代码重构计划](doc/BlissHack/plans/prealpha-4.md)
- [alpha-1 Tileset 引入计划](doc/BlissHack/plans/alpha-1.md)
- [alpha-1.1 地图交互与基建计划](doc/BlissHack/plans/alpha-1.1.md)
- [alpha-2.0 交互式 HUD 计划](doc/BlissHack/plans/alpha-2.0.md)
- [alpha-2.1 焦点与 Below HUD 计划](doc/BlissHack/plans/alpha-2.1.md)
- [alpha-2.2 信息与流程体验计划](doc/BlissHack/plans/alpha-2.2.md)
- [alpha-2.3 动作栏计划](doc/BlissHack/plans/alpha-2.3.md)
- [alpha-1 渲染架构](doc/BlissHack/plans/in-alpha-1/rendering-architecture.md)
- [alpha-1 profile v2](doc/BlissHack/plans/in-alpha-1/profile-v2.md)
- [alpha-1 发布验收](doc/BlissHack/plans/in-alpha-1/release-acceptance.md)
- [alpha-1.1 发布验收](doc/BlissHack/plans/in-alpha-1.1/release-acceptance.md)
- [alpha-2.0 发布验收](doc/BlissHack/plans/in-alpha-2.0/release-acceptance.md)
- [alpha-2.1 发布验收](doc/BlissHack/plans/in-alpha-2.1/release-acceptance.md)
- [alpha-2.2 发布验收](doc/BlissHack/plans/in-alpha-2.2/release-acceptance.md)
- [alpha-2.3 发布验收](doc/BlissHack/plans/in-alpha-2.3/release-acceptance.md)
- [prealpha-3 发布验收](doc/BlissHack/plans/in-prealpha-3/release-acceptance.md)
- [上游修改清单](doc/BlissHack/upstream-modifications.md)
- [存档存储与读取方案评审](doc/BlissHack/plans/in-prealpha-2/save-format-review.md)
- [Game Module 生命周期](doc/BlissHack/plans/in-prealpha-2/module-lifecycle.md)
- [致命错误和诊断日志设计](doc/BlissHack/plans/in-prealpha-2/fatal-errors-and-diagnostics.md)
- [浏览器端到端测试设计](doc/BlissHack/plans/in-prealpha-2/browser-end-to-end-tests.md)
- [WASM 构建流程](doc/BlissHack/build-process.md)
- [Shim 接口参考](doc/BlissHack/shim-interface-reference.md)
- [按键输入参考](doc/BlissHack/key-input-reference.md)
- [Guidebook 中文索引](doc/BlissHack/guidebook-index-cn.md)
- [前端源码](frontend/src)

## 已知接口限制

当前上游 shim ABI 无法安全返回非空消息历史字符串，也没有暴露 `yn_number`。
扩展后的 `getdir` 回调能可靠说明方向输入正在进行，却不能说明发起操作属于邻格
还是远程，也没有暴露射线的阻挡与可见性语义。因此 BlissHack 只显示可靠的
八方向目标，不根据提示、动作名或物品名猜测射线。详情记录在
[Shim 接口参考](doc/BlissHack/shim-interface-reference.md)中。

## 许可证

BlissHack 包含并派生自 NetHack，依照
[NetHack General Public License](dat/license)免费分发，并遵循其中的无担保
条款。构建浏览器可执行文件所需的完整对应源代码均在本仓库中提供。

NetHack 原始版权和许可证声明均予以保留。前端第三方依赖仍分别遵循各自的
许可证。

本仓库记录的 BlissHack 修改始于 2026 年。prealpha-1 增加了浏览器前端、
测试、文档和部署配置。项目对 NetHack C 代码的少量修改均在对应文件中标明，
并记录于
[Shim 接口参考的“当前项目对 shim 接口的修改”章节](doc/BlissHack/shim-interface-reference.md#6-当前项目对-shim-接口的修改)。

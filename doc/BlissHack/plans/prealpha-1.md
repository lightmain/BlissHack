空白界面 MVP 的开发规划
目标：浏览器打开后能看到 NetHack 启动并进入游戏，证明整条链路通了。

第一步：编译 WASM
在终端中安装 Emscripten 并执行 make CROSS_TO_WASM=1，得到 nethack.js + nethack.wasm。

第二步：创建最小 React 项目
Bash



运行
cd frontend
npm create vite@latest . -- --template react-ts
npm install
把 WASM 产物复制到 public/。

第三步：写最小回调（核心）
一个 nethack-bridge.ts 文件，实现一个"什么都应答但什么都不渲染"的回调：

shim_nhgetch → 固定返回空格键（让游戏不卡住）
shim_player_selection → 自动随机选角色
shim_putstr → console.log 到浏览器控制台
shim_print_glyph → 忽略
其他所有事件 → console.warn 记录名称，不处理
这样游戏能启动、能跑，只是画面是空白的、所有输出都在控制台里。

第四步：最小 UI
一个页面，三个区域（全部用纯文本，不做任何样式）：

顶部：消息文本（从 shim_putstr 收集）
中间：空白占位（未来放地图）
底部：一个文本输入框（捕获键盘输入，传给 shim_nhgetch）
按这个顺序做的原因
1→2 验证工具链（Emscripten 能编译、Vite 能启动） 3 验证核心桥接（WASM 加载成功、回调能通） 4 验证最小交互（按键能传到游戏、游戏输出能显示）

每一步都是独立可验证的。任何一步失败都能精确定位问题。

要我开始做第一步吗？需要你先安装 Emscripten。
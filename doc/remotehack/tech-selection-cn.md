# RemoteHack 技术选型讨论

本文档记录 RemoteHack 的技术选型讨论。
每个章节列出问题、备选方案、优劣权衡以及推荐选择。

---

## 1. 后端：HTTP 服务器嵌入策略

### 问题

NetHack 是一个 C 程序。我们需要向基于浏览器的前端提供 HTTP+JSON 服务。
有两大方向：将 HTTP 库嵌入到 NetHack 进程中，或运行一个独立的服务器进程通过 IPC 与 NetHack 通信。

### 方案 A：嵌入式 C HTTP 库（推荐）

将轻量级 HTTP 服务器直接嵌入 NetHack 二进制文件，作为一个新的
`window_procs` 接口实现（遵循 `win/tty`、`win/Qt` 等的模式）。

**候选库：**

| 库 | 许可证 | 体量 | 功能 | 备注 |
|----|--------|------|------|------|
| **civetweb** | MIT | 约 3 个文件 | HTTP/1.1、WebSocket、HTTPS | 活跃维护，易于嵌入，支持单头文件模式 |
| **mongoose** | GPLv2 / 商业 | 2 个文件 | HTTP、WebSocket、MQTT | 双许可证可能与 NetHack 的 NHPL 冲突 |
| **libmicrohttpd** | LGPL | 系统库 | HTTP/1.1、HTTPS | 依赖较重，可移植性差 |
| **facil.io** | MIT | 多文件 | HTTP、WebSocket、Pub/Sub | 较复杂，异步优先 |

**推荐：civetweb**

- MIT 许可证与 NetHack 的宽松许可证（NHPL）兼容。
- 可以作为 2-3 个源文件直接嵌入 `win/http/`。
- 支持同步处理器注册（适配 NetHack 的阻塞模型）和 WebSocket（为未来扩展预留）。
- 经过充分测试，有生产环境使用案例（例如 MongoDB 曾使用）。
- 跨平台（Linux、macOS、Windows）。

**使用 civetweb 的架构：**

```
NetHack 游戏核心
    |
    v
win/http/winhttp.c  （实现 window_procs，将调用转换为 JSON）
    |
    v
civetweb（嵌入式）  <--HTTP+JSON-->  浏览器（React 前端）
```

游戏循环调用 `win_nhgetch()` / `win_nh_poskey()` 时会阻塞等待来自前端的
下一个 HTTP 请求。其他 `window_procs` 函数（putstr、print_glyph、
display_nhwindow 等）将输出缓存为 JSON，在上一个输入请求的响应中返回。

### 方案 B：独立服务器进程 + IPC

将 NetHack 作为子进程运行；用 Go/Rust/Python/Node 编写的服务器
在前面转换 HTTP 与 stdin/stdout（或 Unix socket）之间的通信。

**优点：**
- HTTP 层可自由选择任意语言。
- NetHack 进程无需修改。

**缺点：**
- 现有 tty 接口的 stdout 是非结构化的——解析终端转义码来重建游戏状态既脆弱又有损。
- 无法访问内部游戏状态（glyph 信息、菜单结构等）。
- 双进程管理增加了部署复杂度。
- IPC 序列化带来延迟开销。

**结论：** 不推荐。`window_procs` 接口提供了对所有显示信息的结构化访问。
绕过它去解析终端输出在各方面都更差。

### 方案 C：SHIM_GRAPHICS + 外部进程

NetHack 已有 `win/shim/winshim.c`——一个最小化的存根接口。
我们可以扩展 shim，将结构化数据通过管道传给外部进程。

**优点：**
- 基于现有代码构建。

**缺点：**
- shim 设计上就是极简的；扩展它所需的工作量和从零编写专用 HTTP 接口差不多。
- 仍然需要 IPC，相比直接嵌入增加了复杂度。

**结论：** 可作为参考起点，但专用的 `win/http` 实现更干净。

---

## 2. 通信协议

### 问题

前端如何与后端通信？NetHack 的游戏循环本质上是同步的：
每次处理一个输入，阻塞直到下一个输入到来。

### 方案 A：纯 HTTP 请求-响应（V1 推荐）

```
前端                              后端
   |                                 |
   |--- POST /input {key: "j"} ---->|
   |                                 |  （处理输入，生成输出）
   |<-- 200 {map:[], msgs:[], ...} --|
   |                                 |
   |--- POST /input {key: "i"} ---->|
   |<-- 200 {menu: {...}} ----------|
```

每个请求发送一个玩家操作；响应包含完整的更新后游戏状态（地图、消息、状态栏、菜单等）。

**优点：**
- 完美映射 NetHack 的阻塞式游戏循环。
- 实现和调试都很简单（可用 curl / 浏览器 DevTools）。
- 无状态协议——易于推理。

**缺点：**
- 没有服务端推送能力（回合制游戏不需要）。
- 每次请求有轻微开销（对回合制游戏可忽略不计）。

### 方案 B：WebSocket

持久化双向连接。

**优点：**
- 更低的单消息开销。
- 服务器可推送更新（对未来的多人/观战模式有用）。

**缺点：**
- 状态管理更复杂。
- 对严格的回合制游戏而言过度设计。
- 连接生命周期管理增加复杂度。

### 方案 C：HTTP + Server-Sent Events (SSE)

HTTP 用于输入，SSE 用于输出流。

**优点：**
- 服务器可流式推送更新。

**缺点：**
- 与 WebSocket 开销相当但缺少完整的双向能力。
- 对回合制模型来说不必要的复杂。

### 推荐

**V1 使用纯 HTTP。** NetHack 的回合制本质完美映射到 HTTP 请求-响应模型。
如果未来需要观战模式或需要服务端推送的动画效果，可以后续添加 WebSocket 支持
（civetweb 支持此功能）。

---

## 3. JSON API 结构

### 问题

前后端交换的 JSON 数据应该是什么样的？

### 设计方案

**输入（前端 → 后端）：**

```json
{
  "type": "key",
  "key": "j",
  "mod": 0
}
```

```json
{
  "type": "click",
  "x": 30,
  "y": 10
}
```

```json
{
  "type": "line",
  "text": "Excalibur"
}
```

```json
{
  "type": "menu_select",
  "selections": [{"item": "a", "count": -1}]
}
```

**输出（后端 → 前端）：**

响应是自上次输入以来累积的「显示事件」数组：

```json
{
  "events": [
    {
      "type": "map_update",
      "cells": [
        {"x": 30, "y": 10, "glyph": 2041, "symbol": "@", "color": 7,
         "bg_glyph": 1923, "bg_symbol": ".", "bg_color": 0}
      ]
    },
    {
      "type": "message",
      "text": "You hit the goblin!",
      "attr": 0
    },
    {
      "type": "status",
      "fields": {
        "hp": 15, "hpmax": 16, "pw": 3, "pwmax": 5,
        "ac": 7, "level": 1, "gold": 42, "dlevel": 1,
        "name": "Player", "title": "Rambler"
      }
    }
  ],
  "prompt": {
    "type": "getkey",
    "message": null
  }
}
```

`prompt` 字段告知前端后端当前等待的输入类型：`getkey`（单次按键）、
`getline`（文本输入）、`yn`（是/否/其他）、或 `menu`（菜单选择）。

### 讨论要点

1. **全量状态 vs. 增量更新：** V1 每次发送完整地图状态（更简单，约 80×21 = 1680
   个格子，JSON 约 50KB——足够快）。后续可优化为增量更新。

2. **Glyph 编码：** NetHack 内部使用整数 glyph ID。后端应同时发送 glyph ID
   和可读的符号/颜色，这样前端可以选择文本渲染或贴图渲染。

3. **多层格子：** RemoteHack 的关键特性。每个格子应包含前景（怪物/物品）和
   背景（地形）两个 glyph，以便前端分层渲染。这些数据在
   `win_print_glyph()` 中通过 `glyph_info` 参数已经可用。

---

## 4. 前端技术栈

### 已确定
- **框架：** React（按项目需求）

### 4a. 构建工具

| 选项 | 优点 | 缺点 |
|------|------|------|
| **Vite**（推荐） | 快速 HMR，现代默认配置，轻量 | — |
| Next.js | SSR，文件路由 | 过度设计——游戏不需要 SEO/SSR |
| Webpack（手动配置） | 最大控制权 | 配置繁琐，速度慢 |

**推荐：Vite** ——最快的开发体验，React+TS 零配置。

### 4b. 语言

| 选项 | 优点 | 缺点 |
|------|------|------|
| **TypeScript**（推荐） | 复杂游戏状态的类型安全，更好的 IDE 支持 | 轻微学习成本 |
| JavaScript | 更简单 | 对复杂游戏模型失去类型安全 |

**推荐：TypeScript** ——游戏状态模型（地图、背包、状态栏）足够复杂，值得使用类型系统。

### 4c. 地图渲染

| 选项 | 优点 | 缺点 |
|------|------|------|
| **HTML Canvas**（V1 推荐） | 网格渲染性能好，支持贴图，API 简单 | 文本渲染需要注意处理 |
| 纯 DOM / CSS Grid | 最容易上手，可访问性好 | 80×21 网格更新性能差 |
| WebGL（PixiJS / Three.js） | 最佳性能，支持动画 | V1 来说过于复杂 |

**推荐：从 Canvas 开始。** 地图是固定大小的网格（通常为 80×21，即
COLNO × ROWNO）。Canvas 可以高效地将其渲染为 ASCII 文本或贴图。
如果后续需要复杂动画，可以引入 PixiJS。

**混合方案：** Canvas 用于地图区域，React DOM 用于 UI 面板
（消息栏、状态栏、背包菜单）——兼得两者优势。
地图需要高效的批量渲染；UI 面板受益于 React 的组件模型。

### 4d. 状态管理

| 选项 | 优点 | 缺点 |
|------|------|------|
| **Zustand**（推荐） | 极少样板代码，React 原生，体积小 | 对超大型应用结构性稍弱 |
| React Context + useReducer | 无额外依赖 | 重渲染问题，游戏状态规模下扩展性差 |
| Redux Toolkit | 结构化，成熟 | 对本项目而言样板代码太重 |
| Jotai / Recoil | 原子化状态 | 学习成本，不够主流 |

**推荐：Zustand** ——轻量、TypeScript 友好，非常适合单页游戏 UI。
我们需要一个全局游戏状态存储（地图、消息、背包、状态栏），在每次服务器响应时更新。

### 4e. UI 组件库

| 选项 | 优点 | 缺点 |
|------|------|------|
| **自定义 / Headless**（推荐） | 完全控制游戏美术风格 | 初期工作量更大 |
| MUI / Ant Design | 现成组件 | 通用外观，包体积大，与游戏美术冲突 |

**推荐：自定义组件。** 游戏 UI 应有自己的视觉风格。通用组件库强加的美术风格不适合
地牢冒险游戏。如有需要，可使用无样式的 UI 库（如 Radix、Headless UI）
提供可访问性基础，而不受视觉约束。

---

## 5. 构建系统集成

### 问题

如何将新的 `win/http` 后端和 React 前端集成到 NetHack 现有的构建系统中？

### 建议方案

1. **后端（`win/http/`）：** 在现有 Makefile 体系中添加新的 `HTTP_GRAPHICS`
   编译标志（遵循 `TTY_GRAPHICS`、`QT_GRAPHICS` 等的模式）。civetweb
   源文件与 NetHack 窗口接口代码一起编译。

2. **前端（`frontend/`）：** 使用 Vite 独立构建。开发环境中，Vite dev server
   运行在单独端口，将 API 请求代理到 NetHack HTTP 后端。生产环境中，
   `vite build` 生成静态文件，由 civetweb 内置的静态文件服务功能提供。

3. **开发工作流：**
   ```
   终端 1: make（构建带 HTTP 接口的 NetHack）&& ./nethack
   终端 2: cd frontend && npm run dev（Vite dev server 带代理）
   ```

---

## 6. 开发阶段

### 第一阶段：最小可玩版本（MVP）

- [ ] 实现 `win/http` 窗口接口及核心 `window_procs`
- [ ] 嵌入 civetweb 作为 HTTP 服务
- [ ] 地图、消息、状态栏和按键输入的 JSON API
- [ ] React 前端：地图显示（Canvas 上的 ASCII）、消息区域、状态栏
- [ ] 基本键盘输入转发
- [ ] 构建系统集成（Makefile + Vite）

### 第二阶段：原版功能完整对齐

- [ ] 菜单系统（背包、法术书等）
- [ ] yn_function 和 getlin 提示
- [ ] 角色选择界面
- [ ] 选项配置
- [ ] 存档/读档支持

### 第三阶段：RemoteHack 增强功能

- [ ] 多层格子渲染（怪物 + 地形）
- [ ] 游戏元素的提示框系统
- [ ] 鼠标交互（点击查看、点击移动）
- [ ] 改进的背包 UI
- [ ] 增强的消息区域（无需手动翻页）
- [ ] 操作提示和动作建议
- [ ] 贴图渲染模式

---

## 推荐总结

| 决策 | 推荐 | 理由 |
|------|------|------|
| HTTP 服务器 | civetweb（嵌入式） | MIT 许可证，极小体量，跨平台 |
| 架构 | `win/http/` 中新增 `window_procs` | 干净集成，完整访问游戏状态 |
| 协议（V1） | HTTP 请求-响应 | 完美适配回合制游戏循环 |
| 构建工具 | Vite | 快速、现代、React+TS 零配置 |
| 语言 | TypeScript | 复杂游戏状态需要类型安全 |
| 地图渲染 | Canvas（混合 React DOM） | 性能 + React 组件优势 |
| 状态管理 | Zustand | 轻量、TypeScript 友好 |
| UI 组件 | 自定义 / Headless | 游戏专属美术风格 |

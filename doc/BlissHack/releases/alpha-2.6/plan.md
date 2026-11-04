# BlissHack alpha-2.6 界面动效计划

## 1. 文档状态

本文定义 alpha-2.6 的界面动效、美术调整和验收边界。当前状态为实施中，完成
自动验证、独立复审和用户人工验收前不得标记为 accepted。

## 2. 版本目标

1. 主页、角色创建与游戏界面使用短距离纵向切换，保持终端式直接反馈。
2. 主页以 NetHack 原生字符组成的小型地牢替代抽象标记，不引入生成式插画。
3. 设置页、模态窗口、次级对话框、上下文菜单与 tooltip 使用分级短动画。
4. 原生 View Transition 可用时补足页面退出；不支持时保持可靠的进入动画。
5. `prefers-reduced-motion` 下移除位移和非必要动画。

## 3. 设计约束

- 不修改 NetHack 核心、WASM 桥接、会话 reducer 或存档生命周期。
- 动效协调器只解释现有 action 的呈现方向，不保存第二套业务状态。
- 页面切换不使用缩放、弹簧、粒子、视差或连续装饰动画。
- 页面位移不超过 28px，主要窗口不超过 10px，浮层不超过 4px。
- 动效时长保持在 70ms 至 180ms；背景和文字必须维持现有可读性。

## 4. 实施范围

- Home 使用 `| - . # + @ >` 构成 ASCII 地牢标记。
- Home、Settings、启动页和错误页增加一致的页面进入契约。
- Character Setup 与 Game Terminal 通过 session 内局部 stage 切换。
- Save、Settings、Pause、Examine、End Summary、原生菜单和次级对话框复用
  对话框动效关键帧。
- tooltip 只做短淡入。

## 5. 自动验收

- 主页 ASCII 与动效 CSS contract 测试。
- 相关 screen 测试和完整 Vitest。
- `npm run lint`
- `npm run build`
- `npm run docs:check`
- `git diff --check`
- 桌面与移动视口浏览器截图检查。

## 6. 人工验收

1. Home 到角色创建、角色创建到游戏的切换方向自然且无布局跳动。
2. Settings 打开和返回不会遮挡、残留或丢失焦点。
3. 常见游戏窗口打开时不闪烁、不改变窗口尺寸。
4. 开启系统“减少动态效果”后页面和窗口可立即使用。
5. 主页美术保持 NetHack 字符气质，在桌面和移动布局均清晰。

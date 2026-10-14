# Examine 排版原型说明

## 真实界面基线

- `snapshot-wiki.html` 是用户从 BlissHack 运行时保存的 Kitten
  facts-only 界面。
- `assets/snapshot-document.js` 由该快照机械生成，只移除了无法在静态页面中
  继续运行的 Vite 模块脚本、favicon 和 `crossorigin` 属性。
- “当前实现”直接使用快照 DOM 和随原型打包的生产 CSS，不再手写模拟窗口。
- 快照无法序列化 Canvas 位图；原型会从当前 checked-in tile atlas 恢复
  Kitten portrait，并把该 atlas 副本放在 `assets/` 中。

## NetHackWiki

本原型不复制 NetHackWiki 正文。“建议方案”只为已由可见身份安全确定的
`Kitten` 增加到 <https://nethackwiki.com/wiki/Kitten> 的页头链接。

生产实现若面对未鉴定物品，只能在稳定类别身份可用时链接到类别页面，例如
`Potion`；若没有安全身份，则不显示链接。链接规则不能读取隐藏对象真值或解析
自由文本。

## NetHack 数据

窗口中显示的事实来自当前 NetHack 5.0 源码生成资产，许可条款见
`dat/license`。原型只改变排版和视觉层级，不改写事实值。

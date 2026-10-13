# alpha-2.4 Wiki 发布审查报告

本报告记录 alpha-2.4 阶段六对 checked-in NetHackWiki 节选的发布审查。运行时
Wiki 资产、选择清单、alias catalog、验收 fixture 和 `NOTICE.md` 由
`frontend/scripts/encyclopedia/release-gates.stage-six.test.mjs` 交叉验证。

## 1. 发布范围

- 发布记录：1 条，`monster:PM_NEWT`。
- 页面：`Newt`。
- 固定 revision：`205110`。
- revision SHA-256：
  `8255e5ed686ea657f3b5cea18449b31e11f5bfe731195797b4f2dc5263522032`。
- 许可：Creative Commons Attribution-ShareAlike 3.0 Unported，
  `CC-BY-SA-3.0`。
- 作者标识：NetHackWiki contributors。
- source、revision history 和 license URL 均写入记录与
  `frontend/public/encyclopedia/NOTICE.md`。

发布内容严格为以下 4 个完整原文段落：

| Tab | 原标题 | 段落数 |
| --- | --- | ---: |
| Strategy | Strategy | 2 |
| History | History | 1 |
| History | Dudley's dungeon | 1 |
| **合计** |  | **4** |

没有发布 Overview Tab 或 Overview 段落。选择清单、生成资产和真实浏览器测试
均断言 Overview 不存在；内容没有摘要、翻译、改写、截句、合并或拼接。

## 2. 审查项

| 审查项 | 结果 |
| --- | --- |
| Wiki 缺失 | 970 个核心实体中 1 个有 Wiki，969 个按设计显示 core facts-only |
| alias 冲突 | 1 条精确 alias，title 与 entity ID 冲突均为 0 |
| revision 变化 | selection、acceptance fixture、manifest 和运行时记录均为 `205110` 且 hash 一致 |
| 许可不明 | 0；唯一发布记录有完整 CC BY-SA 3.0 元数据 |
| attribution 缺失 | 0；NOTICE 与页面级来源区域均保留署名、来源、历史和许可 |
| 外部图片 | 0；alpha-2.4 不纳入 Wiki 图片 |
| 未审核候选 | 0；只有 `reviewStatus: published` 的固定选择进入运行时资产 |

Wiki 缺失不阻止发布；alias、revision、许可或 attribution 错误会使生成或运行时
校验 fail closed。Wiki manifest/chunk 失败只降级为 core facts-only，不会削弱
core manifest、chunk 或 WASM 构建身份校验。

## 3. 资源与加载

- Wiki manifest：483 B。
- Wiki chunk：2,467 B。
- Wiki 总量：2,950 B，低于 4 MiB 门禁。
- Detailed 挂载只预加载 Wiki manifest；`wiki-001.json` 仅在打开 Newt 时
  lazy-load，并校验 chunk hash、schema、revision 交叉引用和每段 SHA-256。
- 浏览器不会请求 NetHackWiki 网络资源；正常 build、test 与游戏运行保持离线。

## 4. 结论

checked-in Wiki 发布物只包含 revision 205110 的 4 段获批完整原文，已删除两段
不安全的 Overview 内容，且核心与 Wiki 来源、类型、目录、许可和 UI 归属保持
分离。本报告不代表用户已完成人工界面验收。

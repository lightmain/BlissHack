# alpha-2.4 核心资料覆盖报告

本报告记录 alpha-2.4 阶段六对 checked-in encyclopedia core 资产的发布审查。
统计来源为 `frontend/public/encyclopedia/core/manifest.json` 及其声明的全部
chunk；`frontend/scripts/encyclopedia/release-gates.stage-six.test.mjs`
逐项复算这些结论。

## 1. 构建身份

- NetHack：`5.0.0`。
- core schema：`2`。
- generator：`2.0.0`。
- source inputs：25 个。
- source fingerprint：
  `9ae8f4fa29d54139de661e346c5c58dd44e78c4cd10d398fdd33e1865e2cc465`。
- core entity chunks：11 个；glyph binding chunks：12 个。
- runtime manifest 绑定 core manifest 的字节数、SHA-256 和 source
  fingerprint；运行时不接受不同 WASM 构建的资料。

## 2. 实体覆盖

| family | 记录数 |
| --- | ---: |
| appearance | 17 |
| monster | 383 |
| object | 463 |
| artifact | 33 |
| terrain | 49 |
| trap | 25 |
| **合计** | **970** |

970 个 stable ID 均唯一，manifest 声明数与 chunk 实际记录数一致。所有
supported glyph 引用的 entity ID 都存在，悬空引用为 0。

## 3. Glyph 覆盖

- 完整 glyph domain：9,624。
- supported：6,444。
- unsupported：3,180。
- 每个 glyph 恰有一个连续编号结果；unsupported 均有规范化显式原因。

| unsupported reason | 数量 |
| --- | ---: |
| `swallow-effect` | 3,064 |
| `explosion-effect` | 63 |
| `zap-effect` | 32 |
| `temporary-cmap` | 10 |
| `warning` | 6 |
| `non-entity-object` | 2 |
| `invisible` | 1 |
| `nothing` | 1 |
| `unexplored` | 1 |
| **合计** | **3,180** |

## 4. 资源预算

- 全部 core JSON（不含独立精确对象索引）：1,838,744 B，低于 2 MiB 门禁。
- 加上 45,095 B 独立精确对象索引后总计 1,883,839 B。
- 最大 chunk：`glyph-bindings-010.json`，98,281 B，低于 256 KiB。
- 最大实体记录：`monster:PM_CHROMATIC_DRAGON`，1,627 B，低于 64 KiB。
- Detailed 挂载只预加载 runtime、core 和 Wiki manifest，共 9,418 B。
- 加上最坏单个 glyph chunk 后为 107,699 B，低于 150 KiB 首次索引预算。
- entity 与 Wiki chunk 仍按目标 lazy-load；同 URL 请求合并并缓存。

## 5. 结论

阶段六自动门禁确认所有目标核心实体均有记录，所有 glyph 均被分类，
unsupported glyph 均有显式原因，资源和单记录大小均在发布预算内。本报告不
代表人工界面验收完成。

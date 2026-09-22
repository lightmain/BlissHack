# BlissHack alpha-2.2 发布验收

## 状态

alpha-2.2 实现、自动门禁、独立复审和人工验收均已完成。2026-09-22，用户确认
该版本完成并开始规划下一里程碑。

## 交付内容

- profile v3 和信息量、角色选择、终局风格三项展示设置。
- 使用权威 WASM 元数据的统一角色选择，并保留原版流程和同名存档恢复。
- 安全采集核心终局输出，结束并 flush session 后显示分 Tab 结果页。
- 浏览器本地 Ranking、语义化排名表和包含 Ranking 的完整备份 schema v2。
- 界面快捷键、扩展命令说明搜索和跨页面统一 Tooltip、字体、滚动条样式。

## 自动验证

| 门禁 | 结果 |
| --- | --- |
| `npm run check:toolchain` | Node 24.19.0 / Emscripten 6.0.9 |
| `npm test` | 68 files，752/752 |
| `npm run lint` | 0 warnings / 0 errors |
| `npm run build` | 通过 |
| `npm run test:integration:wasm` | 100/100 |
| Chromium / Firefox / WebKit / performance / long-flow | 发布验收记录均通过 |
| `git diff --check` | 通过 |

## 验收结论

profile 迁移、信息量、角色选择、死亡/逃离/飞升结果页、本地 Ranking、原版兼容
路径和存储生命周期均达到 alpha-2.2 完成定义。快速再来一局不属于本版本范围。

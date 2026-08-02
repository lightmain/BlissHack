# Guidebook 索引

源文件：`Guidebook-short.tex`。源文件共 4601 行，文档标题日期在第 28 行。

这个索引用于让后续开发者或 agent 按行号回到 `Guidebook-short.tex` 的局部内容。这里记录摘要和检索线索，不复制 Guidebook 的大段原文。

## 局部提取脚本

同目录下的 `extract-guidebook-section.ps1` 可以按章节名或行号范围提取局部原文。

示例：

```powershell
powershell -ExecutionPolicy Bypass -File .\godothack\godothack-docs\Guidebook-memory\extract-guidebook-section.ps1 -ListSections
powershell -ExecutionPolicy Bypass -File .\godothack\godothack-docs\Guidebook-memory\extract-guidebook-section.ps1 -Section "The map"
powershell -ExecutionPolicy Bypass -File .\godothack\godothack-docs\Guidebook-memory\extract-guidebook-section.ps1 -StartLine 629 -EndLine 667
```

## 章节与重要小节

| 层级 | 标题 | 行号范围 | 大意 | 检索关键词 |
|---|---:|---:|---|---|
| 文档 | 文档元信息 | 1-33 | LaTeX 头部、标题、作者、日期。 | title, date |
| 主章节 | Introduction | 34-82 | 冒险动机和进入 Mazes of Menace 的背景叙事。 | Amulet, Mazes |
| 主章节 | What is going on here? | 83-219 | 游戏目标、角色职业、种族选择。 | roles, races |
| 主章节 | What do all those things on the screen mean? | 220-580 | 解释屏幕模型、状态栏、消息行、地图符号。 | screen, map, symbols |
| 小节 | 屏幕模型和示例 | 220-312 | 当前层地图随探索显示；有字符界面和彩色/图块界面；Guidebook 采用默认 ASCII 符号说明。 | display, ASCII, tiles |
| 小节 | The status lines (bottom) | 313-467 | 状态栏字段：属性、阵营、层数、金钱、生命、法力、防御、经验、回合、饥饿和状态条件。 | statuslines, HP, AC |
| 小节 | The message line (top) | 468-483 | 顶部消息行负责表达无法直接画在地图上的事件；`--More--` 等待玩家继续。 | message, More |
| 小节 | The map (rest of the screen) | 484-580 | 默认地图符号表；一个可见符号代表地形、物品、怪物、陷阱或记忆标记；可用 `/` 查询符号。 | map, symbol, whatis |
| 主章节 | Commands | 581-2198 | 默认按键、扩展命令、菜单与提示、移动前缀、物品选择、地图查看命令。 | commands, prompt, menu |
| 小节 | 命令输入和提示模型 | 581-623 | 命令通常是一到两个按键或扩展命令名；需要额外信息时使用菜单或命令行提示；可用计数前缀。 | menustyle, prompt, count |
| 小节 | 帮助和 `whatis` | 626-668 | `?` 打开帮助；`/` 查询符号、位置或名称；光标选点后用 `.`, `,`, `;`, `:` 决定详细程度。 | ?, /, whatis |
| 小节 | 移动、战斗前缀和旅行 | 672-780 | 八方向移动、奔跑、谨慎移动、强制攻击、自动旅行、等待；包含 `m`, `F`, `g`, `G`, `M`, `_`, `.`。 | movement, travel |
| 小节 | 常用动作命令 | 782-907 | 使用工具、脱装备、关门、命名、丢弃、踢、吃、刻字、发射。 | apply, drop, eat |
| 小节 | 物品列表和选项 | 909-944 | `i`/`I` 查看背包；`O` 打开选项菜单；物品按库存字母选择。 | inventory, options |
| 小节 | 消息、搜索、保存、装备操作 | 946-1127 | 查看概览、重复消息、喝、读、搜索、保存、投掷、穿脱装备、武器切换、属性信息。 | search, save, wear |
| 小节 | 查看当前位置和地图遮挡 | 1133-1255 | `:`, `;`, `,`, 装备状态查询、已发现物品、持久背包、`Del`/`#terrain` 查看无遮挡地图。 | look, glance, terrain |
| 小节 | 扩展命令列表 | 1256-2058 | `#` 后输入扩展命令；包含大量命令及默认键。 | #command |
| 重点片段 | 扩展命令：背包和工具 | 1265-1320 | 调整库存字母、使用工具、查看属性、切换自动拾取。 | adjust, apply |
| 重点片段 | 扩展命令：查看和交互 | 1424-1502 | `#glance`, `#herecmdmenu`, `#inventory`, `#known`, `#look`, `#lookaround`, `#loot`。 | glance, lookaround |
| 重点片段 | 扩展命令：层概览和拾取 | 1536-1584 | `#overview`, `#perminv`, `#pickup`。 | overview, perminv |
| 重点片段 | 扩展命令：陷阱和地形 | 1755-1807 | `#showtrap` 描述已发现相邻陷阱；`#terrain` 临时隐藏怪物、物品、陷阱以看地图。 | showtrap, terrain |
| 重点片段 | 扩展命令：旅行 | 1860-1868 | `#travel` 选择地图目标；`autodescribe` 可提示是否有已知路径。 | travel, autodescribe |
| 重点片段 | 扩展命令：符号查询 | 1949-1950 | `#whatis` 是 `/` 的扩展命令形式。 | whatis |
| 重点片段 | 调试地图命令 | 1971-2029 | 调试模式下揭示隐藏、映射整层、查看视野和 seen vector。 | wizdetect, wizmap |
| 小节 | Meta 键绑定 | 2061-2170 | `Alt`/`Meta` 组合键到扩展命令的默认映射。 | meta, Alt |
| 小节 | number_pad 额外字母命令 | 2173-2194 | 开启 `number_pad` 时，部分字母键改作扩展命令快捷键。 | number_pad |
| 主章节 | Rooms and corridors | 2199-2577 | 房间、走廊、门、陷阱、楼梯、商店、移动反馈、Rogue level。 | rooms, corridors |
| 小节 | 房间、照明和隐藏走廊 | 2199-2217 | 明亮区域和黑暗区域显示规则；墙和走廊会随探索留在地图记忆中；秘密走廊需要搜索或魔法发现。 | lit, dark, secret |
| 小节 | Doorways | 2218-2285 | 门的开关、上锁、破坏、陷阱、秘密门和自动开门规则。 | door, autoopen |
| 小节 | Traps | 2286-2362 | 陷阱发现条件、搜索、魔法探测、怪物触发、Sokoban 特殊规则。 | traps, search |
| 小节 | Stairs and ladders | 2363-2400 | 楼梯、分支、层切换、非当前层怪物静止。 | stairs, levels |
| 小节 | Shops and shopping | 2401-2442 | 商店、拾取未付款物品、付款、债务和信用。 | shops, unpaid |
| 小节 | Shop idiosyncrasies | 2443-2469 | 商店价格、门口格子、店主行为、关闭和不补货等特殊规则。 | shopkeeper |
| 小节 | Movement feedback | 2470-2556 | 移动通常只更新角色位置；踩物品、陷阱、怪物才给反馈；`pile_limit` 等选项影响物品堆提示。 | movement feedback, pile_limit |
| 小节 | Rogue level | 2557-2577 | 特殊层显示与玩法差异；可能使用字符显示，金钱和楼梯符号不同。 | rogue level |
| 主章节 | Monsters | 2578-2717 | 怪物显示、战斗、宠物、坐骑、bones level、怪物记忆。 | monsters |
| 小节 | 怪物总览 | 2578-2601 | 看不见的怪物不显示；`/` 和 `;` 可查询屏幕上的怪物；`#name` 可命名怪物。 | monster display |
| 小节 | Fighting | 2602-2628 | 向怪物移动即攻击；攻击和平怪物有确认；看不见怪物可能显示为 `I`。 | fight, invisible |
| 小节 | Your pet | 2629-2657 | 初始宠物、喂食、成长、上下楼跟随和走失。 | pet |
| 小节 | Steeds | 2658-2685 | 骑乘、鞍具、坐骑战斗限制、套上或取下鞍具。 | steed, saddle |
| 小节 | Bones levels | 2686-2697 | 前玩家遗留层、幽灵、尸体和遗物。 | bones |
| 小节 | Persistence of Monsters | 2698-2717 | 怪物只在可见或可感知时显示；看不见但被察觉的怪物位置用记忆标记保留。 | remembered, unseen |
| 主章节 | Objects | 2718-3602 | 物品拾取、背包字母、鉴定、诅咒祝福、各类物品、物品记忆。 | objects |
| 小节 | 物品基础 | 2718-2771 | 拾取、自动拾取、负重、库存字母、物品描述和游戏内鉴定差异。 | pickup, inventory |
| 小节 | Curses and Blessings | 2772-2824 | 祝福、未诅咒、诅咒、未知状态对物品效果和选择过滤的影响。 | BUC |
| 小节 | Artifacts | 2825-2866 | 神器的唯一性、命名、识别和列表命令。 | artifacts |
| 小节 | Relics | 2867-2882 | 三个唯一任务物品及未识别时的描述。 | relics |
| 小节 | Weapons | 2883-2958 | 武器、投掷/射击基础、附魔、侵蚀、毒药、武器命令。 | weapons |
| 小节 | Throwing and shooting | 2959-3023 | 投掷、发射、弹药、发射器、路径阻挡和技能影响。 | throw, fire |
| 小节 | Weapon proficiency | 3024-3070 | 武器/法术技能等级、`#enhance`、命中和伤害修正。 | proficiency |
| 小节 | Two-Weapon combat | 3071-3117 | 双持条件、主副手、`x`, `X`, `pushweapon`。 | twoweapon |
| 小节 | Armor | 3118-3193 | 护甲等级、穿脱、魔法干扰、`armorstatus`。 | armor, AC |
| 小节 | Food | 3194-3223 | 饥饿、生存、腐坏、尸体食用、素食相关。 | food, hunger |
| 小节 | Scrolls | 3224-3267 | 卷轴阅读、空白卷轴、识别和书写。 | scrolls |
| 小节 | Potions | 3268-3284 | 药水饮用和投掷效果。 | potions |
| 小节 | Wands | 3285-3323 | 魔杖使用、充能、方向、破坏魔杖。 | wands |
| 小节 | Rings | 3324-3352 | 戒指佩戴、能力影响、戴多个戒指。 | rings |
| 小节 | Spellbooks | 3353-3410 | 法术学习、遗忘、施法、技能、法术列表。 | spellbooks, spells |
| 小节 | Tools | 3411-3438 | 工具、容器、可穿戴工具、盲眼挑战、`a` 使用工具。 | tools |
| 小节 | Containers | 3439-3485 | 袋子/箱子、`#loot`、锁和陷阱、容器内容数量按堆计算。 | containers, loot |
| 小节 | Amulets | 3486-3507 | 护身符和项链的佩戴、移除和陷阱防护。 | amulets |
| 小节 | Gems | 3508-3521 | 宝石、石头、价值和弹药用途。 | gems |
| 小节 | Large rocks | 3522-3555 | 巨石、雕像、推动、阻挡、Sokoban、雕像显示。 | boulder, statue |
| 小节 | Gold | 3556-3575 | 金币、分数、商店支付、祝福/诅咒状态例外。 | gold |
| 小节 | Persistence of Objects | 3576-3602 | 已见物品会留在地图记忆中；物品可能已经不在原处；物品堆只显示最上层物品。 | object memory, pile |
| 主章节 | Conduct | 3603-3885 | 自愿挑战、食物限制、武器限制、和平主义、文盲、Sokoban、灭绝和愿望等记录。 | conduct |
| 小节 | Achievements | 3760-3885 | 通关进展成就和挑战成就的终局披露。 | achievements |
| 主章节 | Scoring | 3886-3916 | 计分依据、排行榜和命令行查看分数。 | scoring |
| 主章节 | Explore mode | 3917-3963 | 探索模式和调试模式入口、区别和用途。 | explore, debug |
| 小节 | Debug mode | 3939-3963 | 调试模式的启动方式、权限限制和定位。 | wizard mode |
| 主章节 | Credits | 3964-4601 | NetHack 历史、版本、移植、贡献者和致谢。 | credits |
| 小节 | Special Thanks | 4516-4527 | 社区致谢。 | thanks |
| 小节 | Dungeoneers | 4528-4601 | 贡献者名单。 | dungeoneers |


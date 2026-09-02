# BlissHack 存档格式评审

本文记录 prealpha-2 阶段二开始前的存档格式调查和建议。结论依据当前
NetHack 5.0 源码、WASM 构建配置和 Emscripten 生成运行时；在用户确认前，
不据此实现导入、导出、存档元数据或覆盖规则。

## 1. 当前文件与命名

WASM 构建使用 Unix 文件逻辑，`getuid()` 在当前 Emscripten 运行时返回 `0`。
`set_savefile_name()` 因此把普通存档命名为：

```text
/save/0<角色名>
```

当前构建没有定义 `SAVE_EXTENSION`、`ZLIB_COMP` 或可在浏览器中工作的外部
`COMPRESS`，所以正常存档没有扩展名，也不压缩。`/save` 是当前唯一挂载到
IDBFS 的目录。正常保存只留下一个完整存档；关卡锁文件位于挂载目录之外，
不属于持久化存档列表。

列表候选应只接受文件名匹配 `^0[^/]{1,31}$` 的普通文件，并排除目录、
`.tmp`、`.bak`、`.e`、压缩后缀及其他内容。文件名只用于定位，角色身份仍需
与 save header 中的角色名一致。

## 2. 创建、恢复与删除生命周期

- 新游戏开始时不会创建完整 save 文件，只创建运行期锁和关卡文件。
- 玩家确认保存后，核心以截断模式创建目标 save，依次写入版本头、角色信息、
  当前层、全局状态和其他层；成功后删除关卡文件并退出。
- 创建或中途读取关卡失败时，核心删除不完整 save。
- 启动时，核心根据角色名构造同一路径并调用 `restore_saved_game()`。
- `validate()` 先校验格式、关键类型尺寸、版本、feature set 和实体数量。
- 普通模式恢复成功后，核心立即删除原 save；后续再次保存会重新创建它。
- 部分深层恢复失败路径也会删除原 save，然后可能进入同名新游戏流程。因此
  “继续游戏”前必须保留内存副本，恢复失败时恢复该副本，并且 UI 不得静默
  进入角色选择。
- 死亡、逃离、飞升等游戏结束不会产生可继续存档。

## 3. Save Header

当前格式是 NetHack 的 historical binary struct-level 格式。文件开头顺序为：

1. 格式标志，当前值为 ASCII `h`，1 byte。
2. critical-size 项目数，1 byte。
3. 每项关键 C 类型或结构的尺寸，各 1 byte；末项包含
   `SAVEFILE_REVISION_LEVEL`。
4. `struct version_info`：
   `incarnation`、`feature_set`、`entity_count` 三个 `unsigned long`。
   WASM32 当前每项为 4 bytes、小端序。
5. 角色信息块长度，一个 C `int`，WASM32 当前为 4 bytes、小端序。
6. 固定 49 bytes 的角色信息：
   `角色名\0职业-种族-性别-阵营...模式`。

当前源码生成值为：

```text
VERSION_NUMBER   = 0x05000000
VERSION_FEATURES = 0x00060040
VERSION_SANITY1  = 0x211e117f
SAVEFILE_REVISION_LEVEL = 0
PL_NSIZ_PLUS = 49
```

阶段二的 TypeScript 解析器只读取上述前缀，不解析后续游戏状态。它应对长度、
格式标志、critical-size 指纹、三个版本字段、角色块长度、NUL 终止、角色名
和文件名一致性执行严格校验。无法确认的文件保留在存储中，但显示为不可继续。

## 4. 兼容性

- 同一 BlissHack 构建：完整 header 指纹一致时可继续。
- 不同 BlissHack 构建：只有 NetHack 版本、feature set、实体数量、critical
  sizes 和 savefile revision 均兼容时才可能恢复；本版本不作跨构建承诺。
- 桌面 NetHack 与 WASM：数据模型、编译特性或实体数量通常不同，默认不兼容。
- 其他 WASM NetHack：即使版本号相同，也必须通过完整 header 校验，不能仅看
  文件名或版本号。

核心 `validate()` 是最终兼容性权威。前端校验用于在调用 `main()` 前拒绝明显
不兼容或损坏的文件，并阻止失败后静默创建同名新游戏。

## 5. 阶段二元数据

阶段二建议只展示能够从当前文件可靠取得的字段：

- 角色名；
- 职业、种族、性别、阵营的三字符 filecode；
- 普通、探索或调试模式；
- 文件字节数；
- IDBFS 文件修改时间。

每条记录同时保留内部路径、兼容状态和明确错误原因。阶段二不增加 sidecar
index；每次 `listSaves()` 都以 `/save` 实际文件和 header 为事实来源，避免
index 与真实文件漂移。

## 6. 服务边界与启动方式

storage service 位于 `frontend/src/storage/`，拥有 Emscripten FS 适配器和
单一 Promise 队列，提供：

```text
initialize()
listSaves()
readSave(path)
writeSave(path, bytes)
deleteSave(path)
flush()
```

`initialize()` 对同一 module 幂等，只挂载 `/save` 一次，并在第一次枚举前
执行 `syncfs(true)`。write、rename、delete 和所有 `syncfs` 都进入同一队列。

刷新后在首页枚举 IDBFS 需要 Emscripten `FS`，但首页不得启动游戏。建议在
`booting` 阶段预加载一个候选 module，挂载并枚举后才进入首页；此时不注册
shim callback、不调用 `main()`、不创建活动 session。玩家开始或继续游戏时，
该 module 被当前 session 接管。session 结束后仍用该 module 完成 flush 和
重新枚举，下一局再创建新 module。

IndexedDB 缺失、挂载或首次同步失败时，应用进入
`home/storageAvailable=false`；新游戏使用内存 FS，Continue 禁用，并显示
“本次游戏无法持久保存”的明确警告。

## 7. 恢复保护

继续游戏采用以下顺序：

1. 串行读取并严格校验目标 save，保留原始 bytes。
2. 创建新 session，把 header 中已验证的角色名写入 module 的
   `ENV.USER` 和 `ENV.LOGNAME`。
3. 调用 NetHack `main()`，由核心自行执行 `restore_saved_game()`。
4. 如果恢复路径进入 `shim_player_selection_or_tty`，视为恢复失败，不允许
   把它当作同名新游戏；退出该 session，并把步骤 1 的 bytes 写回原路径后
   flush。
5. session 核心退出后，等待 storage queue 的 `flush()` 完成，再报告清理
   完成并回到首页。

阶段二不提供删除按钮，避免在格式与恢复路径刚落地时扩大破坏性操作面。

## 8. 阶段三导入导出建议

阶段三建议采用 BlissHack 容器，而不是裸 save bytes。容器包含：

- schema version；
- NetHack 版本与完整 save header 指纹；
- BlissHack build ID；
- 原始文件名和经过解析的角色字段；
- payload 长度；
- payload 的 SHA-256；
- 原始 save bytes。

导入目标名由已验证 header 中的角色名重新计算，不信任外部文件名。冲突只提供
取消或显式替换；替换使用 `.tmp` 和 `.bak`，成功 flush 后才删除备份。

建议限制：

- 单个原始 save 最大 32 MiB；
- 单个导入容器最大 40 MiB；
- 本版本一次只导入一个 save。

这两个上限远高于正常存档，同时能限制内存复制和恶意输入。sidecar index 暂不
需要；若未来为大量存档优化列表，真实文件仍是事实来源，index 只能重建。

## 9. 待确认决策

建议确认以下组合后进入实现：

1. 阶段二使用严格 header 解析，只展示第 5 节字段。
2. 阶段二不提供删除、导入和导出；这些留到阶段三。
3. `booting` 阶段预加载但不运行一个候选 WASM module，用于首页 IDBFS 枚举。
4. 阶段三采用带 manifest 和 SHA-256 的 BlissHack 容器，限制为
   32 MiB 原始 save、40 MiB 容器。

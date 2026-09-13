# alpha-1 Profile Schema v2

## 1. 变更目的

alpha-1 在 Interface 设置中增加地图 renderer：

```json
{
  "schemaVersion": 2,
  "interface": {
    "mapRenderer": "tiles"
  }
}
```

允许值只有 `tiles` 和 `ascii`。新 profile 默认 Tiles，切换立即作用于当前
React 地图，不重启 WASM 或新建 session。

## 2. 存储和迁移

当前持久 key：

```text
blisshack.profile.v2
```

兼容读取 key：

```text
blisshack.profile.v1
```

读取顺序为 v2 优先；只有 v2 不存在时才读取 v1。v1 文档继续执行严格字段
校验，迁移后在内存中变成 v2，并设置 `mapRenderer: "ascii"`，避免升级后强制
改变原有玩家界面。读取本身不静默写回；玩家下次 Apply、Import 或 Restore
Defaults 时才写入 v2。

`migrateProfileDocument()` 是 profile 文档的统一入口。它先只读取并验证
`schemaVersion`，再通过显式 migrator registry 分派：

```text
v1 -> 严格验证 v1 -> 增加 mapRenderer: "ascii" -> v2
v2 -> 严格验证 v2 -> 返回 detached 当前对象
```

未知 schema 在读取其他字段前拒绝。`validateProfile()` 保留为稳定 façade，
storage、profile import 和 backup restore 因此继续共享同一套严格验证与迁移
语义。当前没有 schema v3，也没有反射式通用迁移框架。

Clear Local Data 同时删除 v2 和 v1 key，且不影响无关 localStorage 数据。

## 3. 导入导出

- 新导出统一使用 schema v2。
- v1 和 v2 `.bhprofile` 都可导入。
- v1 导入在预览前迁移为 v2 + ASCII。
- v2 缺失 `mapRenderer`、v1 多出 `mapRenderer`、未知字段或非法枚举均拒绝。
- 导入 diff 使用 `Map display: Tiles/ASCII` 的玩家可见标签。

## 4. 完整备份

`.bhbackup` 外层格式仍为：

```json
{
  "format": "blisshack-backup",
  "schemaVersion": 1
}
```

外层版本没有改变，因为 save bytes、checksum 和容器结构未变。新备份内嵌
profile v2；旧备份中的严格 profile v1 在预览时迁移为 v2 + ASCII。恢复 profile
和恢复 saves 仍是两个显式步骤。

## 5. 故障边界

Tiles 资源或 Canvas 失败只触发当前 session 的显示回退，不写入 profile，也不
把保存偏好改为 ASCII。下次页面加载仍按玩家保存的 `mapRenderer` 尝试。

## 6. 测试契约

- 默认 profile 是 v2 + Tiles。
- v1 存储、profile 导入和 backup 导入迁移为 v2 + ASCII。
- v2 round-trip 保留 renderer。
- v2 验证结果不复用输入的嵌套对象。
- 未知 schema 在访问 interface 或 nethack 字段前失败。
- v2 key 优先于遗留 v1 key。
- profile 导出、跨页面冲突检测和 Clear Local Data 使用 v2 key。
- backup 外层 schema 保持 v1。

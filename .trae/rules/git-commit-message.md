---
alwaysApply: true
scene: git_message
---

# Git Commit Message Style Guide

## 格式
```
<type>(<scope>): <subject>
<BLANK LINE>
<body>
<BLANK LINE>
<footer>
```

## 规范
- **type**：必须为以下之一  
  `feat`（新功能）、`fix`（修复）、`docs`（文档）、`style`（格式）、`refactor`（重构）、`perf`（性能）、`test`（测试）、`chore`（构建/工具）、`ci`（CI）、`revert`（回退）
- **scope**（可选）：影响的模块或文件，如 `auth`、`api`、`ui`
- **subject**：简短描述，**不超过 50 字符**，使用**现在时**，首字母小写，末尾不加句号
- **body**（可选）：详细描述，说明**为什么改**和**怎么改**，每行不超过 72 字符
- **footer**（可选）：关闭 issue（如 `Closes #123`）或注明 Breaking Changes

## 语言
- 使用英文。
- 保持术语一致（如“用户认证” vs “user authentication”）。

## 示例
```
feat(auth): 添加 OAuth2 登录支持

实现 Google 和 GitHub 第三方登录，使用 JWT 管理会话。
Closes #42
```
```
fix(api): 修复用户列表分页偏移量错误

当 page=2 时，之前返回了第 3 页的数据，现修正 limit/offset 计算。
```
```
docs(readme): 更新部署步骤

补充环境变量配置说明。
```

## 禁止
- 不要使用 `-m` 多行合并，必须分开 body。
- 不要写无意义的 subject，如 `update`、`fix bug`。
- 禁止包含表情符号或特殊字符。

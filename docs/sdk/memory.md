---
title: 记忆系统
description: AGENTS.md 分层记忆、自动记忆提取，以及 MEMORY.md 索引的容量上限与写入提醒
---

# 记忆系统 {#memory-system}

## AGENTS.md 文件 {#agents-md}

Wave 使用 `AGENTS.md` 文件作为持久化的项目级和用户级指令，帮助 AI 在不同会话间保持一致的行为和上下文：

- **项目级**：`[project-root]/AGENTS.md`，存放在项目根目录，随代码库共享给所有协作者
- **子目录级**：子目录下的 `AGENTS.md`（如 `packages/api/AGENTS.md`），在 AI 读取该目录下的文件时按需注入——按「项目根方向 → 文件所在目录」逐层带上，项目根自身那份仍按「项目级」常驻、不重复注入；同目录下同时存在 `AGENTS.md` 与 `CLAUDE.md` 时只取前者
- **用户级**：`~/.wave/AGENTS.md`，存放在用户全局目录，跨所有项目生效
- 内容在每次会话加载时自动注入系统提示词，确保 AI 始终遵循这些指令
- 与自动记忆系统互补：AGENTS.md 侧重长期稳定的项目指南和约定，自动记忆侧重会话过程中动态积累的项目洞察
- 自动记忆提取时会避免与 AGENTS.md 内容产生重复

## 自动记忆系统 (Auto Memory) {#auto-memory}

Wave 在后台自动维护项目记忆，帮助 AI 持续了解项目演变：

- 每 N 轮对话触发一次记忆提取（`autoMemoryFrequency` 配置，默认每 1 轮）
- 使用 `general-purpose` 子代理在后台异步执行，不影响主对话
- 自动检测 AI 是否已手动更新记忆目录下的文件，若有则跳过避免重复
- 提取代理仅允许写入记忆目录，使用快速模型，最多 5 轮，越权写入自动拒绝
- 支持 `autoMemoryEnabled` 开关（默认开启）
- 记忆文件存储在 `~/.wave/projects/{项目编码}/memory/` 目录，确保 git worktree 间共享同一记忆

### 索引与容量上限 {#memory-index-limits}

`~/.wave/projects/{项目编码}/memory/MEMORY.md` 是记忆的**索引**（每条一行、指向一个主题文件），它的前 200 行会随系统提示词一起加载：

- **索引双上限**：超过 200 行或超过 25,000 字符即截断（先按行、再按字符并在换行处切分，不会切断一行）；截断时会明确点名丢弃了多少行、从第几行起，并回显首条被丢弃内容，避免条目静默消失
- **单行建议**：索引行应短于约 150 字符，细节放到主题文件里
- **写入侧闸门**：通过 Write / Edit 写 `MEMORY.md` 时不拦写入，但占用率（行数 / 字符数取较大者）达 80% 会提醒压缩、超过 100% 会明确报错——此时超出部分每次加载都被静默丢弃、末尾条目已不可见，需要立即重写
- **主题文件上限**：每个主题文件 4,096 字节 / 200 行（同样按较大者算），超限给同样的提醒
- **索引自动回填**：索引不存在而主题文件已存在时，按各文件 frontmatter 的 `description` 机械生成整份索引；`description` 缺失会提示补上（它是索引行唯一的摘要来源）

## 记忆规则 (Memory Rules) {#memory-rules}

记忆规则提供上下文特定的行为指南，确保 AI 在不同场景下遵循预期模式：

- 存放在 `.wave/rules/` 目录下的多个独立 `.md` 文件（项目级）和 `~/.wave/rules/`（用户级）
- 支持子目录递归扫描和符号链接跟随
- 每个文件是一个独立规则，支持 YAML frontmatter：
  - `paths`：glob 模式数组，仅当相关文件在上下文中时规则才激活（空则始终激活）
  - `priority`：优先级数字，控制冲突时的覆盖顺序
- 项目规则可覆盖用户规则

```typescript
// 获取当前激活的规则
const projectRules = agent.getAllowedRules();
const userRules = agent.getUserAllowedRules();
```

## 记忆 API {#memory-api}

```typescript
// 获取项目级记忆
const projectMemory = agent.projectMemory;

// 获取用户级记忆
const userMemory = agent.userMemory;

// 获取合并后的记忆
const combined = await agent.getCombinedMemory();
```

## 消息压缩 (Compact) {#compact}

Wave 采用多层压缩机制管理对话历史，确保在长对话中不超出模型 token 限制：

**自动压缩 (Auto-Compact)**

- 每次 AI 响应后监控 token 使用量（`latestTotalTokens` 为 `total_tokens`，不含 cache 读取/写入 tokens——与压缩判断口径一致，避免缓存命中双重计数导致 UI 显示虚高）
- 当总 token 数超过 `getMaxInputTokens()` 时，自动触发压缩流程
- 使用快速模型（fastModel）生成对话摘要，`max_tokens: 8192`，`temperature: 0.1`
- 压缩前从消息中剥离图片以降低 token 消耗
- 按 API round 边界分组消息，保留最后 2 个 API round，避免拆分 tool_use/tool_result 对
- 被压缩的消息替换为 `compress` 块（类型为 `compress`，内容为摘要文本）
- `compress` 块在发送 API 请求时转换为 user 角色消息
- 压缩后创建新会话，通过 `parentSessionId` 链接到旧会话，保持历史可追溯
- 递归压缩时，旧摘要连同整个历史被新摘要替换

**熔断机制 (Circuit Breaker)**

- 跟踪连续压缩失败次数
- 连续 3 次失败后跳过压缩并记录警告，避免在损坏的上下文中浪费 API 调用
- 压缩成功后失败计数器重置为 0

**压缩后上下文恢复 (Post-Compact Context Restoration)**

- 最近读取的文件：最多 5 个文件，每个 5000 tokens
- 当前工作目录路径
- 计划模式状态及计划文件路径
- 已调用的 Skill 列表（名称和描述，总预算 25k tokens，单个 5k）
- 后台子代理的描述和运行状态
- 上述内容以 `[Context Restoration]` 章节追加到摘要末尾

**摘要格式**
AI 生成的摘要包含 9 个结构化章节：Primary Request and Intent、Key Technical Concepts、Files and Code Sections、Errors and Fixes、Problem Solving、All User Messages、Pending Tasks、Current Work、Optional Next Step。

**手动压缩**

```typescript
// 手动触发压缩（可附带自定义指令）
await agent.compact("重点关注认证模块的修改");
```

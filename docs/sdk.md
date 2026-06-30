# Agent SDK

核心 Node.js SDK，负责 AI 模型集成、工具系统、记忆管理与会话持久化。

## 1. 快速开始 {#quick-start}

### 安装 {#install}

```bash
npm install wave-agent-sdk
```

### 核心能力 {#capabilities}

- **AI 模型集成** — 支持 OpenAI 兼容格式，可配置多模型（主模型 + 快速模型）
- **工具系统** — 内置 Bash、Read、Write、Edit、Glob、Grep、LSP 等工具，支持自定义工具注册
- **记忆管理** — AGENTS.md 项目记忆 + 自动记忆系统 + 记忆规则
- **会话持久化** — JSONL 格式会话存储，支持恢复与回滚
- **子代理系统** — 支持 Bash、Explore、Plan 等专用子代理
- **Skill 技能系统** — 可扩展的斜杠命令与技能插件
- **MCP 协议** — Model Context Protocol 集成
- **插件系统** — 官方插件市场 + 自定义插件支持
- **OpenTelemetry** — 内置遥测支持

### 基本用法 {#basic-usage}

```typescript
import { Agent } from 'wave-agent-sdk';

// 创建 Agent
const agent = await Agent.create({
  model: 'gpt-4',
  apiKey: process.env.WAVE_API_KEY,
  baseURL: 'https://api.example.com/v1',
  callbacks: {
    onAssistantContentUpdated: ({ chunk }) => {
      process.stdout.write(chunk);
    },
  },
});

// 发送消息
await agent.sendMessage('帮我写一个排序算法');

// 销毁 Agent（清理资源）
await agent.destroy();
```

### 开发 {#development}

```bash
# 构建
pnpm -F wave-agent-sdk build

# 运行测试
pnpm -F wave-agent-sdk test

# 类型检查
pnpm -F wave-agent-sdk run type-check
```

## 2. Agent 生命周期 {#agent-lifecycle}

### 创建 Agent {#agent-create}

使用 `Agent.create()` 静态工厂方法创建 Agent 实例。该方法为异步方法，完成初始化后返回配置好的 Agent。

```typescript
const agent = await Agent.create({
  model: 'gpt-4',
  apiKey: 'your-api-key',
  baseURL: 'https://api.example.com/v1',
  workdir: '/path/to/project',
  callbacks: { /* ... */ },
});
```

### 配置选项 (AgentOptions) {#agent-options}

#### 模型与 API

| 选项 | 类型 | 说明 |
|------|------|------|
| `model` | `string` | 主模型名称（也可通过 `WAVE_MODEL` 环境变量设置） |
| `fastModel` | `string` | 快速模型，用于子代理、摘要等轻量场景（fallback: `WAVE_FAST_MODEL`） |
| `apiKey` | `string` | API Key（fallback: `WAVE_API_KEY`） |
| `baseURL` | `string` | API Base URL（fallback: `WAVE_BASE_URL`） |
| `serverUrl` | `string` | Wave AI 服务端地址，用于 SSO 认证（fallback: `WAVE_SERVER_URL`） |
| `defaultHeaders` | `Record<string, string>` | 自定义请求头 |
| `subagentHeaders` | `Record<string, Record<string, string>>` | 按子代理类型设置的请求头 |
| `fetchOptions` | `ClientOptions["fetchOptions"]` | fetch 选项 |
| `fetch` | `ClientOptions["fetch"]` | 自定义 fetch 实现 |
| `maxInputTokens` | `number` | 最大输入 Token 数（fallback: `WAVE_MAX_INPUT_TOKENS`） |
| `maxTokens` | `number` | 最大输出 Token 数（fallback: `WAVE_MAX_OUTPUT_TOKENS`） |
| `language` | `string` | Agent 通信首选语言（如 `"zh"`、`"en"`） |

#### 会话与工作目录

| 选项 | 类型 | 说明 |
|------|------|------|
| `workdir` | `string` | 工作目录（默认 `process.cwd()`） |
| `restoreSessionId` | `string` | 恢复指定会话 |
| `continueLastSession` | `boolean` | 继续上一次会话 |
| `messages` | `Message[]` | 初始消息（主要用于测试） |
| `systemPrompt` | `string` | 自定义系统提示词（替换默认提示词） |

#### 权限与工具

| 选项 | 类型 | 说明 |
|------|------|------|
| `permissionMode` | `PermissionMode` | 权限模式（默认 `"default"`） |
| `canUseTool` | `PermissionCallback` | 自定义权限回调 |
| `allowedTools` | `string[]` | 始终允许的工具列表 |
| `disallowedTools` | `string[]` | 始终禁止的工具列表 |
| `tools` | `string[]` | 启用的工具列表（`undefined` = 全部，`[]` = 禁用全部） |
| `customTools` | `ToolPlugin[]` | 自定义工具注册 |
| `hooks` | `PartialHookConfiguration` | 创建时注入的钩子配置 |

#### 扩展与集成

| 选项 | 类型 | 说明 |
|------|------|------|
| `plugins` | `PluginConfig[]` | 本地插件配置 |
| `mcpServers` | `Record<string, McpServerConfig>` | MCP 服务器配置（覆盖 .mcp.json） |
| `lspManager` | `ILspManager` | 自定义 LSP 管理器 |
| `worktreeName` | `string` | worktree 名称 |
| `isNewWorktree` | `boolean` | 是否为新创建的 worktree |
| `watchSkills` | `boolean` | 是否监听 Skill 文件变化（默认 `true`） |

#### 回调与日志

| 选项 | 类型 | 说明 |
|------|------|------|
| `callbacks` | `AgentCallbacks` | 事件回调集合 |
| `stream` | `boolean` | 是否使用流式模式（默认 `true`） |
| `logger` | `Logger` | 自定义日志器 |

### 销毁 Agent {#agent-destroy}

`destroy()` 方法执行完整的清理流程：中止正在进行的 AI 响应、停止所有后台任务和子代理、关闭 MCP 连接、停止文件监听、刷新遥测数据。

```typescript
await agent.destroy();
```

### Agent 属性 {#agent-properties}

| 属性 | 类型 | 说明 |
|------|------|------|
| `sessionId` | `string` | 当前会话 ID |
| `messages` | `Message[]` | 当前会话消息列表 |
| `usages` | `Usage[]` | Token 使用记录 |
| `sessionFilePath` | `string` | 会话文件路径 |
| `latestTotalTokens` | `number` | 最近一次总 Token 数 |
| `workingDirectory` | `string` | 当前工作目录 |
| `projectMemory` | `string` | 项目级记忆内容 |
| `userMemory` | `string` | 用户级记忆内容 |
| `isLoading` | `boolean` | 是否正在处理请求 |
| `isCompacting` | `boolean` | 是否正在压缩 |
| `isCommandRunning` | `boolean` | 是否有命令正在执行 |
| `queuedMessages` | `QueuedMessage[]` | 消息队列 |
| `goalStatus` | `string` | 目标状态 |
| `isGoalActive` | `boolean` | 是否有活跃目标 |
| `taskListId` | `string` | 任务列表 ID |
| `hasRunningBackgroundWork` | `boolean` | 是否有后台任务运行中 |

### Agent 常用方法 {#agent-methods}

| 方法 | 说明 |
|------|------|
| `sendMessage(content)` | 发送用户消息 |
| `destroy()` | 销毁 Agent 并清理资源 |
| `abortAIMessage()` | 中止当前 AI 响应 |
| `abortMessage()` | 中止当前消息处理 |
| `abortBashCommand()` | 中止正在执行的 Bash 命令 |
| `abortSlashCommand()` | 中止正在执行的斜杠命令 |
| `clearMessages()` | 清空消息（触发 SessionEnd/SessionStart 钩子） |
| `compact(instructions?)` | 手动触发上下文压缩 |
| `setModel(model)` | 切换模型 |
| `setWorkdir(dir)` | 切换工作目录 |
| `restoreSession(sessionId)` | 恢复到指定会话 |
| `truncateHistory(index)` | 截断历史到指定位置 |
| `getFullMessageThread()` | 获取完整消息链（含压缩前的父会话） |

## 3. 消息处理 {#messaging}

### 发送消息 {#send-message}

```typescript
await agent.sendMessage('帮我重构这个模块');
```

消息进入队列后，Agent 自动处理：解析消息类型、调用 AI 模型、执行工具调用、流式输出结果。如果 Agent 正在处理其他消息，新消息会排入队列等待。

### 消息队列 {#message-queue}

Agent 内置消息队列管理并发消息：

- 消息按入队顺序依次处理
- 支持通过 `queuedMessages` 属性查看队列
- `removeQueuedMessage(index)` — 按索引移除队列中的消息
- `removeQueuedMessageById(id)` — 按 ID 移除队列中的消息
- `recallQueuedMessage()` — 召回最近移除的消息（用于 UP 箭头回忆）

### 消息类型 {#message-types}

Agent 支持多种消息块类型，通过回调通知 UI 层：

| 类型 | 回调 | 说明 |
|------|------|------|
| 文本内容 | `onAssistantContentUpdated` | AI 文本流式输出，含 `chunk`、`accumulated`、`stage` |
| 推理内容 | `onAssistantReasoningUpdated` | 推理/思考过程流式输出 |
| 工具调用 | `onToolBlockUpdated` | 工具执行状态更新 |
| 压缩摘要 | `onCompactBlockAdded` | 上下文压缩后生成的摘要 |
| 错误信息 | `onErrorBlockAdded` | 错误消息 |
| Bang 命令 | `onAddBangMessage` / `onUpdateBangMessage` / `onCompleteBangMessage` | Shell 命令执行（`!command` 语法） |
| 任务通知 | `onBackgroundTasksChange` | 后台任务状态变更 |

### 流式输出 {#streaming}

默认启用流式模式（`stream: true`），AI 响应通过回调实时推送：

```typescript
callbacks: {
  // 文本流式输出
  onAssistantContentUpdated: ({ messageId, chunk, accumulated, stage }) => {
    // stage: "streaming" | "end"
    process.stdout.write(chunk);
  },
  // 推理过程流式输出
  onAssistantReasoningUpdated: ({ messageId, chunk, accumulated, stage }) => {
    // 推理内容（thinking/reasoning）
  },
}
```

## 4. 回调系统 {#callbacks}

### AgentCallbacks 接口 {#agent-callbacks-interface}

`AgentCallbacks` 继承了 `MessageManagerCallbacks`、`BackgroundTaskManagerCallbacks`、`McpManagerCallbacks` 和 `SubagentManagerCallbacks`，提供全面的事件通知。

### 消息回调 {#callbacks-messaging}

| 回调 | 参数 | 说明 |
|------|------|------|
| `onMessagesChange` | `Message[]` | 消息列表完整更新 |
| `onSessionIdChange` | `string` | 会话 ID 变更（如压缩后创建新会话） |
| `onLatestTotalTokensChange` | `number` | Token 总量更新 |
| `onUsagesChange` | `Usage[]` | Token 使用记录更新 |
| `onUserMessageAdded` | `UserMessageParams` | 用户消息添加 |
| `onAssistantMessageAdded` | `messageId: string` | AI 消息创建 |
| `onAssistantContentUpdated` | `{ messageId, chunk, accumulated, stage }` | 文本流式输出 |
| `onAssistantReasoningUpdated` | `{ messageId, chunk, accumulated, stage }` | 推理流式输出 |
| `onToolBlockUpdated` | `ToolBlockUpdateCallbackParams` | 工具块更新 |
| `onErrorBlockAdded` | `error: string` | 错误块添加 |
| `onCompactBlockAdded` | `content: string` | 压缩摘要添加 |
| `onCompactionStateChange` | `isCompacting: boolean` | 压缩状态变更 |

### Bang 命令回调 {#callbacks-bang}

| 回调 | 参数 | 说明 |
|------|------|------|
| `onAddBangMessage` | `command: string` | Bang 命令开始执行 |
| `onUpdateBangMessage` | `command, output` | Bang 命令输出更新 |
| `onCompleteBangMessage` | `command, exitCode` | Bang 命令执行完成 |

### 后台任务回调 {#callbacks-background}

| 回调 | 参数 | 说明 |
|------|------|------|
| `onBackgroundTasksChange` | `BackgroundTask[]` | 后台任务列表变更 |
| `onBackgroundCurrentTask` | — | 后台当前任务变更 |

### 子代理回调 {#callbacks-subagent}

| 回调 | 参数 | 说明 |
|------|------|------|
| `onSubagentUserMessageAdded` | `subagentId, params` | 子代理收到用户消息 |
| `onSubagentAssistantMessageAdded` | `subagentId, messageId` | 子代理创建 AI 消息 |
| `onSubagentAssistantContentUpdated` | `{ subagentId, messageId, chunk, accumulated, stage }` | 子代理流式输出 |
| `onSubagentLatestTotalTokensChange` | `subagentId, tokens` | 子代理 Token 更新 |

### MCP 回调 {#callbacks-mcp}

| 回调 | 参数 | 说明 |
|------|------|------|
| `onMcpServersChange` | `McpServerStatus[]` | MCP 服务器状态变更 |

### UI 状态回调 {#callbacks-ui}

| 回调 | 参数 | 说明 |
|------|------|------|
| `onPermissionModeChange` | `PermissionMode` | 权限模式变更 |
| `onModelChange` | `string` | 模型切换 |
| `onConfiguredModelsChange` | `string[]` | 可用模型列表变更 |
| `onLoadingChange` | `boolean` | 加载状态变更 |
| `onCommandRunningChange` | `boolean` | 命令执行状态变更 |
| `onWorkdirChange` | `string` | 工作目录变更 |
| `onQueuedMessagesChange` | `QueuedMessage[]` | 消息队列变更 |
| `onTasksChange` | `Task[]` | 任务列表变更 |
| `onGoalStateChange` | `active, condition?, elapsed?` | 目标状态变更 |
| `onGoalEvaluating` | `evaluating: boolean` | 目标评估状态 |

## 5. 工具系统 {#tool-system}

### 内置工具清单 {#builtin-tools}

Wave 提供 25 个内置工具，涵盖代码探索、文件操作、任务管理、网页抓取和定时任务等能力。

#### 文件操作

| 工具 | 说明 |
|------|------|
| `Read` | 读取文件内容，支持图片读取和二进制检测 |
| `Write` | 写入文件（已存在文件需先 Read） |
| `Edit` | 精确字符串替换，支持 `replace_all` 批量替换 |

#### 代码搜索与智能

| 工具 | 说明 |
|------|------|
| `Glob` | 文件名模式匹配（如 `**/*.ts`） |
| `Grep` | 正则表达式内容搜索（基于 ripgrep） |
| `LSP` | 代码智能（跳转定义、查找引用、悬停信息、符号搜索等） |

#### 执行与交互

| 工具 | 说明 |
|------|------|
| `Bash` | 终端命令执行，支持后台运行和超时控制 |
| `AskUserQuestion` | 向用户提问，支持单选/多选选项 |
| `WebFetch` | 网页内容抓取与 AI 摘要 |

#### 任务管理

| 工具 | 说明 |
|------|------|
| `TaskCreate` | 创建任务（subject、description、activeForm） |
| `TaskGet` | 获取任务详情 |
| `TaskUpdate` | 更新任务状态和属性 |
| `TaskList` | 列出所有任务 |
| `TaskStop` | 中止后台任务 |

#### 定时任务

| 工具 | 说明 |
|------|------|
| `CronCreate` | 创建定时任务（5 字段 cron 表达式） |
| `CronDelete` | 删除定时任务 |
| `CronList` | 列出所有定时任务 |

#### 工作区与流程

| 工具 | 说明 |
|------|------|
| `EnterWorktree` | 创建 Git worktree 隔离工作区 |
| `ExitWorktree` | 退出 worktree（keep/remove） |
| `EnterPlanMode` | 进入计划模式 |
| `ExitPlanMode` | 退出计划模式 |
| `Skill` | 调用 Skill 技能 |
| `Agent` | 创建子代理 |
| `Workflow` | 运行工作流脚本 |

### 工具详情 {#tool-details}

#### Bash — 终端命令执行 {#tool-bash}

| 参数 | 类型 | 说明 |
|------|------|------|
| `command` | string | 必需，要执行的命令 |
| `timeout` | number | 超时时间（秒） |
| `description` | string | 命令描述 |
| `run_in_background` | boolean | 是否后台执行 |

执行后显示 `shortResult`（输出最后 3 行摘要）。后台执行时返回任务 ID，可通过任务通知查看结果。

#### Read — 读取文件 {#tool-read}

| 参数 | 类型 | 说明 |
|------|------|------|
| `file_path` | string | 必需，文件路径 |
| `offset` | number | 起始行号（默认 1） |
| `limit` | number | 最大读取行数（默认 2000） |

支持图片读取（PNG/JPEG/GIF/WebP），自动检测二进制文档（PDF/DOCX 等返回错误提示）。对未变更的文件返回 "File unchanged" 避免重复内容。

#### Edit — 精确字符串替换 {#tool-edit}

| 参数 | 类型 | 说明 |
|------|------|------|
| `file_path` | string | 必需，文件路径 |
| `old_string` | string | 必需，要替换的原文 |
| `new_string` | string | 必需，替换后的新文 |
| `replace_all` | boolean | 是否批量替换所有匹配项 |

非 `replace_all` 时若 `old_string` 在文件中出现多次则报错，提示提供更多上下文。

#### Write — 写入文件 {#tool-write}

| 参数 | 类型 | 说明 |
|------|------|------|
| `file_path` | string | 必需，文件路径 |
| `content` | string | 必需，写入内容 |

写入已存在文件前必须先 Read 确认当前内容；自动创建不存在的父目录。

#### Glob — 文件名模式匹配 {#tool-glob}

| 参数 | 类型 | 说明 |
|------|------|------|
| `pattern` | string | 必需，glob 模式（如 `**/*.ts`） |
| `path` | string | 搜索根目录 |
| `limit` | number | 最大返回数量（默认 100） |

#### Grep — 文本内容搜索 {#tool-grep}

| 参数 | 类型 | 说明 |
|------|------|------|
| `pattern` | string | 必需，正则表达式 |
| `path` | string | 搜索目录 |
| `glob` | string | 文件过滤模式（如 `*.ts`） |
| `type` | string | 文件类型（如 `ts`、`py`） |
| `output_mode` | string | `content`、`files_with_matches`、`count` |
| `-A/-B/-C` | number | 匹配后/前/前后上下文行数 |
| `-i` | boolean | 大小写无关搜索 |
| `head_limit` | number | 限制输出行数 |
| `multiline` | boolean | 多行匹配模式 |

#### LSP — 代码智能 {#tool-lsp}

支持操作：`goToDefinition`、`findReferences`、`hover`、`documentSymbol`、`workspaceSymbol`、`goToImplementation`、`prepareCallHierarchy`、`incomingCalls`、`outgoingCalls`。

#### AskUserQuestion — 交互式提问 {#tool-askuser}

| 参数 | 类型 | 说明 |
|------|------|------|
| `questions` | array | 必需，问题列表 |
| `questions[].question` | string | 问题内容 |
| `questions[].header` | string | 简短标签（最多 12 字符） |
| `questions[].options` | array | 选项列表（2-4 个），每项含 `label` 和可选 `description` |
| `questions[].multiSelect` | boolean | 是否允许多选 |

#### WebFetch — 网页内容抓取 {#tool-webfetch}

| 参数 | 类型 | 说明 |
|------|------|------|
| `url` | string | 必需，要抓取的 URL |
| `prompt` | string | 必需，对抓取内容的处理指令 |

内置 15 分钟 LRU 缓存（最大 50MB），自动将 HTTP 升级到 HTTPS，HTML 自动转 Markdown，使用快速模型处理摘要。内容上限 100K 字符。GitHub URL 提示使用 `gh` CLI。

#### EnterWorktree / ExitWorktree — Git Worktree 隔离 {#tool-worktree}

**EnterWorktree**：在 `.wave/worktrees/` 下创建独立分支工作区。要求当前在 git 仓库且不在已有 worktree 中。

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | string | worktree 名称（可选，自动生成） |

**ExitWorktree**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `keep` | boolean | 是否保留 worktree（默认 false） |
| `discard_changes` | boolean | 是否丢弃未提交更改 |

#### CronCreate / CronDelete / CronList — 定时任务 {#tool-cron}

**CronCreate**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `cron` | string | 必需，5 字段 cron 表达式（本地时区） |
| `prompt` | string | 必需，要执行的内容 |
| `recurring` | boolean | 是否循环（默认 true） |

**CronDelete**：`id` — 任务 ID。**CronList**：无参数。

限制：最多 50 个任务，循环任务 7 天自动过期。

#### TaskCreate / TaskGet / TaskUpdate / TaskList — 任务管理 {#tool-task}

**TaskCreate**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `subject` | string | 必需，任务主题 |
| `description` | string | 任务描述 |
| `activeForm` | string | 进行中的动词形式（如 "正在编写测试"） |

**TaskUpdate**：`id`（必需）、`subject`、`description`、`status`（`pending` -> `in_progress` -> `completed` -> `deleted`）、`blocks`/`blockedBy`。

**TaskList**：无参数，返回所有任务摘要。**TaskGet**：`id` — 获取单个任务详情。

### 自定义工具 (ToolPlugin) {#custom-tools}

通过 `customTools` 选项注册自定义工具，与内置工具并行可用：

```typescript
import { Agent, buildTool } from 'wave-agent-sdk';

const myTool = buildTool({
  name: 'MyTool',
  description: '我的自定义工具',
  parameters: {
    query: { type: 'string', description: '搜索查询' },
  },
  execute: async ({ query }, context) => {
    return { content: `结果: ${query}` };
  },
});

const agent = await Agent.create({
  customTools: [myTool],
  // ...
});
```

`ToolPlugin` 接口：

```typescript
interface ToolPlugin {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: any, context: ToolContext) => Promise<ToolResult>;
}
```

### 权限管理 {#permissions}

Agent 支持细粒度的工具权限控制：

**权限模式 (PermissionMode)**：

| 模式 | 说明 |
|------|------|
| `default` | 危险操作需用户确认 |
| `plan` | 计划模式，限制写入操作 |
| `acceptEdits` | 自动接受文件编辑 |

**权限 API**：

```typescript
// 获取/设置权限模式
agent.getPermissionMode();
agent.setPermissionMode('acceptEdits');

// 检查工具权限
await agent.checkPermission('Bash', { command: 'rm -rf /tmp/test' });

// 添加权限规则
await agent.addPermissionRule('Bash(npm *)');

// 获取可用工具列表
agent.getAvailableToolNames();
```

**创建时配置**：

```typescript
const agent = await Agent.create({
  permissionMode: 'default',
  allowedTools: ['Read', 'Glob', 'Grep'],
  disallowedTools: ['Bash(rm *)'],
  canUseTool: async (toolName, params) => {
    // 自定义权限判断逻辑
    return { allowed: true };
  },
});
```

### 工具名常量 {#tool-name-constants}

SDK 导出所有工具名常量，避免硬编码：

```typescript
import {
  BASH_TOOL_NAME,           // "Bash"
  READ_TOOL_NAME,           // "Read"
  WRITE_TOOL_NAME,          // "Write"
  EDIT_TOOL_NAME,           // "Edit"
  GLOB_TOOL_NAME,           // "Glob"
  GREP_TOOL_NAME,           // "Grep"
  LSP_TOOL_NAME,            // "LSP"
  WEB_FETCH_TOOL_NAME,      // "WebFetch"
  ASK_USER_QUESTION_TOOL_NAME, // "AskUserQuestion"
  TASK_CREATE_TOOL_NAME,    // "TaskCreate"
  TASK_GET_TOOL_NAME,       // "TaskGet"
  TASK_UPDATE_TOOL_NAME,    // "TaskUpdate"
  TASK_LIST_TOOL_NAME,      // "TaskList"
  TASK_STOP_TOOL_NAME,      // "TaskStop"
  CRON_CREATE_TOOL_NAME,    // "CronCreate"
  CRON_DELETE_TOOL_NAME,    // "CronDelete"
  CRON_LIST_TOOL_NAME,      // "CronList"
  ENTER_WORKTREE_TOOL_NAME, // "EnterWorktree"
  EXIT_WORKTREE_TOOL_NAME,  // "ExitWorktree"
  ENTER_PLAN_MODE_TOOL_NAME, // "EnterPlanMode"
  EXIT_PLAN_MODE_TOOL_NAME, // "ExitPlanMode"
  SKILL_TOOL_NAME,          // "Skill"
  AGENT_TOOL_NAME,          // "Agent"
  WORKFLOW_TOOL_NAME,       // "Workflow"
} from 'wave-agent-sdk';
```

## 6. 会话管理 {#session-management}

### 创建会话 {#session-create}

Agent 创建时自动开始新会话，每个会话有唯一 ID：

```typescript
const agent = await Agent.create({ workdir: '/path/to/project' });
console.log(agent.sessionId); // 自动生成的会话 ID
```

### 恢复会话 {#session-restore}

两种方式恢复历史会话：

```typescript
// 方式 1：通过 restoreSessionId 恢复指定会话
const agent = await Agent.create({
  restoreSessionId: 'session-id-to-restore',
  workdir: '/path/to/project',
});

// 方式 2：通过 continueLastSession 恢复最近会话
const agent = await Agent.create({
  continueLastSession: true,
  workdir: '/path/to/project',
});

// 方式 3：运行时恢复
await agent.restoreSession('another-session-id');
```

### 会话查询 API {#session-api}

SDK 提供独立的会话查询函数：

```typescript
import {
  listSessions,           // 列出所有会话
  listSessionsFromJsonl,    // 列出会话（JSONL 格式）
  loadSessionFromJsonl,     // 加载指定会话数据
  getLatestSessionFromJsonl, // 获取最近活跃会话
  getSessionFilePath,       // 获取会话文件路径
  deleteSession,            // 删除会话
} from 'wave-agent-sdk';

// 列出所有会话
const sessions = await listSessions('/path/to/project');
// 返回 SessionMetadata[]: { id, createdAt, lastActiveAt, messageCount, ... }

// 加载指定会话
const data = await loadSessionFromJsonl('session-id', '/path/to/project');
// 返回 SessionData: { messages, metadata, ... }
```

### 会话历史操作 {#session-history}

```typescript
// 截断历史到指定位置（用于回退/rewind）
await agent.truncateHistory(messageIndex);

// 获取完整消息链（含压缩前的父会话消息）
const thread = await agent.getFullMessageThread();
```

### 会话文件存储 {#session-storage}

会话以 JSONL 格式存储在 `~/.wave/sessions/` 目录下：

- 文件路径经过工作目录编码，确保不同项目隔离
- 每条消息为一行独立 JSON 记录
- 压缩后创建新会话，通过 `parentSessionId` 链接到旧会话，保持历史可追溯
- 子代理会话使用独立文件名（`subagent_` 前缀）

## 7. 插件系统 {#plugin-system}

### 插件配置 {#plugin-config}

通过 `AgentOptions.plugins` 加载本地插件：

```typescript
const agent = await Agent.create({
  plugins: [
    { path: '/path/to/my-plugin' },
  ],
});
```

通过 `settings.json` 的 `enabledPlugins` 启用已安装的插件。插件的 skill、hook、MCP 和 LSP 服务器可使用 `${WAVE_PLUGIN_ROOT}` 占位符引用其父插件目录。

### 插件管理 {#plugin-management}

SDK 通过 `PluginCore` 提供完整的插件管理能力：

- 插件安装与卸载
- 插件启用与禁用
- 插件自动更新
- Skill、Hook、MCP、LSP 资源自动注册

### Marketplace 集成 {#marketplace}

SDK 内置 Marketplace 服务，支持从远程 Git 仓库安装和管理插件。默认市场 `wave-plugins-official` 自动启用且支持自动更新。

## 8. MCP 集成 {#mcp-integration}

### 配置方式 {#mcp-config}

支持两种 MCP 服务器连接方式：

**本地进程（stdio）**：

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "..." }
    }
  }
}
```

**远程 HTTP/SSE**：

```json
{
  "mcpServers": {
    "remote-server": {
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

可通过 `AgentOptions.mcpServers` 在创建时注入，或通过 `settings.json` 配置。

### 管理 API {#mcp-api}

```typescript
// 获取所有 MCP 服务器状态
const servers = agent.getMcpServers();
// 返回 McpServerStatus[]

// 连接指定 MCP 服务器
await agent.connectMcpServer('github');

// 断开指定 MCP 服务器
await agent.disconnectMcpServer('github');
```

### 状态回调 {#mcp-callbacks}

```typescript
callbacks: {
  onMcpServersChange: (servers) => {
    // MCP 服务器状态变更时触发
    servers.forEach(s => console.log(s.name, s.status));
  },
}
```

## 9. 记忆系统 {#memory-system}

### AGENTS.md 文件 {#agents-md}

Wave 使用 `AGENTS.md` 文件作为持久化的项目级和用户级指令，帮助 AI 在不同会话间保持一致的行为和上下文：

- **项目级**：`[project-root]/AGENTS.md`，存放在项目根目录，随代码库共享给所有协作者
- **用户级**：`~/.wave/AGENTS.md`，存放在用户全局目录，跨所有项目生效
- 内容在每次会话加载时自动注入系统提示词，确保 AI 始终遵循这些指令
- 与自动记忆系统互补：AGENTS.md 侧重长期稳定的项目指南和约定，自动记忆侧重会话过程中动态积累的项目洞察
- 自动记忆提取时会避免与 AGENTS.md 内容产生重复

### 自动记忆系统 (Auto Memory) {#auto-memory}

Wave 在后台自动维护项目记忆，帮助 AI 持续了解项目演变：

- 每 N 轮对话触发一次记忆提取（`autoMemoryFrequency` 配置，默认每 1 轮）
- 使用 `general-purpose` 子代理在后台异步执行，不影响主对话
- 自动检测 AI 是否已手动更新 `.wave/memory/` 目录下的文件，若有则跳过避免重复
- 提取代理仅允许写入 `.wave/memory/` 目录，使用快速模型，最多 5 轮，越权写入自动拒绝
- 支持 `autoMemoryEnabled` 开关（默认开启）
- 记忆文件存储在 `~/.wave/projects/{项目编码}/memory/` 目录，确保 git worktree 间共享同一记忆

### 记忆规则 (Memory Rules) {#memory-rules}

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

### 记忆 API {#memory-api}

```typescript
// 获取项目级记忆
const projectMemory = agent.projectMemory;

// 获取用户级记忆
const userMemory = agent.userMemory;

// 获取合并后的记忆
const combined = await agent.getCombinedMemory();
```

### 消息压缩 (Compact) {#compact}

Wave 采用多层压缩机制管理对话历史，确保在长对话中不超出模型 token 限制：

**自动压缩 (Auto-Compact)**
- 每次 AI 响应后监控 token 使用量（含 cache 读取/写入 tokens）
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
await agent.compact('重点关注认证模块的修改');
```

## 10. 后台任务与工作流 {#background-tasks}

### 后台任务管理 {#background-task-management}

Agent 支持管理后台 Shell 任务和子代理任务：

```typescript
// 获取后台 Shell 输出
agent.getBackgroundShellOutput(taskId, { offset: 0, limit: 100 });

// 终止后台 Shell
agent.killBackgroundShell(taskId);

// 获取后台任务输出
agent.getBackgroundTaskOutput(taskId, { offset: 0, limit: 100 });

// 停止后台任务
agent.stopBackgroundTask(taskId);
```

### 工作流管理 {#workflow-management}

```typescript
// 获取所有工作流运行记录
const runs = await agent.getWorkflowRuns();

// 获取指定工作流运行记录
const run = agent.getWorkflowRun(runId);

// 停止工作流运行
agent.stopWorkflowRun(runId);
```

### 前台任务 {#foreground-tasks}

```typescript
// 注册前台任务
agent.registerForegroundTask(task);

// 注销前台任务
agent.unregisterForegroundTask(id);

// 获取后台当前任务
await agent.backgroundCurrentTask();
```

### 任务状态回调 {#task-callbacks}

```typescript
callbacks: {
  onBackgroundTasksChange: (tasks) => {
    // 后台任务列表变更
  },
  onTasksChange: (tasks) => {
    // 任务管理列表变更
  },
  onBackgroundCurrentTask: () => {
    // 后台当前任务变更
  },
}
```

## 11. 其他功能 {#other-features}

### 目标管理 (Goal) {#goal}

`/goal <condition>` 设置自主多轮目标追求，Agent 会持续执行直到条件满足或触发熔断。

```typescript
// 设置目标
await agent.setGoal('所有测试通过且无 lint 错误');

// 查看目标状态
await agent.showGoalStatus();

// 清除目标
await agent.clearGoal();
```

**熔断条件**：50 轮对话、30 分钟、3 次评估失败。

### 斜杠命令 {#slash-commands}

```typescript
// 获取所有已注册的斜杠命令
const commands = agent.getSlashCommands();

// 检查命令是否存在
agent.hasSlashCommand('compact');

// 注册自定义斜杠命令
agent.registerSlashCommand({
  id: 'my-command',
  name: 'my-command',
  description: '我的自定义命令',
  handler: async (args, context) => { /* ... */ },
});

// 重新加载自定义命令
await agent.reloadCustomCommands();

// 获取自定义命令
const cmd = agent.getCustomCommand('my-command');
const allCmds = agent.getCustomCommands();
```

### Bang 命令 {#bang}

直接执行 Shell 命令并将输出作为消息注入对话：

```typescript
await agent.bang('ls -la');
```

### SSO 认证 {#sso}

通过 `AuthService` 单例管理 SSO 认证流程：

```typescript
import { AuthService } from 'wave-agent-sdk';

const auth = AuthService.getInstance();

// 设置服务端地址
auth.setServerUrl('https://wave-admin.example.com');

// 监听认证状态变化
const unsubscribe = auth.onAuthChange((event) => {
  console.log('Auth event:', event); // "login" | "logout"
});

// 检查认证状态
const isLoggedIn = auth.isLoggedIn();
const token = auth.getToken();
```

认证优先级：`AgentOptions.serverUrl` > `WAVE_SERVER_URL` 环境变量。

### 提示历史 {#prompt-history}

```typescript
import { PromptHistoryManager } from 'wave-agent-sdk';
```

`PromptHistoryManager` 管理用户输入历史，支持上下箭头回忆。

### Git 工具 {#git-utils}

SDK 导出一组 Git 操作工具函数：

```typescript
import {
  isGitRepository,      // 检查是否为 git 仓库
  getGitRepoRoot,       // 获取仓库根目录
  getGitCommonDir,      // 获取 .git 目录
  getGitMainRepoRoot,   // 获取主仓库根目录（worktree 感知）
  resolveGitDir,        // 解析 git 目录
  getDefaultRemoteBranch, // 获取默认远程分支
  hasUncommittedChanges,  // 检查未提交更改
  hasNewCommits,         // 检查新提交
} from 'wave-agent-sdk';
```

### 文件搜索 {#file-search}

```typescript
import { fileSearch } from 'wave-agent-sdk';
```

提供高性能文件搜索能力，支持 glob 模式和内容搜索。

### 计划模式 {#plan-mode}

```typescript
// 获取计划文件路径
const planPath = agent.getPlanFilePath();
```

计划模式下 Agent 专注于设计方案，限制文件修改操作。通过 `EnterPlanMode` / `ExitPlanMode` 工具切换。

### Worktree 管理 {#worktree}

```typescript
// 触发 worktree 移除钩子
await agent.triggerWorktreeRemoveHook('/path/to/worktree');
```

## 12. 内置 Skills {#builtin-skills}

### settings — 配置管理 {#skill-settings}

详见 [Settings Skill](#settings-skill)。用户可通过 `/settings` 以自然语言管理所有 Wave 设置。

### init — 代码库初始化 {#skill-init}

分析代码库并创建 `AGENTS.md` 文件，为后续 Agent 会话提供项目上下文指引。

- **名称**: `init`
- **特性**: 不会被 AI 自动调用，需用户通过 `/init` 手动触发

### loop — 定时循环任务 {#skill-loop}

按指定间隔重复执行提示词或斜杠命令。

- **名称**: `loop`
- **使用方式**: `/loop [interval] <prompt>`
- **间隔格式**: `Ns`, `Nm`, `Nh`, `Nd`（如 `5m`, `30m`, `2h`, `1d`），最小粒度为 1 分钟，默认 10 分钟

**示例**:
- `/loop 5m /babysit-prs` — 每 5 分钟执行 `/babysit-prs`
- `/loop 30m check the deploy` — 每 30 分钟检查部署
- `/loop check the deploy` — 默认每 10 分钟执行

**底层工具**：由 `CronCreate`、`CronDelete`、`CronList` 三个工具实现。

**限制**：循环任务 7 天后自动过期；最多支持 50 个定时任务。

## 13. 内置 Subagents {#builtin-subagents}

### Bash — 命令执行 {#subagent-bash}

专门用于执行 bash 命令的代理，适用于 git 操作、命令执行、终端任务等。

- **工具**: `[Bash]`
- **模型**: 继承主代理模型

### Explore — 代码库探索 {#subagent-explore}

快速探索代码库的文件搜索专家，支持三种细致程度：`quick`、`medium`、`very thorough`。

- **工具**: `[Glob, Grep, Read, Bash, LSP]`
- **模型**: 快速模型（fastModel）
- **模式**: 只读，禁止任何文件修改操作

### Plan — 软件架构师 {#subagent-plan}

设计实现方案的软件架构师代理，返回分步策略、识别关键文件、考虑架构权衡。

- **工具**: `[Glob, Grep, Read, Bash, LSP]`
- **模型**: 继承主代理模型
- **模式**: 只读，禁止任何文件修改操作

### General-Purpose 代理 {#subagent-general-purpose}

用于研究复杂问题、搜索代码和执行多步骤任务的通用代理。

- **模型**: 继承主代理模型

```typescript
// 获取子代理实例
const subagent = agent.getSubagentInstance('explore');
```

## 14. Settings Skill {#settings-skill}

Wave 提供了一个强大的内置 `/settings` skill，作为用户与 Wave 配置系统交互的自然语言入口。用户无需手动编辑配置文件，只需用自然语言描述需求，AI 即可帮助查看、修改和引导配置。

**主要特性：**

- **自然语言配置**：通过对话方式管理所有 Wave 设置，如"显示我的当前设置"、"更新项目设置启用自动记忆"等。
- **三级作用域**：配置支持用户级（`~/.wave/settings.json`）、项目级（`.wave/settings.json`）和本地级（`.wave/settings.local.json`）。
- **热加载**：所有配置修改立即生效，无需重启 Wave。

### settings.json 配置中心 {#settings-json}

`settings.json` 是 Wave 的中央配置文件，支持自定义钩子、环境变量、工具权限等功能。

**使用示例：**

- "显示我当前的项目设置"
- "帮我在项目级设置里开启自动记忆"
- "用本地配置文件覆盖某个全局设置"

### 钩子 (Hooks) {#settings-hooks}

钩子允许在特定事件发生时自动执行任务，实现工作流自动化。Wave 支持以下钩子事件：

| 事件名称 | 触发时机 |
|----------|----------|
| `PreToolUse` | 工具执行前（可用于校验、拦截或预处理） |
| `PostToolUse` | 工具执行完成后（可用于后处理或日志记录） |
| `UserPromptSubmit` | 用户提交 Prompt 时 |
| `PermissionRequest` | Wave 请求工具权限时 |
| `Stop` | Wave 完成响应周期（无更多工具调用）时 |
| `SubagentStop` | 子代理完成响应周期时 |
| `WorktreeCreate` | 创建新 worktree 时 |
| `WorktreeRemove` | 离开或删除 worktree 时 |
| `SessionStart` | 会话开始时（来源：`startup` / `resume` / `compact`） |
| `SessionEnd` | 会话结束时（来源：`exit` / `stop` / `compact`） |

**钩子配置要点：**

- **模式匹配**：支持通过 `matcher` 匹配工具名（如 `Write`、`Read*`、`/^Edit/`），适用于 `PreToolUse`、`PostToolUse` 和 `PermissionRequest`。
- **异步执行**：支持 `async` 字段配置后台异步执行，避免阻塞工作流。
- **超时控制**：支持 `timeout` 字段设置最大执行时间（默认 600 秒）。
- **退出码控制**：`0` = 成功继续；`2` = 阻塞错误，阻止操作；其他 = 非阻塞错误，继续但显示警告。
- **输入上下文**：Wave 通过 `stdin` 向钩子进程传递 JSON 格式的详细信息。
- **热加载**：配置文件修改后即时生效，无需重启 Wave。

### 环境变量 {#settings-env}

通过 `env` 字段设置对所有工具和钩子可用的环境变量，也可直接在系统环境中设置。

#### WAVE_* 变量

| 变量 | 描述 |
|---|---|
| `WAVE_MODEL` | 默认 AI 模型 |
| `WAVE_FAST_MODEL` | 快速模型（用于子代理、摘要等轻量场景） |
| `WAVE_API_KEY` | API Key |
| `WAVE_BASE_URL` | API Base URL |
| `WAVE_SERVER_URL` | Wave AI 服务端地址（用于 SSO） |
| `WAVE_CUSTOM_HEADERS` | 自定义请求头（JSON 格式） |
| `WAVE_MAX_INPUT_TOKENS` | 最大输入 Token 数 |
| `WAVE_MAX_OUTPUT_TOKENS` | 最大输出 Token 数 |
| `WAVE_DISABLE_AUTO_MEMORY` | 禁用自动记忆 |
| `WAVE_AUTO_MEMORY_FREQUENCY` | 自动记忆触发频率 |
| `WAVE_PROMPT_CACHE_REGEX` | Prompt 缓存匹配正则（默认 `claude`） |
| `WAVE_PLUGIN_GIT_TIMEOUT_MS` | 插件 Git 操作超时（毫秒） |

#### OTEL_* 变量（OpenTelemetry）

| 变量 | 描述 |
|---|---|
| `OTEL_ENABLED` | 是否启用遥测（设为 `false` 禁用） |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP 导出端点 |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | 导出协议（`grpc` / `http`） |
| `OTEL_EXPORTER_OTLP_HEADERS` | 导出附加头（JSON 格式） |
| `OTEL_LOG_USER_PROMPTS` | 是否记录用户 Prompt |
| `OTEL_LOG_TOOL_CONTENT` | 是否记录工具调用内容 |
| `OTEL_SPAN_TTL_MS` | Span 存活时间（毫秒） |
| `OTEL_SHUTDOWN_TIMEOUT_MS` | 关闭超时时间（毫秒） |

### 工具权限 {#settings-permissions}

管理工具权限并定义"安全区域"（Safe Zone），支持 `allow`、`deny` 列表以及 `permissionMode` 配置。权限修改立即生效。

### 模型配置 {#settings-models}

在 `models` 字段中定义 AI 模型及其专属参数，支持任意模型参数：

- `temperature`：控制输出的随机性
- `reasoning_effort`：推理强度（`low`/`medium`/`high`），适用于支持推理的模型
- `thinking`：是否开启思考模式及预算 tokens，如 `{"type": "enabled", "budget_tokens": 2048}`

此外还支持 `fastModel` 配置，用于子代理（Explore）和网页抓取摘要等轻量场景。

### Prompt 缓存 {#settings-prompt-cache}

SDK 默认对名称包含 `claude` 的模型自动启用 Prompt Cache（提示词缓存），通过在消息内容中插入 `ephemeral` 缓存标记来复用上下文，降低 API 调用成本。

对于其他支持 Prompt Cache 的模型，可通过 `WAVE_PROMPT_CACHE_REGEX` 匹配模型名称：

- `WAVE_PROMPT_CACHE_REGEX="qwen"` — 匹配 qwen 系列模型
- `WAVE_PROMPT_CACHE_REGEX="(qwen|claude)"` — 同时匹配多个

### MCP 协议 {#settings-mcp}

配置外部 MCP 服务器连接，支持本地进程（stdio）和远程 HTTP/SSE 两种方式。用户可通过 `/settings 增加mcp：xxx` 快速添加。

### 记忆规则 {#settings-memory}

为 Agent 提供上下文特定的指令和指南，确保 AI 在不同场景下遵循预期的行为模式。

### 自定义 Skill {#settings-skills}

创建自定义 skill 以扩展 Wave 功能，处理特定复杂任务。用户可通过 `/settings 帮我写个skill` 快速创建。

### 子代理 {#settings-subagents}

定义专用的 AI 个性代理，将特定任务委托给专业化的子代理执行。

### 插件配置 {#settings-plugins}

通过 `enabledPlugins` 启用或禁用插件。插件的 skill、hook、MCP 和 LSP 服务器可使用 `${WAVE_PLUGIN_ROOT}` 占位符引用其父插件目录。

### 其他设置 {#settings-other}

- `language`：AI 通信首选语言（如 `"zh"`、`"en"`）。
- `autoMemoryEnabled`：启用或禁用自动记忆（默认：`true`）。
- `autoMemoryFrequency`：自动记忆提取频率（默认：`1`）。

## 15. 官方插件市场 {#plugin-marketplaces}

SDK 内置默认插件市场 `wave-plugins-official`（来源：[netease-lcap/wave-plugins-official](https://github.com/netease-lcap/wave-plugins-official)），自动启用且支持自动更新。该市场提供以下插件：

### document-skills {#plugin-document-skills}

文档处理套件，包含 **docx**（Word）、**xlsx**（Excel）、**pptx**（PowerPoint）和 **pdf** 四个技能组。AI 可以读取、创建和编辑各类办公文档，支持内容提取、格式转换和数据操作。

### typescript-lsp {#plugin-typescript-lsp}

TypeScript/JavaScript 语言服务器，通过 `typescript-language-server --stdio` 提供代码智能支持。包括代码补全、跳转定义、查找引用、符号搜索、类型提示和错误诊断等功能。

### chrome-devtools {#plugin-chrome-devtools}

Chrome DevTools Protocol MCP 服务器，通过 `npx chrome-devtools-mcp` 启动。支持浏览器自动化操作，包括页面导航、元素检查、截图、网络请求监控、控制台执行等。

### code2spec {#plugin-code2spec}

从代码生成规格说明文档的工具集。基于代码库自动创建 requirements、plan、tasks 等技术规格模板，帮助团队建立代码与文档的对应关系。

### code2cwspec {#plugin-code2cwspec}

从现有代码（.NET、Java 等老系统）逆向生成为 CodeWave 格式的规范模板。包含 **4 个子代理**：cw-architect（架构分析）、cw-researcher（代码调研）、cw-validator（规范校验）、cw-writer（文档生成），输出 requirements/plan/tasks 完整规范。

### commit-skills {#plugin-commit-skills}

简化的 Git 工作流技能集，包含 **5 个技能**：commit（提交）、commit-push-mr（提交并推送 MR）、commit-push-pr（提交并推送 PR）、watch-merge-mr（等待合并 MR）、watch-merge-pr（等待合并 PR）。支持从代码审查到合并的全流程自动化。

### speckit {#plugin-speckit}

规范驱动开发工具包（中文版），包含 **8 个技能**：analyze、checklist、clarify、constitution、implement、plan、specify、tasks。适用于软件工程任务的规格说明与规划。

### deep-wiki {#plugin-deep-wiki}

AI 驱动的 Wiki 生成器，支持 Mermaid 图表、源码引用、入职指南和 llms.txt 生成。包含 **3 个子代理**（wiki-architect、wiki-researcher、wiki-writer）和 **3 个命令**（ask、build、generate）。

### tavily-search {#plugin-tavily-search}

Tavily AI 驱动的搜索引擎 MCP 服务器，通过 `https://mcp.tavily.com/mcp/` 提供网络搜索能力。

### lcap-extension-component {#plugin-lcap-extension-component}

LCAP 低代码平台扩展组件开发指南。包含约 **17 个技能**，覆盖 ElementUI、ElementPlus、AntD、Mobile UI、Cloud UI 等平台组件。

### frontend-design {#plugin-frontend-design}

创建独特的、生产级前端界面设计技能。注重美学品质，避免千篇一律的 AI 审美风格。

## 16. OpenTelemetry 遥测 {#opentelemetry-telemetry}

Wave 支持 OpenTelemetry 可观测性标准，提供结构化的遥测数据（Traces、Metrics、Logs），帮助开发者观察 Agent 行为、调试性能问题并分析会话模式。

### 导出器 (Exporters) {#otel-exporters}

Wave 支持为每种信号类型（Traces、Metrics、Logs）配置不同的导出目标：

- **OTLP 导出器**：将遥测数据发送到标准 OTLP 收集器（如 Jaeger、Grafana Tempo、Honeycomb）。通过 `OTEL_EXPORTER_OTLP_ENDPOINT` 设置收集器地址。
- **JSONL 文件导出器**：将遥测数据写入 `~/.wave/telemetry.jsonl`，每行一条独立的 JSON 记录。

**配置方式**：通过 `OTEL_*` 环境变量或 `settings.json` 中的 `monitoring.telemetry` 字段配置，环境变量优先。

```json
{
  "monitoring": {
    "telemetry": {
      "enabled": true,
      "tracesExporter": "otlp",
      "metricsExporter": "jsonl",
      "logsExporter": "jsonl",
      "endpoint": "https://your-collector.example.com",
      "headers": { "Authorization": "Bearer ..." }
    }
  }
}
```

### Span 体系 {#otel-spans}

Wave 创建三层 Span 结构，完整记录用户交互到工具执行的全链路：

| Span 类型 | 说明 | 关键属性 |
|-----------|------|----------|
| **InteractionSpan** | 包裹一次完整的用户消息 -> Agent 响应周期 | `user_prompt`（可选）、`user_prompt_length`、`interaction.sequence` |
| **LLMRequestSpan** | Interaction 的子 Span，表示单次 API 调用 | `model`、`input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_creation_tokens`、`ttft_ms`、`ttlt_ms`、`success`、`has_tool_call` |
| **ToolSpan** | Interaction 的子 Span，表示单次工具执行 | `tool_name`、`tool_input`（可选）、`success`、`error`、`duration_ms` |

- **父子关系**：一个 InteractionSpan 包含多个 LLMRequestSpan（多轮递归时）和多个 ToolSpan（并行工具调用时）
- **并行隔离**：使用 `AsyncLocalStorage` 确保并行工具执行时 Span 上下文不混淆
- **资源属性**：包含 `service.name: 'wave'`、`service.version`、`os.type`、`host.arch`

### 事件日志 (Event Logging) {#otel-events}

Wave 在关键会话生命周期节点记录结构化事件：

| 事件 | 触发时机 | 关键属性 |
|------|----------|----------|
| `session_start` | 会话启动 | `sessionId`、`model`、`workdir` |
| `session_end` | 会话结束 | `duration`、`totalTokens`、`exitReason` |
| `user_prompt` | 用户发送消息 | `prompt_length`、`prompt`（若启用） |
| `tool_decision` | 工具权限决策 | `tool_name`、`decision`、`source` |
| `compaction` | 自动压缩触发 | `beforeTokens`、`afterTokens`、`model` |
| `error` | 错误发生 | `error_type`、`message`、`stack`（截断） |

### PII 保护 {#otel-privacy}

默认情况下，用户提示文本和工具内容**不包含**在遥测数据中。需显式启用：

- `OTEL_LOG_USER_PROMPTS=1`：在事件中包含用户提示文本
- `OTEL_LOG_TOOL_CONTENT=1`：在事件中包含工具输入/输出内容

### 可靠性保障 {#otel-reliability}

- **优雅降级**：遥测初始化或导出失败时，Agent 正常运行不受影响，仅记录警告日志
- **关闭刷新**：进程退出时自动刷新遥测数据，超时时间可配置（默认 2 秒）
- **内存保护**：超过 30 分钟的活跃 Span 自动清理，防止长会话内存泄漏
- **懒加载**：遥测模块懒加载，不增加启动延迟

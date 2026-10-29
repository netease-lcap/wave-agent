---
title: Agent 生命周期
description: 创建 Agent、构造选项、属性与常用方法，以及 destroy() 的终态排空语义
---

# Agent 生命周期 {#agent-lifecycle}

## 创建 Agent {#agent-create}

使用 `Agent.create()` 静态工厂方法创建 Agent 实例。该方法为异步方法，完成初始化后返回配置好的 Agent。

```typescript
const agent = await Agent.create({
  model: "gpt-4",
  apiKey: "your-api-key",
  baseURL: "https://api.example.com/v1",
  workdir: "/path/to/project",
  callbacks: {
    /* ... */
  },
});
```

## 配置选项 (AgentOptions) {#agent-options}

### 模型与 API

| 选项              | 类型                                     | 说明                                                                |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `model`           | `string`                                 | 主模型名称（也可通过 `WAVE_MODEL` 环境变量设置）                    |
| `fastModel`       | `string`                                 | 快速模型，用于子代理、摘要等轻量场景（fallback: `WAVE_FAST_MODEL`） |
| `apiKey`          | `string`                                 | API Key（fallback: `WAVE_API_KEY`）                                 |
| `baseURL`         | `string`                                 | API Base URL（fallback: `WAVE_BASE_URL`）                           |
| `serverUrl`       | `string`                                 | Wave AI 服务端地址，用于 SSO 认证（fallback: `WAVE_SERVER_URL`）    |
| `defaultHeaders`  | `Record<string, string>`                 | 自定义请求头                                                        |
| `subagentHeaders` | `Record<string, Record<string, string>>` | 按子代理类型设置的请求头                                            |
| `fetchOptions`    | `ClientOptions["fetchOptions"]`          | fetch 选项                                                          |
| `fetch`           | `ClientOptions["fetch"]`                 | 自定义 fetch 实现                                                   |
| `maxInputTokens`  | `number`                                 | 最大输入 Token 数（fallback: `WAVE_MAX_INPUT_TOKENS`）              |
| `maxTokens`       | `number`                                 | 最大输出 Token 数（fallback: `WAVE_MAX_OUTPUT_TOKENS`）             |
| `language`        | `string`                                 | Agent 通信首选语言（如 `"zh"`、`"en"`）                             |

### 会话与工作目录

| 选项                  | 类型        | 说明                               |
| --------------------- | ----------- | ---------------------------------- |
| `workdir`             | `string`    | 工作目录（默认 `process.cwd()`）   |
| `restoreSessionId`    | `string`    | 恢复指定会话                       |
| `continueLastSession` | `boolean`   | 继续上一次会话                     |
| `messages`            | `Message[]` | 初始消息（主要用于测试）           |
| `systemPrompt`        | `string`    | 自定义系统提示词（替换默认提示词） |

### 权限与工具

| 选项              | 类型                       | 说明                                                  |
| ----------------- | -------------------------- | ----------------------------------------------------- |
| `permissionMode`  | `PermissionMode`           | 权限模式（默认 `"default"`）                          |
| `canUseTool`      | `PermissionCallback`       | 自定义权限回调                                        |
| `allowedTools`    | `string[]`                 | 始终允许的工具列表                                    |
| `disallowedTools` | `string[]`                 | 始终禁止的工具列表                                    |
| `tools`           | `string[]`                 | 启用的工具列表（`undefined` = 全部，`[]` = 禁用全部） |
| `customTools`     | `ToolPlugin[]`             | 自定义工具注册                                        |
| `hooks`           | `PartialHookConfiguration` | 创建时注入的钩子配置                                  |

### 扩展与集成

| 选项            | 类型                              | 说明                                            |
| --------------- | --------------------------------- | ----------------------------------------------- |
| `plugins`       | `PluginConfig[]`                  | 本地插件配置                                    |
| `mcpServers`    | `Record<string, McpServerConfig>` | MCP 服务器配置（覆盖 .mcp.json）                |
| `lspManager`    | `ILspManager`                     | 自定义 LSP 管理器                               |
| `name`          | `string`                          | worktree 名称                                   |
| `isNewWorktree` | `boolean`                         | 是否为新创建的 worktree                         |
| `watchSkills`   | `boolean`                         | 是否监听 Skill 文件变化（默认 `true`）          |
| `telemetry`     | `Partial<TelemetryConfig>`        | 遥测配置，见 [出站头](./telemetry#otel-headers) |

### 回调与日志

| 选项        | 类型             | 说明                            |
| ----------- | ---------------- | ------------------------------- |
| `callbacks` | `AgentCallbacks` | 事件回调集合                    |
| `stream`    | `boolean`        | 是否使用流式模式（默认 `true`） |
| `logger`    | `Logger`         | 自定义日志器                    |

## 销毁 Agent {#agent-destroy}

`destroy()` 方法执行完整的清理流程：中止正在进行的 AI 响应、停止所有后台任务和子代理、关闭 MCP 连接、停止文件监听、刷新遥测数据。

```typescript
await agent.destroy();
```

**生命周期契约：**

- **确定性排空**：`destroy()` 返回前会等待所有已注册的存活异步工作（消息分发、子代理等 fire-and-forget 工作）排空，销毁后不存在跨生命周期存活的异步副作用；超时（默认 10 秒）时记录 `Async work did not drain` 告警。
- **终态抛错**：`destroy()` 后调用 `sendMessage` / `bang` / `askBtw` 等公开 API 会同步抛出 `Error("Agent destroyed")`，不会静默丢弃或在已销毁的 Agent 上启动新回合。
- **幂等**：重复调用 `destroy()` 不抛错（二次销毁是安全 no-op）。

## Agent 属性 {#agent-properties}

| 属性                       | 类型              | 说明                         |
| -------------------------- | ----------------- | ---------------------------- |
| `sessionId`                | `string`          | 当前会话 ID                  |
| `messages`                 | `Message[]`       | 当前会话消息列表             |
| `usages`                   | `Usage[]`         | Token 使用记录               |
| `sessionFilePath`          | `string`          | 会话文件路径                 |
| `latestTotalTokens`        | `number`          | 最近一次总 Token 数          |
| `currentWorkdir`           | `string`          | 当前工作目录（随 `cd` 漂移） |
| `sessionWorkdir`           | `string`          | 会话创建时的工作目录         |
| `projectMemory`            | `string`          | 项目级记忆内容               |
| `userMemory`               | `string`          | 用户级记忆内容               |
| `isLoading`                | `boolean`         | 是否正在处理请求             |
| `isCompacting`             | `boolean`         | 是否正在压缩                 |
| `isCommandRunning`         | `boolean`         | 是否有命令正在执行           |
| `queuedMessages`           | `QueuedMessage[]` | 消息队列                     |
| `taskListId`               | `string`          | 任务列表 ID                  |
| `hasRunningBackgroundWork` | `boolean`         | 是否有后台任务运行中         |

## Agent 常用方法 {#agent-methods}

| 方法                        | 说明                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `sendMessage(content)`      | 发送用户消息                                                                                                        |
| `destroy()`                 | 销毁 Agent 并清理资源（终态：排空存活异步工作，之后公开 API 抛 `Agent destroyed`，见 [销毁 Agent](#agent-destroy)） |
| `abortAIMessage()`          | 中止当前 AI 响应                                                                                                    |
| `abortMessage()`            | 中止当前消息处理                                                                                                    |
| `abortBashCommand()`        | 中止正在执行的 Bash 命令                                                                                            |
| `abortSlashCommand()`       | 中止正在执行的斜杠命令                                                                                              |
| `clearMessages()`           | 清空消息（触发 SessionEnd/SessionStart 钩子）                                                                       |
| `compact(instructions?)`    | 手动触发上下文压缩                                                                                                  |
| `setModel(model)`           | 切换模型                                                                                                            |
| `setWorkdir(dir)`           | 切换工作目录                                                                                                        |
| `restoreSession(sessionId)` | 恢复到指定会话                                                                                                      |
| `truncateHistory(index)`    | 截断历史到指定位置                                                                                                  |
| `getFullMessageThread()`    | 获取完整消息链（含压缩前的父会话）                                                                                  |

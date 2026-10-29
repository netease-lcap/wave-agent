---
title: 消息处理与回调
description: 发送消息与消息队列、消息类型、流式输出，以及 AgentCallbacks 的消息/任务/子代理/MCP/UI 回调面
---

# 消息处理与回调

## 消息处理 {#messaging}

### 发送消息 {#send-message}

```typescript
await agent.sendMessage("帮我重构这个模块");
```

消息进入队列后，Agent 自动处理：解析消息类型、调用 AI 模型、执行工具调用、流式输出结果。如果 Agent 正在处理其他消息，新消息会排入队列等待。

### 消息队列 {#message-queue}

Agent 内置消息队列管理并发消息：

- 消息按入队顺序依次处理
- 支持通过 `queuedMessages` 属性查看队列
- `removeQueuedMessage(index)` — 按索引移除队列中的消息
- `removeQueuedMessageById(id)` — 按 ID 移除队列中的消息
- `updateQueuedMessageById(id, patch)` — 按 ID 更新队列中某条消息的内容（`content` / `images` / `type`），不改变队列顺序；消息存在返回 `true`，否则返回 `false`
- `recallQueuedMessage()` — 召回最近移除的消息（用于 UP 箭头回忆）

### 消息类型 {#message-types}

Agent 支持多种消息块类型，通过回调通知 UI 层：

| 类型     | 回调                          | 说明                                                                                                                                          |
| -------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 文本内容 | `onAssistantContentUpdated`   | AI 文本流式输出，含 `chunk`、`stage`（chunk 为增量片段，消费端自行累积）                                                                      |
| 推理内容 | `onAssistantReasoningUpdated` | 推理/思考过程流式输出                                                                                                                         |
| 工具调用 | `onToolBlockUpdated`          | 工具执行状态更新（bash 模式命令输出经此实时推送）                                                                                             |
| 压缩摘要 | `onCompactBlockAdded`         | 上下文压缩后生成的摘要                                                                                                                        |
| 错误信息 | `onErrorBlockAdded`           | 错误消息                                                                                                                                      |
| 任务通知 | `onBackgroundTasksChange`     | 后台任务状态变更（后台任务完成的通知消息为 `isMeta: true`，UI 隐藏、模型可见，详见 [后台任务完成通知](./background-tasks#task-notification)） |

### 流式输出 {#streaming}

默认启用流式模式（`stream: true`），AI 响应通过回调实时推送：

```typescript
callbacks: {
  // 文本流式输出
  onAssistantContentUpdated: ({ messageId, chunk, stage }) => {
    // chunk: 增量片段（自上次回调以来的新内容）；stage: "streaming" | "end"
    // 注意：回调不再提供 accumulated，需自行追加累积
    process.stdout.write(chunk);
  },
  // 推理过程流式输出
  onAssistantReasoningUpdated: ({ messageId, chunk, stage }) => {
    // 推理内容（thinking/reasoning），chunk 同样为增量片段
  },
}
```

## 回调系统 {#callbacks}

### AgentCallbacks 接口 {#agent-callbacks-interface}

`AgentCallbacks` 继承了 `MessageManagerCallbacks`、`BackgroundTaskManagerCallbacks`、`McpManagerCallbacks` 和 `SubagentManagerCallbacks`，提供全面的事件通知。

### 消息回调 {#callbacks-messaging}

| 回调                          | 参数                            | 说明                               |
| ----------------------------- | ------------------------------- | ---------------------------------- |
| `onSessionIdChange`           | `string`                        | 会话 ID 变更（如压缩后创建新会话） |
| `onLatestTotalTokensChange`   | `number`                        | Token 总量更新                     |
| `onUsagesChange`              | `Usage[]`                       | Token 使用记录更新                 |
| `onUserMessageAdded`          | `UserMessageParams`             | 用户消息添加                       |
| `onAssistantMessageAdded`     | `messageId: string`             | AI 消息创建                        |
| `onAssistantContentUpdated`   | `{ messageId, chunk, stage }`   | 文本流式输出（chunk 为增量片段）   |
| `onAssistantReasoningUpdated` | `{ messageId, chunk, stage }`   | 推理流式输出（chunk 为增量片段）   |
| `onToolBlockUpdated`          | `ToolBlockUpdateCallbackParams` | 工具块更新                         |
| `onErrorBlockAdded`           | `error: string`                 | 错误块添加                         |
| `onCompactBlockAdded`         | `content: string`               | 压缩摘要添加                       |
| `onCompactionStateChange`     | `isCompacting: boolean`         | 压缩状态变更                       |

### 后台任务回调 {#callbacks-background}

| 回调                      | 参数               | 说明             |
| ------------------------- | ------------------ | ---------------- |
| `onBackgroundTasksChange` | `BackgroundTask[]` | 后台任务列表变更 |
| `onBackgroundCurrentTask` | —                  | 后台当前任务变更 |

### 子代理回调 {#callbacks-subagent}

| 回调                                | 参数                                      | 说明                               |
| ----------------------------------- | ----------------------------------------- | ---------------------------------- |
| `onSubagentUserMessageAdded`        | `subagentId, params`                      | 子代理收到用户消息                 |
| `onSubagentAssistantMessageAdded`   | `subagentId, messageId`                   | 子代理创建 AI 消息                 |
| `onSubagentAssistantContentUpdated` | `{ subagentId, messageId, chunk, stage }` | 子代理流式输出（chunk 为增量片段） |
| `onSubagentLatestTotalTokensChange` | `subagentId, tokens`                      | 子代理 Token 更新                  |

### MCP 回调 {#callbacks-mcp}

| 回调                 | 参数                | 说明               |
| -------------------- | ------------------- | ------------------ |
| `onMcpServersChange` | `McpServerStatus[]` | MCP 服务器状态变更 |

### UI 状态回调 {#callbacks-ui}

| 回调                       | 参数              | 说明             |
| -------------------------- | ----------------- | ---------------- |
| `onPermissionModeChange`   | `PermissionMode`  | 权限模式变更     |
| `onModelChange`            | `string`          | 模型切换         |
| `onConfiguredModelsChange` | `string[]`        | 可用模型列表变更 |
| `onLoadingChange`          | `boolean`         | 加载状态变更     |
| `onCommandRunningChange`   | `boolean`         | 命令执行状态变更 |
| `onWorkdirChange`          | `string`          | 工作目录变更     |
| `onQueuedMessagesChange`   | `QueuedMessage[]` | 消息队列变更     |
| `onTasksChange`            | `Task[]`          | 任务列表变更     |

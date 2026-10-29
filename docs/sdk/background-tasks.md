---
title: 后台任务与工作流
description: 后台任务与工作流管理、前台任务、任务状态回调，以及后台任务完成通知（task-notification）
---

# 后台任务与工作流 {#background-tasks}

## 后台任务管理 {#background-task-management}

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

## 工作流管理 {#workflow-management}

```typescript
// 获取所有工作流运行记录
const runs = await agent.getWorkflowRuns();

// 获取指定工作流运行记录
const run = agent.getWorkflowRun(runId);

// 停止工作流运行
agent.stopWorkflowRun(runId);
```

## 前台任务 {#foreground-tasks}

```typescript
// 注册前台任务
agent.registerForegroundTask(task);

// 注销前台任务
agent.unregisterForegroundTask(id);

// 获取后台当前任务
await agent.backgroundCurrentTask();
```

## 任务状态回调 {#task-callbacks}

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

## 后台任务完成通知（task-notification）{#task-notification}

后台任务（Bash 后台命令、后台子代理、后台 workflow）完成时，Wave 会将完成通知作为 `task-notification` 消息注入主对话，供模型感知并汇报：

- **UI 隐藏**：通知为 `role: "user"` 的 meta 消息（`isMeta: true`），在 CLI 与 Webview 消息流中均不显示，消息流只呈现真实对话。
- **模型可见**：模型读取消息上下文时看到包装文本 `A background agent completed a task:` 加 `<task-notification>` XML（含 task-id、task-type、status、summary、output-file）。
- **持久化**：通知消息与随后的 assistant 回复一同写入会话 jsonl，恢复会话后模型上下文与通知行为不变。
- **killed 不注入**：被手动终止（killed）的后台任务不注入完成通知。
- **批量合并**：多个后台任务同时完成时，所有通知合并进同一轮 AI 应答。
- **/clear 与 abort**：`MessageQueue.clear()` 保留 pending 通知（不丢弃后台结果）；abort 期间不注入通知（折叠进下一轮）。

用户感知路径为模型主动汇报与 `/tasks` 面板，不经消息流。

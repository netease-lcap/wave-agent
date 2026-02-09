# Quickstart: Task Background Execution

## Running a Task in the Background

To start a long-running task without blocking the agent:

```typescript
// Using the Task tool
await agent.callTool("Task", {
  description: "Refactor the codebase",
  prompt: "Go through all files and apply the new linting rules",
  subagent_type: "typescript-expert",
  run_in_background: true
});
// Returns: "Task started in background. Task ID: task_1"
```

## Checking Task Progress

To see what the task has produced so far:

```typescript
await agent.callTool("TaskOutput", {
  task_id: "task_1",
  block: false
});
```

## Waiting for Completion

To wait for a task to finish and get the final result:

```typescript
await agent.callTool("TaskOutput", {
  task_id: "task_1",
  block: true,
  timeout: 60000
});
```

## Stopping a Task

If you need to cancel a task:

```typescript
await agent.callTool("TaskStop", {
  task_id: "task_1"
});
```

## CLI Management

List all tasks:
```bash
/tasks
```

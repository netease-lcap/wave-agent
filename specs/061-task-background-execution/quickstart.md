# Quickstart: Task Background Execution

## Running a Task in the Background

To start a long-running task without blocking the agent:

```typescript
// Using the Task tool
await agent.callTool("Task", {
  description: "Refactor the codebase",
  prompt: "Go through all files and apply the new linting rules",
  subagent_type: "general-purpose",
  run_in_background: true
});
// Returns: "Task started in background. Task ID: task_1"
```

## Checking Task Progress

To see what the task has produced so far, use the `Read` tool with the `outputPath` provided when the task started:

```typescript
await agent.callTool("Read", {
  file_path: "/tmp/task_1_output.log"
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

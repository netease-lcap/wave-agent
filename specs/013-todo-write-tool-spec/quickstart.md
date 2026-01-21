# TodoWrite Tool Quickstart

## Overview
The `TodoWrite` tool is used by agents to maintain a list of tasks for the current session.

## Usage Examples

### Initializing a Task List
```typescript
await todoWriteTool.execute({
  todos: [
    { id: "task1", content: "Research codebase", status: "in_progress" },
    { id: "task2", content: "Implement feature", status: "pending" },
    { id: "task3", content: "Write tests", status: "pending" }
  ]
}, context);
```

### Updating Task Status
```typescript
await todoWriteTool.execute({
  todos: [
    { id: "task1", content: "Research codebase", status: "completed" },
    { id: "task2", content: "Implement feature", status: "in_progress" },
    { id: "task3", content: "Write tests", status: "pending" }
  ]
}, context);
```

## Key Implementation Details
- **Atomic Updates**: The tool receives the entire list of todos, ensuring the state is always consistent.
- **UI Integration**: The `shortResult` provides a visual summary (e.g., `[x] Task 1\n[>] Task 2`) that can be displayed in the CLI.
- **State Enforcement**: The tool rejects updates that violate the "one-in-progress" rule, forcing the agent to be focused.

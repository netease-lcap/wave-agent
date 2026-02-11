# UI Events Contract: Task List

This document defines the communication interface between the Agent SDK and the CLI UI for task management.

## 1. SDK to UI (Events)

The SDK notifies the UI of changes in the task state. These events are triggered by the `TaskManager` when tasks are modified.

### `onTasksChange`

Triggered whenever tasks are created, modified, or deleted.

- **Payload**: `Task[]` (The complete, updated list of tasks for the current session).
- **Trigger**: 
    - Initial load of the session.
    - Successful execution of `TaskCreate`, `TaskUpdate`, or `TaskDelete` tools.
    - Any internal modification within `TaskManager`.

## 2. Integration Pattern

The `ChatProvider` in `packages/code` acts as the bridge:

1. **Subscription**: `ChatProvider` receives the `onTasksChange` callback via `AgentCallbacks`.
2. **State Management**: `ChatProvider` maintains the `tasks` array in its state.
3. **Propagation**: The state is passed down to the `TaskList` component for rendering.

```typescript
// Example Callback in Agent (forwarding from TaskManager)
const callbacks: AgentCallbacks = {
  onTasksChange: (tasks: Task[]) => {
    // Forward to UI
  }
};
```

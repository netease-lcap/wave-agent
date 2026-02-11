# Data Model: Task List UI

This document defines the data structures used by the Task List UI, including the core Task entity and UI-specific state.

## 1. Core Task Entity

The Task List UI consumes the `Task` entity defined in `packages/agent-sdk/src/types/tasks.ts`.

```typescript
export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export interface Task {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  activeForm?: string;
  owner?: string;
  blocks: string[];
  blockedBy: string[];
  metadata: Record<string, unknown>;
}
```

## 2. UI State

The Task List UI maintains additional state to manage visibility, selection, and display modes.

### 2.1 TaskListState

This state is managed within the `TaskList` component or a dedicated provider in `packages/code`.

| Property | Type | Description |
| :--- | :--- | :--- |
| `tasks` | `Task[]` | The list of tasks for the current session. |

### 2.2 UI-Specific Task Metadata

While the core `Task` entity is used, the UI may derive or attach temporary properties for rendering:

| Property | Type | Description |
| :--- | :--- | :--- |
| `displayStatus` | `string` | A formatted string or icon representing the status (e.g., "✅ Done", "⏳ Pending"). |
| `indentationLevel` | `number` | Derived from `blockedBy` relationships to show task hierarchy. |

## 3. Persistence

- **Core Task Data**: Persisted in `~/.wave/tasks/<session-id>.json` via the `TaskManager`.
- **UI State**: The task list is always visible if tasks exist in the current session.
- **Data Flow**: The UI state for `tasks` is updated via the `onTasksChange` event emitted by the SDK, ensuring the UI is always in sync with the `TaskManager` without polling or file watching.

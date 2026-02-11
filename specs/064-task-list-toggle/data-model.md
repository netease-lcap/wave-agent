# Data Model: Task List Toggle

## Entities

### TaskListState (UI State)
Represents the visibility and configuration of the task list in the CLI.

| Field | Type | Description |
|-------|------|-------------|
| `showTaskManager` | `boolean` | Whether the task list is currently visible. |
| `tasks` | `BackgroundTask[]` | The list of tasks to display (sourced from `ChatContext`). |

## State Transitions

### Toggle Visibility
- **Trigger**: `Ctrl+T` key press.
- **Action**: `showTaskManager = !showTaskManager`.
- **Result**: The `TaskManager` component is mounted/unmounted or shown/hidden at the bottom of the `MessageList`.

### Update Content
- **Trigger**: `onTasksChange` callback from `Agent`.
- **Action**: `tasks` array in `ChatContext` is updated.
- **Result**: `TaskManager` re-renders with the latest task information.

## Validation Rules
- The task list should only be toggleable when the CLI is in "normal" input mode (not selecting files, etc.).
- If no tasks exist, the `TaskManager` should display a "No tasks" message or remain hidden (to be decided during implementation, but "No tasks" is preferred for feedback).

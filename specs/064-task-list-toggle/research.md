# Research: Task List Toggle

## Decision: Keyboard Shortcut and UI Integration

### Keyboard Shortcut
- **Chosen**: `Ctrl+T`
- **Rationale**: Standard shortcut for "Tasks" or "Tabs" in many applications. It is currently unused in the `InputManager.ts` of the `code` package.
- **Implementation**: Add a handler in `InputManager.ts` within `handleNormalInput` to toggle the `showTaskManager` state.

### UI Integration
- **Chosen**: Render `TaskManager` at the bottom of `MessageList.tsx`.
- **Rationale**: `MessageList.tsx` is the main container for the conversation. Placing the task list at the bottom ensures it is visible alongside the messages, as requested.
- **Implementation**: 
  - Use `showTaskManager` state from `InputManager` to conditionally render the `TaskManager` component.
  - The `TaskManager` component already exists and is designed to show background tasks.

### Data Access
- **Chosen**: Use `useChat` context.
- **Rationale**: `useChat` already manages `backgroundTasks` and receives real-time updates from the `Agent` via the `onTasksChange` callback.
- **Implementation**: `TaskManager` already consumes `useChat`, so no changes are needed for data retrieval.

### State Management
- **Chosen**: Leverage `InputManager`'s `showTaskManager` state.
- **Rationale**: `InputManager` already has a `showTaskManager` property (currently used for something else or partially implemented). We will repurpose/ensure it works for this toggle.
- **Alternatives considered**: Creating a new context for UI visibility. Rejected because `InputManager` is already the central place for managing UI states triggered by keyboard input.

## Rationale for Technical Choices
- **React Ink**: The CLI is built with React Ink, so all UI changes must follow Ink's component model.
- **Centralized Input Handling**: Using `InputManager` ensures that keyboard shortcuts are handled consistently and don't conflict with other UI modes (like file selection).
- **Real-time Updates**: By relying on the existing `onTasksChange` callback in `ChatProvider`, the task list will automatically update whenever the agent creates or updates a task.

## Unresolved Questions (Resolved during research)
- *How to anchor at bottom?* Ink's `Box` layout in `MessageList.tsx` naturally handles vertical stacking. Placing `TaskManager` after the message list content will anchor it at the bottom.
- *Global shortcut?* `InputManager` handles global input when not in specific sub-modes.

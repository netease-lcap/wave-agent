# Research: Task List UI Feature

## 1. Message Rendering in `packages/code`
- **Component**: `packages/code/src/components/MessageList.tsx` is the primary component for rendering the list of messages.
- **Mechanism**: It uses the `Static` component from Ink for historical messages and maps over `dynamicMessages` for the latest message (especially when `isLoading` or `isCommandRunning`).
- **Individual Items**: Each message is rendered using `MessageItem.tsx`.

## 2. Appending Components to the Message List
- **Location**: `packages/code/src/components/ChatInterface.tsx` manages the layout of the chat UI.
- **Strategy**: Components can be appended after the `MessageList` component within the main `Box` container.
- **Existing Examples**:
    - `Confirmation.tsx` is conditionally rendered after `MessageList`.
    - `InputBox.tsx` is rendered at the bottom when no confirmation is visible and the view is not expanded.
- **Recommendation**: The `TaskList` component should be placed between `MessageList` and `InputBox` (or `Confirmation`), similar to how `BackgroundTaskManager` might be integrated if it were persistent. It should always be rendered at the bottom of the message list if tasks exist.

## 3. Event-Based Notification System (Updated)
The previous recommendation of using file-watching for task updates is replaced by a more direct event-driven approach within the SDK.

### Findings:
- **Tool Interaction**: `TaskCreate` and `TaskUpdate` tools in `packages/agent-sdk/src/tools/taskManagementTools.ts` interact with a singleton-like instance of `TaskManager`.
- **Current State**: `TaskManager` (`packages/agent-sdk/src/services/taskManager.ts`) is currently a pure service that performs filesystem operations but lacks an event emitter or callback system.
- **Existing Patterns**: 
    - `BackgroundTaskManager` and `MessageManager` use a callback-based system defined in `AgentCallbacks` (in `packages/agent-sdk/src/agent.ts`).
    - `Agent` acts as the central hub, receiving callbacks from managers and forwarding them to the UI (the `code` package).

### Proposed Implementation:
1.  **Update `TaskManager`**: Modify `TaskManager` to support a callback or use an `EventEmitter` to notify when tasks are created or updated.
2.  **Update `AgentCallbacks`**: Add an `onTasksChange` callback to the `AgentCallbacks` interface in `packages/agent-sdk/src/agent.ts`.
    ```typescript
    export interface AgentCallbacks {
      // ... existing callbacks
      onTasksChange?: (tasks: Task[]) => void;
    }
    ```
3.  **Integrate with `Agent`**:
    - The `Agent` class should initialize `TaskManager` (or receive it) and register a listener.
    - When `TaskManager` triggers an event, the `Agent` calls the `onTasksChange` callback.
4.  **UI Subscription**: The `code` package (specifically `ChatProvider`) already receives `AgentCallbacks`. It can subscribe to `onTasksChange` to update its local state and trigger re-renders of the `TaskList` component.

## 4. `TaskManager` Implementation Status
- **Status**: `TaskManager` is already implemented in `packages/agent-sdk/src/services/taskManager.ts`.
- **Capabilities**:
    - `createTask(sessionId, task)`
    - `getTask(sessionId, taskId)`
    - `updateTask(sessionId, task)`
    - `listTasks(sessionId)`
    - `getNextTaskId(sessionId)`
- **Integration**: It is currently used by `taskManagementTools.ts` in the SDK. It needs to be upgraded from a stateless service to an observable one.

## 5. Best Practices for React Ink List Components
- **Reference**: `packages/code/src/components/BackgroundTaskManager.tsx` provides a good template for a list with statuses.
- **Key Patterns**:
    - Use `Box` with `flexDirection="column"` for the list layout.
    - Status-based coloring (e.g., green for in-progress, blue for completed, yellow for pending).
    - Render as a static, read-only list similar to how messages or status lines are displayed.

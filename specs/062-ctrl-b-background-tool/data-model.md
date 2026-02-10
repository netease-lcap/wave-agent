# Data Model: Ctrl-B Background Tool

## Entities

### ForegroundTask
Represents a tool execution currently running in the foreground that can be backgrounded.

- **type**: `'bash' | 'task'`
- **command**: `string` (for bash)
- **args**: `any` (for task)
- **startTime**: `number`
- **backgroundHandler**: `() => Promise<string>` (A callback that transitions the existing process/task to background and returns the Task ID)

## State Transitions

### Foreground -> Background
1. **Trigger**: User presses `Ctrl-B`.
2. **Action**: 
    - `Agent` identifies the **latest** active `ForegroundTask` (in case of multiple parallel tool calls).
    - `Agent` calls `backgroundHandler()` for that task.
    - The handler:
        - Detaches the process/task from the foreground manager.
        - Attaches it to `BackgroundTaskManager`.
        - Returns the new Task ID.
    - `Agent` returns a `ToolResult` to the original caller with the message: `"Command was manually backgrounded by user with ID [ID]"`.
3. **Result**: Foreground tool execution ends with a result; the actual process/task continues running in the background.

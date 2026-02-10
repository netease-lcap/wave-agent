# API Contracts: Ctrl-B Background Tool

## Agent Internal API (TypeScript)

### `Agent.backgroundCurrentTask()`
Attempts to move the currently running foreground tool to the background.

**Returns**: `Promise<boolean>` - True if a task was backgrounded, false otherwise.

## InputManager Callbacks

### `onBackgroundCurrentTask()`
Callback triggered when the Ctrl-B key combination is detected.

## Tool Result

When a tool is backgrounded, it returns:
```json
{
  "success": true,
  "content": "Command was manually backgrounded by user with ID task_123",
  "shortResult": "Backgrounded task_123"
}
```

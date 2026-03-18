# Wave Hooks Configuration

Hooks allow you to automate tasks when certain events occur in Wave. This document provides detailed guidance on how to configure complex hooks in `settings.json`.

## Hook Events

Wave supports the following hook events:

- `WorktreeCreate`: Triggered when a new worktree is created.
- `TaskStart`: Triggered when a task starts.
- `TaskComplete`: Triggered when a task is completed.
- `TaskError`: Triggered when a task fails.
- `SessionStart`: Triggered when a new session starts.
- `SessionEnd`: Triggered when a session ends.

## Hook Configuration Structure

Hooks are configured in the `hooks` field of `settings.json`. Each event can have multiple hook configurations.

```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "command": "pnpm install",
        "description": "Install dependencies in new worktree",
        "blocking": true,
        "timeout": 300000
      }
    ],
    "TaskComplete": [
      {
        "command": "pnpm test",
        "description": "Run tests after task completion",
        "blocking": false
      }
    ]
  }
}
```

## Hook Configuration Fields

- `command`: The shell command to execute.
- `description`: A brief description of the hook's purpose.
- `blocking`: (Optional) Whether the hook should block the main agent's execution (default: `false`).
- `timeout`: (Optional) Maximum execution time in milliseconds (default: `60000`).
- `env`: (Optional) Environment variables specific to this hook.
- `cwd`: (Optional) Working directory for the hook command.

## Advanced Hook Examples

### 1. Conditional Hooks
You can use shell logic within the `command` field to create conditional hooks.
```json
{
  "hooks": {
    "TaskComplete": [
      {
        "command": "if [ \"$WAVE_TASK_STATUS\" = \"completed\" ]; then pnpm lint; fi",
        "description": "Run linting only on successful task completion"
      }
    ]
  }
}
```

### 2. Hook Chaining
You can chain multiple commands in a single hook or define multiple hooks for the same event.
```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "command": "pnpm install && pnpm build",
        "description": "Install and build in new worktree"
      }
    ]
  }
}
```

### 3. Using Environment Variables
Wave provides several environment variables to hooks:
- `WAVE_PROJECT_DIR`: The root directory of the project.
- `WAVE_SESSION_ID`: The current session ID.
- `WAVE_TASK_ID`: The current task ID (if applicable).
- `WAVE_TASK_STATUS`: The status of the task (for `TaskComplete` and `TaskError`).

## Best Practices

- **Keep hooks fast**: Long-running hooks can slow down your workflow, especially if they are `blocking`.
- **Use descriptive names**: Help yourself and others understand what each hook does.
- **Test your hooks**: Run the commands manually first to ensure they work as expected.
- **Use local overrides**: For machine-specific hooks, use `.wave/settings.local.json`.

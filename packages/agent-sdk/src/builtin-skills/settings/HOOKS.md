# Wave Hooks Configuration

Hooks allow you to automate tasks when certain events occur in Wave. This document provides detailed guidance on how to configure hooks in `settings.json`.

## Hook Events

Wave supports the following hook events:

- `PreToolUse`: Triggered before a tool is executed.
- `PostToolUse`: Triggered after a tool has finished executing.
- `UserPromptSubmit`: Triggered when a user submits a prompt.
- `PermissionRequest`: Triggered when Wave requests permission to use a tool.
- `Stop`: Triggered when Wave finishes its response cycle (no more tool calls).
- `SubagentStop`: Triggered when a subagent finishes its response cycle.
- `WorktreeCreate`: Triggered when a new worktree is created.

## Hook Configuration Structure

Hooks are configured in the `hooks` field of `settings.json`. Each event can have multiple hook configurations.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "command": "pnpm lint",
            "description": "Run lint before writing files"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "command": "echo \"Permission requested for Bash tool\" >> hooks.log",
            "description": "Log permission requests for Bash"
          }
        ]
      }
    ]
  }
}
```

## Hook Configuration Fields

- `matcher`: (Optional) A pattern to match against the tool name (e.g., "Write", "Read*", "/^Edit/"). Only applicable for `PreToolUse`, `PostToolUse`, and `PermissionRequest`.
- `hooks`: An array of hook commands to execute.
  - `command`: The shell command to execute.
  - `description`: A brief description of the hook's purpose.
  - `async`: (Optional) Whether the hook should run in the background without blocking (default: `false`).
  - `timeout`: (Optional) Maximum execution time in seconds (default: `600`).

## Hook Input JSON

Wave provides detailed context to hook processes via `stdin` as a JSON object. This allows hooks to make informed decisions based on the current state.

### Common Fields
- `session_id`: The current session ID.
- `transcript_path`: Path to the session transcript file (JSON).
- `cwd`: The current working directory.
- `hook_event_name`: The name of the triggering event.

### Event-Specific Fields
- `tool_name`: (PreToolUse, PostToolUse, PermissionRequest) The name of the tool.
- `tool_input`: (PreToolUse, PostToolUse, PermissionRequest) The input parameters passed to the tool.
- `tool_response`: (PostToolUse) The result of the tool execution.
- `user_prompt`: (UserPromptSubmit) The text submitted by the user.
- `subagent_type`: (If executed by a subagent) The type of the subagent.
- `name`: (WorktreeCreate) The name of the new worktree.

## Hook Exit Codes

Hooks can communicate status and control Wave's behavior using exit codes:

- **Exit 0**: Success. Wave continues its normal execution.
- **Exit 2**: Blocking Error. Wave blocks the current operation and provides feedback based on the event:
    - `UserPromptSubmit`: Blocks prompt processing and shows `stderr` as a user error.
    - `PreToolUse`: Blocks tool execution and provides `stderr` to the agent as feedback.
    - `PostToolUse`: Appends `stderr` to the tool result as feedback for the agent.
    - `Stop`: Blocks the stop operation and provides `stderr` to the agent.
- **Other Exits (e.g., Exit 1)**: Non-blocking error. Wave continues execution but shows `stderr` as a warning to the user.

## Best Practices

- **Keep hooks fast**: Long-running hooks can slow down your workflow unless they are `async`.
- **Use descriptive names**: Help yourself and others understand what each hook does.
- **Test your hooks**: Run the commands manually first to ensure they work as expected.
- **Use local overrides**: For machine-specific hooks, use `.wave/settings.local.json`.

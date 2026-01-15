# Data Model: Slash Command Allowed Tools

## Entities

### CustomSlashCommandConfig (Extension)
The configuration object extracted from slash command markdown frontmatter.

| Field | Type | Description |
|-------|------|-------------|
| `allowedTools` | `string[]` | List of tool permission rules (e.g., `Bash(git status:*)`) |

### PermissionManager (State Extension)
The internal state of the permission manager.

| Field | Type | Description |
|-------|------|-------------|
| `temporaryRules` | `string[]` | In-memory rules added for the duration of a slash command |

## Validation Rules
- `allowedTools` must be an array of strings.
- Each string should follow the `ToolName(pattern)` format, consistent with `settings.json`.

## State Transitions
1. **Slash Command Triggered**: `allowedTools` are extracted from the command config.
2. **AI Cycle Start**: `PermissionManager.addTemporaryRules()` is called with the extracted tools.
3. **Tool Execution**: `PermissionManager.checkPermission()` matches against both `allowedRules` and `temporaryRules`.
4. **AI Cycle End**: `PermissionManager.clearTemporaryRules()` is called in the `finally` block of `sendAIMessage`.

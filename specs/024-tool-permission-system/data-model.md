# Data Model: Tool Permission System

## Core Entities

### PermissionMode
**Description**: Configuration setting that determines tool execution behavior.
**Values**: "default" | "acceptEdits" | "plan" | "bypassPermissions"

### PermissionRule
**Description**: A string defining a permitted or denied action.
**Formats**:
1. **Tool Name**: `Bash`, `Write`, `Read`
2. **Bash Command**: `Bash(ls -la)`, `Bash(git *)`
3. **Path-based**: `Read(**/*.env)`, `Write(/etc/**)`
   - Format: `ToolName(glob_pattern)`
   - Supported tools: `Read`, `Write`, `Edit`, `Delete`, `LS`
4. **MCP Tool**: `mcp__server__tool`
   - Format: `mcp__<server_name>__<tool_name>`

### AgentOptions (Extended)
**Description**: Configuration options for initializing an Agent instance.
**Fields**:
- `allowedTools?`: `string[]` (Instance-specific allowed rules, maps to `permissions.allow`)
- `disallowedTools?`: `string[]` (Instance-specific denied rules, maps to `permissions.deny`)
- `tools?`: `string[]` (Available tools list for filtering/visibility)

### WaveConfiguration
**Description**: The configuration object loaded from `settings.json`.
**Fields**:
- `permissions`:
    - `allow`: `string[]` (List of permitted rules)
    - `deny`: `string[]` (List of explicitly denied rules)
    - `defaultMode`: `PermissionMode`

### PermissionDecision
**Description**: Result of a permission authorization check.
**Fields**:
- `behavior`: "allow" | "deny"
- `message?`: `string` (Required when behavior is "deny")
- `hidePersistentOption?`: `boolean` (When true, "Don't ask again" is hidden in UI)

### ConfirmationState
**Description**: UI state for the permission confirmation dialog.
**Fields**:
- `isVisible`: `boolean`
- `selectedOption`: "allow" | "alternative" | "smartWildcard"
- `alternativeText`: `string`
- `suggestedPattern?`: `string` (The smart wildcard pattern)

### ConfirmationQueueItem
**Description**: Individual item in the confirmation queue for sequential processing.
**Fields**:
- `toolName`: `string`
- `resolver`: `(decision: PermissionDecision) => void`
- `reject`: `() => void`

## Entity Relationships

```
WaveConfiguration
    └── permissions
        ├── allow: PermissionRule[]
        └── deny: PermissionRule[]

Agent
    ├── permissionMode: PermissionMode
    ├── canUseTool: PermissionCallback
    ├── allowedTools: PermissionRule[] (Instance-specific)
    └── disallowedTools: PermissionRule[] (Instance-specific)

PermissionManager.checkPermission(context)
    ├── 1. Check disallowedTools (Instance-specific, Precedence)
    ├── 2. Check permissions.deny (Global, Precedence)
    ├── 3. Check allowedTools (Instance-specific)
    ├── 4. Check permissions.allow (Global, Exact or Wildcard)
    ├── 5. Check built-in safe commands (with path restrictions)
    └── 6. If not allowed, trigger Confirmation UI
```

## Implementation Notes

1. **Precedence**: `permissions.deny` always takes precedence over `permissions.allow`.
2. **Wildcard Matching**: Rules containing `*` are converted to regex for matching (for Bash) or use `minimatch` (for path-based tools).
3. **Pipeline Decomposition**: Complex bash commands are split into `SimpleCommand` entities before matching.
4. **Smart Wildcard**: Heuristic-based pattern generation for common commands (e.g., `npm install *`).
5. **Path Restrictions**: Built-in safe commands (`cd`, `ls`, `pwd`) are restricted to the CWD and its subdirectories.
6. **Chained Command Splitting**: When the user selects "Don't ask again" for a chained command, it is split into simple commands, and only non-safe ones are saved.
7. **Dangerous Command Safety**: Commands that are dangerous (e.g., `rm`, `sudo`), out-of-bounds, or contain write redirections will have `hidePersistentOption` set to true.

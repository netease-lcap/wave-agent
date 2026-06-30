# Data Model: Tool Permission System

## Core Entities

### PermissionMode
**Description**: Configuration setting that determines tool execution behavior.
**Values**: "default" | "acceptEdits" | "plan" | "bypassPermissions" | "dontAsk"

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
    - `permissionMode`: `PermissionMode`
    - `additionalDirectories`: `string[]` (List of paths that extend the Safe Zone)

### PermissionDecision
**Description**: Result of a permission authorization check.
**Fields**:
- `behavior`: "allow" | "deny"
- `message?`: `string` (Required when behavior is "deny")
- `hidePersistentOption?`: `boolean` (When true, "Don't ask again" is hidden in UI)
- `newPermissionMode?`: `PermissionMode` (Signal to change the session's permission mode)
- `newPermissionRule?`: `string` (Signal to persist a new allowed rule)

### ConfirmationState
**Description**: UI state for the permission confirmation dialog.
**Fields**:
- `isVisible`: `boolean`
- `selectedOption`: "allow" | "alternative" | "smartWildcard" | "autoAcceptEdits" | "dontAskAgain"
- `alternativeText`: `string`
- `suggestedPattern?`: `string` (The smart wildcard pattern)

### ConfirmationQueueItem
**Description**: Individual item in the confirmation queue for sequential processing.
**Fields**:
- `toolName`: `string`
- `resolver`: `(decision: PermissionDecision) => void`
- `reject`: `() => void`

### Safe Zone
**Description**: A logical entity representing the union of allowed directories for file operations.
**Fields**:
- `workdir`: `string` (The current working directory of the agent)
- `additionalDirectories`: `string[]` (User-defined allowed directories)

## Entity Relationships

```
WaveConfiguration
    └── permissions
        ├── allow: PermissionRule[]
        ├── deny: PermissionRule[]
        ├── permissionMode: PermissionMode
        └── additionalDirectories: string[]

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
    ├── 6. Check Safe Zone for file operations (Write, Edit, Delete, mkdir)
    └── 7. If not allowed, trigger Confirmation UI
```

## Configuration Hierarchy

### Settings Resolution Order
1. **Command-line flags** (highest precedence)
   - `--dangerously-skip-permissions` → "bypassPermissions"
   - No flags → use configuration `permissionMode`
   
2. **settings.local.json** (project-level override)
   - Local project-specific overrides
   - Typically gitignored, developer-specific
   
3. **settings.json (project-level)**
   - Project-wide defaults
   - Committed to repository
   
4. **settings.json (user-level)**  
   - User's global preferences
   - Stored in user config directory

5. **System default** (fallback)
   - "default" mode when no configuration present

## Implementation Notes

1. **Precedence**: `permissions.deny` always takes precedence over `permissions.allow`.
2. **Wildcard Matching**: Rules containing `*` are converted to regex for matching (for Bash) or use `minimatch` (for path-based tools).
3. **Pipeline Decomposition**: Complex bash commands are split into `SimpleCommand` entities before matching.
4. **Smart Wildcard**: Heuristic-based pattern generation for common commands (e.g., `npm install *`).
5. **Path Restrictions**: Built-in safe commands (`cd`, `ls`, `pwd`) are restricted to the CWD and its subdirectories.
6. **Chained Command Splitting**: When the user selects "Don't ask again" for a chained command, it is split into simple commands, and only non-safe ones are saved.
7. **Dangerous Command Safety**: Commands that are dangerous (e.g., `rm`, `sudo`), out-of-bounds, or contain write redirections will have `hidePersistentOption` set to true.
8. **Interactive Trust**: Selecting "Yes, and auto-accept edits" sets `newPermissionMode` to `acceptEdits`. Selecting "Yes, and don't ask again..." sets `newPermissionRule`.
9. **Rule Addition**: Triggered when `PermissionDecision` contains `newPermissionRule`. Results in updating `.wave/settings.local.json`.
10. **dontAsk Mode**: Auto-denies restricted tools not in allow list. Injects message into system prompt.
11. **Safe Zone Enforcement**: File modification operations outside the Safe Zone (CWD + `additionalDirectories`) always require confirmation, even in `acceptEdits` mode. Symbolic links are resolved to real paths.

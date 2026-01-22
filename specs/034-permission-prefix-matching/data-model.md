# Data Model: Permission Prefix Matching

## Entities

### Permission Rule
Represents a rule that allows specific tool calls.

- **Type**: `string`
- **Format**:
    - **Exact Match**: `ToolName(input_string)`
    - **Prefix Match**: `ToolName(prefix_string:*)`
- **Validation Rules**:
    - Must be a non-empty string.
    - Prefix matching is only triggered if the string ends exactly with `:*`.
    - The `:*` sequence is treated literally if it appears anywhere else in the string.

### Tool Permission Context
The context provided to the `PermissionManager` when checking permissions.

- **toolName**: Name of the tool being called (e.g., "Bash").
- **toolInput**: Arguments passed to the tool (e.g., `{ command: "git commit" }`).
- **permissionMode**: The current permission mode (e.g., "default", "bypassPermissions").

## Relationships

- `PermissionManager` holds a list of persistent `Permission Rule` strings (`allowedRules`) and temporary rules (`temporaryRules`).
- `PermissionManager` receives a `Tool Permission Context` and matches it against both `allowedRules` and `temporaryRules`.
- For `Bash` commands, the system ensures that *every* part of a command chain (e.g., `cmd1 && cmd2`) is allowed by at least one rule.

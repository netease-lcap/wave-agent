# Data Model: Secure File Access

## Entities

### WaveConfiguration (Extended)
The existing configuration object is extended to include path-based permissions.

| Field | Type | Description |
|-------|------|-------------|
| `permissions.additionalDirectories` | `string[]` | List of absolute or relative paths that are considered part of the Safe Zone. |

### Safe Zone
A logical entity representing the union of allowed directories.

| Field | Type | Description |
|-------|------|-------------|
| `workdir` | `string` | The current working directory of the agent. |
| `additionalDirectories` | `string[]` | User-defined allowed directories. |

## State Transitions

### Permission Check Flow
1.  **Input**: `toolName`, `toolInput` (containing file path), `permissionMode`, `workdir`, `additionalDirectories`.
2.  **Process**:
    - Resolve target file path to absolute real path.
    - Resolve `workdir` and `additionalDirectories` to absolute real paths.
    - Check if target path is inside any of the resolved safe paths.
3.  **Output**:
    - `behavior: "allow"` if (inside Safe Zone AND `acceptEdits`) OR (not a restricted tool).
    - `behavior: "deny"` (with message) if outside Safe Zone OR (inside Safe Zone AND NOT `acceptEdits`).

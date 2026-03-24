# Data Model: AcceptEdits Permission Mode

## Entities

### PermissionMode (Type)
- **Description**: Defines the current level of authorization required for restricted tools.
- **Values**:
  - `default`: Requires user confirmation for all restricted tools (`Edit`, ``, `Delete`, `Write`, `Bash`).
  - `acceptEdits`: Automatically accepts `Edit`, ``, `Delete`, and `Write`. Requires confirmation for `Bash`.
  - `bypassPermissions`: Automatically accepts all restricted tools.

### Configuration (Entity)
- **Description**: Global settings loaded from `settings.json`.
- **Fields**:
  - `permissionMode`: `PermissionMode` (Optional, defaults to `default`).

## State Transitions

### Permission Mode Cycling
- **Trigger**: `Shift+Tab` in CLI.
- **Transition**: `default` -> `acceptEdits` -> `bypassPermissions` -> `default`.

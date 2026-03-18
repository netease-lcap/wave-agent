# Data Model: dontAsk Permission Mode

## Entities

### PermissionMode (Updated)
- **Type**: Union of strings
- **Values**: `"default"`, `"bypassPermissions"`, `"acceptEdits"`, `"plan"`, `"dontAsk"`
- **Description**: Determines how tool permissions are handled.

### PermissionRule (Existing)
- **Description**: A rule in `permissions.allow` or `temporaryRules` that pre-approves a tool call.

## Validation Rules
- In `dontAsk` mode, restricted tools MUST match a `PermissionRule` to be allowed.
- Unrestricted tools are always allowed.
- `deny` rules take precedence over `allow` rules.

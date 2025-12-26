# Data Model: Remove Bypass Permissions from Shift+Tab

## Entities

### PermissionMode (Existing)

The `PermissionMode` type is defined in `packages/agent-sdk/src/types/permissions.ts`.

- **Type**: Union of string literals
- **Values**:
  - `"default"`: Standard mode with permission prompts for restricted tools.
  - `"acceptEdits"`: Automatically accepts file modifications.
  - `"bypassPermissions"`: Bypasses all permission checks.

## State Transitions

The `InputManager` maintains the current `permissionMode` state. The `cyclePermissionMode` method handles the transition between states when triggered by the `Shift+Tab` shortcut.

### New Transition Logic

| Current State | Trigger | Next State |
|---------------|---------|------------|
| `"default"` | `Shift+Tab` | `"acceptEdits"` |
| `"acceptEdits"` | `Shift+Tab` | `"default"` |
| `"bypassPermissions"` | `Shift+Tab` | `"default"` |
| Any other (if added) | `Shift+Tab` | `"default"` |

This logic ensures that `bypassPermissions` is no longer reachable via the shortcut cycle, and if the system somehow enters that state, the shortcut provides a way back to the safe cycle.

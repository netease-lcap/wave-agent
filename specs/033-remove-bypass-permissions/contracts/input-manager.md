# API Contracts: Remove Bypass Permissions from Shift+Tab

## Internal Component Contracts

### InputManager (packages/code/src/managers/InputManager.ts)

#### `cyclePermissionMode(): void`

- **Description**: Cycles the current permission mode to the next one in the defined sequence.
- **Pre-condition**: None.
- **Post-condition**: 
  - If `permissionMode` was `"default"`, it becomes `"acceptEdits"`.
  - If `permissionMode` was `"acceptEdits"`, it becomes `"default"`.
  - If `permissionMode` was `"bypassPermissions"` or any other value, it becomes `"default"`.
  - `callbacks.onPermissionModeChange` is called with the new mode.

### InputManagerCallbacks (packages/code/src/managers/InputManager.ts)

#### `onPermissionModeChange?: (mode: PermissionMode) => void`

- **Description**: Optional callback triggered when the permission mode changes.
- **Parameters**:
  - `mode`: The new `PermissionMode`.

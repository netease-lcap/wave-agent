# SDK Contract: Permission Management

## Agent Class

### Methods

#### `getPermissionMode(): PermissionMode`
- **Description**: Returns the current effective permission mode.
- **Returns**: `PermissionMode`

#### `setPermissionMode(mode: PermissionMode): void`
- **Description**: Sets the current permission mode for the session.
- **Parameters**:
  - `mode`: `PermissionMode`

## PermissionManager Class

### Methods

#### `updateConfiguredDefaultMode(mode: PermissionMode): void`
- **Description**: Updates the default mode from configuration.
- **Parameters**:
  - `mode`: `PermissionMode`

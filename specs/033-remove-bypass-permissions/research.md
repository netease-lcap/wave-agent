# Research: Remove Bypass Permissions from Shift+Tab

## Decision: Modify `InputManager.cyclePermissionMode`

The `InputManager.cyclePermissionMode` method in `packages/code/src/managers/InputManager.ts` currently cycles through three modes: `default`, `acceptEdits`, and `bypassPermissions`.

### Rationale
The requirement is to remove `bypassPermissions` from this cycle. The most direct and safe way to implement this is to modify the `modes` array within the `cyclePermissionMode` method.

### Alternatives Considered
1. **Remove `bypassPermissions` from `PermissionMode` type**:
   - **Rationale**: If it's not used anywhere else, removing it from the type system would be cleaner.
   - **Evaluation**: `bypassPermissions` is still a valid mode that might be set via other means (e.g., configuration or environment variables). Removing it from the type system would be a breaking change for the SDK and might affect other parts of the system that still support it. The requirement specifically mentions removing it from the `Shift+Tab` shortcut, not necessarily from the entire system.
   - **Decision**: Keep the type but remove it from the shortcut cycle.

2. **Add a configuration option for the cycle**:
   - **Rationale**: Allows users to customize which modes are included in the cycle.
   - **Evaluation**: Over-engineering for the current requirement. The constitution favors minimalism.
   - **Decision**: Hardcode the new cycle in `InputManager`.

## Findings

### Current Implementation in `InputManager.ts`:
```typescript
  cyclePermissionMode(): void {
    const modes: PermissionMode[] = [
      "default",
      "acceptEdits",
      "bypassPermissions",
    ];
    const currentIndex = modes.indexOf(this.permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];
    // ...
    this.permissionMode = nextMode;
    this.callbacks.onPermissionModeChange?.(this.permissionMode);
  }
```

### Proposed Implementation:
```typescript
  cyclePermissionMode(): void {
    const modes: PermissionMode[] = [
      "default",
      "acceptEdits",
    ];
    let nextIndex: number;
    const currentIndex = modes.indexOf(this.permissionMode);
    
    if (currentIndex === -1) {
      // Current mode is not in the cycle (e.g., "bypassPermissions")
      nextIndex = 0; // Go to "default"
    } else {
      nextIndex = (currentIndex + 1) % modes.length;
    }
    
    const nextMode = modes[nextIndex];
    // ...
    this.permissionMode = nextMode;
    this.callbacks.onPermissionModeChange?.(this.permissionMode);
  }
```

This implementation handles the case where the current mode is `bypassPermissions` by defaulting to `default` on the next press, satisfying User Story 2.

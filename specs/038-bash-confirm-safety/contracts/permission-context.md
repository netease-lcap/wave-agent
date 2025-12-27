# API Contract: Permission Callback Context

This document describes the change to the `ToolPermissionContext` interface, which is used by the `PermissionManager` to communicate with the UI callback.

## `ToolPermissionContext` Interface

```typescript
export interface ToolPermissionContext {
  /** Name of the tool being executed */
  toolName: string;
  /** Current permission mode */
  permissionMode: PermissionMode;
  /** Custom permission callback if provided */
  canUseToolCallback?: PermissionCallback;
  /** Tool input parameters for better context */
  toolInput?: Record<string, unknown>;
  /** Suggested prefix for bash commands */
  suggestedPrefix?: string;
  /** 
   * NEW: Whether to hide the persistent permission option (e.g., "Don't ask again")
   * in the UI for this specific tool call.
   */
  hidePersistentOption?: boolean;
}
```

## Usage in `Confirmation` Component

The `Confirmation` component in the `code` package will receive this context (via props) and use `hidePersistentOption` to conditionally render the "auto" option.

```tsx
// In Confirmation.tsx
const showAutoOption = !context.hidePersistentOption;

return (
  // ...
  {showAutoOption && (
    <Box key="auto-option">
      {/* ... "Don't ask again" option ... */}
    </Box>
  )}
  // ...
);
```

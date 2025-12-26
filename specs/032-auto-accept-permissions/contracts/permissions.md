# Contracts: Auto-Accept Permissions

## Permission System Types

```typescript
// packages/agent-sdk/src/types/permissions.ts

export type PermissionMode = "default" | "bypassPermissions" | "acceptEdits";

export interface PermissionDecision {
  behavior: "allow" | "deny";
  message?: string;
  /** Signal to change the session's permission mode */
  newPermissionMode?: PermissionMode;
  /** Signal to persist a new allowed rule */
  newPermissionRule?: string;
}
```

## Configuration Types

```typescript
// packages/agent-sdk/src/types/hooks.ts

export interface WaveConfiguration {
  hooks?: Partial<Record<HookEvent, HookEventConfig[]>>;
  env?: Record<string, string>;
  defaultMode?: PermissionMode;
  /** New field for persistent permissions */
  permissions?: {
    allow?: string[];
  };
}
```

## UI Component Props

```typescript
// packages/code/src/components/Confirmation.tsx

export interface ConfirmationProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
  onDecision: (decision: PermissionDecision) => void;
  onCancel: () => void;
  onAbort: () => void;
}
```

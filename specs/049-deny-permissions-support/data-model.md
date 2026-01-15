# Data Model: Support permissions.deny in settings.json

## WaveConfiguration Evolution

The `WaveConfiguration` interface in `packages/agent-sdk/src/types/configuration.ts` will be updated to include `deny`.

```typescript
export interface WaveConfiguration {
  // ... existing fields
  permissions?: {
    allow?: string[];
    deny?: string[]; // New field
    defaultMode?: "default" | "bypassPermissions" | "acceptEdits";
    additionalDirectories?: string[];
  };
  // ...
}
```

## PermissionManagerOptions Evolution

```typescript
export interface PermissionManagerOptions {
  // ... existing fields
  allowedRules?: string[];
  deniedRules?: string[]; // New field
  // ...
}
```

## Rule Formats

1. **Tool Name**: `Bash`, `Write`, `Read`
2. **Bash Command**: `Bash(ls -la)`, `Bash(rm:*)`
3. **Path-based**: `Read(**/*.env)`, `Write(/etc/**)`, `Delete(/tmp/test.txt)`
   - Format: `ToolName(glob_pattern)`
   - Supported tools: `Read`, `Write`, `Edit`, `MultiEdit`, `Delete`, `LS`

# API Contracts: Support Plan Mode

## PermissionManager Extensions

```typescript
export interface PermissionManagerOptions {
  // ... existing options
  planFilePath?: string; // Path to the current plan file
}

export class PermissionManager {
  // ... existing methods
  public setPlanFilePath(path: string | undefined): void;
}
```

## Agent Extensions

```typescript
export class Agent {
  // ... existing methods
  public setPermissionMode(mode: PermissionMode): void;
  // Internal logic will handle plan file creation when mode is set to "plan"
}
```

## New PlanManager (Internal)

```typescript
export class PlanManager {
  constructor(workdir: string, logger?: Logger);
  public async getOrGeneratePlanFilePath(): Promise<{ path: string; name: string }>;
  public getPlanDir(): string;
}
```

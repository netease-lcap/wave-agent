# Bash Tools API Contract

**Version**: 1.0.0
**Feature**: Bash Tools

## TypeScript Interface Definitions

### Bash Tool Arguments
```typescript
interface BashArgs {
  command: string;
  timeout?: number;
  description?: string;
  run_in_background?: boolean;
}
```

### Bash Output Tool Arguments
```typescript
interface BashOutputArgs {
  bash_id: string;
  filter?: string;
}
```

### Kill Bash Tool Arguments
```typescript
interface KillBashArgs {
  shell_id: string;
}
```

## Background Bash Manager API

```typescript
interface BackgroundBashManager {
  startShell(command: string, timeout?: number): string; // returns shellId
  getOutput(shellId: string, filter?: string): {
    stdout: string;
    stderr: string;
    status: string;
  } | null;
  getShell(shellId: string): BackgroundShell | null;
  killShell(shellId: string): boolean;
}

interface BackgroundShell {
  id: string;
  command: string;
  status: "running" | "completed" | "failed" | "killed";
  stdout: string;
  stderr: string;
  exitCode?: number;
  startTime: number;
  endTime?: number;
}
```

## Execution Flow
1. **Foreground**: `Bash` tool spawns a process, waits for completion or timeout, and returns the combined output.
2. **Background**: `Bash` tool registers the command with `BackgroundBashManager`, which spawns the process and returns a `bash_id`.
3. **Monitoring**: `BashOutput` tool queries `BackgroundBashManager` for accumulated output of a specific `bash_id`.
4. **Termination**: `KillBash` tool requests `BackgroundBashManager` to terminate a specific `shell_id`.

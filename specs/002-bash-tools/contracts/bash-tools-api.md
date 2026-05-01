# Bash Tools API Contract

**Version**: 2.0.0
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

## Background Task Manager API

```typescript
interface BackgroundTaskManager {
  startShell(command: string, timeout?: number): { id: string }; // returns taskId
  getTask(taskId: string): BackgroundTask | null;
  stopTask(taskId: string): boolean;
}

interface BackgroundTask {
  id: string;
  command: string;
  status: "running" | "completed" | "failed" | "killed";
  outputPath: string;   // path to real-time log file
  exitCode?: number;
}
```

## Foreground Task Manager API

```typescript
interface ForegroundTaskManager {
  registerForegroundTask(task: { id: string; backgroundHandler: () => Promise<void> }): void;
  unregisterForegroundTask(id: string): void;
}
```

## Execution Flow
1. **Foreground**: `Bash` tool spawns a fresh shell process via `spawn(command, { shell: true, cwd: context.workdir })`, streams output via `onResultUpdate`/`onShortResultUpdate` callbacks, and returns combined stdout+stderr on completion.
2. **Background**: `Bash` tool calls `BackgroundTaskManager.startShell()` which spawns the process and pipes output to a log file. Returns `taskId` and `outputPath` immediately. Agents use the `Read` tool to monitor output.
3. **Termination**: `TaskStop` tool calls `BackgroundTaskManager.stopTask()` to terminate a background process (SIGTERM → SIGKILL on process group).

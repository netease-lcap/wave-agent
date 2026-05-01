# Data Model: Bash Tools

**Feature**: Bash Tools
**Source**: Extracted from current implementation in `packages/agent-sdk/src/tools/bashTool.ts`

## Core Entities

### BashArguments
**Purpose**: Arguments for the `Bash` tool.
**Fields**:
- `command: string`: The shell command to execute.
- `timeout?: number`: Maximum execution time in milliseconds (max 600000).
- `description?: string`: Brief description of what the command does (5-10 words).
- `run_in_background?: boolean`: Whether to run the command in the background.

### BackgroundTask
**Purpose**: Internal state for background processes (managed by `BackgroundTaskManager`).
**Fields**:
- `id: string`: Unique identifier (e.g., `shell_<timestamp>_<random>`).
- `command: string`: The command being run.
- `status: "running" | "completed" | "failed" | "killed"`: Current status.
- `outputPath: string`: Path to a real-time log file for stdout/stderr.
- `exitCode?: number`: Process exit code (set when completed).

### ForegroundTask
**Purpose**: Tracks running foreground commands for streaming and backgrounding (managed by `ForegroundTaskManager`).
**Fields**:
- `id: string`: Unique identifier (e.g., `bash_<timestamp>_<random>`).
- `child: ChildProcess`: The spawned child process.
- `backgroundHandler: () => Promise<void>`: Callback to move the process to background.

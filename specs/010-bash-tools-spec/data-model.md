# Data Model: Bash Tools

**Feature**: Bash Tools
**Source**: Extracted from current implementation in `packages/agent-sdk/src/tools/bashTool.ts`

## Core Entities

### BashArguments
**Purpose**: Arguments for the `Bash` tool.
**Fields**:
- `command: string`: The shell command to execute.
- `timeout?: number`: Maximum execution time in milliseconds.
- `description?: string`: Brief description of the command.
- `run_in_background?: boolean`: Whether to run the command in the background.

### BashOutputArguments
**Purpose**: Arguments for the `BashOutput` tool.
**Fields**:
- `bash_id: string`: The ID of the background process.
- `filter?: string`: Regex to filter output lines.

### KillBashArguments
**Purpose**: Arguments for the `KillBash` tool.
**Fields**:
- `shell_id: string`: The ID of the background process to kill.

### BackgroundShell
**Purpose**: Internal state for background processes.
**Fields**:
- `id: string`: Unique identifier.
- `command: string`: The command being run.
- `status: "running" | "completed" | "failed" | "killed"`: Current status.
- `stdout: string`: Accumulated standard output.
- `stderr: string`: Accumulated standard error.
- `exitCode?: number`: Process exit code.

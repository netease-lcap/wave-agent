# Bash Tools Quickstart

## Overview
Bash tools allow the agent to execute terminal commands. Each command spawns a fresh shell process — `cd` and environment changes do NOT persist between calls.

## Usage Examples

### Running a Foreground Command
```typescript
// Run a command and wait for output
const result = await bashTool.execute({
  command: "pnpm test",
  description: "Run unit tests"
}, context);
```

### Running a Background Command
```typescript
// Start a long-running process
const result = await bashTool.execute({
  command: "pnpm start",
  run_in_background: true
}, context);
// Returns a taskId and outputPath
```

### Reading Background Output
```typescript
// Use the Read tool to monitor a background process's log file
const output = await readTool.execute({
  file_path: "/tmp/bash_task_123.log"
}, context);
```

### Stopping a Background Process
```typescript
// Terminate a background process
const result = await taskStopTool.execute({
  task_id: "shell_123"
}, context);
```

## Key Implementation Details
- **Fresh Shell per Command**: Each call uses `spawn(command, { shell: true, cwd: context.workdir })`. The working directory resets to `context.workdir` after each command.
- **Process Groups**: Background processes are killed using process group IDs (SIGTERM → SIGKILL) to ensure all child processes are terminated.
- **Output Management**: Foreground output streams via callbacks. Background output is piped to a log file readable via the `Read` tool.

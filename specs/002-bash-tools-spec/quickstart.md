# Bash Tools Quickstart

## Overview
Bash tools allow the agent to execute terminal commands.

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
// Returns a bash_id
```

### Checking Background Output
```typescript
// Retrieve output from a background process
const result = await bashOutputTool.execute({
  bash_id: "shell_123",
  filter: "Error"
}, context);
```

### Killing a Background Process
```typescript
// Terminate a background process
const result = await killBashTool.execute({
  shell_id: "shell_123"
}, context);
```

## Key Implementation Details
- **Persistent Shell**: While each call uses `spawn`, the environment is maintained via the `ToolContext`.
- **Process Groups**: Background processes are killed using process group IDs to ensure all child processes are terminated.
- **Output Management**: Output is buffered and can be filtered via `BashOutput`.

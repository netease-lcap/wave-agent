# Research: Bash Tools Implementation

## Execution Model
**Decision**: Use `child_process.spawn` with `shell: true` — fresh shell per command.
**Rationale**: Each command spawns a new shell process with `cwd: context.workdir`. The shell working directory resets after each command, so `cd` does not persist between calls. The agent prompt instructs use of absolute paths.

## Background Execution
**Decision**: Implement `BackgroundTaskManager` to track long-running processes via log files.
**Rationale**: Agents often need to start servers or long-running tests and continue working. Background output is piped to a log file that the agent reads via the `Read` tool.

## Output Handling
**Decision**: Strip ANSI color codes and truncate output at 30,000 characters.
**Rationale**: ANSI codes clutter the LLM's context and are not useful for reasoning. Truncation prevents context window overflow. Excess output is persisted to a temp file with the path returned.

## Real-time Streaming
**Decision**: Foreground commands stream updates to both `shortResult` (last 3 lines) and full `result` via `onShortResultUpdate` and `onResultUpdate` callbacks.
**Rationale**: Provides responsive feedback for long-running commands without blocking the agent.

## Process Termination
**Decision**: Use negative PID (e.g., `process.kill(-pid)`) for termination, with SIGTERM followed by SIGKILL fallback.
**Rationale**: This ensures that the entire process group (including any sub-processes started by the command) is killed, preventing zombie processes.

## Security
**Decision**: Integrate with `PermissionManager` and discourage use for file operations.
**Rationale**: Bash is a powerful tool that requires strict oversight. Encouraging specialized FS tools (Read, Write, Edit, Glob, Grep) reduces the risk of accidental or malicious system damage.

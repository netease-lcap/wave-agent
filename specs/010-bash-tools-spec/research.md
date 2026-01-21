# Research: Bash Tools Implementation

## Execution Model
**Decision**: Use `child_process.spawn` with `shell: true`.
**Rationale**: Provides the most flexible way to execute shell commands across different platforms while allowing for pipe and redirection support.

## Background Execution
**Decision**: Implement a `BackgroundBashManager` to track long-running processes.
**Rationale**: Agents often need to start servers or long-running tests and continue working. A manager allows for asynchronous monitoring and control.

## Output Handling
**Decision**: Strip ANSI color codes and truncate output at 30,000 characters.
**Rationale**: ANSI codes clutter the LLM's context and are not useful for reasoning. Truncation prevents context window overflow.

## Process Termination
**Decision**: Use negative PID (e.g., `process.kill(-pid)`) for termination.
**Rationale**: This ensures that the entire process group (including any sub-processes started by the command) is killed, preventing zombie processes.

## Security
**Decision**: Integrate with `PermissionManager` and discourage use for file operations.
**Rationale**: Bash is a powerful tool that requires strict oversight. Encouraging specialized FS tools reduces the risk of accidental or malicious system damage.

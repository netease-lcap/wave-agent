# Research: Bang Shell Command

## Background

The "bang shell command" feature is a common pattern in interactive shells and chat interfaces (e.g., Jupyter notebooks, some IRC clients) where a prefix (usually `!`) is used to execute a command in the underlying operating system's shell.

## Implementation Details

### Shell Execution

- **`child_process.spawn`**: This is the preferred method for executing shell commands in Node.js as it provides better control over the process lifecycle and allows for streaming output.
- **`shell: true`**: This option should be used to ensure that the command is executed within a shell environment, allowing for shell features like globbing and environment variable expansion.
- **`stdio: "pipe"`**: This allows the agent to capture stdout and stderr from the process.

### Output Management

- **Truncation**: To prevent long outputs from overwhelming the chat history, the output should be truncated by default. A common approach is to show only the last few lines of the output.
- **Expansion**: Users should be able to expand the output block to see the full result. This can be implemented using a toggle state in the `BangDisplay` component.

### Error Handling

- **Exit Codes**: The exit code of the process should be captured and used to indicate the success or failure of the command.
- **Signals**: Signals like `SIGINT` (Ctrl+C) should be handled gracefully to allow users to abort long-running commands.

## Alternatives Considered

- **`child_process.exec`**: This method is simpler but buffers the entire output in memory, which can be problematic for commands with very large outputs. `spawn` is more robust for this use case.
- **Restricting Commands**: For security reasons, it might be desirable to restrict the types of commands that can be executed. However, for a developer-focused tool, providing full shell access is often more useful.

## References

- [Node.js child_process documentation](https://nodejs.org/api/child_process.html)
- [Ink documentation](https://github.com/vadimdemedes/ink)

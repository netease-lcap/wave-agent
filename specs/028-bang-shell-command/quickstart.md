# Quickstart: Bang Shell Command

## Overview

The "bang shell command" feature allows you to execute shell commands directly from the chat input by prefixing them with `!`.

## Usage

1. **Execute a command**: Type `!ls -la` in the chat input and press Enter.
2. **View output**: The command and its output will be displayed in a dedicated block in the conversation history.
3. **Truncated output**: If the output is long, only the last 3 lines will be shown by default.
4. **Expand output**: Click on the output block or use a keyboard shortcut to see the full result.
5. **Abort command**: Press Ctrl+C while a command is running to terminate it.

## Examples

- `!ls -la`: List files in the current directory.
- `!fdfind .`: Find files in the current directory (using `fd` or `fdfind`).
- `!echo "hello world"`: Print "hello world" to the chat.
- `!sleep 10`: Run a command that takes 10 seconds to complete.

## Troubleshooting

- **Command not found**: If you get an error like "command not found", ensure that the command is installed on your system and is in your PATH.
- **Permission denied**: If you get a "permission denied" error, ensure that you have the necessary permissions to execute the command.
- **Concurrent execution**: Only one bang command can be executed at a time. If you try to run another command while one is already running, you will get an error.

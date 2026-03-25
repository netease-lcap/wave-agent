# Contract: Bang Execution

## Overview

The `BangManager` is responsible for executing shell commands and updating the message history.

## Interface

### `BangManager`

- **`executeCommand(command: string): Promise<number>`**: Executes the given shell command and returns the exit code.
- **`abortCommand(): void`**: Kills the currently running process.
- **`isCommandRunning: boolean`**: Whether a command is currently executing.

### `MessageManager`

- **`addBangMessage(command: string): void`**: Adds a new `BangBlock` to the message history.
- **`updateBangMessage(command: string, output: string): void`**: Updates the output of a `BangBlock`.
- **`completeBangMessage(command: string, exitCode: number, output: string): void`**: Completes a `BangBlock` with the final exit code and output.

## Behavior

- **`executeCommand`**:
    - MUST prevent concurrent execution of multiple bang commands.
    - MUST use `child_process.spawn` with `shell: true` and `stdio: "pipe"`.
    - MUST capture stdout and stderr and update the message history.
    - MUST handle process exit and error events.
- **`abortCommand`**:
    - MUST kill the running process using `SIGKILL`.
    - MUST update the `isCommandRunning` state.
- **`BangDisplay`**:
    - MUST truncate long outputs to a maximum of 3 lines by default.
    - MUST provide a way to expand the output block.
    - MUST use colors to indicate execution status (running, success, failure).

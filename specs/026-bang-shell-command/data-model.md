# Data Model: Bang Shell Command

## Entities

### `BangBlock`

A message block type representing a shell command execution.

- **`type`**: `"bang"` (string)
- **`command`**: The shell command string (string)
- **`output`**: The captured stdout and stderr (string)
- **`isRunning`**: Whether the command is currently executing (boolean)
- **`exitCode`**: The exit code of the process (number | null)

### `BangManagerOptions`

Options for initializing the `BangManager`.

- **`workdir`**: The working directory for command execution (string)

## Relationships

- **`MessageManager`**: The `BangManager` uses the `MessageManager` to add and update `BangBlock`s in the conversation history.
- **`InputManager`**: The `InputManager` detects `!` prefix in chat input and calls the `BangManager` to execute the command.
- **`BangDisplay`**: The `BangDisplay` component renders a `BangBlock` in the UI.

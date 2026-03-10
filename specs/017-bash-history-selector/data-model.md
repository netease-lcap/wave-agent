# Data Model: Bash History Selector

## Entities

### HistoryEntry
Represents a single command in the bash history.

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | The full command string. |
| `timestamp` | number | Unix timestamp of when the command was executed. |
| `directory` | string | The directory where the command was executed. |

### SelectorState
The internal state of the history selector in `InputManager`.

| Field | Type | Description |
|-------|------|-------------|
| `isActive` | boolean | Whether the selector is currently visible. |
| `query` | string | The current search string typed after `!`. |
| `selectedIndex` | number | The index of the currently highlighted item. |
| `results` | HistoryEntry[] | The list of matching history entries. |

## State Transitions

1. **Inactive**: The default state where the selector is hidden.
2. **Active**: Triggered by typing `!` at the start of the input.
3. **Filtering**: As the user types, the `query` is updated and `results` are refreshed.
4. **Executed**: User presses `Enter`. The command is executed and the selector returns to **Inactive**.
5. **Inserted**: User presses `Tab`. The command is inserted for editing and the selector returns to **Inactive**.
6. **Cancelled**: User presses `Escape` or deletes the `!`. The selector returns to **Inactive**.

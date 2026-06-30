# Data Model: File Selector

## Entities

### FileItem
Represents a file or directory in the selector list.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | The name of the file or directory. |
| `path` | string | The full or relative path to the item. |
| `type` | 'file' \| 'directory' | Whether the item is a file or a directory. |

### SelectorState
The internal state of the file selector in `InputManager`.

| Field | Type | Description |
|-------|------|-------------|
| `isActive` | boolean | Whether the selector is currently visible. |
| `query` | string | The current search string typed after `@`. |
| `selectedIndex` | number | The index of the currently highlighted item. |
| `results` | FileItem[] | The list of matching items found. |

## State Transitions

1. **Inactive**: The default state where the selector is hidden.
2. **Active**: Triggered by typing `@`. The selector is visible and performing searches.
3. **Filtering**: As the user types, the `query` is updated and `results` are refreshed.
4. **Selected**: User presses `Enter` or `Tab`. The selected path is inserted and the selector returns to **Inactive**.
5. **Cancelled**: User presses `Escape` or deletes the `@`. The selector returns to **Inactive**.

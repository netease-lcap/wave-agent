# Internal Contracts: Prompt History

## PromptHistoryManager (SDK)

The `PromptHistoryManager` is responsible for all I/O operations related to the prompt history file.

### Methods

#### `addEntry(prompt: string): Promise<void>`
- **Description**: Appends a new prompt to the history file.
- **Input**: `prompt` (string)
- **Behavior**: 
    - Creates a `PromptEntry` with the current timestamp.
    - Appends the JSON stringified entry followed by a newline to `~/.wave/history.jsonl`.

#### `getHistory(): Promise<PromptEntry[]>`
- **Description**: Reads all entries from the history file.
- **Output**: `Promise<PromptEntry[]>`
- **Behavior**:
    - Reads `~/.wave/history.jsonl`.
    - Parses each line as JSON.
    - Returns an array of entries, sorted by timestamp (newest first).

#### `searchHistory(query: string): Promise<PromptEntry[]>`
- **Description**: Filters history entries based on a search query.
- **Input**: `query` (string)
- **Output**: `Promise<PromptEntry[]>`
- **Behavior**:
    - Performs a case-insensitive search of the `query` within the `prompt` field of all entries.
    - Returns matching entries.

## HistorySearch Component (UI)

### Props

| Prop | Type | Description |
|------|------|-------------|
| `onSelect` | `(prompt: string) => void` | Callback when a prompt is selected. |
| `onClose` | `() => void` | Callback when the search interface is closed. |
| `initialQuery` | `string` | (Optional) Initial search query. |

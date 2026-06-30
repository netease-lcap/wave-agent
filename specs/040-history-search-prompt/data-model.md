# Data Model: History Search Prompt

## Entities

### PromptEntry
Represents a single user prompt saved in the history.

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | `string` | The full text of the user's prompt. |
| `timestamp` | `number` | The Unix timestamp (milliseconds) when the prompt was sent. |

## Persistence

### File Format: JSONL
The history is stored in `~/.wave/history.jsonl`. Each line is a valid JSON object representing a `PromptEntry`.

**Example:**
```json
{"prompt": "how to use git", "timestamp": 1706832000000}
{"prompt": "list all files in src", "timestamp": 1706832060000}
```

## Validation Rules
- `prompt` MUST NOT be empty when saving.
- `timestamp` MUST be a valid positive integer.

# TodoWrite Tool API Contract

**Version**: 1.0.0
**Feature**: TodoWrite Tool

## TypeScript Interface Definitions

### Todo Item
```typescript
interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}
```

### TodoWrite Tool Arguments
```typescript
interface TodoWriteArgs {
  todos: TodoItem[];
}
```

## Validation Logic
The `TodoWrite` tool performs the following checks before updating the state:
1. **Array Check**: `todos` must be an array.
2. **Item Structure**: Each item must have `id`, `content`, and `status`.
3. **Unique IDs**: No two items can have the same `id`.
4. **Single In-Progress**: At most one item can have `status: "in_progress"`.
5. **Non-Empty Content**: `content` must be a non-empty string.

## Output Format
- **Success**: Returns a summary of completed tasks (e.g., "2/5 completed").
- **Short Result**: Returns a multi-line string showing the status of each task:
  - `[ ]` for pending
  - `[>]` for in_progress
  - `[x]` for completed
- **Error**: Returns a descriptive error message if validation fails.

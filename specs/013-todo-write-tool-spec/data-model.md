# Data Model: TodoWrite Tool

**Feature**: TodoWrite Tool
**Source**: Extracted from current implementation in `packages/agent-sdk/src/tools/todoWriteTool.ts`

## Core Entities

### TodoItem
**Purpose**: Represents a single task in the todo list.
**Fields**:
- `id: string`: Unique identifier for the task.
- `content: string`: Description of the task.
- `status: "pending" | "in_progress" | "completed"`: Current state of the task.

### TodoWriteArguments
**Purpose**: Arguments for the `TodoWrite` tool.
**Fields**:
- `todos: TodoItem[]`: The complete, updated list of todos.

## Validation Rules
- **Unique IDs**: Every todo item must have a unique `id`.
- **Single In-Progress**: At most one todo item can have the status `in_progress`.
- **Non-Empty Content**: Task content must not be empty.
- **Valid Status**: Status must be one of the three allowed values.

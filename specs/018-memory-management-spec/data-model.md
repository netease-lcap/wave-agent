# Memory Management Data Model

## Storage Format

Both Project and User memory files use a simple Markdown format:

```markdown
# Memory (or # User Memory)

This is the memory file...

- Entry 1
- Entry 2
- Entry 3
```

## Memory Types

```typescript
type MemoryType = "project" | "user";
```

## Service Interfaces

### `addMemory` (Project)
```typescript
export const addMemory = async (
  message: string,
  workdir: string,
): Promise<void>;
```

### `addUserMemory` (Global)
```typescript
export const addUserMemory = async (message: string): Promise<void>;
```

### `getCombinedMemoryContent`
```typescript
export const getCombinedMemoryContent = async (
  workdir: string,
): Promise<string>;
```

## Constants

- `USER_MEMORY_FILE`: Path to the global user memory file.
- `DATA_DIRECTORY`: Path to the global configuration directory.
- `AGENTS.md`: Hardcoded filename for project-level memory.

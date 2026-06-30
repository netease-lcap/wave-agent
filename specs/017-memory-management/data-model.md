# Data Model: Memory Management

## Entities

### MemoryEntry
A single piece of persisted information.

| Field | Type | Description |
|-------|------|-------------|
| `content` | string | The text of the memory (e.g., "Use pnpm"). |
| `type` | 'project' \| 'user' | Whether it's stored in `AGENTS.md` or global memory. |
| `source` | string | The absolute path to the storage file. |

### MemoryRule

Represents a single memory rule discovered from the filesystem.

```typescript
interface MemoryRule {
  /** Unique identifier, typically the relative path from the rules root */
  id: string;
  /** The raw content of the markdown file (excluding frontmatter) */
  content: string;
  /** Metadata parsed from YAML frontmatter */
  metadata: MemoryRuleMetadata;
  /** Source of the rule (project-level or user-level) */
  source: 'project' | 'user';
  /** Absolute path to the file on disk */
  filePath: string;
}
```

### MemoryRuleMetadata

Metadata extracted from the YAML frontmatter of a memory rule file.

```typescript
interface MemoryRuleMetadata {
  /** 
   * Glob patterns that determine when this rule is active.
   * If undefined or empty, the rule is always active.
   */
  paths?: string[];
  /** 
   * Optional priority override. 
   * Higher numbers take precedence if there are conflicting instructions.
   */
  priority?: number;
}
```

### MemoryRuleRegistryState

The internal state maintained by the `MemoryRuleManager`.

```typescript
interface MemoryRuleRegistryState {
  /** All discovered rules, indexed by ID */
  rules: Record<string, MemoryRule>;
  /** Set of active rule IDs based on the current context */
  activeRuleIds: Set<string>;
}
```

## State Transitions

1. **Idle**: Normal input mode.
2. **Triggered**: User asks the agent to remember something.
3. **Saving**: The entry is written to the appropriate file (AGENTS.md, global memory, or auto-memory).
4. **Persisted**: The entry is now available for future AI requests.

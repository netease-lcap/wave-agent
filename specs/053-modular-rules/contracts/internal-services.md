# Internal Contracts: Modular Memory Rules

## MemoryRuleManager (Internal Service)

Responsible for the lifecycle of memory rules: discovery, loading, and state management.

```typescript
interface IMemoryRuleManager {
  /**
   * Scans .wave/rules and ~/.wave/rules for memory rule files.
   * Resolves symlinks and handles circularity.
   */
  discoverRules(): Promise<void>;

  /**
   * Returns the union of all active memory rules based on the provided file paths.
   * @param filesInContext List of file paths currently in the agent's context window.
   */
  getActiveRules(filesInContext: string[]): MemoryRule[];

  /**
   * Reloads rules from disk (e.g., when a file change is detected).
   */
  reload(): Promise<void>;
}
```

## MemoryRuleService (Utility)

Pure utility functions for parsing and matching.

```typescript
interface IMemoryRuleService {
  /**
   * Parses a markdown file into a MemoryRule object.
   * Uses the internal markdownParser for frontmatter.
   */
  parseRule(filePath: string, source: 'project' | 'user'): Promise<MemoryRule>;

  /**
   * Determines if a rule matches any of the given file paths using minimatch.
   */
  isMatch(rule: MemoryRule, filesInContext: string[]): boolean;
}
```

## Integration Point: AIManager / Agent

The `MemoryRuleManager` will be instantiated within the `Agent` and used by `AIManager` to augment the system prompt.

```typescript
// In AIManager.ts or Agent.ts
const activeRules = memoryRuleManager.getActiveRules(currentContextFiles);
const memoryRulePrompt = activeRules.map(r => r.content).join('\n\n');
// Append memoryRulePrompt to system prompt...
```

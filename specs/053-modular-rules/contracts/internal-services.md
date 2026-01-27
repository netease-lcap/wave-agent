# Internal Contracts: Modular Rules

This feature primarily involves internal service contracts within the `agent-sdk`.

## RuleManager Interface

```typescript
interface IRuleManager {
  /**
   * Discover and load all rules from project and user directories.
   * Should be called during Agent initialization.
   */
  initialize(): Promise<void>;

  /**
   * Get all rules that are currently active based on the provided file paths.
   * @param filesInContext List of absolute or relative file paths currently in context.
   */
  getActiveRules(filesInContext: string[]): Rule[];

  /**
   * Format active rules into a string suitable for the system prompt.
   */
  formatRulesForPrompt(rules: Rule[]): string;
}
```

## Rule Entity Type

```typescript
type Rule = {
  id: string;
  name: string;
  content: string;
  paths?: string[];
  source: 'project' | 'user';
  filePath: string;
};
```

## Integration Point: AIManager

The `AIManager` will call `RuleManager.getActiveRules()` before each AI request.

```typescript
// In AIManager.sendAIMessage
const filesInContext = this.messageManager.getFilesInContext(); // New method needed
const activeRules = this.ruleManager.getActiveRules(filesInContext);
const rulesPrompt = this.ruleManager.formatRulesForPrompt(activeRules);
// Append rulesPrompt to system prompt
```

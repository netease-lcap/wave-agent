# Contract: Prompt Engineering Framework

## Interfaces

### `IPromptRegistry`

```typescript
export interface IPromptRegistry {
  /**
   * Register a new prompt template
   */
  register(name: string, template: string, options?: { version?: string, description?: string }): void;

  /**
   * Get a prompt by name, filled with the provided context
   */
  get(name: string, context?: Record<string, any>): string;

  /**
   * Check if a prompt exists
   */
  has(name: string): boolean;

  /**
   * List all registered prompts
   */
  list(): Array<{ name: string, version: string, description?: string }>;
}
```

### `ToolPlugin` (Updated)

```typescript
export interface ToolPlugin {
  // ...
  /**
   * Function to provide a prompt to be added to the tool description.
   * Now integrated with the Prompt Engineering Framework.
   */
  prompt?: (args?: {
    availableSubagents?: SubagentConfiguration[];
    availableSkills?: SkillMetadata[];
    workdir?: string;
    registry?: IPromptRegistry;
  }) => string;
}
```

# Research: Prompt Engineering Framework

## Current State

Currently, prompts are managed as hardcoded strings or functions in `packages/agent-sdk/src/prompts/index.ts` and `packages/agent-sdk/src/prompts/autoMemory.ts`.

Tools can provide dynamic descriptions via a `prompt()` function in their plugin definition:

```typescript
export interface ToolPlugin {
  // ...
  prompt?: (args?: {
    availableSubagents?: SubagentConfiguration[];
    availableSkills?: SkillMetadata[];
    workdir?: string;
  }) => string;
}
```

This is used in `ToolManager.getToolsConfig` to override the tool's description:

```typescript
if (tool.prompt) {
  config.function.description = tool.prompt(options);
}
```

## Proposed Improvements

1.  **Centralized Registry**: Move all prompts to a `PromptRegistry` that can be easily managed and updated.
2.  **Template System**: Use a template system (e.g., Mustache or simple string substitution) for prompts to make them more flexible.
3.  **Context-Aware Prompts**: Formalize the context passed to prompts to include more information about the current state.
4.  **Validation**: Add validation for prompts to ensure they don't exceed token limits or contain invalid characters.
5.  **Versioning**: Support versioning of prompts to allow for easy rollbacks and A/B testing.

## References

- `packages/agent-sdk/src/prompts/index.ts`
- `packages/agent-sdk/src/prompts/autoMemory.ts`
- `packages/agent-sdk/src/tools/types.ts`
- `packages/agent-sdk/src/managers/toolManager.ts`

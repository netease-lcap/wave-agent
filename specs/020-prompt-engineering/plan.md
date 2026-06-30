# Plan: Prompt Engineering Framework

## Architecture

The framework will consist of the following components:

1.  **`PromptRegistry`**: A central class for managing prompt templates.
2.  **`PromptTemplate`**: A class or interface for representing a prompt template with substitution logic.
3.  **`ExecutionContext`**: A standardized object containing data about the current session and environment.

## Implementation Steps

1.  **Create `PromptRegistry`**:
    - Implement `register(name, template)`
    - Implement `get(name, context)`
    - Implement `list()`

2.  **Refactor Existing Prompts**:
    - Move `BASE_SYSTEM_PROMPT`, `TOOL_POLICY`, etc. from `packages/agent-sdk/src/prompts/index.ts` to the registry.
    - Update `buildSystemPrompt` to use the registry.

3.  **Update `ToolManager`**:
    - Ensure `ToolManager` correctly passes context to the registry when retrieving tool descriptions.

4.  **Add Validation**:
    - Implement a simple token counter to validate prompt lengths.

5.  **Testing**:
    - Add unit tests for `PromptRegistry` and template substitution.
    - Add integration tests to verify the agent's behavior.

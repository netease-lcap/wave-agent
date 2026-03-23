# Research: /btw Side Question Feature

## Decision: Non-blocking Side Agent Implementation
- **Chosen Approach**: Use `SubagentManager.createInstance` with `runInBackground: true` and an empty `tools` array.
- **Rationale**: This leverages the existing subagent infrastructure in `agent-sdk`, ensuring isolation and asynchronous execution without blocking the main agent's loop.
- **Alternatives Considered**: 
    - Creating a new `AIManager` instance directly: Rejected because it would bypass the `SubagentManager`'s lifecycle management and communication hooks.
    - Modifying the main agent's `MessageManager`: Rejected because it would pollute the main conversation history.

## Decision: UI Switching and Escape Key Handling
- **Chosen Approach**: Introduce `activeSideAgentId` and `sideAgentMessages` in `useChat.tsx`. Use `useInput` to listen for the `Escape` key.
- **Rationale**: This provides a clean way to toggle between the main chat and side agent views while maintaining separate message histories.
- **Alternatives Considered**: 
    - Using a separate React component for the side agent: Rejected because it would require more complex state synchronization with the main `ChatInterface`.

## Decision: Storage for System Reminder
- **Chosen Approach**: Store in `packages/agent-sdk/src/prompts/btw-side-question.md` and export as a constant in `packages/agent-sdk/src/prompts/index.ts`.
- **Rationale**: Follows the established pattern for managing prompts as Markdown files while making them easily accessible in the SDK.
- **Alternatives Considered**: 
    - Hardcoding the prompt in the `SlashCommandManager`: Rejected as it makes the prompt harder to maintain and version.

## Decision: Tool-less Side Agent
- **Chosen Approach**: Pass an empty `tools: []` array to the `SubagentConfiguration` during agent creation.
- **Rationale**: The `ToolManager` already respects the `tools` configuration, making this the most direct and reliable way to disable all tools.
- **Alternatives Considered**: 
    - Manually unregistering tools after initialization: Rejected as it's more error-prone and less efficient.

## Decision: Adding the `/btw` Command
- **Chosen Approach**: Add to `AVAILABLE_COMMANDS` in `packages/code/src/constants/commands.ts` and register in `SlashCommandManager.initializeBuiltinCommands`.
- **Rationale**: Ensures the command is visible in the UI's slash command autocomplete and correctly handled by the SDK's command manager.

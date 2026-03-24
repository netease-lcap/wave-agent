# Research: /btw Side Question Feature

## Decision: Non-blocking Side Agent Implementation
- **Chosen Approach**: Use isolated `MessageManager` and `AIManager` instances within `BtwManager`.
- **Rationale**: This ensures complete isolation from the main agent's state and allows for a tool-less assistant without the overhead of the full `SubagentManager` lifecycle.
- **Alternatives Considered**: 
    - Using `SubagentManager.createInstance`: Rejected because it includes tools by default and would require more complex configuration to disable them completely.
    - Modifying the main agent's `MessageManager`: Rejected because it would pollute the main conversation history.

## Decision: UI Switching and Escape Key Handling
- **Chosen Approach**: Introduce `sideMessages` and `isSideAgentThinking` in `useChat.tsx`. Use `useInput` to listen for the `Escape` key.
- **Rationale**: This provides a clean way to toggle between the main chat and side agent views while maintaining separate message histories.

## Decision: Storage for System Prompt
- **Chosen Approach**: Export `BTW_SUBAGENT_SYSTEM_PROMPT` as a constant in `packages/agent-sdk/src/prompts/index.ts`.
- **Rationale**: Follows the established pattern for managing prompts while making them easily accessible in the SDK.

## Decision: Tool-less Side Agent
- **Chosen Approach**: Call `aiManager.sendAIMessage({ tools: [] })` in `BtwManager`.
- **Rationale**: The `AIManager` correctly handles an empty tools array by not providing any tool definitions to the AI model.

## Decision: Adding the `/btw` Command
- **Chosen Approach**: Add to `AVAILABLE_COMMANDS` in `packages/code/src/constants/commands.ts` and register in `SlashCommandManager.initializeBuiltinCommands`.
- **Rationale**: Ensures the command is visible in the UI's slash command autocomplete and correctly handled by the SDK's command manager.

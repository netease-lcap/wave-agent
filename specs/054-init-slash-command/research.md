# Research: Init Slash Command

## Decision: Implementation of `/init` Slash Command

### 1. Slash Command Definition
- **Location**: `packages/agent-sdk/src/managers/slashCommandManager.ts`.
- **Action**: Register a new built-in command `init` in `initializeBuiltinCommands()`.

### 2. Prompt Handling
- **Location**: `packages/agent-sdk/src/constants/prompts.ts`.
- **Action**: Add `INIT_PROMPT` constant containing the instructions from `init-prompt.md`.
- **Fallback**: Since it's a built-in command, the prompt will be hardcoded in `prompts.ts`.

### 3. Repository Analysis
- **Approach**: The `/init` command will trigger the AI agent with the `INIT_PROMPT`. The agent will use its existing tools (`readTool`, `globTool`, `grepTool`, `lsTool`) to analyze the codebase.
- **Rationale**: This leverages the agent's existing reasoning and tool-use capabilities to perform a deep analysis of the repository structure, build commands, and existing rules.

### 4. File Generation
- **Target**: `AGENTS.md` in the repository root.
- **Mechanism**: The agent will use `writeTool` to create or update the file.

## Rationale
- **Leveraging Existing Infrastructure**: By registering `/init` as a slash command that sends a specific prompt to the AI, we reuse the robust tool-calling and reasoning capabilities already present in the agent.
- **Consistency**: Storing the prompt in `prompts.ts` follows the established pattern for system and task-specific prompts.

## Alternatives Considered
- **Dedicated Analysis Service**: Rejected because the agent's tools are already sufficient for repository exploration, and a dedicated service would add unnecessary complexity.
- **Custom Tool for Init**: Rejected because the task is high-level and better suited for the agent's general-purpose reasoning guided by a prompt.

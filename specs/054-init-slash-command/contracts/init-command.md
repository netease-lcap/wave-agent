# API Contract: Init Slash Command

## Slash Command Interface

### `/init`
- **Description**: Triggers the repository initialization process.
- **Input**: None.
- **Output**: 
  - A message in the chat interface indicating the start of analysis.
  - AI-generated content for `AGENTS.md`.
  - A `writeTool` call to create or update `AGENTS.md`.

## Internal Prompt Contract

### `INIT_PROMPT`
- **Type**: `string`
- **Location**: `packages/agent-sdk/src/constants/prompts.ts`
- **Content**: Instructions for the agent to analyze the repo and generate `AGENTS.md`.

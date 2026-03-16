# Quickstart: Support AskUserQuestion Tool

## Overview
This feature adds the `AskUserQuestion` tool, enabling the agent to ask structured multiple-choice questions.

## Development Setup
1. Build the `agent-sdk` to include the new tool:
   ```bash
   pnpm -F agent-sdk build
   ```
2. Run the CLI to test the tool interaction:
   ```bash
   pnpm -F code start
   ```

## Verification Steps

### Unit Tests
Run tests for the tool logic:
```bash
pnpm -F agent-sdk test tests/tools/askUserQuestion.test.ts
```

### Integration Tests
Verify the full flow from agent call to UI response:
```bash
pnpm -F agent-sdk test tests/integration/askUserQuestion.integration.test.ts
```

### Manual Verification
1. Start the agent.
2. Give an ambiguous prompt: "Refactor the code in src/utils.ts".
3. Verify the agent calls `AskUserQuestion` with options for refactoring patterns.
4. Select an option and verify the agent proceeds with that choice.

# Quickstart: Bash History Selector

## Overview
This feature adds an interactive Bash History Selector triggered by `!` for searching and re-executing commands.

## Development Setup
1. Build the `agent-sdk` to include history utilities:
   ```bash
   pnpm -F agent-sdk build
   ```
2. Run the CLI to test the selector:
   ```bash
   pnpm -F code start
   ```

## Verification Steps

### Unit Tests
Run tests for history search and the selector component:
```bash
pnpm -F agent-sdk test tests/utils/history.test.ts
pnpm -F code test tests/components/BashHistorySelector.test.tsx
```

### Manual Verification
1. Start the agent.
2. Type `!` at the beginning of the input field.
3. Verify the history selector appears with recent commands.
4. Type a query to filter the history.
5. Press `Enter` to execute a command immediately.
6. Press `Tab` to insert a command for editing.

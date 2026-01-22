# Quickstart: File Selector

## Overview
This feature adds an interactive File Selector triggered by `@` for quick file and directory selection.

## Development Setup
1. Build the `agent-sdk` (if changes were made there):
   ```bash
   pnpm -F agent-sdk build
   ```
2. Run the CLI to test the selector:
   ```bash
   pnpm -F code start
   ```

## Verification Steps

### Unit Tests
Run tests for the `InputManager` and `FileSelector`:
```bash
pnpm -F code test tests/managers/InputManager.test.ts
pnpm -F code test tests/components/FileSelector.test.tsx
```

### Manual Verification
1. Start the agent.
2. Type `@` in the input field.
3. Verify the file selector appears with a list of files in the current directory.
4. Type a query to filter the list.
5. Use arrow keys to navigate and `Enter` to select a file.
6. Verify the file path is inserted into the input field.

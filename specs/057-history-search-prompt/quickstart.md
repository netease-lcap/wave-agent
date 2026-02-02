# Quickstart: History Search Prompt

## Overview
This feature adds a dedicated prompt history for the Wave Agent, accessible via `Ctrl+R`. It replaces the previous bash-only history.

## Usage

### Searching History
1. In the agent's input field, press `Ctrl+R`.
2. The history search interface will appear.
3. Type to filter previous prompts (case-insensitive).
4. Use **Up/Down Arrow keys** to navigate the results.
5. Press **Enter** to select a prompt and populate the input field.
6. Press **Esc** to cancel and close the search.

### History Storage
- Prompts are automatically saved to `~/.wave/history.jsonl`.
- The file uses JSONL format (one JSON object per line).

## Development

### Key Files
- `packages/agent-sdk/src/utils/promptHistory.ts`: History management logic.
- `packages/code/src/components/HistorySearch.tsx`: Search UI component.
- `packages/code/src/components/InputBox.tsx`: Integration point.

### Running Tests
```bash
# Run SDK tests
pnpm -F agent-sdk test promptHistory

# Run UI tests
pnpm -F code test HistorySearch
```

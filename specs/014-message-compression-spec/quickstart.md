# Quickstart: Message Compression

## Overview
This feature manages conversation history and user input size through automatic summarization and placeholders.

## Development Setup
1. Build the `agent-sdk` to include compression utilities:
   ```bash
   pnpm -F agent-sdk build
   ```
2. Run the CLI to test input compression:
   ```bash
   pnpm -F code start
   ```

## Verification Steps

### Unit Tests
Run tests for history compression and input placeholders:
```bash
pnpm -F agent-sdk test tests/utils/messageOperations.test.ts
pnpm -F code test tests/managers/InputManager.test.ts
```

### Manual Verification

#### History Compression
1. Set a low `maxInputTokens` in the agent config or mock token usage.
2. Engage in a long conversation.
3. Verify that older messages are replaced by a summary block.
4. Verify the agent still remembers the general context of the summarized messages.

#### Input Compression
1. Paste a long block of text (> 200 chars) into the input field.
2. Verify it is replaced by a `[LongText#1]` placeholder.
3. Send the message.
4. Verify the agent receives and responds to the full content of the pasted text.

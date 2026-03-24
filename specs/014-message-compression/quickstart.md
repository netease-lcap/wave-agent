# Quickstart: Message Compression

## Overview
This feature manages conversation history through automatic summarization.

## Development Setup
1. Build the `agent-sdk` to include compression utilities:
   ```bash
   pnpm -F agent-sdk build
   ```

## Verification Steps

### Unit Tests
Run tests for history compression:
```bash
pnpm -F agent-sdk test tests/agent/agent.compression.test.ts
```

### Manual Verification

#### History Compression
1. Set a low `maxInputTokens` in the agent config or mock token usage.
2. Engage in a long conversation.
3. Verify that the entire conversation history is replaced by a single continuation summary block.
4. Verify the agent still remembers the general context of the summarized messages.

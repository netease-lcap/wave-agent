# Quickstart: Message Compact

## Overview
This feature manages conversation history through automatic summarization and manual `/compact` command.

## Development Setup
1. Build the `agent-sdk` to include compaction utilities:
   ```bash
   pnpm -F wave-agent-sdk build
   ```

## Verification Steps

### Unit Tests
Run tests for history compaction:
```bash
pnpm -F wave-agent-sdk test tests/managers/aiManager.compactConversation.test.ts
```

### Manual Verification

#### History Compaction
1. Set a low `maxInputTokens` in the agent config or mock token usage.
2. Engage in a long conversation.
3. Verify that the entire conversation history is replaced by a single continuation summary block.
4. Verify the agent still remembers the general context of the summarized messages.

#### Manual /compact Command
1. Type `/compact` in the conversation to manually trigger compaction.
2. Optionally provide custom instructions: `/compact focus on the API changes`.
3. Verify the conversation history is replaced by a summary that reflects the custom instructions.

#### PreCompact/PostCompact Hooks
1. Configure a PreCompact hook in `.wave/settings.json`:
   ```json
   { "hooks": { "PreCompact": [{ "hooks": [{ "type": "command", "command": "echo 'Preserve all error messages'" }] }] } }
   ```
2. Trigger compaction via `/compact`.
3. Verify the hook output is merged into the custom instructions for the summary.

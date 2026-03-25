# Plan: Implement "clear" command in SDK

## Context
The "clear" command is a built-in feature of the SDK, handled by `SlashCommandManager.initializeBuiltinCommands()` in `packages/agent-sdk`. This allows the SDK to handle the core logic of clearing messages and syncing the task list, while the CLI can still react to these changes (e.g., by clearing the terminal).

## Proposed Changes

### Phase 1: SDK Changes (agent-sdk)

#### 1. Modify `packages/agent-sdk/src/managers/slashCommandManager.ts`
- Register the `clear` command in `initializeBuiltinCommands()`.
- The handler will:
    1. Call `this.aiManager.abortAIMessage()` to stop any ongoing AI processing.
    2. Call `this.messageManager.clearMessages()` to reset the conversation history and session ID.
    3. Call `await this.taskManager.syncWithSession()` to ensure the task list ID is updated to match the new session ID.

### Phase 2: CLI Changes (code)

#### 1. React to session ID changes
- The CLI should monitor the `sessionId` from the SDK.
- When the `sessionId` changes, the CLI should clear the terminal screen and remount the chat interface.

### Phase 3: SDK Refinement (agent-sdk)

#### 1. Modify `packages/agent-sdk/src/agent.ts`
- Update `clearMessages()` to be `async` and call `await this.slashCommandManager.executeCommand("clear")`. This ensures that calling `clearMessages()` programmatically has the same effect as typing `/clear`.

## Verification Plan

### Automated Tests
- Run `pnpm -F wave-agent-sdk test tests/managers/slashCommandManager.clear.test.ts` to verify the SDK logic.
- Run `pnpm -F wave-code test tests/managers/inputHandlers.test.ts` to ensure no regressions in command handling.

### Manual Verification
1. Start the Wave Agent CLI.
2. Type some messages to populate the history.
3. Type `/clear` and press Enter.
4. Verify that:
    - The terminal screen is cleared.
    - The message history is reset.
    - A new session ID is generated.
    - The task list is reset (if applicable).
5. Verify that `/clear` works even when the agent is busy (it should be queued and then execute).

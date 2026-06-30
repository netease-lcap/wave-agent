# Plan: Implement "clear" command

## Context
The `/clear` command is a CLI-internal command registered in `AVAILABLE_COMMANDS` in `packages/code/src/constants/commands.ts`. The full clear logic lives directly in `Agent.clearMessages()` in `packages/agent-sdk/src/agent.ts`. The CLI calls `agent.clearMessages()` via a callback when the user types `/clear`.

The `/clear` command was moved from the SDK's `SlashCommandManager` (whose `initializeBuiltinCommands()` method was removed entirely) to the CLI-internal command system. `Agent.clearMessages()` now contains the full logic inline instead of delegating to `SlashCommandManager`.

## Proposed Changes

### Phase 1: SDK Changes (agent-sdk)

#### 1. Modify `packages/agent-sdk/src/agent.ts`
- Implement `clearMessages()` as an async public method that contains the full clear logic directly:
    1. Call `this.aiManager.abortAIMessage()` to stop any ongoing AI processing.
    2. Call `this.goalManager.clearGoal()` if a goal is currently active.
    3. Call `await this.hookManager.executeSessionEndHooks()` to fire SessionEnd hooks before clearing.
    4. Call `this.messageManager.clearMessages()` to reset the conversation history and session ID.
    5. Call `this.memoryService.clearCache()` to clear the auto-memory cache.
    6. Call `await this.taskManager.syncWithSession()` to ensure the task list ID is updated to match the new session ID.
    7. Call `await this.hookManager.executeSessionStartHooks()` to fire SessionStart hooks, injecting any `additionalContext` or `initialUserMessage` as meta messages.
    8. Call `await this.saveSession()` to persist the fresh session.

### Phase 2: CLI Changes (code)

#### 1. Register `/clear` as a CLI-internal command
- Add `clear` to `AVAILABLE_COMMANDS` in `packages/code/src/constants/commands.ts`.
- Wire the callback in `useChat.tsx` to call `agent.clearMessages()`.

#### 2. React to session ID changes
- The CLI should monitor the `sessionId` from the SDK.
- When the `sessionId` changes, the CLI should clear the terminal screen and remount the chat interface.

## Verification Plan

### Automated Tests
- Run `pnpm -F wave-agent-sdk test tests/agent.clearMessages.test.ts` to verify the SDK logic.
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
    - SessionEnd hooks fired before clearing and SessionStart hooks fired after.
    - The auto-memory cache is cleared.
5. Verify that `/clear` works even when the agent is busy (it should be queued and then execute).

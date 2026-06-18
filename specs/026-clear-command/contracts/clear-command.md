# Contract: Clear Command

## CLI Registration
The `/clear` command is registered as a CLI-internal command in `AVAILABLE_COMMANDS` (in `packages/code/src/constants/commands.ts`). It is not registered in `SlashCommandManager` (that method, `initializeBuiltinCommands()`, was removed entirely). The CLI wires the callback via `useChat.tsx` to call `Agent.clearMessages()`.

## Agent
The `Agent` class provides an async `clearMessages()` method that contains the full clear logic directly.

### Agent.clearMessages()
- **Signature**: `public async clearMessages(): Promise<void>`
- **Implementation**: Performs the following actions in order:
    1. `this.aiManager.abortAIMessage()` — stop any ongoing AI processing.
    2. `this.goalManager.clearGoal()` — clear the active goal (if a goal is currently active).
    3. `await this.hookManager.executeSessionEndHooks()` — fire SessionEnd hooks before clearing.
    4. `this.messageManager.clearMessages()` — reset the conversation history and session ID.
    5. `this.memoryService.clearCache()` — clear the auto-memory cache.
    6. `await this.taskManager.syncWithSession()` — update the task list to match the new session ID.
    7. `await this.hookManager.executeSessionStartHooks()` — fire SessionStart hooks, injecting any `additionalContext` or `initialUserMessage` as meta messages.
    8. `await this.saveSession()` — persist the fresh session.

## MessageManager
The `MessageManager` class provides a `clearMessages()` method that resets the conversation history and session ID.

### MessageManager.clearMessages()
- **Signature**: `public clearMessages(): void`
- **Implementation**:
    - `this.setMessages([])`
    - `const newSessionId = generateSessionId()`
    - `this.rootSessionId = newSessionId`
    - `this.setSessionId(newSessionId)`
    - `this.setlatestTotalTokens(0)`
    - `this.savedMessageCount = 0`

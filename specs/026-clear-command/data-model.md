# Data Model: Clear Command Move to SDK

## SlashCommandManager
The `clear` command is registered as a built-in slash command in the `SlashCommandManager`.

### SlashCommand
- **id**: "clear"
- **name**: "clear"
- **description**: "Clear conversation history and reset session"
- **handler**: An async function that performs the following actions:
    - `this.aiManager.abortAIMessage()`
    - `this.messageManager.clearMessages()`
    - `await this.taskManager.syncWithSession()`

## Agent
The `Agent` class provides an async `clearMessages()` method that delegates to the `clear` slash command.

### Agent.clearMessages()
- **Signature**: `public async clearMessages(): Promise<void>`
- **Implementation**: `await this.slashCommandManager.executeCommand("clear")`

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

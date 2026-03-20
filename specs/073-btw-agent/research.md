# Research: btwAgent Implementation

## Decision: Implementation Strategy for btwAgent

The `btwAgent` will be implemented as a specialized subagent within the `code` package, leveraging the existing `SubagentManager` in `agent-sdk`.

### Rationale
- **Subagent Parity**: Using `SubagentManager` ensures `btwAgent` behaves similarly to other subagents while allowing for the required isolation.
- **State Management**: `useChat.tsx` in the `code` package is the central hub for agent state and is the most appropriate place to manage the `btwAgent` lifecycle and UI transitions.
- **Tool & Prompt Inheritance**: By accessing the main agent's `toolManager` and `aiManager` (via a new getter), we can ensure the `btwAgent` has the same capabilities and persona.

### Alternatives Considered
- **Main Agent Mode**: Modifying the main agent to have a "btw mode". Rejected because it would complicate the main agent's state machine and task queue management.
- **Separate Agent Class**: Creating a new `BtwAgent` class in `agent-sdk`. Rejected as `SubagentManager` already provides the necessary abstraction for isolated agent instances.

## Key Findings

### 1. Subagent Implementation
- `agent-sdk`'s `SubagentManager` handles the creation and execution of subagent instances.
- Each subagent has its own `MessageManager` and `AIManager`.
- `code` package's `useChat.tsx` manages subagent state and communication via callbacks (`onSubagentMessagesChange`, etc.).

### 2. CommandsSelector & /btw
- Commands are defined in `packages/code/src/constants/commands.ts`.
- Adding `/btw` to this list will make it available in the `CommandsSelector`.
- Interception will happen in `useChat.tsx`'s `sendMessage` function to prevent the command from entering the normal task queue. **The interception MUST occur before the message queue check to ensure `/btw` commands are processed immediately even if the main agent is busy.**

### 3. Isolated Managers & Inheritance
- `SubagentManager.createInstance()` creates a new instance with isolated managers.
- Message inheritance can be achieved by calling `setMessages()` on the new subagent's `MessageManager` with a snapshot of the main agent's messages.
- **Note**: `AIManager` needs a public `getSystemPrompt()` method to allow the `btwAgent` to inherit the main agent's system prompt.

### 4. UI & Interaction
- `isBtwModeActive` state in `ChatContext` will control UI visibility.
- The main input box will be conditionally hidden based on `isBtwModeActive`.
- A new "dismiss" message component will be displayed at the bottom.
- `useInput` hook in `useChat.tsx` will be used to capture "Space", "Enter", and "Escape" keys for dismissal.

### 5. System Reminder Wrapper
- The user's query will be wrapped in the specified `<system-reminder>` XML block before being sent to the `btwAgent`.
- The UI will be responsible for hiding this XML block when rendering the user's message in the `btwAgent`'s message list.

### 6. Concurrent Execution
- The `SubagentManager` and `AIManager` in `agent-sdk` are designed to handle multiple agent instances concurrently.
- Launching a `btwAgent` as a subagent will not block the main agent's execution loop or task queue.
- The UI in `code` needs to ensure that while the `btwAgent` messages are being displayed, the main agent's background processes (like tool execution or message generation) continue to update the underlying state.

## Technical Decisions

| Component | Decision |
|-----------|----------|
| **Agent Type** | `SubagentInstance` via `SubagentManager` |
| **State Location** | `packages/code/src/contexts/useChat.tsx` |
| **Command Interception** | `sendMessage` in `useChat.tsx` |
| **Dismissal Keys** | Space, Enter, Escape |
| **Tooling** | Same as main agent (retrieved via `toolManager.list()`) |
| **System Prompt** | Same as main agent (retrieved via new `aiManager.getSystemPrompt()`) |
| **Concurrency** | Fully concurrent; main agent continues background tasks |

# Data Model: btwAgent

## Entities

### `BtwAgentState`
Represents the state of the `btwAgent` session within the `ChatContext`.

| Field | Type | Description |
|-------|------|-------------|
| `isBtwModeActive` | `boolean` | Whether the `btwAgent` is currently active and taking over the UI. |
| `btwAgentInstance` | `SubagentInstance \| null` | The active `SubagentInstance` for the `btwAgent`. |
| `btwAgentMessages` | `Message[]` | The isolated message history for the `btwAgent` session. |
| `btwAgentIsLoading` | `boolean` | Whether the `btwAgent` is currently generating a response. |

## State Transitions

### 1. Activation (`/btw <query>`)
- **Trigger**: User submits a message starting with `/btw `.
- **Action**:
    1. Intercept the message in `sendMessage` **before** the `isLoading || isCommandRunning` check.
    2. Set `isBtwModeActive` to `true`.
    3. Create a new `SubagentInstance` via `SubagentManager`.
    4. Initialize the new instance's `MessageManager` with a snapshot of the main agent's messages.
    5. Wrap the user's query in the `<system-reminder>` block.
    6. Execute the `btwAgent` using `aiManager.sendAIMessage()`.
    7. Update `btwAgentInstance` and `btwAgentIsLoading`.
    8. **Concurrency**: The main agent's current task (if any) continues to run in the background.
    9. **Bypass Queue**: The `/btw` command MUST NOT be added to `queuedMessages`.

### 2. Message Updates
- **Trigger**: `onSubagentMessagesChange` callback from `SubagentManager`.
- **Action**:
    1. Check if the `subagentId` matches the `btwAgentInstance`.
    2. Update `btwAgentMessages` and `btwAgentIsLoading`.
    3. **Note**: Main agent messages may still be updated in the background if it's running a task.

### 3. Dismissal (Space, Enter, Escape)
- **Trigger**: User presses one of the dismissal keys while `isBtwModeActive` is `true`.
- **Action**:
    1. Abort the `btwAgent`'s current message generation if active.
    2. Reset `isBtwModeActive` to `false`.
    3. Clear `btwAgentInstance`, `btwAgentMessages`, and `btwAgentIsLoading`.
    4. Restore the main agent's UI (input box, main message list).
    5. **Concurrency**: The main agent's background tasks are unaffected by this dismissal.

## Validation Rules
- `/btw` command MUST include a query (e.g., `/btw what is this?`).
- Only one `btwAgent` session can be active at a time.
- `btwAgent` messages MUST NOT be added to the main agent's `MessageManager`.
- `btwAgent` tasks MUST NOT be added to the main agent's `TaskManager`.

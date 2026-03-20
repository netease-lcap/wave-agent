# Feature Specification: btwAgent

**Feature Branch**: `073-btw-agent`  
**Created**: 2026-03-20  
**Input**: User description: "1, implement btwAgent similar as subagent. 2, btw agent has the same system prompt with main agent, and same tools with main agent. 3, btw agent should inherit main agent message, but still have isolated messsage manager and aimanager. 4, /btw should be added to CommandsSelector. 5, when user input /btw xxx, the msg should not be in queue, instead, it should launch a btw agent to answer user's question. 6, when is in btw, the inputbox should be hide,and \"Press Space, Enter, or Escape to dismiss\" should be displayed at bottom and message list should be btw agent's message."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Quick Query via /btw (Priority: P1)

As a user, I want to ask a quick question about the codebase or current context without interrupting my main task or adding to the task queue, so that I can get immediate information without side effects.

**Why this priority**: This is the core functionality of the feature. It allows for non-intrusive exploration and questioning.

**Independent Test**: Can be tested by typing `/btw what does this function do?` and verifying that a separate agent responds without adding a task to the queue, and that the UI changes to reflect the "btw" state.

**Acceptance Scenarios**:

1. **Given** the main agent is active, **When** the user types `/btw` in the input box, **Then** `/btw` should appear in the `CommandsSelector`.
2. **Given** the user inputs `/btw how is the project structured?`, **When** the command is submitted, **Then** a `btwAgent` should be launched.
3. **Given** the `btwAgent` is launched, **When** it starts processing, **Then** the main input box should be hidden.
4. **Given** the `btwAgent` is active, **When** the UI is rendered, **Then** "Press Space, Enter, or Escape to dismiss" should be displayed at the bottom.
5. **Given** the `btwAgent` is active, **When** it generates messages, **Then** these messages should be displayed in the message list, and the main conversation history should be hidden.

---

### User Story 2 - Dismissing btwAgent (Priority: P1)

As a user, I want to easily return to my main conversation after getting an answer from the `btwAgent`, so that I can continue my work.

**Why this priority**: Essential for the user to return to their primary workflow.

**Independent Test**: Can be tested by pressing `Escape` while the `btwAgent` is active and verifying the UI returns to the main agent state.

**Acceptance Scenarios**:

1. **Given** the `btwAgent` is active, **When** the user presses `Space`, `Enter`, or `Escape`, **Then** the `btwAgent` session should end.
2. **Given** the `btwAgent` session ends, **When** the UI updates, **Then** the main input box should reappear and the message list should show the main agent's messages again.

---

### Edge Cases

- **What happens when the user inputs /btw without a query?** The system should probably prompt for a query or do nothing.
- **How does the system handle multiple /btw calls?** Since it's a modal-like state, it should probably only allow one active `btwAgent` session at a time.
- **What happens if the main agent is in the middle of a task?** The `btwAgent` should be able to run in parallel (UI-wise it takes over, but the main agent's background tasks should continue if any).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST add a `/btw` command to the `CommandsSelector`.
- **FR-002**: The system MUST launch a `btwAgent` when the user submits a `/btw <query>` command.
- **FR-017**: The system MUST process `/btw <query>` commands immediately, bypassing the normal message queue. Even if the main agent is currently busy (`isLoading` or `isCommandRunning` is true), the `/btw` command MUST NOT be added to `queuedMessages`.
- **FR-003**: The `btwAgent` MUST NOT add its messages or tasks to the main agent's task queue.
- **FR-004**: The `btwAgent` MUST inherit the current message history from the main agent upon initialization.
- **FR-005**: The `btwAgent` MUST use an isolated `MessageManager` and `AIManager` to ensure its conversation state does not leak into the main agent's state.
- **FR-006**: The `btwAgent` MUST use the same system prompt as the main agent.
- **FR-007**: The `btwAgent` MUST be configured with the same tools as the main agent.
- **FR-012**: The system MUST wrap the user's query in a `<system-reminder>` block when sending it to the `btwAgent`.
- **FR-013**: The `<system-reminder>` block MUST contain the following instructions:
    ```xml
    <system-reminder>This is a side question from the user. You must answer this question directly in a single response.

    IMPORTANT CONTEXT:
    - You are a separate, lightweight agent spawned to answer this one question
    - The main agent is NOT interrupted - it continues working independently in the background
    - You share the conversation context but are a completely separate instance
    - Do NOT reference being interrupted or what you were "previously doing" - that framing is incorrect

    CRITICAL CONSTRAINTS:
    - You have NO tools available - you cannot read files, run commands, search, or take any actions
    - This is a one-off response - there will be no follow-up turns
    - You can ONLY provide information based on what you already know from the conversation context
    - NEVER say things like "Let me try...", "I'll now...", "Let me check...", or promise to take any action
    - If you don't know the answer, say so - do not offer to look it up or investigate

    Simply answer the question with the information you have.</system-reminder>
    ```
- **FR-014**: The system MUST hide the `<system-reminder>` XML block from the user in the UI, showing only the user's original query.
- **FR-015**: The `btwAgent` MUST be able to run concurrently with the main agent. If the main agent is currently executing a task, the `btwAgent` MUST NOT interrupt or pause it.
- **FR-016**: The system MUST maintain the UI state for both agents, allowing the user to switch back to the main agent's view (dismissing the `btwAgent` view) while the main agent continues its background work.
- **FR-008**: When the `btwAgent` is active, the main input box MUST be hidden.
- **FR-009**: When the `btwAgent` is active, the UI MUST display "Press Space, Enter, or Escape to dismiss" at the bottom of the screen.
- **FR-010**: When the `btwAgent` is active, the message list MUST display ONLY the messages from the `btwAgent`'s isolated `MessageManager`, hiding the main conversation history. The welcome message (WAVE version and working directory) SHOULD still be displayed at the top of the message list.
- **FR-011**: The system MUST dismiss the `btwAgent` and return to the main agent state when the user presses `Space`, `Enter`, or `Escape`.
- **FR-018**: When the `btwAgent` state changes (activated or dismissed), the system MUST trigger a remount of the `ChatInterface` by updating the `remountKey` in `App.tsx`. This ensures the terminal is cleared and the `MessageList` is fresh, consistent with how session switching and history rewinding are handled.

### Key Entities

- **btwAgent**: A specialized agent instance that handles transient queries.
- **IsolatedMessageManager**: A `MessageManager` instance dedicated to the `btwAgent` session.
- **IsolatedAIManager**: An `AIManager` instance dedicated to the `btwAgent` session.

### Assumptions

- The `btwAgent` is a temporary session and its state does not need to be persisted across application restarts.
- "Inherit main agent message" means a deep copy or a snapshot of the main agent's messages at the time of `/btw` invocation.
- The "read-only" constraint for tools means that even if `Bash` is provided, it should be used for non-destructive commands (like `ls`, `cat`, etc.), or simply that only `Read`, `Glob`, `Grep`, and `LSP` are provided.

# Feature Specification: /btw Side Question

**Feature Branch**: `073-btw-side-question`  
**Created**: 2026-03-23  
**Input**: User description: "when user input /btw xxx, system should send user msg like this: system-reminder-btw-side-question.md, and hide system-reminder to user. the main agent should still keep running. another agent without any tools should be launched to answer user's question. message list should show btw agent's messages and show a tip at bottom: \"Press Escape to dismiss\", when user press esc, the message list should show main agent's messages. agent sdk must provide a btw() to answer user's question. coding cli should add /btw to @packages/code/src/components/CommandSelector.tsx and call agent sdk function."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask a side question while the main agent is working (Priority: P1)

As a user, I want to ask a quick question without stopping the main agent's current task, so that I can get information or explore the codebase without losing progress.

**Why this priority**: This is the core value of the feature - non-blocking side questions and codebase exploration.

**Independent Test**: Can be tested by starting a long-running task with the main agent, then typing `/btw what is the current date?` or `/btw where is the login logic?` and verifying that the main agent continues its task while a side agent answers the question or searches the code.

**Acceptance Scenarios**:

1. **Given** the main agent is performing a task (e.g., running tests), **When** the user inputs `/btw how do I use the Grep tool?`, **Then** a side agent is launched, receives the question, and provides an answer without interrupting the main agent.
2. **Given** a side agent is answering a `/btw` question, **When** the side agent responds, **Then** the `<system-reminder>` block (if any) is not visible to the user in the chat history.

---

### User Story 2 - Side agent capabilities and follow-up (Priority: P2)

As a user, I want the side agent to be able to explore the codebase and support follow-up questions, so that I can have a focused conversation about a specific topic without cluttering the main chat.

**Why this priority**: Enhances the utility of the side agent for complex queries.

**Independent Test**: Can be tested by asking a side question that requires a tool (e.g., `/btw find all .tsx files`) and then asking a follow-up question (e.g., `/btw which one is the main entry point?`) and verifying the side agent responds with context.

**Acceptance Scenarios**:

1. **Given** a side agent is launched via `/btw`, **When** it receives the question, **Then** it has access to exploration tools (Grep, Glob, Read, LSP, Bash).
2. **Given** a side agent is active, **When** the user sends a message, **Then** it is treated as a follow-up question to the side agent rather than a new message to the main agent.

---

### Edge Cases

- **Empty Input**: What happens when the user inputs `/btw` without any text? (System should probably ignore it or show a usage hint).
- **Rapid Succession**: How does the system handle multiple `/btw` commands in rapid succession? (System should reuse the existing side agent or handle them as separate turns).
- **Main Agent Completion**: What if the main agent finishes its task while the side agent is still generating a response? (The side agent should continue until it finishes its response).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST recognize the `/btw` slash command followed by a question.
- **FR-002**: System MUST launch a separate agent instance (using Explore configuration) to handle the `/btw` request.
- **FR-003**: System MUST NOT interrupt or pause the main agent when a `/btw` command is issued.
- **FR-004**: System MUST hide any `<system-reminder>` content from the user's view in the chat interface.
- **FR-005**: The side agent MUST have access to exploration tools (e.g., Grep, Glob, Read, LSP, Bash).
- **FR-006**: System MUST ensure the side agent inherits all messages from the main agent's current conversation history to provide context for the answer.
- **FR-007**: System MUST switch the message list view to show the side agent's messages when a `/btw` command is issued.
- **FR-008**: System MUST display "Side agent is thinking... | Esc to dismiss" when the side agent is active and thinking.
- **FR-009**: System MUST switch the message list view back to the main agent's messages when the user presses the Escape key.
- **FR-010**: System MUST support multi-turn follow-up questions within the side agent view.

### Key Entities

- **Side Agent**: A lightweight, tool-less agent instance spawned for side conversations.
- **Slash Command (/btw)**: The trigger for the side agent.
- **System Reminder**: The specific instructions provided to the side agent, hidden from the user.

### Assumptions

- The `/btw` command is handled by the CLI/Frontend before being passed to the main agent's message loop, or the main agent's loop is designed to handle asynchronous side-tasks.
- "Hide system-reminder to user" means the user doesn't see the internal prompt engineering used to constrain the side agent.
- The side agent uses the same model as the main agent but with a different system prompt and no tools.
ifferent system prompt and no tools.
means the user doesn't see the internal prompt engineering used to constrain the side agent.
- The side agent uses the same model as the main agent but with a different system prompt and no tools.
ifferent system prompt and no tools.

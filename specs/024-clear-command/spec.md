# Feature Specification: Clear Command

**Feature Branch**: `024-clear-command`
**Created**: 2026-04-01

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clear conversation via slash command (Priority: P1)

As a CLI user, I want to type `/clear` to reset my conversation history so I can start a fresh session without restarting the application.

**Acceptance Scenarios**:

1. **Given** an active conversation with messages, **When** the user types `/clear`, **Then** the conversation history is cleared, a new session ID is generated, and the terminal screen is cleared.
2. **Given** an ongoing AI response is being processed, **When** the user types `/clear`, **Then** the ongoing AI processing is aborted before the conversation is cleared.
3. **Given** the task list has items from the current session, **When** `/clear` is executed, **Then** the task list is synchronized with the new session ID.

---

### User Story 2 - Programmatic clear via SDK (Priority: P1)

As an SDK consumer, I want to call `agent.clearMessages()` to reset the conversation so my application can programmatically start a new session.

**Acceptance Scenarios**:

1. **Given** an active agent session with messages, **When** `agent.clearMessages()` is called, **Then** the conversation history is cleared and a new session ID is generated, producing the same effect as typing `/clear`.

---

### Edge Cases

- **What happens if `/clear` is called while no conversation exists?** A new session ID is generated anyway; no error is thrown.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The CLI MUST register `clear` as a CLI-internal command in `AVAILABLE_COMMANDS`, with the clear logic implemented in `Agent.clearMessages()`.
- **FR-002**: Executing `/clear` MUST abort any ongoing AI message processing.
- **FR-003**: Executing `/clear` MUST clear the conversation history and generate a new session ID.
- **FR-004**: Executing `/clear` MUST synchronize the task list with the new session ID.
- **FR-005**: The `Agent` class MUST expose an async `clearMessages()` method that contains the clear logic directly (abort AI, clear messages, sync tasks).
- **FR-006**: The CLI MUST react to session ID changes by clearing the terminal screen and remounting the chat interface.

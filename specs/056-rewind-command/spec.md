# Feature Specification: Rewind Command

**Feature Branch**: `056-rewind-command`  
**Created**: 2026-02-02  
**Status**: Completed  
**Input**: User description: "support /rewind builtin command to revert messages. the checkpoints should be only user message, when select user message, this user message and all messages after this message should be deleted. and all file operation in these messages should be reverted too, you can save prev file content to revert."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Basic Message Rewind (Priority: P1)

As a user, I want to be able to revert the conversation to a previous state by selecting a specific user message, so that I can correct mistakes or explore different paths without cluttering the history.

**Why this priority**: This is the core functionality of the feature. It allows users to manage conversation history and undo unwanted AI responses.

**Independent Test**: Can be fully tested by sending multiple messages, triggering `/rewind`, selecting a previous user message, and verifying that the selected message and all subsequent messages are removed from the history.

**Acceptance Scenarios**:

1. **Given** a conversation with 3 user messages and 3 AI responses, **When** the user types `/rewind` and selects the 2nd user message, **Then** the 2nd user message, its corresponding AI response, and the 3rd user message and its AI response are all deleted.
2. **Given** a conversation, **When** the user types `/rewind` but cancels the selection, **Then** no messages are deleted and the conversation remains unchanged.

---

### User Story 2 - Rewind with File Reversion (Priority: P2)

As a user, I want file changes made by the agent in the messages being deleted to be automatically reverted, so that my local environment stays in sync with the conversation state.

**Why this priority**: This ensures consistency between the conversation history and the actual state of the files on disk, which is critical for a coding assistant.

**Independent Test**: Can be tested by having the agent create or modify a file, then rewinding to a point before that file operation and verifying the file is restored to its previous state or deleted if it was newly created.

**Acceptance Scenarios**:

1. **Given** the agent modified `src/main.ts` in the most recent turn, **When** the user rewinds to the user message immediately preceding that turn, **Then** `src/main.ts` is restored to its content prior to that modification.
2. **Given** the agent created a new file `tests/new_test.ts`, **When** the user rewinds to a point before the file was created, **Then** `tests/new_test.ts` is deleted from the filesystem.

---

### User Story 3 - Rewind with Subagent Support (Priority: P2)

As a user, I want file changes made by subagents to be automatically reverted when I rewind the main conversation, and any running background subagent tasks to be terminated if their context is removed.

**Why this priority**: This ensures that the rewind functionality is consistent across the entire agent ecosystem, including modular subagents and background tasks.

**Acceptance Scenarios**:

1. **Given** a subagent modified a file, **When** the user rewinds the main conversation to a point before the subagent was invoked, **Then** the file changes made by the subagent are reverted.
2. **Given** a subagent is running a long-running task in the background, **When** the user rewinds the main conversation to a point before the subagent task was started, **Then** the background subagent task is automatically terminated.

---

### Edge Cases

- **What happens when the user rewinds to the very first message?** The entire conversation history should be cleared, and any file changes made during the session (including those by subagents) should be reverted.
- **What happens if a subagent task is running when a rewind is triggered?** If the message that initiated the subagent is removed, the task MUST be stopped immediately to prevent inconsistent states.
- **What happens if a file to be reverted has been modified externally after the agent changed them?** The system MUST overwrite any external changes and restore the file to its exact state prior to the agent's operation at that checkpoint.
- **What happens if a file to be reverted has been deleted manually by the user?** The system should attempt to restore it if the previous content is available, or handle the missing file gracefully without crashing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `/rewind` builtin command.
- **FR-002**: System MUST present a list of previous user messages as checkpoints when `/rewind` is invoked.
- **FR-003**: System MUST delete the selected user message and all subsequent messages (user and AI) upon confirmation.
- **FR-004**: System MUST track file operations (create, modify, delete) performed by the agent.
- **FR-005**: System MUST store the previous state/content of files before they are modified or deleted by the agent.
- **FR-006**: System MUST revert all file operations associated with the messages being deleted during a rewind.
- **FR-007**: System MUST perform sequential reversion of file operations in reverse order to ensure the filesystem returns to the exact state corresponding to the selected checkpoint.
- **FR-008**: System MUST handle `/rewind` as a built-in command within the `InputManager` for consistent UI state management.
- **FR-009**: System MUST forward file history snapshots from subagents to the parent agent's history.
- **FR-010**: System MUST terminate background subagent tasks if the message that initiated them is removed during a rewind.

### Key Entities *(include if feature involves data)*

- **Checkpoint**: Represents a point in the conversation history (specifically a user message) that the user can revert to.
- **File Snapshot**: A record of a file's state (content and existence) before an agent operation, used for reversion.
- **Conversation History**: The sequence of messages that is modified during the rewind process.

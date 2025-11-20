# Feature Specification: Separate Agent Sessions

**Feature Branch**: `014-separate-agent-sessions`
**Created**: 2025-11-20
**Status**: Draft
**Input**: User description: "packages/agent-sdk/src/managers/subagentManager.ts has many message manager, packages/agent-sdk/src/managers/messageManager.ts can save session, packages/agent-sdk/src/agent.ts also has message manager, when saving session, i would like agent and subagent have different session file name"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Distinguishable Session Files (Priority: P1)

As a developer or user debugging the system, I want agent and subagent sessions to be saved with different filename patterns so that I can easily distinguish between the main agent's session history and the subagents' session histories in the file system.

**Why this priority**: Currently, all sessions likely look the same (`session_{id}.json`), making it difficult to manage or debug specific subagent interactions without opening every file.

**Independent Test**:
1.  Start an agent.
2.  Trigger a subagent task.
3.  Wait for completion and session saving.
4.  Check the sessions directory.
5.  Verify that the main agent session file follows the standard pattern.
6.  Verify that the subagent session file follows a distinct pattern (e.g., `subagent_session_{id}.json`).

**Acceptance Scenarios**:

1.  **Given** a running Agent and a Subagent, **When** the session is saved, **Then** the Agent's session file should start with `session_` (or the configured default).
2.  **Given** a running Subagent, **When** its session is saved, **Then** its session file should start with a distinct prefix (e.g., `subagent_session_`) to differentiate it from the main agent.
3.  **Given** a session directory with mixed files, **When** listing sessions, **Then** the system should be able to identify and load both types of sessions correctly.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support different filename prefixes for session files based on the source (Agent vs. Subagent).
- **FR-002**: The `MessageManager` MUST allow configuration of the session filename prefix.
- **FR-003**: The `SubagentManager` MUST configure its subagent `MessageManager` instances to use a distinct filename prefix (e.g., `subagent_session_`).
- **FR-004**: The `Agent` MUST continue to use the default filename prefix (e.g., `session_`) for its `MessageManager`.
- **FR-005**: The session service (`saveSession`, `getSessionFilePath`) MUST accept a prefix parameter or determine the prefix from the context to generate the correct filename.
- **FR-006**: The session listing and loading functionality MUST support the new filename patterns to ensure subagent sessions can be found and restored if needed.
- **FR-007**: The specific naming convention for subagent sessions MUST be `subagent_session_{id}.json`.

### Key Entities *(include if feature involves data)*

- **Session File**: The JSON file storing the conversation history.
- **Session Prefix**: A string identifier used to prefix the session filename (e.g., "session", "subagent_session").

### Edge Cases

- **Nested Subagents**: If a subagent creates another subagent, the system should use the standard subagent prefix (flat structure) rather than nesting prefixes (e.g., `subagent_session_...` not `subagent_subagent_session_...`), unless a hierarchy is explicitly required.
- **Existing Sessions**: Existing session files with the old naming convention should still be loadable by the system.
- **Filename Collisions**: Although UUIDs make this unlikely, the system should handle potential filename collisions gracefully (e.g., by appending a timestamp or counter).

## Assumptions

- The default session directory location remains the same for both agents and subagents.
- The internal structure of the session JSON data remains the same; only the filename changes.
- Subagent sessions are still considered "sessions" and should be manageable (deletable, loadable) by the system, potentially with some filtering if needed in the future.

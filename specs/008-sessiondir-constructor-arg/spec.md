# Feature Specification: SessionDir Constructor Argument

**Feature Branch**: `008-sessiondir-constructor-arg`  
**Created**: 2025-11-11  
**Status**: Draft  
**Input**: User description: "agent sdk support sessionDir arg as constructor arg, which is optional, the default value refer packages/agent-sdk/src/services/session.ts"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Custom Session Directory (Priority: P1)

SDK users want to specify a custom session directory when creating an Agent instance to store session data in a location other than the default (~/.wave/sessions). This is valuable for applications that need to isolate session data per application instance, use custom data directories, or meet specific organizational storage requirements.

**Why this priority**: This is the core functionality requested and enables the primary use case. Without this, users cannot customize where their session files are stored.

**Independent Test**: Can be fully tested by creating an Agent with a custom sessionDir, sending messages, and verifying session files are created in the specified directory rather than the default location.

**Acceptance Scenarios**:

1. **Given** I create an Agent with `sessionDir: "/custom/sessions"`, **When** I send a message that creates a session, **Then** session files are saved to `/custom/sessions/` directory
2. **Given** I create an Agent with a custom sessionDir, **When** I restore a session by ID, **Then** the session is loaded from the custom directory
3. **Given** I create an Agent with a custom sessionDir, **When** I list sessions, **Then** only sessions from the custom directory are returned

---

### User Story 2 - Default Session Directory Behavior (Priority: P2)

SDK users want the Agent to continue using the existing default session directory (~/.wave/sessions) when no sessionDir is specified, maintaining backward compatibility with existing applications.

**Why this priority**: Ensures backward compatibility and maintains current behavior for existing users who don't specify a custom sessionDir.

**Independent Test**: Can be fully tested by creating an Agent without specifying sessionDir and verifying sessions are stored in the default location (~/.wave/sessions).

**Acceptance Scenarios**:

1. **Given** I create an Agent without specifying sessionDir, **When** I send messages, **Then** session files are saved to the default `~/.wave/sessions/` directory
2. **Given** existing sessions exist in the default directory, **When** I create an Agent without sessionDir, **Then** I can restore and access existing sessions

---

### User Story 3 - Session Directory Validation (Priority: P3)

SDK users want clear error messages when an invalid sessionDir is provided, ensuring robust error handling and preventing silent failures.

**Why this priority**: Provides better developer experience through clear error handling, but doesn't block core functionality.

**Independent Test**: Can be fully tested by providing invalid sessionDir values and verifying appropriate errors are thrown with helpful messages.

**Acceptance Scenarios**:

1. **Given** I create an Agent with an invalid sessionDir path, **When** the Agent tries to access sessions, **Then** a clear error message is provided indicating the sessionDir issue
2. **Given** I create an Agent with sessionDir pointing to a read-only location, **When** trying to save a session, **Then** an appropriate permission error is reported

---

### Edge Cases

- What happens when the custom sessionDir doesn't exist yet?
- How does system handle sessionDir with insufficient permissions?
- What happens when switching between different sessionDir values for the same workdir?
- How does session cleanup handle custom session directories?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: AgentOptions interface MUST include an optional `sessionDir` parameter of type string
- **FR-002**: Agent constructor MUST accept sessionDir parameter and pass it to session-related services
- **FR-003**: Session service functions MUST use the provided sessionDir instead of the hardcoded SESSION_DIR constant when specified
- **FR-004**: Session service functions MUST fall back to the current default path (`join(homedir(), ".wave", "sessions")`) when no sessionDir is provided
- **FR-005**: System MUST create the custom sessionDir if it doesn't exist (similar to current ensureSessionDir behavior)
- **FR-006**: All session operations (save, load, list, delete, cleanup) MUST use the configured sessionDir consistently
- **FR-007**: Session file paths MUST be generated relative to the configured sessionDir
- **FR-008**: System MUST maintain backward compatibility - existing code without sessionDir MUST continue working unchanged

### Key Entities *(include if feature involves data)*

- **SessionDir**: Custom directory path where session files are stored, defaults to `~/.wave/sessions`
- **SessionData**: Existing session data structure, storage location now configurable via sessionDir
- **AgentOptions**: Configuration interface extended with optional sessionDir parameter

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Developers can specify custom session directories and sessions are stored in the specified location 100% of the time
- **SC-002**: Existing applications continue working without modification when sessionDir is not specified
- **SC-003**: Session operations (create, load, list, delete) complete successfully in custom directories within same time limits as default directory
- **SC-004**: All session-related functionality works identically whether using default or custom sessionDir
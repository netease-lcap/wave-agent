# Feature Specification: Session Management

**Feature Branch**: `004-session-management`
**Created**: 2026-01-21
**Status**: Implemented
**Input**: User description: "robust session management system designed for performance, scalability, and project-based organization"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Project-Based Organization (Priority: P1)

As a developer working on multiple projects, I want my agent sessions to be organized by the project's working directory so that I can easily find and manage sessions relevant to my current work.

**Why this priority**: Core organizational requirement for a developer-focused agent.

**Independent Test**: Create sessions in different directories and verify they are stored in separate subdirectories under `~/.wave/projects`.

**Acceptance Scenarios**:

1. **Given** a working directory, **When** a session is created, **Then** it MUST be stored in a subdirectory named after the encoded path.
2. **Given** a long or complex path, **When** encoded, **Then** it MUST be filesystem-safe and limited to 200 characters.

---

### User Story 2 - High-Performance Session Listing (Priority: P1)

As a user with hundreds of historical sessions, I want the session list to load quickly so that I don't experience lag when starting or switching sessions.

**Why this priority**: Essential for a good user experience as the number of sessions grows.

**Independent Test**: Generate 100 large session files and measure the time to list them; it should be near-instant because the system reads from a single `sessions-index.json` file.

**Acceptance Scenarios**:

1. **Given** multiple session files, **When** listing sessions, **Then** the system MUST read from `sessions-index.json` to achieve O(1) performance.
2. **Given** a missing or corrupted index, **When** listing sessions, **Then** the system MUST fallback to reading the last line of each file and rebuild the index.

---

### User Story 3 - Subagent Session Separation (Priority: P2)

As a developer using subagents, I want subagent sessions to be clearly identified and separated from main agent sessions to avoid cluttering the primary session history.

**Why this priority**: Improves clarity when working with complex multi-agent workflows.

**Independent Test**: Start a subagent and verify its session file is prefixed with `subagent-`.

**Acceptance Scenarios**:

1. **Given** a subagent is created, **When** its session is saved, **Then** the filename MUST start with `subagent-`.

---

### Edge Cases

- **Permission Issues**: If the session directory cannot be created or written to, the system should fail gracefully with a clear error.
- **Corrupted Files**: If a JSONL file contains invalid JSON, it should be skipped during listing and treated as non-existent during loading.
- **Empty Sessions**: Files with no messages should use the file's modification time as the `lastActiveAt` timestamp.
- **Path Encoding Collisions**: Use a hash suffix for long paths to ensure uniqueness even when truncated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All session data MUST be stored in `~/.wave/projects`.
- **FR-002**: Sessions MUST be grouped into subdirectories based on an encoded version of the project's working directory path.
- **FR-003**: Working directory paths MUST be encoded to be filesystem-safe, resolving symbolic links and handling special characters.
- **FR-004**: Encoded directory names MUST be limited to 200 characters, using a hash suffix for longer paths.
- **FR-005**: Sessions MUST be stored in JSONL (JSON Lines) format, with one JSON object per line representing a message.
- **FR-006**: Main session files MUST be named using a UUID. The first session ID in a chain MUST be designated as the `rootSessionId` and persisted in the `SessionIndex`.
- **FR-007**: The `rootSessionId` MUST be preserved across message compressions and session restorations to provide a stable identifier for session-scoped resources (like plan files and task lists).
- **FR-008**: Subagent session files MUST be prefixed with `subagent-`.
- **FR-008**: Each message line MUST include a `timestamp` field in ISO 8601 format.
- **FR-009**: Session metadata MUST be derived from the filename, directory structure, and the last message line.
- **FR-010**: Session listing MUST be optimized to use `sessions-index.json` to achieve O(1) performance, minimizing I/O.
- **FR-011**: Sessions older than 14 days MUST be automatically cleaned up.
- **FR-012**: Empty project directories MUST be removed during cleanup.
- **FR-013**: Each project directory MUST maintain a `sessions-index.json` file for O(1) session listing.
- **FR-014**: The session index MUST cache the `firstMessage` content for instant UI display.
- **FR-015**: The system MUST be able to rebuild the session index from `.jsonl` files if it is missing or corrupted.

### Key Entities *(include if feature involves data)*

- **Session**: A record of a conversation between a user and an agent.
    - `id`: UUID of the current session.
    - `rootSessionId`: UUID of the first session in the chain (persisted across compressions).
    - `type`: 'main' or 'subagent'.
    - `workdir`: The project directory associated with the session.
    - `lastActiveAt`: Timestamp of the last message.
    - `messages`: List of message objects.
    - `firstMessage`: (Optional) The content of the first message in the session for display purposes.
- **SessionIndex**:
    - `sessions`: A map of session IDs to metadata.
    - `lastUpdated`: Timestamp of the last index update.
- **Project Directory**: A container for sessions belonging to a specific path.
    - `path`: Original filesystem path.
    - `encodedPath`: Filesystem-safe name used for the directory.

## Assumptions

- The user's home directory is accessible and writable.
- JSONL is an efficient format for appending messages without rewriting the entire file.

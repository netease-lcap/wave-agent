# Feature Specification: Session Management Improvements

**Feature Branch**: `016-session-management-improvements`  
**Created**: 2025-11-23  
**Status**: Draft  
**Input**: User description: "1, session default dir should be changed to ~/.wave/projects 2, session files should be grouped by workdir, workdir should be changed like -home-xxx-yyy 3, session file name should be uuidv6, remove prefix."

## Clarifications

### Session 2025-11-23

- Q: Directory Path Length Limits → A: Keep original path info in metadata, limit directory names to 200 chars with hash
- Q: Symbolic Link Handling → A: Resolve symbolic links to their target paths before encoding
- Q: Permission Failure Handling → A: Fail session creation entirely and return error
- Q: Concurrent Session Creation → A: Allow multiple sessions with different UUIDs in same directory
- Q: Migration Strategy for Existing Sessions → A: No backward compatibility needed

### Session 2025-11-24

- Q: What should be the data structure for each line in JSONL? → A: Store messages with message-level metadata only (no session metadata)
- Q: What essential metadata should be included with each message line? → A: only timestamp
- Q: How should the system identify and manage sessions without session-level metadata? → A: Use filename (UUIDv6) as session ID, derive workdir from parent directory path
- Q: Should there be any migration or transition support for existing JSON sessions? → A: Complete clean break - ignore existing JSON sessions, start fresh with JSONL
- Q: What approach should be used for performance with JSONL session loading? → A: uuidv6 support ordering by time, getLatestSession can use id to get timing info
- Q: When should messages be written to JSONL during AI conversation recursion? → A: each recursion, you can append messages in finally in sendAIMessage

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Improved Session Organization (Priority: P1)

As a Wave agent user working on multiple projects, I need session files to be better organized by project directory so that I can easily manage and locate session data for different projects without files getting mixed together in a single flat directory.

**Why this priority**: This is the core organizational improvement that provides immediate value by making session management more intuitive and scalable for users working on multiple projects.

**Independent Test**: Can be fully tested by creating sessions in different working directories and verifying they are stored in separate subdirectories under ~/.wave/projects, delivering clear project-based separation.

**Acceptance Scenarios**:

1. **Given** I am working in `/home/user/project-a`, **When** I start a Wave agent session, **Then** session files are stored in `~/.wave/projects/-home-user-project-a/`
2. **Given** I am working in `/home/user/project-b`, **When** I start a Wave agent session, **Then** session files are stored in `~/.wave/projects/-home-user-project-b/`
3. **Given** I have sessions in multiple project directories, **When** I list sessions for a specific workdir, **Then** only sessions from that project directory are returned

---

### User Story 2 - Cleaner Session File Names (Priority: P2)

As a Wave agent user, I need session files to have cleaner, more standardized names using UUIDv6 without prefixes so that the file system is less cluttered and session files are easier to identify and manage programmatically.

**Why this priority**: Improves file system cleanliness and provides better UUID generation, but is secondary to the organizational improvements.

**Independent Test**: Can be tested by creating new sessions and verifying files are named with UUIDv6 format without prefixes (e.g., `01234567-89ab-6cde-f012-3456789abcde.json`).

**Acceptance Scenarios**:

1. **Given** I start a new Wave agent session, **When** the session file is created, **Then** the filename uses UUIDv6 format without any prefix
2. **Given** existing sessions exist, **When** I create new sessions, **Then** new sessions use the new UUIDv6 naming and directory structure
3. **Given** I have session files in the new format, **When** I load or delete sessions, **Then** the system correctly handles the new naming convention

---

### User Story 3 - Directory Path Encoding (Priority: P3)

As a Wave agent user working in directories with special characters or deep paths, I need the system to consistently encode working directory paths into safe directory names so that sessions are stored reliably regardless of the original path complexity.

**Why this priority**: Ensures robustness for edge cases but is less critical than core organizational improvements.

**Independent Test**: Can be tested by working in directories with spaces, special characters, or long paths and verifying they are properly encoded into valid directory names.

**Acceptance Scenarios**:

1. **Given** I am working in `/home/user/my project/sub dir`, **When** a session is created, **Then** it is stored in `~/.wave/projects/-home-user-my_project-sub_dir/`
2. **Given** I am working in a deeply nested directory, **When** a session is created, **Then** the encoded directory name remains valid and consistent
3. **Given** I have sessions from paths with special characters, **When** I list sessions, **Then** the system correctly maps back to the original working directories

---

### Edge Cases

- What happens when the `~/.wave/projects` directory doesn't exist or lacks write permissions? → System fails with clear error message
- How does the system handle working directories that are symbolic links? → Resolve to target paths before encoding
- What occurs when multiple sessions are created simultaneously in the same working directory? → Allow multiple sessions with different UUIDs in same project directory
- How are existing sessions handled during the transition? → No backward compatibility needed - clean break to new system
- What happens when the encoded directory name would exceed filesystem limits?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST change the default session storage directory from `~/.wave/sessions` to `~/.wave/projects`
- **FR-002**: System MUST create subdirectories under `~/.wave/projects` based on the encoded working directory path
- **FR-003**: System MUST encode working directory paths by replacing forward slashes with hyphens (e.g., `/home/user/project` becomes `-home-user-project`), resolving symbolic links to their target paths before encoding
- **FR-004**: System MUST encode special characters in directory paths to ensure valid filesystem directory names (spaces become underscores, etc.) and limit encoded directory names to 200 characters with hash suffix for longer paths
- **FR-005**: System MUST generate session file names using UUIDv6 format without any prefix and use JSONL format for efficient message appending (e.g., `01234567-89ab-6cde-f012-3456789abcde.jsonl`)
- **FR-010**: System MUST store each message as a separate line in JSONL format with only timestamp metadata, eliminating session-level metadata (id, version, workdir) for streamlined data structure
- **FR-012**: System MUST append messages to JSONL session files during each recursion of `sendAIMessage()`, specifically in the `finally` block to ensure messages are saved regardless of success or failure
- **FR-011**: System MUST use the UUIDv6 filename as the session identifier and derive the working directory from the parent directory path for session management operations
- **FR-013**: System MUST leverage UUIDv6's time-ordered properties to determine session chronology for operations like `getLatestSession()`, eliminating the need to read file contents for timing information
- **FR-006**: System MUST create the `~/.wave/projects` directory structure automatically if it doesn't exist, and MUST fail with clear error message if directory creation or write permissions are unavailable
- **FR-007**: System MUST filter session listings by the encoded working directory path to ensure project-specific session isolation
- **FR-008**: System MUST handle session cleanup operations within the new directory structure
- **FR-009**: System MUST preserve all existing session functionality (save, load, list, delete, cleanup) with the new organization

### Key Entities *(include if feature involves data)*

- **Session Directory**: The base directory `~/.wave/projects` where all project-based session directories are stored
- **Project Directory**: Encoded subdirectory under the session directory that corresponds to a specific working directory (e.g., `-home-user-project-a`)
- **Session File**: Individual JSONL files containing message data line-by-line, named using UUIDv6 format without prefixes
- **Message Line**: Each line in the JSONL file represents a single message with timestamp metadata only, enabling efficient appending without rewriting the entire file
- **UUIDv6 Ordering**: Time-ordered session identifiers that enable chronological sorting without reading file contents, optimizing performance for session listing operations
- **Working Directory**: The original file system path where the user is working, which gets encoded into a project directory name
- **Session Metadata**: Contains the mapping between encoded directory names and original working directory paths for proper session filtering and organization
# Feature Specification: Simplify Session Metadata Storage

**Feature Branch**: `023-simplify-session-metadata`  
**Created**: 2025-12-05  
**Status**: Draft  
**Input**: User description: "remove SessionMetadataLine SessionMetadata, do not save meta at first line any longer. when save session for subagent, start with `subagent-`. remove startedAt and parentSessionId which is useless. remove readMetadata. by doing those, we can remove readMetadata from listSessionsFromJsonl to speed up."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Creates Session Files Without Metadata Line (Priority: P1)

Developers working with the agent system will create session files that no longer store metadata within the file content, eliminating the need to read file content during session listing operations.

**Why this priority**: This is the core change that enables all performance improvements by removing the expensive metadata reading operation during session enumeration.

**Independent Test**: Can be fully tested by creating new session files and verifying they contain only message lines without metadata headers, delivering immediate performance benefits to session listing.

**Acceptance Scenarios**:

1. **Given** a new session is created, **When** the session file is written, **Then** the file starts directly with the first message and contains no metadata line
2. **Given** multiple sessions exist, **When** listing sessions, **Then** session identification occurs through filename parsing without reading file contents

---

### User Story 2 - Developer Works with Subagent Sessions Using Filename Prefix (Priority: P2)

Developers working with subagent sessions will have those sessions identified by filename prefix "subagent-" rather than metadata stored inside the file, enabling quick filtering and identification.

**Why this priority**: This enables efficient subagent session identification without file content parsing while maintaining clear separation between main and subagent sessions.

**Independent Test**: Can be fully tested by creating subagent sessions and verifying filenames start with "subagent-" prefix and can be filtered efficiently during directory listing.

**Acceptance Scenarios**:

1. **Given** a subagent session is created, **When** the session file is saved, **Then** the filename starts with "subagent-" prefix
2. **Given** mixed main and subagent sessions exist, **When** filtering for subagent sessions, **Then** filtering occurs by filename pattern matching without reading file contents

---

### Edge Cases

- **Legacy File Migration**: System encounters existing session files with metadata lines during operation
- **Invalid Filename Patterns**: System processes files that don't conform to expected naming conventions
- **Corrupted Session Files**: System handles files with incomplete or malformed content during listing operations

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST create session files without metadata lines in the file content
- **FR-002**: System MUST prefix subagent session filenames with "subagent-" to enable identification without file content reading
- **FR-003**: System MUST remove startedAt and parentSessionId fields from session storage as they provide no operational value
- **FR-004**: System MUST eliminate metadata reading operations from file content during session enumeration
- **FR-005**: System MUST implement session listing that derives session metadata from file names and only reads the last message for timestamp and token information, eliminating the need to read metadata headers
- **FR-006**: System MUST maintain compatibility with session identification for existing operations like session restoration and message operations
- **FR-007**: System MUST preserve essential session information through file naming patterns that encode session type and identifier

### Key Entities *(include if feature involves data)*

- **Session File**: Data file containing only message entries without metadata content, identified by filename patterns
- **Session Filename**: File naming convention that encodes session type and essential information for efficient identification
- **Session Directory Structure**: File system organization that maintains project association without requiring file content parsing

## Assumptions

- Session files are stored in a predictable directory structure organized by project
- Existing session operations can be adapted to work with filename-based identification
- Performance improvements from eliminating file content reading will be significant for large session collections
- Migration from existing metadata-in-file approach can be handled transparently
- Session identifiers remain unique and suitable for filename encoding
# Feature Specification: Session Management

**Feature ID**: `002-session-management`
**Status**: Implemented
**Created**: 2026-01-21

## Overview

Wave Agent uses a robust session management system designed for performance, scalability, and project-based organization. Sessions are stored as JSONL files, grouped by project directories, and optimized for fast listing and retrieval.

## User Scenarios

### Project-Based Organization
As a developer working on multiple projects, I want my agent sessions to be organized by the project's working directory so that I can easily find and manage sessions relevant to my current work.

### High-Performance Session Listing
As a user with hundreds of historical sessions, I want the session list to load quickly so that I don't experience lag when starting or switching sessions.

### Subagent Session Separation
As a developer using subagents, I want subagent sessions to be clearly identified and separated from main agent sessions to avoid cluttering the primary session history.

## Requirements

### Storage & Organization
- **FR-001**: All session data MUST be stored in `~/.wave/projects`.
- **FR-002**: Sessions MUST be grouped into subdirectories based on an encoded version of the project's working directory path.
- **FR-003**: Working directory paths MUST be encoded to be filesystem-safe, resolving symbolic links and handling special characters.
- **FR-004**: Encoded directory names MUST be limited to 200 characters, using a hash suffix for longer paths to ensure uniqueness and compatibility.

### File Format & Naming
- **FR-005**: Sessions MUST be stored in JSONL (JSON Lines) format, with one JSON object per line representing a message.
- **FR-006**: Main session files MUST be named using a UUID (e.g., `f47ac10b-58cc-4372-a567-0e02b2c3d479.jsonl`).
- **FR-007**: Subagent session files MUST be prefixed with `subagent-` (e.g., `subagent-f47ac10b-58cc-4372-a567-0e02b2c3d479.jsonl`).
- **FR-008**: Each message line MUST include a `timestamp` field in ISO 8601 format.

### Metadata & Performance
- **FR-009**: Session files MUST NOT contain a separate metadata header line.
- **FR-010**: Session metadata (ID, type, workdir) MUST be derived from the filename and directory structure.
- **FR-011**: Dynamic metadata (last active time, total tokens) MUST be extracted from the last message in the JSONL file.
- **FR-012**: Session listing MUST be optimized to only read the last line of each session file to minimize I/O.

### Lifecycle Management
- **FR-013**: Sessions older than 14 days MUST be automatically cleaned up.
- **FR-014**: Empty project directories MUST be removed during cleanup.

## Edge Cases
- **Permission Issues**: If the session directory cannot be created or written to, the system should fail gracefully with a clear error.
- **Corrupted Files**: If a JSONL file contains invalid JSON, it should be skipped during listing and treated as non-existent during loading.
- **Empty Sessions**: Files with no messages should use the file's modification time as the `lastActiveAt` timestamp.

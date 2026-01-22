# Feature Specification: Bash Confirmation Safety

**Feature Branch**: `038-bash-confirm-safety`  
**Created**: 2025-12-27  
**Status**: Implemented  
**Input**: User description: "for some bash confirm which will never save to permissions.allow array, like cd outside of workdir or other danger cmd, should not display \"Don't ask again\" option"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Dangerous Command Confirmation (Priority: P1)

As a user, when I run a command that is considered dangerous or moves outside the working directory, I should NOT see the "Don't ask again" option, because these permissions should only be granted on a case-by-case basis.

**Why this priority**: This is the core of the requested feature, preventing accidental permanent authorization of risky operations.

**Independent Test**: Can be tested by running a command like `cd ..` (if it goes outside the project root) or a command known to be "dangerous" and verifying the absence of the "Don't ask again" option.

**Acceptance Scenarios**:

1. **Given** the agent is running in a project directory, **When** I execute a command that attempts to change the directory to one outside the project root (e.g., `cd /tmp`), **Then** the confirmation dialog MUST NOT include a "Don't ask again" option.
2. **Given** a command is identified as "dangerous" (e.g., system-level modifications), **When** I execute it, **Then** the confirmation dialog MUST NOT include a "Don't ask again" option.

---

### Edge Cases

- **What happens when a command is partially outside the workdir?** (e.g., `ls ../other-project`). The system should treat any access outside the workdir as a reason to hide the "Don't ask again" option.
- **How does the system handle aliases or complex scripts?** The system should analyze the final command to be executed to determine its safety/scope.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST detect if a bash command attempts to access or move to a directory outside the current working directory (project root).
- **FR-002**: The system MUST maintain a list or logic to identify "dangerous" commands that should never be permanently authorized.
- **FR-003**: The confirmation dialog MUST hide the "Don't ask again" option for any command identified in FR-001 or FR-002.
- **FR-004**: The system MUST ensure that permissions for these "dangerous" or "out-of-bounds" commands are never persisted to the `permissions.allow` configuration.

### Key Entities *(include if feature involves data)*

- **Permission Configuration**: The data structure (e.g., `permissions.allow`) that stores user-authorized commands.
- **Bash Command**: The command string and its context (working directory, arguments) being evaluated for safety.

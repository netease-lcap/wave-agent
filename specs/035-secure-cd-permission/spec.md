# Feature Specification: Secure Pipeline Command Permission Matching

**Feature Branch**: `035-secure-cd-permission`  
**Created**: 2025-12-27  
**Status**: Completed  
**Input**: User description: "permissions.allow array contain 'cd xxx:*', when bash like 'cd xxx && other-cmd' being executed, system should not automatically permit it. not only for cd, permissions.allow should save sample cmd splited from pipeline like && or other. when running pipeline cmd, should split into sample cmds and check all by permissions.allow"

## Clarifications

### Session 2025-12-27

- Q: How should the system match commands that include inline environment variable assignments? → A: Strip assignments (e.g., `VAR=val cmd` matches `cmd`).
- Q: Should the target of a redirection be validated against permission rules? → A: Only validate the command (e.g., `echo`).
- Q: Which commands should be included in the initial built-in safe list? → A: Minimal: cd, ls, pwd.
- Q: Should other built-in safe commands also be restricted to the working directory? → A: Yes, apply to all safe commands (ls, pwd, etc.).
- Q: How should `ls` without any arguments be handled? → A: Automatically permit (defaults to current dir).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Decompose and Validate Chained Commands (Priority: P1)

As a user, I want the system to automatically permit complex commands (using `&&`, `;`, `|`, etc.) if and only if every individual command within the chain is already permitted by my `permissions.allow` configuration.

**Why this priority**: This provides a balance between security and usability. It prevents unauthorized commands from being smuggled into a chain while allowing legitimate chained workflows without constant prompting.

**Independent Test**: Can be tested by configuring `permissions.allow` with multiple patterns and executing a chained command that matches all of them, and another that matches only some.

**Acceptance Scenarios**:

1. **Given** `permissions.allow` contains `cd /tmp/*` and `ls`, **When** the user executes `cd /tmp/test && ls`, **Then** the system SHOULD automatically permit the command.
2. **Given** `permissions.allow` contains `cd /tmp/*` but NOT `rm *`, **When** the user executes `cd /tmp/test && rm -rf /`, **Then** the system MUST NOT automatically permit the command and SHOULD prompt for permission.
3. **Given** `permissions.allow` contains `cat *` and `grep *`, **When** the user executes `cat file.txt | grep "search"`, **Then** the system SHOULD automatically permit the command.

---

### User Story 2 - Handle Complex Shell Syntax (Priority: P2)

The system should correctly identify individual commands even when they are part of complex shell constructs like subshells or redirections.

**Why this priority**: Ensures consistent security across different shell usage patterns.

**Independent Test**: Test with subshells `(...)` and redirections `>`.

**Acceptance Scenarios**:

1. **Given** `permissions.allow` contains `cd /tmp/*` and `ls`, **When** the user executes `(cd /tmp/test && ls)`, **Then** the system SHOULD automatically permit the command.
2. **Given** `permissions.allow` contains `echo *`, **When** the user executes `echo "data" > output.txt`, **Then** the system SHOULD automatically permit the command (only validating the `echo` part).

### User Story 3 - Built-in Safe Commands with Path Restrictions (Priority: P3)

As a user, I want common safe commands (like `cd`) to be automatically permitted by default, but only when they operate within the current working directory or its subdirectories, to prevent unauthorized navigation to sensitive system areas.

**Why this priority**: Improves the "out-of-the-box" experience while maintaining a strong security boundary around the project workspace.

**Independent Test**: Can be tested by running `cd` to a subdirectory (should be permitted) and `cd ..` or `cd /etc` (should require permission).

**Acceptance Scenarios**:

1. **Given** the current working directory is `/home/user/project`, **When** the user executes `cd src`, **Then** the system SHOULD automatically permit the command.
2. **Given** the current working directory is `/home/user/project`, **When** the user executes `cd /etc`, **Then** the system MUST NOT automatically permit the command and SHOULD prompt for permission.
3. **Given** the current working directory is `/home/user/project`, **When** the user executes `cd ..`, **Then** the system MUST NOT automatically permit the command.
4. **Given** the current working directory is `/home/user/project`, **When** the user executes `cd src/components && ls`, **Then** the system SHOULD automatically permit the command (assuming `ls` is also safe).

- **What happens with nested operators?** (e.g., `cmd1 && (cmd2 | cmd3); cmd4`). The system must recursively decompose these.
- **How are environment variables handled?** (e.g., `VAR=val cmd`). The system MUST strip inline environment variable assignments before matching the command against `permissions.allow` or the built-in safe list.
- **What about aliases or functions?** The system should ideally check the expanded command, but for now, checking the literal string parts is the baseline.
- **Escaped operators**: `echo "a && b"` should be treated as a single command `echo`.

### Assumptions

- The system has a robust way to parse bash command strings into constituent parts (a "simple command" parser).
- `permissions.allow` stores patterns that match these "simple commands".
- If any part of a complex command fails the permission check, the entire complex command requires manual approval.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST be able to parse a complex bash command string and identify all individual "simple commands" and their arguments.
- **FR-002**: The system MUST recognize shell operators (`&&`, `||`, `;`, `|`, `&`) as delimiters for splitting commands.
- **FR-003**: For any command execution request, the system MUST iterate through all identified simple commands.
- **FR-004**: A complex command MUST be automatically permitted ONLY IF every constituent simple command matches at least one pattern in `permissions.allow`.
- **FR-005**: If any constituent simple command does not match a pattern in `permissions.allow`, the system MUST NOT automatically permit the entire complex command and MUST prompt the user for the full command string.
- **FR-006**: The system MUST correctly handle quoted strings and escaped characters to avoid incorrectly splitting commands (e.g., `echo "&&"` is one command).
- **FR-007**: The system MUST maintain a built-in list of "safe commands" (`cd`, `ls`, `pwd`) that are automatically permitted even if not explicitly listed in `permissions.allow`, provided they meet specific safety criteria.
- **FR-008**: Built-in safe commands (`cd`, `ls`, `pwd`) MUST ONLY be automatically permitted if they operate within the current working directory or its subdirectories (nested). Any attempt to access paths outside the working directory (e.g., `cd ..`, `ls /etc`) MUST require explicit permission.
- **FR-012**: Built-in safe commands that default to the current directory when no path arguments are provided (e.g., `ls`, `pwd`) MUST be automatically permitted.

### Key Entities *(include if feature involves data)*

- **Simple Command**: A single executable command with its arguments, excluding shell operators that chain it to other commands.
- **Complex Command**: A command string containing one or more simple commands joined by shell operators.
- **Permission Pattern**: A wildcard or literal string in `permissions.allow` used to match against a Simple Command.

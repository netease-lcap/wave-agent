# Feature Specification: Split Chained Bash Commands for Permissions

**Feature Branch**: `036-split-bash-commands`  
**Created**: 2025-12-27  
**Status**: Implemented  
**Input**: User description: "when confirm bash tool with \"cmd1 && cmd2\" or other chain cmd, and user select don't ask, system shall split into multi simple cmds and save to permissions.allow array. if the sample cmd is builtin safe cmd(already implemented) like cd, do not save to permissions.allow array."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Allow Chained Commands with Safe Builtins (Priority: P1)

As a user, when I run a chained command that includes safe builtins (like `cd`) and choose to "Don't ask again", I want the system to only save the non-safe parts of the command to my allowed permissions list.

**Why this priority**: This is the core requirement. It ensures that users don't clutter their permissions list with safe commands while still getting the benefit of auto-allowing the dangerous parts of a chain.

**Independent Test**: Can be fully tested by running `mkdir test && cd test`, selecting "Don't ask again", and verifying that only `Bash(mkdir test)` is added to the allowed rules, while `Bash(cd test)` is not.

**Acceptance Scenarios**:

1. **Given** the user runs `mkdir test && cd test`, **When** the user selects "Don't ask again" in the permission prompt, **Then** `Bash(mkdir test)` is added to `permissions.allow` and `Bash(cd test)` is NOT added.
2. **Given** `Bash(mkdir test)` is in `permissions.allow`, **When** the user runs `mkdir test` again, **Then** the system does not prompt for permission.

---

### User Story 2 - Allow Complex Chained Commands (Priority: P2)

As a user, when I run a complex chained command (using pipes or other operators) and choose to "Don't ask again", I want all non-safe components to be saved individually.

**Why this priority**: Users often use pipes and other operators. Splitting these ensures that individual components are allowed for future use, even if used in different combinations.

**Independent Test**: Can be tested by running `npm install | grep error`, selecting "Don't ask again", and verifying both `Bash(npm install)` and `Bash(grep error)` are added to the allowed rules.

**Acceptance Scenarios**:

1. **Given** the user runs `npm install | grep error`, **When** the user selects "Don't ask again", **Then** both `Bash(npm install)` and `Bash(grep error)` are added to `permissions.allow`.
2. **Given** the rules are added, **When** the user runs `npm install` or `grep error` individually, **Then** no permission prompt is shown.

---

### User Story 3 - Handle Multiple Safe Commands in a Chain (Priority: P3)

As a user, when I run a chain consisting only of safe commands, I want the system to handle it gracefully without adding anything to the permissions list.

**Why this priority**: Ensures consistency and avoids unnecessary entries in the configuration file.

**Independent Test**: Can be tested by running `cd /tmp && ls`, selecting "Don't ask again", and verifying that no new rules are added to `permissions.allow`.

**Acceptance Scenarios**:

1. **Given** the user runs `cd /tmp && ls`, **When** the user selects "Don't ask again", **Then** no new rules are added to `permissions.allow` (since both are safe).

---

### Edge Cases

- **What happens when a command has environment variables?** The system should strip environment variables before checking if it's a safe command, but should probably save the original command (or the stripped version depending on existing policy) to the allow list.
- **How does system handle subshells?** Commands inside subshells `(cmd)` should be split and processed recursively if they contain operators.
- **What if a command is already allowed?** The system should not add duplicate rules to the `permissions.allow` array.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST detect chained bash commands using shell operators: `&&`, `||`, `;`, `|`, `&`.
- **FR-002**: System MUST split chained commands into individual simple commands when the user selects "Don't ask again" for a bash tool execution.
- **FR-003**: System MUST identify "builtin safe commands" based on the existing `SAFE_COMMANDS` list (currently `cd`, `ls`, `pwd`).
- **FR-004**: System MUST NOT save builtin safe commands to the `permissions.allow` array.
- **FR-005**: System MUST save all other non-safe simple commands extracted from the chain to the `permissions.allow` array in the format `Bash(command)`.
- **FR-006**: System MUST ensure that subsequent executions of any of the saved simple commands do not prompt the user if they match an entry in the `permissions.allow` list.
- **FR-007**: System MUST handle nested commands (e.g., in subshells) by splitting them into simple commands.

### Key Entities *(include if feature involves data)*

- **Command**: A string representing a bash command.
- **Permission Rule**: A string in the format `ToolName(input)` (e.g., `Bash(ls)`) used to match allowed executions.
- **Permissions Configuration**: The persistent storage (e.g., `settings.local.json`) containing the `allow` array of Permission Rules.

## Assumptions

- The existing `splitBashCommand` utility in `bashParser.ts` is sufficient for identifying simple commands.
- "Safe commands" are those that are already automatically allowed by the `PermissionManager` without being in the `allow` list.
- The user's "Don't ask again" choice is communicated to the `Agent` via the `newPermissionRule` field in the `PermissionDecision` returned by the permission callback.

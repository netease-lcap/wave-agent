# Feature Specification: Auto-Accept Permissions

**Feature Branch**: `032-auto-accept-permissions`  
**Created**: 2025-12-26  
**Status**: Draft  
**Input**: User description: "currently, Confirm for tool only have 2 options, I would like to add a option in 2nd position. 1, for Write Edit or other fs tools, new option would be \"Yes, and auto-accept edits\". when user select this option, system should set permission mode to \"acceptEdits\" 2, for Bash, new option would be \"Yes, and don't ask again for xxx_cmd commands in this workdir\". when user select this option, saves the permission rule to .wave/settings.local.json in your project directory. The rule is saved in the permissions.allow array using the format \"Bash(command)\". 3, system should read permissions.allow array in all settings.json such as local project and user level when starting."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Auto-accept File Edits from Prompt (Priority: P1)

As a user, when I am prompted to confirm a file edit, I want to be able to choose to auto-accept all future edits in the current session, so that I don't have to confirm each one individually.

**Why this priority**: This provides a convenient way to switch to `acceptEdits` mode without needing to know keyboard shortcuts or manually modifying settings.

**Independent Test**: Can be tested by triggering a file edit tool (e.g., `Write`), selecting the new "Yes, and auto-accept edits" option, and then verifying that subsequent file edits are accepted automatically.

**Acceptance Scenarios**:

1. **Given** the agent is in `default` mode, **When** the agent attempts a `Write` operation, **Then** the confirmation prompt shows three options: "1. Yes", "2. Yes, and auto-accept edits", and "3. [Alternative/Feedback]".
2. **Given** the confirmation prompt for a `Write` operation is shown, **When** the user selects "Yes, and auto-accept edits", **Then** the current operation is executed, and the agent's permission mode is set to `acceptEdits`.
3. **Given** the agent's permission mode was set to `acceptEdits` via the prompt, **When** the agent attempts a subsequent `Edit` operation, **Then** it is executed without a prompt.

---

### User Story 2 - Persistent Bash Command Permission (Priority: P1)

As a user, when I am prompted to confirm a Bash command, I want to be able to allow that specific command to run without asking again in the current project, so that I can automate repetitive tasks safely.

**Why this priority**: This allows users to build a "whitelist" of trusted commands for a specific project, balancing security and convenience.

**Independent Test**: Can be tested by triggering a `Bash` command, selecting "Yes, and don't ask again for ...", verifying that `.wave/settings.local.json` is updated, and then running the same command again to see it execute without a prompt.

**Acceptance Scenarios**:

1. **Given** the agent is in `default` mode, **When** the agent attempts a `Bash` operation with command `ls`, **Then** the confirmation prompt shows three options: "1. Yes", "2. Yes, and don't ask again for ls commands in this workdir", and "3. [Alternative/Feedback]".
2. **Given** the confirmation prompt for `Bash` command `ls` is shown, **When** the user selects "Yes, and don't ask again...", **Then** the command is executed, and `Bash(ls)` is added to the `permissions.allow` array in `.wave/settings.local.json`.
3. **Given** `Bash(ls)` is in the `permissions.allow` array of the local project settings, **When** the agent attempts a `Bash` operation with command `ls`, **Then** it is executed without a prompt.
4. **Given** `Bash(ls)` is in the `permissions.allow` array, **When** the agent attempts a `Bash` operation with command `rm -rf /`, **Then** the user is still prompted for permission.

---

### User Story 3 - Global and Local Permission Rules (Priority: P2)

As a user, I want my allowed command rules to be respected whether they are defined at the project level or the user level, so that I can have global trusted commands.

**Why this priority**: Provides flexibility in managing permissions across different scopes.

**Independent Test**: Can be tested by manually adding a rule to the user-level `settings.json` and verifying it works in any project.

**Acceptance Scenarios**:

1. **Given** `Bash(git status)` is in the user-level `settings.json` under `permissions.allow`, **When** the agent attempts `git status` in any project, **Then** it is executed without a prompt.
2. **Given** rules exist in both user-level and project-level settings, **When** the agent starts, **Then** both sets of rules are loaded and applied.

---

### Edge Cases

- **Missing `.wave` directory**: If the user selects the persistent Bash option and `.wave` doesn't exist, the system should create it.
- **Malformed `settings.json`**: If the settings file is malformed, the system should handle it gracefully (e.g., log an error and proceed without the rule).
- **Duplicate rules**: If the rule already exists, selecting the option again should not create a duplicate.
- **Command with special characters**: Commands with quotes or other special characters should be correctly stored and matched.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The confirmation prompt for file system tools (`Write`, `Edit`, `MultiEdit`, `Delete`) MUST include a second option: "Yes, and auto-accept edits".
- **FR-002**: Selecting "Yes, and auto-accept edits" MUST set the current session's permission mode to `acceptEdits`.
- **FR-003**: The confirmation prompt for the `Bash` tool MUST include a second option: "Yes, and don't ask again for [command] commands in this workdir".
- **FR-004**: Selecting the persistent Bash option MUST save the rule `Bash([command])` to the `permissions.allow` array in `.wave/settings.local.json`.
- **FR-005**: The system MUST create the `.wave` directory and `settings.local.json` file if they do not exist when saving a local permission rule.
- **FR-006**: On startup, the system MUST load `permissions.allow` from all applicable `settings.json` files (user-level and project-level).
- **FR-007**: The system MUST automatically grant permission for any tool call that matches a rule in the loaded `permissions.allow` list.
- **FR-008**: The matching for `Bash(command)` MUST be an exact string match of the command.

### Key Entities *(include if feature involves data)*

- **PermissionRule**: A string format `ToolName(arguments)` used to identify allowed operations.
- **SettingsFile**: A JSON file (local or user-level) containing a `permissions.allow` array of `PermissionRule`s.
- **PermissionDecision**: The result of a permission check, extended to include optional `newPermissionMode` and `newPermissionRule` to signal the system to update its state.

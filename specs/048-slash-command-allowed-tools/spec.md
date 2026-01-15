# Feature Specification: Slash Command Allowed Tools

**Feature Branch**: `048-slash-command-allowed-tools`  
**Created**: 2026-01-15  
**Status**: Draft  
**Input**: User description: "---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*)
description: Create a git commit
---
for such a slash command, system should support allowed-tools util ai stop. for allowed-tools, user don't have to confirm"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Auto-approved Tool Execution (Priority: P1)

As a user, I want the AI to execute specific tools automatically when I trigger a slash command, so that I don't have to manually confirm every step of a known workflow.

**Why this priority**: This is the core value of the feature—reducing friction for common automated tasks.

**Independent Test**: Can be tested by triggering a slash command with `allowed-tools` and verifying that the AI executes those tools without prompting the user for confirmation, by leveraging the existing `PermissionManager` logic.

**Acceptance Scenarios**:

1. **Given** a slash command defined with `allowed-tools: Bash(git status:*)`, **When** the user triggers this command and the AI calls `Bash(git status)`, **Then** the tool should execute immediately without a confirmation prompt because it is temporarily added to the allowed rules.
2. **Given** a slash command with `allowed-tools`, **When** the AI calls a tool NOT in the list (e.g., `Write`), **Then** the system MUST prompt the user for confirmation as usual (unless it's already allowed in `settings.json`).

---

### User Story 2 - Session Termination (Priority: P2)

As a system, I want to revoke the auto-approval privilege once the AI response cycle completes, to ensure security and prevent unauthorized tool usage in subsequent interactions.

**Why this priority**: Essential for security and ensuring that "allowed tools" don't persist indefinitely beyond the intended scope of the slash command.

**Independent Test**: Can be tested by verifying that after the AI finishes its response cycle (recursion stops), tools that were previously auto-approved now require manual confirmation for any new user input.

**Acceptance Scenarios**:

1. **Given** an active slash command session with `allowed-tools`, **When** the AI finishes its task and the `sendAIMessage` recursion ends, **Then** all subsequent tool executions MUST require manual confirmation.

---

### Edge Cases

- **Empty Allowed Tools**: If a slash command is defined without `allowed-tools`, all tool executions MUST require manual confirmation.
- **Invalid Pattern Syntax**: If an `allowed-tools` pattern is syntactically invalid, the system SHOULD ignore that specific pattern and default to manual confirmation for matching tools.
- **Session Persistence**: If the user starts a new task or switches context, any active `allowed-tools` privileges from a previous slash command MUST be revoked.
- **Overlapping Patterns**: If multiple patterns match a tool execution, the most permissive one (auto-approval) takes precedence.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST parse the `allowed-tools` metadata from the slash command header (YAML/Markdown format).
- **FR-002**: System MUST temporarily merge the `allowed-tools` into the `PermissionManager`'s allowed rules for the duration of the `sendAIMessage` recursion cycle.
- **FR-003**: System MUST use the existing `PermissionManager.checkPermission` logic to determine if a tool call is auto-approved, ensuring consistency with `settings.json` behavior.
- **FR-004**: System MUST leverage the existing wildcard matching (e.g., `:*`) in `PermissionManager` for `allowed-tools`.
- **FR-005**: System MUST remove the temporary `allowed-tools` from the `PermissionManager` when the `sendAIMessage` recursion cycle completes.
- **FR-006**: System MUST NOT persist `allowed-tools` from a slash command to `settings.json` or `settings.local.json`.

### Key Entities *(include if feature involves data)*

- **Slash Command Definition**: The configuration object containing the command name, description, and `allowed-tools` list.
- **Allowed Tool Pattern**: A string or object representing a permitted tool and its allowed argument patterns (e.g., `Bash(git status:*)`).
- **Privileged Session**: The stateful context that tracks whether auto-approval is currently active and which tools are allowed.

## Assumptions

- The auto-approval state is scoped to a single `sendAIMessage` call (including its recursive tool-use calls).
- The `allowed-tools` configuration follows the same syntax as `permissions.allow` in `settings.json` (e.g., `Bash(git status:*)`).
- The `PermissionManager` will be updated to support temporary addition/removal of rules.
- The system already has a mechanism for tool confirmation that can be bypassed.

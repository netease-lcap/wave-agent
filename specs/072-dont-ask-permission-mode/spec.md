# Feature Specification: dontAsk Permission Mode

**Feature Branch**: `072-dont-ask-permission-mode`  
**Created**: 2026-03-18  
**Input**: User description: "support dontAsk permission mode: Auto-denies tools unless pre-approved via permissions.allow rules"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Auto-deny unapproved tools (Priority: P1)

As a user, I want tools that are not pre-approved to be automatically denied when I am in `dontAsk` mode, so that I am not interrupted by permission requests for tools I haven't explicitly allowed.

**Why this priority**: This is the core requirement of the `dontAsk` mode. It ensures that the agent only uses tools the user has already trusted, without ever stopping to ask for more.

**Independent Test**: Set permission mode to `dontAsk`. Ensure `permissions.allow` does not contain `Bash`. Have the agent attempt a `Bash` command. Verify the command is immediately denied without any user prompt or callback invocation.

**Acceptance Scenarios**:

1. **Given** the permission mode is set to `dontAsk` and `Bash` is NOT in `permissions.allow`, **When** the agent calls `Bash`, **Then** the tool call is denied immediately and the agent receives a "permission denied" error without the user being prompted.
2. **Given** the permission mode is set to `dontAsk` and `ls` is in `permissions.allow`, **When** the agent calls `ls`, **Then** the tool is executed immediately (existing behavior, but must be preserved).

---

### User Story 2 - Configure dontAsk mode (Priority: P2)

As a user, I want to be able to set the permission mode to `dontAsk` in my configuration so that I can enforce this behavior across sessions.

**Why this priority**: Users need a way to enable this feature.

**Independent Test**: Change the `defaultMode` in the configuration to `dontAsk` and verify that the system respects this setting on startup.

**Acceptance Scenarios**:

1. **Given** the configuration file has `defaultMode: "dontAsk"`, **When** the agent starts, **Then** the effective permission mode is `dontAsk`.

---

### Edge Cases

- **Restricted vs Unrestricted Tools**: Unrestricted tools (those not in `RESTRICTED_TOOLS`) should still be allowed automatically, even in `dontAsk` mode, as they never required permission in the first place.
- **Deny Rules**: `deny` rules must still take precedence. If a tool is in both `allow` and `deny`, it should be denied.
- **Agent Feedback**: The error message returned to the agent should be specific and informative, e.g., "Permission denied: Tool '[toolName]' is not pre-approved in 'permissions.allow' and the current permission mode is 'dontAsk'. Automatic prompts are disabled in this mode." This allows the agent to understand the restriction and inform the user if a necessary tool is blocked, rather than repeatedly attempting the same call.
- **System Prompt Injection**: When `dontAsk` mode is active, the system SHOULD inform the agent that tools are executed in a "user-selected permission mode" and that permissions can be configured via `settings.json` and `settings.local.json`. This ensures the agent is aware of the restriction without needing a full list of allowed rules.
- **UI Interaction**: Similar to `bypassPermissions` mode, the `dontAsk` mode MUST NOT be accessible via the "Shift+Tab" shortcut used to cycle through permission modes in the CLI. It should only be enabled via explicit configuration.

## Clarifications

### Session 2026-03-18

- Q: How should the agent be informed about permissions in the system prompt? → A: Inform the agent that tools are executed in a "user-selected permission mode" and that permissions can be configured via `settings.json` and `settings.local.json`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support a new permission mode named `dontAsk`.
- **FR-002**: In `dontAsk` mode, the system MUST auto-deny any restricted tool call that does not match a rule in `permissions.allow` or `temporaryRules`.
- **FR-003**: In `dontAsk` mode, the system MUST NOT invoke the `canUseToolCallback` (which typically triggers user prompts) for unapproved restricted tools.
- **FR-004**: In `dontAsk` mode, the system MUST continue to auto-allow tools that match `permissions.allow` or `temporaryRules`.
- **FR-005**: In `dontAsk` mode, the system MUST continue to auto-allow unrestricted tools (those not in `RESTRICTED_TOOLS`).
- **FR-006**: The system MUST allow configuring `dontAsk` as the default permission mode via settings.
- **FR-007**: When a tool is auto-denied in `dontAsk` mode, the error message MUST be specific, e.g., "Permission denied: Tool '[toolName]' is not pre-approved in 'permissions.allow' and the current permission mode is 'dontAsk'. Automatic prompts are disabled in this mode."
- **FR-008**: The `dontAsk` mode MUST NOT be included in the cycle of permission modes triggered by the "Shift+Tab" shortcut.
- **FR-009**: When `dontAsk` mode is active, the system MUST inject a message into the agent's system prompt stating: "Tools are executed in a 'user-selected permission mode'. Permissions can be configured via settings.json and settings.local.json."

### Key Entities

- **Permission Mode**: Now includes `dontAsk` in addition to `default`, `bypassPermissions`, `acceptEdits`, and `plan`.
- **Permission Decision**: The result of a check in `dontAsk` mode will be `deny` for any restricted tool not explicitly allowed.

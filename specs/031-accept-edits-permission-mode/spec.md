# Feature Specification: AcceptEdits Permission Mode

**Feature Branch**: `031-accept-edits-permission-mode`  
**Created**: 2025-12-26  
**Status**: Implemented  
**Input**: User description: "1, permission mode should support `acceptEdits` Automatically accepts file edit permissions for the session. 2, sdk should support set permission mode. 3, code cli should support During a session: Use Shift+Tab to cycle through modes. 4, settings.json `defaultMode` should support acceptEdits too."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic File Edits (Priority: P1)

As a user, I want the agent to automatically apply file edits without asking for my permission every time, so that I can work more efficiently when I trust the agent's changes.

**Why this priority**: This is the core value of the feature, enabling a "hands-off" editing experience for the most common operations.

**Independent Test**: Can be tested by setting the permission mode to `acceptEdits` and observing that the agent performs `Edit`, `MultiEdit`, `Delete`, and `Write` operations without prompting for confirmation, while still prompting for `Bash`.

**Acceptance Scenarios**:

1. **Given** the agent is in `acceptEdits` mode, **When** the agent attempts to use `Edit`, `MultiEdit`, `Delete`, or `Write` tools, **Then** the operation is applied immediately without a permission prompt.
2. **Given** the agent is in `acceptEdits` mode, **When** the agent attempts to use the `Bash` tool, **Then** the user is prompted for permission.
3. **Given** the agent is in `default` mode, **When** the agent attempts to use any restricted tool (`Edit`, `MultiEdit`, `Delete`, `Bash`, `Write`), **Then** the user is prompted for permission.
4. **Given** the agent is in `bypassPermissions` mode, **When** the agent attempts to use any restricted tool, **Then** the operation is applied immediately without a prompt.

---

### User Story 2 - CLI Mode Cycling (Priority: P2)

As a CLI user, I want to quickly switch between permission modes during a session using a keyboard shortcut, so that I can easily toggle between manual control, automatic edits, and full bypass.

**Why this priority**: Provides essential interactive control over the permission modes.

**Independent Test**: Can be tested in the CLI by pressing `Shift+Tab` and verifying that the permission mode cycles through `default`, `acceptEdits`, and `bypassPermissions`, and is reflected in the UI.

**Acceptance Scenarios**:

1. **Given** a CLI session is active and in `default` mode, **When** the user presses `Shift+Tab`, **Then** the permission mode changes to `acceptEdits`.
2. **Given** the CLI is in `acceptEdits` mode, **When** the user presses `Shift+Tab`, **Then** the permission mode changes to `bypassPermissions`.
3. **Given** the CLI is in `bypassPermissions` mode, **When** the user presses `Shift+Tab`, **Then** the permission mode changes to `default`.
4. **Given** the permission mode has changed via shortcut, **When** the agent performs a restricted operation, **Then** it follows the rules of the newly selected mode.

---

### User Story 3 - Persistent Configuration (Priority: P3)

As a user, I want to set my preferred default permission mode in a configuration file, so that I don't have to manually switch it every time I start a new session.

**Why this priority**: Improves user experience by remembering preferences across sessions.

**Independent Test**: Can be tested by modifying `settings.json` and verifying that new sessions start with the configured mode.

**Acceptance Scenarios**:

1. **Given** `settings.json` has `defaultMode` set to `acceptEdits`, **When** a new session starts, **Then** the initial permission mode is `acceptEdits`.
2. **Given** `settings.json` has `defaultMode` set to `default`, **When** a new session starts, **Then** the initial permission mode is `default`.
3. **Given** `settings.json` has `defaultMode` set to `bypassPermissions`, **When** a new session starts, **Then** the initial permission mode is `bypassPermissions`.

---

### User Story 4 - SDK Control (Priority: P3)

As a developer using the SDK, I want to programmatically set the permission mode, so that I can control the agent's behavior based on my application's logic.

**Why this priority**: Enables integration and customization for third-party applications using the SDK.

**Independent Test**: Can be tested by calling the SDK method to set permission mode and verifying the agent's behavior.

**Acceptance Scenarios**:

1. **Given** an agent instance created via SDK, **When** the developer sets the permission mode to `acceptEdits`, **Then** the agent automatically accepts subsequent file edits.

---

### Edge Cases

- **Invalid Configuration**: What happens when `settings.json` contains an unrecognized `defaultMode`? (Assumption: Fall back to `ask` mode).
- **Session Persistence**: Does the mode changed via `Shift+Tab` persist if the agent restarts within the same "session" (if applicable)? (Assumption: It persists for the duration of the process).
- **Conflicting Permissions**: How does `acceptEdits` interact with OS-level file permissions? (Assumption: OS permissions still apply; if the file is read-only at the OS level, the edit will fail even if "accepted" by the agent).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support a new permission mode named `acceptEdits`.
- **FR-002**: In `acceptEdits` mode, the system MUST automatically grant permission for `Edit`, `MultiEdit`, `Delete`, and `Write` operations.
- **FR-003**: In `acceptEdits` mode, the system MUST still require user permission for the `Bash` tool.
- **FR-004**: The SDK MUST provide a method or property to get and set the current permission mode.
- **FR-005**: The CLI MUST listen for the `Shift+Tab` key combination during an active session.
- **FR-006**: When `Shift+Tab` is pressed in the CLI, the system MUST cycle through available permission modes in this order: `default` -> `acceptEdits` -> `bypassPermissions` -> `default`.
- **FR-007**: The CLI MUST provide a visual indicator (e.g., in the status line or prompt) showing the currently active permission mode.
- **FR-008**: The system MUST read the `defaultMode` property from `settings.json` on startup to initialize the permission mode.
- **FR-009**: The `defaultMode` in `settings.json` MUST support `acceptEdits` as a valid value.

### Key Entities *(include if feature involves data)*

- **PermissionMode**: An enumeration of allowed values: `default`, `acceptEdits`, `bypassPermissions`.
- **Configuration**: The global settings object (loaded from `settings.json`) that includes the `defaultMode`.
- **AgentSession**: The runtime context of the agent where the current permission mode is maintained.

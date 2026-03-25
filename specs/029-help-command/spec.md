# Feature Specification: Help Command

**Feature Branch**: `029-help-command`  
**Created**: 2026-03-25  
**Input**: User description: "support /help builtin command to show help and key bindings. the help view should be interactive and show general key bindings, built-in commands, and custom commands from plugins."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Accessing Help (Priority: P1)

As a user, I want to be able to see a list of available commands and key bindings by typing `/help`, so that I can learn how to use the agent effectively.

**Why this priority**: This is the core functionality. It provides discoverability for all other features.

**Independent Test**: Type `/help` in the chat input and verify that the help view appears.

**Acceptance Scenarios**:

1. **Given** the agent is running, **When** the user types `/help` and presses Enter, **Then** the help view is displayed.
2. **Given** the help view is open, **When** the user presses `Esc`, **Then** the help view is closed and the user returns to the chat input.

---

### User Story 2 - Navigating Help Tabs (Priority: P2)

As a user, I want to switch between different categories of help (General, Commands, Custom Commands) using the `Tab` key, so that I can quickly find the information I need.

**Why this priority**: Improves organization and usability of the help information.

**Independent Test**: Open help, press `Tab`, and verify that the active tab changes.

**Acceptance Scenarios**:

1. **Given** the help view is open on the "General" tab, **When** the user presses `Tab`, **Then** the "Commands" tab becomes active.
2. **Given** the "Commands" tab is active, **When** the user presses `Tab`, **Then** the "Custom Commands" tab becomes active (if any custom commands exist), otherwise it cycles back to "General".

---

### User Story 3 - Browsing Commands (Priority: P2)

As a user, I want to scroll through the list of commands and see their descriptions, so that I can understand what each command does.

**Why this priority**: Provides detailed information about each command.

**Independent Test**: Open help, switch to "Commands" tab, use arrow keys to navigate, and verify descriptions are shown.

**Acceptance Scenarios**:

1. **Given** the "Commands" tab is active, **When** the user uses `Up` and `Down` arrow keys, **Then** the selected command changes.
2. **Given** a command is selected, **Then** its description is displayed below the command name.
3. **Given** there are more commands than can fit in the view, **When** the user scrolls down, **Then** the list of commands scrolls to show more items.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `/help` builtin command.
- **FR-002**: System MUST display an interactive help view when `/help` is invoked.
- **FR-003**: Help view MUST include a "General" section showing key bindings.
- **FR-004**: Help view MUST include a "Commands" section showing all built-in slash commands.
- **FR-005**: Help view MUST include a "Custom Commands" section if any plugins or custom commands are registered.
- **FR-006**: System MUST allow switching between help sections using the `Tab` key.
- **FR-007**: System MUST allow navigating the command list using `Up` and `Down` arrow keys.
- **FR-008**: System MUST display the description of the currently selected command.
- **FR-009**: System MUST allow closing the help view using the `Esc` key.
- **FR-010**: Help view MUST be implemented using Ink components for consistency with the CLI.

### Key Entities *(include if feature involves data)*

- **SlashCommand**: Represents a command with an ID, name, description, and handler.
- **HelpItem**: A key-description pair for general help (e.g., "@" -> "Reference files").
- **HelpView**: The UI component responsible for rendering the help information.

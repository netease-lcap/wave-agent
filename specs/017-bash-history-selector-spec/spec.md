# Feature Specification: Bash History Selector

**Feature Branch**: `017-bash-history-selector-spec`  
**Created**: 2026-01-22  
**Status**: In Progress  
**Input**: User description: "Bash History Selector for searching and re-executing commands"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Search and Re-execute Commands (Priority: P1)

As a user, I want to quickly find and re-execute previous bash commands by typing `!` so I don't have to re-type long or complex commands.

**Why this priority**: This is the core functionality that saves time and reduces errors when repeating common tasks.

**Independent Test**: Type `!` at the start of the input, type a partial command, and verify that the correct command appears and can be executed by pressing `Enter`.

**Acceptance Scenarios**:

1. **Given** the input field is empty, **When** the user types `!`, **Then** the bash history selector MUST appear.
2. **Given** the history selector is open, **When** the user types a query, **Then** the list MUST filter in real-time.
3. **Given** a command is highlighted, **When** the user presses `Enter`, **Then** the command MUST be executed immediately.

---

### User Story 2 - Edit History Commands (Priority: P2)

As a user, I want to select a command from history and edit it before execution so I can reuse similar commands with minor variations.

**Why this priority**: Increases the flexibility of the history selector beyond simple repetition.

**Independent Test**: Type `!`, select a command, press `Tab`, and verify that the command is inserted into the input field for editing.

**Acceptance Scenarios**:

1. **Given** a command is highlighted in the selector, **When** the user presses `Tab`, **Then** the command MUST be inserted into the input field, replacing the `!query`.
2. **Given** a command is inserted via `Tab`, **When** the user modifies it and presses `Enter`, **Then** the modified command MUST be executed.

---

### User Story 3 - Manage History (Priority: P3)

As a user, I want to delete sensitive or incorrect commands from my history so I can keep my history clean and secure.

**Why this priority**: Provides user control over their history data.

**Independent Test**: Type `!`, highlight a command, press `Ctrl+d`, and verify that the command is removed from the history list.

**Acceptance Scenarios**:

1. **Given** a command is highlighted in the selector, **When** the user presses `Ctrl+d`, **Then** the command MUST be removed from the history.

---

### Edge Cases

- **Empty history**: If the history is empty, the selector should show a "No history found" message.
- **Multi-line commands**: The UI must handle multi-line commands gracefully, perhaps by truncating or showing a preview.
- **Duplicate entries**: The selector should ideally collapse or handle duplicate consecutive entries.
- **Large history files**: The search must remain fast even with thousands of history entries.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST trigger the bash history selector when `!` is typed as the first character in the input field.
- **FR-002**: System MUST perform real-time search of the bash history.
- **FR-003**: System MUST display a list of matching commands with metadata (timestamp, directory).
- **FR-004**: System MUST support keyboard navigation using `UpArrow`, `DownArrow`, `Enter`, `Tab`, `Ctrl+d`, and `Escape`.
- **FR-005**: System MUST execute the command immediately on `Enter`.
- **FR-006**: System MUST insert the command into the input field on `Tab`.
- **FR-007**: System MUST delete the selected entry from history on `Ctrl+d`.
- **FR-008**: System MUST limit the display to 10 items at a time with a scrolling mechanism.

### Key Entities *(include if feature involves data)*

- **HistoryEntry**: Represents a single command in the history.
    - `command`: The full command string.
    - `timestamp`: When the command was executed.
    - `directory`: The directory where it was executed.
- **SelectorState**: The state of the history selector in `InputManager`.
    - `isActive`: Whether the selector is currently visible.
    - `query`: The current search string.
    - `selectedIndex`: The index of the currently highlighted item.

## Assumptions

- The `searchBashHistory` utility in `wave-agent-sdk` provides access to the user's bash history.
- The terminal environment supports the Ink-based UI components.
- The user's bash history is stored in a standard format (e.g., `.bash_history`).

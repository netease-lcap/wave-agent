# Feature Specification: Task List Toggle

**Feature Branch**: `064-task-list-toggle`  
**Created**: 2026-02-11  
**Status**: Draft  
**Input**: User description: "read specs/063-task-management-tools to learn about bg. support ctrl t hide or show a task list at bottom of message list"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Toggle Task List Visibility (Priority: P1)

As a user, I want to quickly show or hide the task list using a keyboard shortcut so that I can manage my screen space and focus on the conversation or the tasks as needed.

**Why this priority**: This is the core requirement of the feature. It provides the primary interaction mechanism for the user.

**Independent Test**: Can be fully tested by pressing `Ctrl+T` in the CLI interface and verifying that the task list appears or disappears at the bottom of the message list.

**Acceptance Scenarios**:

1. **Given** the task list is currently hidden, **When** I press `Ctrl+T`, **Then** the task list should be displayed at the bottom of the message list.
2. **Given** the task list is currently visible, **When** I press `Ctrl+T`, **Then** the task list should be hidden from view.

---

### User Story 2 - Persistent Task List Display (Priority: P2)

As a user, I want the task list to remain visible at the bottom of the message list while I am working, so that I can always see my current progress.

**Why this priority**: Ensures that the task list is useful as a persistent reference during the session.

**Independent Test**: Can be tested by showing the task list and then performing other actions (like sending messages or running tools) and verifying the task list remains visible.

**Acceptance Scenarios**:

1. **Given** the task list is visible, **When** new messages are added to the message list, **Then** the task list should remain anchored at the bottom of the message list.

---

### User Story 3 - Task List Content (Priority: P3)

As a user, I want the task list to show the current status of my tasks so that I have an accurate overview of my work.

**Why this priority**: The task list is only useful if it displays relevant and up-to-date information from the task management system.

**Independent Test**: Can be tested by creating or updating tasks and verifying that the changes are reflected in the displayed task list.

**Acceptance Scenarios**:

1. **Given** the task list is visible, **When** a task's status changes (e.g., from "pending" to "in_progress"), **Then** the task list should update to reflect the new status.

---

### Edge Cases

- **What happens if there are no tasks?** The task list should display a friendly message indicating that no tasks have been created yet, or remain empty but visible if toggled on.
- **What happens if the task list is too long for the screen?** The system should handle overflow gracefully, perhaps by limiting the number of displayed tasks or providing a scrollable area (though standard CLI behavior might just push it off-screen).
- **What happens if `Ctrl+T` is pressed while another input is active?** The shortcut should be globally recognized within the application context to ensure consistent behavior.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST listen for the `Ctrl+T` keyboard shortcut.
- **FR-002**: System MUST toggle the visibility of a task list component at the bottom of the message list when `Ctrl+T` is pressed.
- **FR-003**: The task list MUST be integrated with the task management system defined in spec 063.
- **FR-004**: The task list MUST display a summary of tasks for the current session, including their subject and status.
- **FR-005**: The task list MUST update its content in real-time or upon visibility toggle to reflect the current state of tasks.
- **FR-006**: The task list MUST be positioned at the bottom of the message list in the CLI interface.
- **FR-007**: System MUST maintain the toggle state (visible/hidden) across message updates within the same session.

### Key Entities *(include if feature involves data)*

- **Task List View**: A UI component that renders a summary of tasks.
  - **Visibility State**: Boolean indicating if the list is shown or hidden.
  - **Task Summary**: A collection of task subjects and statuses retrieved from the task management system.

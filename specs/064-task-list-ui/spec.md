# Feature Specification: Task List UI

**Feature Branch**: `064-task-list-ui`  
**Created**: 2026-02-11  
**Status**: Draft  
**Input**: User description: "show task list at bottom of message list. remeber, it is not background tasks. read specs/063-task-management-tools for more info"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Task List in Chat (Priority: P1)

As a user, I want to see a summary of my current tasks at the bottom of the message list so that I can always keep track of my progress without manually listing tasks.

**Why this priority**: This is the core requirement of the feature. It provides immediate visibility into the task state.

**Independent Test**: Can be tested by creating a task and verifying that a task list component appears at the bottom of the chat interface.

**Acceptance Scenarios**:

1. **Given** I have active tasks in the current session, **When** I view the message list, **Then** a task list summary is displayed at the bottom.
2. **Given** the task list is displayed, **When** a task status changes (e.g., from pending to in_progress), **Then** the task list UI updates to reflect the new status.

---

### User Story 2 - Task List Visibility (Priority: P2)

As a user, I want the task list to be persistent but non-intrusive so that it doesn't clutter my conversation while still being accessible.

**Why this priority**: Ensures the UI remains usable and the task list doesn't interfere with reading messages.

**Independent Test**: Verify the task list position and styling in the CLI interface.

**Acceptance Scenarios**:

1. **Given** a long conversation, **When** I scroll to the bottom, **Then** the task list is clearly visible after the last message.
2. **Given** no tasks exist in the session, **When** I view the message list, **Then** the task list section should either be hidden or show an appropriate "No tasks" state.

---

### Edge Cases

- **What happens when there are many tasks?** The UI should handle a large number of tasks gracefully (e.g., by using a compact format).
- **How does it handle very long task subjects?** Subjects should be truncated or wrapped to fit the terminal width.
- **What if the task storage is temporarily unavailable?** The UI should fail gracefully, perhaps by not showing the task list or showing a "Loading/Error" state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST render a task list component at the bottom of the message list in the CLI.
- **FR-002**: The task list MUST display tasks from the current session (as defined in spec 063).
- **FR-003**: Each task in the list MUST show its current status (e.g., using icons or colors).
- **FR-004**: Each task in the list MUST show its subject.
- **FR-005**: The task list MUST update automatically when tasks are created or updated via the task management tools.
- **FR-006**: The task list MUST be distinct from "background tasks" (which might refer to running processes or tool executions).
- **FR-007**: The UI MUST use React Ink components to match the existing CLI style.

### Key Entities *(include if feature involves data)*

- **Task (from Spec 063)**: The primary data source for the UI.
- **Message List**: The existing UI component where the task list will be appended.

## Assumptions

- The task list should only show tasks for the *current* session.
- The "bottom of message list" means it appears after the last message but before the input prompt.
- We will use the existing task storage mechanism defined in `specs/063-task-management-tools`.

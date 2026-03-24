# Feature Specification: Task Management Tools and UI

**Feature Branch**: `063-task-management-tools`  
**Created**: 2026-02-11  
**Input**: User description: "support tools: - TaskCreate: For creating new tasks - TaskGet: For retrieving task details - TaskUpdate: For updating task status and adding comments - TaskList: For listing all tasks, you can refer to tmp.js . all tasks should be stored in ~/.wave/tasks/{taskListId}/{taskId}.json, similar like ~/.claude/tasks, you can look for that. Also remove current todowrite tool. task list id should be set by agent sdk and env var WAVE_TASK_LIST_ID. Also show task list at bottom of message list."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create and Track a Task (Priority: P1)

As a user, I want to create a new task so that I can track my progress on a specific objective.

**Why this priority**: This is the core functionality. Without task creation, the other tools have no data to operate on.

**Independent Test**: Can be fully tested by calling TaskCreate and verifying that a JSON file is created in the correct directory with the expected content.

**Acceptance Scenarios**:

1. **Given** a session is active, **When** I call TaskCreate with a subject and description, **Then** a new task is created with a unique ID and stored in `~/.wave/tasks/{taskListId}/{taskId}.json`.
2. **Given** a task has been created, **When** I call TaskGet with the taskId, **Then** I receive the full details of that task.

---

### User Story 2 - Update Task Progress (Priority: P2)

As a user, I want to update the status of my tasks and add comments so that I can keep my progress record up to date.

**Why this priority**: Task management is dynamic; being able to update status and add notes is essential for tracking work over time.

**Independent Test**: Can be tested by calling TaskUpdate on an existing task and then verifying the changes via TaskGet or by inspecting the JSON file.

**Acceptance Scenarios**:

1. **Given** an existing task, **When** I call TaskUpdate with a new status (e.g., "in_progress", "completed"), **Then** the task's status is updated in the storage.
2. **Given** an existing task, **When** I call TaskUpdate with metadata or a description change, **Then** the task is updated accordingly.

---

### User Story 3 - List All Tasks (Priority: P3)

As a user, I want to see a list of all tasks for my current session so that I can get an overview of my work.

**Why this priority**: Provides visibility across multiple tasks, which is important for managing complex workflows.

**Independent Test**: Can be tested by creating multiple tasks and calling TaskList to ensure all are returned.

**Acceptance Scenarios**:

1. **Given** multiple tasks exist for the current task list, **When** I call TaskList, **Then** I receive a summary list of all tasks including their IDs, subjects, and current statuses.

---

### User Story 4 - View Task List in Chat UI (Priority: P1)

As a user, I want to see a summary of my current tasks at the bottom of the message list so that I can always keep track of my progress without manually listing tasks.

**Why this priority**: This provides immediate visibility into the task state within the conversation flow.

**Independent Test**: Can be tested by creating a task and verifying that a task list component appears at the bottom of the chat interface.

**Acceptance Scenarios**:

1. **Given** I have active tasks in the current session, **When** I view the message list, **Then** a task list summary is displayed at the bottom.
2. **Given** the task list is displayed, **When** a task status changes, **Then** the task list UI updates to reflect the new status.

---

### User Story 5 - Decommission Legacy TodoWrite Tool (Priority: P4)

As a system maintainer, I want to remove the legacy TodoWrite tool so that the agent exclusively uses the new task management system.

**Why this priority**: Ensures a clean transition to the new system and prevents confusion between old and new task management methods.

**Independent Test**: Verify that `TodoWrite` is no longer available in the agent's toolset.

**Acceptance Scenarios**:

1. **Given** the agent is initialized, **When** I list available tools, **Then** `TodoWrite` should not be in the list.

---

### Edge Cases

- **What happens when a task ID does not exist?** TaskGet and TaskUpdate should return a clear error message indicating the task was not found.
- **How does the system handle invalid status transitions?** The system should validate that the provided status is one of the allowed values.
- **What happens if the storage directory is not writable?** The tools should handle filesystem errors gracefully.
- **What happens when there are many tasks?** The UI should handle a large number of tasks gracefully (e.g., by using a compact format).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `TaskCreate` tool that accepts `subject`, `description`, `activeForm`, and optional `metadata`.
- **FR-002**: System MUST store tasks as JSON files in `~/.wave/tasks/{taskListId}/{taskId}.json`.
- **FR-003**: System MUST provide a `TaskGet` tool that retrieves all information for a specific `taskId`.
- **FR-004**: System MUST provide a `TaskUpdate` tool that allows updating `status`, `subject`, `description`, `activeForm`, `owner`, and `metadata` using `taskId`.
- **FR-005**: System MUST allow managing task dependencies via `addBlocks` and `addBlockedBy` in `TaskUpdate`.
- **FR-006**: System MUST provide a `TaskList` tool that returns all tasks associated with the current `taskListId`.
- **FR-007**: Tasks MUST include fields: `taskId`, `subject`, `description`, `status`, `activeForm`, `owner`, `blocks`, `blockedBy`, and `metadata`.
- **FR-008**: The system MUST automatically create the necessary directory structure if it does not exist.
- **FR-009**: The system MUST remove the `TodoWrite` tool definition and implementation.
- **FR-010**: The system MUST determine `taskListId` using `WAVE_TASK_LIST_ID` or `rootSessionId`.
- **FR-011**: The system MUST render a task list component at the bottom of the message list in the CLI.
- **FR-012**: The task list header MUST include a hint for the visibility toggle: `(Ctrl+T to hide)`.
- **FR-013**: Each task in the list MUST show its current status and subject.
- **FR-014**: The task list MUST update automatically when tasks are created or updated.
- **FR-015**: The task list MUST be distinct from "background tasks" (running processes).

### Key Entities *(include if feature involves data)*

- **Task**: Represents a single unit of work.
  - **taskId**: Unique identifier (string).
  - **subject**: Brief title (string).
  - **description**: Detailed requirements (string).
  - **status**: Current state (enum: `pending`, `in_progress`, `completed`, `deleted`).
  - **activeForm**: Present continuous form for display (string).
  - **owner**: Assigned agent or user (string, optional).
  - **blocks**: List of task IDs that depend on this task (array of strings).
  - **blockedBy**: List of task IDs that this task depends on (array of strings).
  - **metadata**: Arbitrary key-value pairs (object).
- **Task List**: A grouping mechanism for tasks, identified by `taskListId`.

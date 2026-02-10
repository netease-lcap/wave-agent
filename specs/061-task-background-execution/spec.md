# Feature Specification: Task Background Execution and Management

**Feature Branch**: `061-task-background-execution`  
**Created**: 2026-02-09  
**Status**: Draft  
**Input**: User description: "Task tool support `run_in_background` and TaskOutput tool and TaskStop tool, refer to temp.js , remove BashOutput and KillBash , use TaskOutput tool and TaskStop tool instead. Add a feature, remove /bashes, implement /tasks in code package"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Background Task Execution (Priority: P1)

As a user, I want to be able to run complex or long-running tasks in the background so that I can continue interacting with the agent while the task processes.

**Why this priority**: This is the core functionality that enables non-blocking workflows, which is essential for productivity when dealing with time-consuming operations.

**Independent Test**: Can be tested by initiating a task with `run_in_background: true` and verifying that the agent returns control immediately with a task ID, while the task continues to run.

**Acceptance Scenarios**:

1. **Given** a task that takes significant time, **When** I execute it with `run_in_background: true`, **Then** I should receive a unique task ID immediately and the agent should be ready for the next command.
2. **Given** a background task is running, **When** I check the system status, **Then** I should see the task listed as active.

---

### User Story 2 - Task Output Retrieval (Priority: P1)

As a user, I want to retrieve the output of a background task (either while it's running or after it's finished) so that I can see the results of my requested operations.

**Why this priority**: Background tasks are useless if their results cannot be inspected. This provides the necessary visibility into background operations.

**Independent Test**: Can be tested by using the `TaskOutput` tool with a valid task ID and verifying that the output (logs, results, etc.) is returned.

**Acceptance Scenarios**:

1. **Given** a running background task, **When** I use `TaskOutput` with `block: true`, **Then** the tool should wait for the task to complete and then return the full output.
2. **Given** a running background task, **When** I use `TaskOutput` with `block: false`, **Then** the tool should immediately return the output generated so far without waiting for completion.
3. **Given** a blocking `TaskOutput` call is active, **When** I press **Esc** (abort), **Then** the output retrieval should stop (unblocking the UI), but the underlying background task MUST continue running.

---

### User Story 3 - Task Termination (Priority: P2)

As a user, I want to be able to stop a running background task if I realize it's no longer needed or if it's behaving unexpectedly.

**Why this priority**: Provides control over system resources and allows users to cancel mistaken or runaway operations.

**Independent Test**: Can be tested by using the `TaskStop` tool on a running task and verifying that the task is terminated and its status is updated to stopped/cancelled.

**Acceptance Scenarios**:

1. **Given** a running background task, **When** I use `TaskStop` with the task ID, **Then** the task should be terminated immediately and I should receive a confirmation.

---

### User Story 4 - Task Management Command (Priority: P2)

As a user, I want to use a `/tasks` command in the CLI to list and manage all background tasks so that I have a central place to monitor progress.

**Why this priority**: Provides a user-friendly interface for task management without needing to remember specific task IDs or use low-level tools directly.

**Independent Test**: Can be tested by running `/tasks` in the CLI and verifying that it displays a list of current and recent tasks with their statuses.

**Acceptance Scenarios**:

1. **Given** several background tasks have been started, **When** I run `/tasks`, **Then** I should see a formatted list showing Task ID, Type, Status, and Start Time for each task.
2. **Given** the legacy `/bashes` command existed, **When** I try to use it, **Then** it should either be removed or redirected to `/tasks` with a deprecation notice.

---

### Edge Cases

- **Invalid Task ID**: How does the system handle `TaskOutput` or `TaskStop` requests with an ID that doesn't exist? (Expected: Error message indicating the task was not found).
- **Task Already Finished**: What happens when `TaskStop` is called on a task that has already completed? (Expected: Informative message that the task is already finished).
- **Timeout on Output Retrieval**: How does `TaskOutput` handle a task that takes longer than the specified timeout when `block: true`? (Expected: Return current output with a status indicating it's still running).
- **Concurrent Access**: Multiple requests for output from the same background task.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `Task` tool MUST support a `run_in_background` boolean parameter.
- **FR-002**: When `run_in_background` is true, the system MUST initiate the task asynchronously and return a unique `task_id` immediately.
- **FR-003**: The system MUST provide a `TaskOutput` tool to retrieve output from background tasks.
- **FR-004**: `TaskOutput` MUST support a `task_id` parameter.
- **FR-005**: `TaskOutput` MUST support a `block` parameter (defaulting to true) to determine whether to wait for task completion.
- **FR-006**: `TaskOutput` MUST support a `timeout` parameter for blocking calls.
- **FR-007**: The system MUST provide a `TaskStop` tool to terminate running background tasks.
- **FR-008**: `TaskStop` MUST support a `task_id` parameter.
- **FR-009**: The `BashOutput` and `KillBash` tools MUST be removed/deprecated in favor of the unified `TaskOutput` and `TaskStop` tools.
- **FR-010**: `TaskOutput` MUST work for both background shell tasks and async agent tasks.
- **FR-011**: The CLI MUST implement a `/tasks` command to list all active and recently completed tasks.
- **FR-012**: The legacy `/bashes` command MUST be removed from the CLI.
- **FR-014**: Aborting a `TaskOutput` tool call (e.g., via Esc key) MUST NOT terminate the underlying background task.

### Key Entities *(include if feature involves data)*

- **Task**: Represents an execution unit (shell command or agent subtask).
    - Attributes: `task_id` (unique identifier), `status` (pending, running, completed, failed, stopped), `output` (accumulated logs/results), `type` (shell, agent).

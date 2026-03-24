# Feature Specification: Task Background Execution and Management

**Feature Branch**: `061-task-background-execution`  
**Created**: 2026-02-09  
**Input**: User description: "Task tool support `run_in_background` and TaskOutput tool and TaskStop tool, refer to temp.js , remove BashOutput and KillBash , use TaskOutput tool and TaskStop tool instead. Add a feature, remove /bashes, implement /tasks in code package. Also support Ctrl-B to background a foreground bash tool or task tool."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Background Task Execution (Priority: P1)

As a user, I want to be able to run complex or long-running tasks in the background so that I can continue interacting with the agent while the task processes.

**Why this priority**: This is the core functionality that enables non-blocking workflows, which is essential for productivity when dealing with time-consuming operations.

**Independent Test**: Can be tested by initiating a task with `run_in_background: true` and verifying that the agent returns control immediately with a task ID, while the task continues to run.

**Acceptance Scenarios**:

1. **Given** a task that takes significant time, **When** I execute it with `run_in_background: true`, **Then** I should receive a unique task ID and a path to a real-time output log file immediately, and the agent should be ready for the next command.
2. **Given** a background task is running, **When** I check the system status, **Then** I should see the task listed as active.
3. **Given** a background task is running, **When** I read the provided log file path, **Then** I should see the real-time output of the task.

---

### User Story 2 - Task Output Retrieval (Priority: P1)

As a user, I want to retrieve the output of a background task (either while it's running or after it's finished) so that I can see the results of my requested operations.

**Why this priority**: Background tasks are useless if their results cannot be inspected. This provides the necessary visibility into background operations. Real-time monitoring via log files provides an even better experience for long-running tasks.

**Independent Test**: Can be tested by using the `TaskOutput` tool with a valid task ID and verifying that the output (logs, results, etc.) is returned, or by reading the `outputPath` provided when the task started.

**Acceptance Scenarios**:

1. **Given** a running background task, **When** I use `TaskOutput` with `block: true`, **Then** the tool should wait for the task to complete and then return the full output.
2. **Given** a running background task, **When** I use `TaskOutput` with `block: false`, **Then** the tool should immediately return the output generated so far without waiting for completion.
3. **Given** a background task started, **When** I access the `outputPath` file, **Then** I should see the same output as `TaskOutput` but in real-time.

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

### User Story 5 - Backgrounding a Foreground Tool (Priority: P1)

As a user running a long-running bash command or a subagent task in the foreground, I want to be able to move it to the background using Ctrl-B so I can continue using the CLI for other tasks without waiting for it to finish.

**Why this priority**: This provides immediate value by unblocking the user during long operations that were initially started in the foreground.

**Independent Test**: Can be tested by running a long bash command (e.g., `sleep 60`), pressing Ctrl-B, and verifying that the CLI returns to the prompt while the command continues in the background.

**Acceptance Scenarios**:

1. **Given** a bash or task tool is running in the foreground, **When** the user sees the hint `[Ctrl-B] Background` and presses Ctrl-B, **Then** the tool's foreground execution ends, and the task continues in the background.
2. **Given** a tool has been backgrounded via Ctrl-B, **When** the user checks the task status via `/tasks`, **Then** the tool should be visible as a background task.

---

### Edge Cases

- **Invalid Task ID**: How does the system handle `TaskOutput` or `TaskStop` requests with an ID that doesn't exist? (Expected: Error message indicating the task was not found).
- **Task Already Finished**: What happens when `TaskStop` is called on a task that has already completed? (Expected: Informative message that the task is already finished).
- **Timeout on Output Retrieval**: How does `TaskOutput` handle a task that takes longer than the specified timeout when `block: true`? (Expected: Return the last few lines of the log file with a status indicating it's still running).
- **Concurrent Access**: Multiple requests for output from the same background task.
- **Ctrl-B pressed when no tool is running**: The system should ignore the keypress.
- **Direct user bash commands (`!command`)**: Commands initiated directly by the user using the `!` prefix MUST NOT be affected by Ctrl-B.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `Task` tool MUST support a `run_in_background` boolean parameter.
- **FR-002**: When `run_in_background` is true, the system MUST initiate the task asynchronously and return a unique `task_id` and an `outputPath` to a real-time log file immediately.
- **FR-003**: The system MUST provide a `TaskOutput` tool to retrieve output from background tasks.
- **FR-004**: `TaskOutput` MUST support a `task_id` parameter.
- **FR-005**: `TaskOutput` MUST support a `block` parameter (defaulting to true) to determine whether to wait for task completion.
- **FR-006**: `TaskOutput` MUST support a `timeout` parameter for blocking calls (default: 30000ms, max: 600000ms).
- **FR-007**: The system MUST provide a `TaskStop` tool to terminate running background tasks.
- **FR-008**: `TaskStop` MUST support a `task_id` parameter.
- **FR-009**: The `BashOutput` and `KillBash` tools MUST be removed/deprecated in favor of the unified `TaskOutput` and `TaskStop` tools.
- **FR-010**: `TaskOutput` MUST work for both background shell tasks and async agent tasks.
- **FR-011**: Background tasks MUST NOT update their `shortResult` while running to prevent unnecessary message updates and "unknown" tool blocks in the UI.
- **FR-012**: The CLI MUST implement a `/tasks` command to list all active and recently completed tasks.
- **FR-013**: The legacy `/bashes` command MUST be removed from the CLI.
- **FR-014**: The `/tasks` command output MUST include task IDs, status, and task type.
- **FR-015**: For background shell tasks, the system MUST pipe `stdout` and `stderr` to the `outputPath` log file in real-time.
- **FR-016**: For background subagent tasks, the system MUST log tool execution details (tool name and compact parameters) to the `outputPath` log file in real-time.
- **FR-017**: The `outputPath` log file MUST be properly closed when the task completes or is stopped.
- **FR-018**: The CLI MUST display a UI hint (e.g., `[Ctrl-B] Background`) while a backgroundable tool (Bash or Task) is running in the foreground.
- **FR-019**: The CLI MUST listen for the Ctrl-B key combination while a tool is executing in the foreground.
- **FR-020**: When Ctrl-B is pressed during a Bash or Task tool execution, the system MUST transition the tool's foreground stage to "end" and continue it in the background.
- **FR-021**: The result of a backgrounded tool MUST be set to "Command was manually backgrounded by user with ID [ID]".
- **FR-022**: The system MUST NOT background bash commands that were initiated directly by the user using the `!` prefix when Ctrl-B is pressed.

### Key Entities *(include if feature involves data)*

- **Task**: Represents an execution unit (shell command or agent subtask).
    - Attributes: `task_id` (unique identifier), `status` (pending, running, completed, failed, stopped), `output` (accumulated logs/results), `type` (shell, agent), `outputPath` (optional path to real-time log file).

# Feature Specification: Bash Tools

**Feature Branch**: `002-bash-tools`  
**Created**: 2024-12-19  
**Input**: User description: "Support bash tools: Bash, BashOutput, KillBash"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Execute Foreground Commands (Priority: P1)

As an AI agent, I want to execute shell commands in the foreground so that I can perform tasks like running tests, managing git, or executing build scripts and see the results immediately.

**Why this priority**: This is the primary way the agent interacts with the system for non-file operations.

**Independent Test**: Run a simple command like `echo "hello"` and verify the output is returned.

**Acceptance Scenarios**:

1. **Given** a command to execute, **When** the `Bash` tool is called, **Then** it MUST return the command's output (stdout and stderr).
2. **Given** a command that takes time, **When** it exceeds the timeout, **Then** it MUST be terminated and return a timeout error.

---

### User Story 2 - Background Process Management (Priority: P2)

As an AI agent, I want to run long-running commands in the background and retrieve their output later so that I can continue working on other tasks while the command executes.

**Why this priority**: Essential for tasks like starting a development server or running a long test suite without blocking the agent.

**Independent Test**: Start a background process with `sleep 5 && echo "done"`, check its output with the `Read` tool after 5 seconds.

**Acceptance Scenarios**:

1. **Given** `run_in_background` is true, **When** `Bash` is called, **Then** it MUST return a `bash_id` and an `outputPath` to a real-time log file immediately.
2. **Given** a running background process, **When** `TaskStop` (formerly `KillBash`) is called with its ID, **Then** the process MUST be terminated.
3. **Given** a background process started, **When** I read the provided `outputPath` file using the `Read` tool, **Then** I should see the real-time output of the process.

---

### User Story 3 - Real-time Foreground Streaming (Priority: P2)

As an AI agent, I want to see the output of foreground commands in real-time so that I can monitor progress and receive immediate feedback for long-running tasks.

**Why this priority**: Provides a more responsive and interactive experience, especially for commands that produce incremental output.

**Independent Test**: Run a command like `for i in {1..5}; do echo $i; sleep 1; done` and verify that the output updates in the UI every second.

**Acceptance Scenarios**:

1. **Given** a foreground command is running, **When** it produces output, **Then** the `shortResult` MUST update in real-time with the last 3 lines of output.
2. **Given** a foreground command is running, **When** it produces output, **Then** the full `result` MUST update in real-time with the accumulated output.
3. **Given** a foreground command is running, **When** updates occur, **Then** they MUST be throttled (e.g., once per second) to avoid overwhelming the UI.

---

### Edge Cases

- **Output Truncation**: If a command produces massive output (e.g., > 30,000 characters), the system must truncate it to prevent overwhelming the LLM. Excess output is persisted to a temp file.
- **ANSI Color Codes**: Output containing ANSI escape sequences for colors should be stripped to ensure the LLM can read the text clearly.
- **Process Group Termination**: When killing a background process, it should terminate the entire process group to avoid leaving orphan processes.
- **Invalid Task ID**: Calling `TaskStop` with a non-existent or expired ID should return a clear error message.
- **Fresh Shell per Command**: Each foreground command spawns a new shell; `cd` and env changes do not persist between calls.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `Bash` tool for executing shell commands.
- **FR-002**: `Bash` tool MUST support an optional `timeout` parameter (default 120s for foreground).
- **FR-003**: `Bash` tool MUST support a `run_in_background` parameter.
- **FR-004**: System MUST NOT provide a `TaskOutput` (formerly `BashOutput`) tool; instead, agents SHOULD use the `Read` tool to read the `outputPath`.
- **FR-006**: System MUST provide a `TaskStop` (formerly `KillBash`) tool to terminate background processes.
- **FR-007**: All bash output MUST have ANSI color codes stripped.
- **FR-008**: Foreground bash output MUST be truncated if it exceeds 30,000 characters.
- **FR-009**: Background bash tasks MUST NOT update their `shortResult` while running to prevent unnecessary message updates and "unknown" tool blocks in the UI.
- **FR-010**: Each `Bash` call spawns a fresh shell process with `cwd: context.workdir` and a copy of `process.env`. Environment variables set in one command do NOT persist to subsequent commands.
- **FR-011**: When `run_in_background` is true, the system MUST return an `outputPath` to a real-time log file.
- **FR-012**: The system MUST pipe `stdout` and `stderr` to the `outputPath` log file in real-time.
- **FR-013**: Foreground `Bash` tool MUST support real-time streaming updates to both `shortResult` and the full `result` content.
- **FR-014**: Real-time updates for foreground `Bash` tool MUST be throttled to once per second.
- **FR-015**: Real-time `shortResult` for foreground `Bash` tool MUST show the last 3 lines of output.
- **FR-016**: The `Read` tool MUST work for reading the `outputPath` of background processes.

### Key Entities *(include if feature involves data)*

- **Foreground Command**: A single shell execution via `spawn()` with `cwd: context.workdir`; fresh shell per call.
- **Background Task**: A long-running shell process managed by `BackgroundTaskManager`, output piped to a log file.
- **Command Output**: The combined stdout and stderr from a command execution, ANSI-stripped and potentially truncated.

## Assumptions

- The agent has the necessary permissions to execute bash commands in the target environment.
- The underlying shell is compatible with standard Bash syntax.
- The `PermissionManager` will handle security checks before any command is actually executed.
- Agents are instructed to prefer specialized tools (Read, Write, etc.) over general bash commands when appropriate.

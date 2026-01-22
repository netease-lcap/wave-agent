# Feature Specification: Bash Tools

**Feature Branch**: `002-bash-tools-spec`  
**Created**: 2024-12-19  
**Status**: Implemented  
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

**Independent Test**: Start a background process with `sleep 5 && echo "done"`, check its output with `BashOutput` after 5 seconds.

**Acceptance Scenarios**:

1. **Given** `run_in_background` is true, **When** `Bash` is called, **Then** it MUST return a `bash_id` immediately.
2. **Given** a valid `bash_id`, **When** `BashOutput` is called, **Then** it MUST return the accumulated output.
3. **Given** a running background process, **When** `KillBash` is called with its ID, **Then** the process MUST be terminated.

---

### Edge Cases

- **Output Truncation**: If a command produces massive output (e.g., > 30,000 characters), the system must truncate it to prevent overwhelming the LLM.
- **ANSI Color Codes**: Output containing ANSI escape sequences for colors should be stripped to ensure the LLM can read the text clearly.
- **Process Group Termination**: When killing a background process, it should terminate the entire process group to avoid leaving orphan processes.
- **Invalid Bash ID**: Calling `BashOutput` or `KillBash` with a non-existent or expired ID should return a clear error message.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `Bash` tool for executing shell commands.
- **FR-002**: `Bash` tool MUST support an optional `timeout` parameter (default 120s for foreground).
- **FR-003**: `Bash` tool MUST support a `run_in_background` parameter.
- **FR-004**: System MUST provide a `BashOutput` tool to retrieve output from background processes using a `bash_id`.
- **FR-005**: `BashOutput` tool SHOULD support filtering output lines using a regular expression.
- **FR-006**: System MUST provide a `KillBash` tool to terminate background processes.
- **FR-007**: All bash output MUST have ANSI color codes stripped.
- **FR-008**: Foreground bash output MUST be truncated if it exceeds 30,000 characters.
- **FR-009**: The system MUST maintain environment variables across sequential `Bash` calls (persistent session behavior).

### Key Entities *(include if feature involves data)*

- **Bash Session**: Represents a shell execution context.
- **Bash ID**: A unique identifier for a background process.
- **Command Output**: The combined stdout and stderr from a command execution.

## Assumptions

- The agent has the necessary permissions to execute bash commands in the target environment.
- The underlying shell is compatible with standard Bash syntax.
- The `PermissionManager` will handle security checks before any command is actually executed.
- Agents are instructed to prefer specialized tools (Read, Write, etc.) over general bash commands when appropriate.

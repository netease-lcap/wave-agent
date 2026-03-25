# Feature Specification: Bang Shell Command

**Feature Branch**: `028-bang-shell-command`  
**Created**: 2026-03-25  
**Input**: User description: "support bang shell command to execute shell command directly from chat input. prefix with ! to trigger. for example, !ls -la or !fdfind . the output should be displayed in a dedicated block."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Basic Command Execution (Priority: P1)

As a user, I want to be able to execute shell commands directly from the chat input by prefixing them with `!`, so that I can quickly perform system operations without leaving the agent interface.

**Why this priority**: This is the core functionality of the feature. It provides a powerful way for users to interact with their system.

**Independent Test**: Can be tested by typing a command like `!echo "hello"` in the chat input and verifying that the command is executed and the output "hello" is displayed in the conversation.

**Acceptance Scenarios**:

1. **Given** the chat input is empty, **When** the user types `!ls -la` and presses Enter, **Then** the command `ls -la` is executed in the current working directory, and its output is displayed in a `BangBlock`.
2. **Given** a command is being executed, **When** the user types another command, **Then** the system should prevent concurrent execution and show an error message.

---

### User Story 2 - Output Display and Truncation (Priority: P2)

As a user, I want the output of my shell commands to be displayed clearly, with long outputs being truncated by default to avoid cluttering the chat history, but still accessible if I need to see the full result.

**Why this priority**: This ensures a good user experience by keeping the chat history readable while still providing access to full command results.

**Independent Test**: Can be tested by executing a command with many lines of output (e.g., `!seq 1 100`) and verifying that only the last few lines are shown by default, and that expanding the block reveals the full output.

**Acceptance Scenarios**:

1. **Given** a command with 20 lines of output, **When** the output is displayed in the chat, **Then** only the last 3 lines are shown by default.
2. **Given** a truncated output block, **When** the user expands the block (e.g., by clicking or using a keyboard shortcut), **Then** the full 20 lines of output are displayed.

---

### User Story 3 - Command Abort (Priority: P2)

As a user, I want to be able to abort a long-running shell command if I realize it was a mistake or if it's taking too long.

**Why this priority**: This prevents the agent from being stuck waiting for a command that may never finish or that the user no longer wants to run.

**Acceptance Scenarios**:

1. **Given** a long-running command like `!sleep 60` is executing, **When** the user triggers an abort action (e.g., Ctrl+C), **Then** the process is killed and the `BangBlock` reflects that the command was terminated.

---

### Edge Cases

- **What happens if the command does not exist?** The system should capture the error from the shell and display it in the `BangBlock` with an appropriate error status (e.g., red color).
- **What happens if the command produces no output?** The `BangBlock` should still show the command and its exit status, but the output area should be empty or hidden.
- **What happens if the command is interrupted by a signal (e.g., SIGINT)?** The system should handle the signal gracefully, update the exit code (e.g., 130 for SIGINT), and show that the command was interrupted.
- **What happens if the command is executed in a directory that doesn't exist?** The `BangManager` should handle the error and report it to the user.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST detect chat inputs starting with `!` as shell commands.
- **FR-002**: System MUST execute the command following the `!` in the current working directory.
- **FR-003**: System MUST capture stdout and stderr from the executed command.
- **FR-004**: System MUST display the command and its output in a dedicated `BangBlock` within the conversation history.
- **FR-005**: System MUST show the execution status (running, success, failure) using visual cues (e.g., colors).
- **FR-006**: System MUST truncate long outputs to a maximum of 3 lines by default.
- **FR-007**: System MUST provide a way to expand the `BangBlock` to show the full output.
- **FR-008**: System MUST prevent multiple concurrent bang commands from being executed.
- **FR-009**: System MUST provide a mechanism to abort a running bang command.

### Key Entities *(include if feature involves data)*

- **BangBlock**: A message block type representing a shell command execution, containing the command string, output, running state, and exit code.
- **BangManager**: A service responsible for spawning the shell process, managing its lifecycle, and communicating updates to the message history.

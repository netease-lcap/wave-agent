# Feature Specification: Ctrl-B Background Tool

**Feature Branch**: `062-ctrl-b-background-tool`  
**Created**: 2026-02-10  
**Status**: Draft  
**Input**: User description: "code cli user press ctrl b can make a foreground bash tool or task tool run in background, stage of tool should be end, result of tool should be \"Command was manually backgrounded by user with ID\". branch short name can be 062-ctrl-b-background-tool"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Backgrounding a Bash Tool (Priority: P1)

As a user running a long-running bash command (like a build or a server), I want to be able to move it to the background so I can continue using the CLI for other tasks without waiting for it to finish.

**Why this priority**: This is the core functionality requested. It provides immediate value by unblocking the user during long operations.

**Independent Test**: Can be tested by running a long bash command (e.g., `sleep 60`), pressing Ctrl-B, and verifying that the CLI returns to the prompt while the command continues in the background.

**Acceptance Scenarios**:

1. **Given** a bash tool is running in the foreground, **When** the user sees the hint `[Ctrl-B] Background` and presses Ctrl-B, **Then** the tool's execution state in the current session is marked as "end", and the result is recorded as "Command was manually backgrounded by user with ID [ID]".
2. **Given** a bash tool has been backgrounded, **When** the user checks the task status, **Then** the tool should be visible as a background task.

---

### User Story 2 - Backgrounding a Task Tool (Priority: P2)

As a user, I want to be able to background a subagent task (Task tool) that is taking a long time to complete, so I can perform other operations in the main agent.

**Why this priority**: Extends the backgrounding capability to subagent tasks, which can often be long-running.

**Independent Test**: Can be tested by starting a complex task via the Task tool, pressing Ctrl-B, and verifying the main agent is unblocked.

**Acceptance Scenarios**:

1. **Given** a Task tool is running in the foreground, **When** the user sees the hint `[Ctrl-B] Background` and presses Ctrl-B, **Then** the tool's foreground execution ends with the specified result message, and the task continues in the background.

---

### Edge Cases

- **Ctrl-B pressed when no tool is running**: The system should ignore the keypress or provide a subtle indication that no foreground tool is active.
- **Tool finishes just as Ctrl-B is pressed**: The system should handle the race condition gracefully, ideally prioritizing the actual completion if it happened first.
- **Multiple Ctrl-B presses**: Subsequent presses while a tool is already being backgrounded should be ignored.
- **Backgrounding a tool that doesn't support backgrounding**: If there are tools that cannot be backgrounded (though the request specifies bash and task tools), the system should inform the user.
- **Direct user bash commands (`!command`)**: Commands initiated directly by the user using the `!` prefix MUST NOT be affected by Ctrl-B.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-000**: The CLI MUST display a UI hint (e.g., `[Ctrl-B] Background`) while a backgroundable tool (Bash or Task) is running in the foreground.
- **FR-001**: The CLI MUST listen for the Ctrl-B key combination while a tool is executing in the foreground.
- **FR-001.1**: If multiple tools are running in parallel, Ctrl-B MUST background only the **latest** started tool that supports backgrounding.
- **FR-002**: When Ctrl-B is pressed during a Bash tool execution, the system MUST transition the tool's stage to "end".
- **FR-003**: When Ctrl-B is pressed during a Task tool execution, the system MUST transition the tool's stage to "end".
- **FR-004**: The result of a backgrounded tool MUST be set to "Command was manually backgrounded by user with ID [ID]".
- **FR-005**: The system MUST ensure the underlying process or task continues to run in the background after being backgrounded from the foreground.
- **FR-006**: The CLI MUST return control to the user (show the prompt or next agent message) immediately after a tool is backgrounded.
- **FR-007**: The system MUST include the unique ID of the backgrounded task/command in the result message.
- **FR-008**: The system MUST NOT background bash commands that were initiated directly by the user using the `!` prefix when Ctrl-B is pressed.

### Key Entities *(include if feature involves data)*

- **Tool Execution**: Represents the lifecycle of a tool call (bash, task, etc.).
- **Background Task**: An entity representing a process or subagent task running independently of the main foreground loop.
- **User ID**: A unique identifier for the user session or the specific backgrounded command instance.

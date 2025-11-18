# Feature Specification: Hook Exit Code Output Support

**Feature Branch**: `011-hooks-exitcode-output`  
**Created**: 2025-11-15  
**Status**: Draft  
**Input**: User description: "support hooks exitCode output. refer this: ## Hook Output

There are two ways for hooks to return output back to Wave Agent. The output
communicates whether to block and any feedback that should be shown to Wave
and the user.

### Simple: Exit Code

Hooks communicate status through exit codes, stdout, and stderr:

* **Exit code 0**: Success. stdout is
  added to the context only for `UserPromptSubmit`.
* **Exit code 2**: Blocking error. `stderr` is fed back to Wave to process
  automatically. See per-hook-event behavior below.
* **Other exit codes**: Non-blocking error. `stderr` is shown to the user and
  execution continues.

<Warning>
  Reminder: Wave Agent does not see stdout if the exit code is 0, except for
  the `UserPromptSubmit` hook where stdout is injected as context.
</Warning>

#### Exit Code 2 Behavior

| Hook Event         | Behavior                                                           |
| ------------------ | ------------------------------------------------------------------ |
| `PreToolUse`       | Blocks the tool call, shows stderr to Wave                       |
| `PostToolUse`      | Shows stderr to Wave and allows AI to continue (tool already ran) |
| `UserPromptSubmit` | Blocks prompt processing, erases prompt, shows stderr to user only |
| `Stop`             | Blocks stoppage, shows stderr to Wave                            |"

## Clarifications

### Session 2025-11-15

- Q: Should testing implementation details be formally documented in the specification to ensure consistent validation approaches? → A: Include formal testing validation patterns in the spec as testable requirements

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hook Success Feedback (Priority: P1)

When a hook script executes successfully, users need to know the operation completed and any relevant context should be captured for downstream processing.

**Why this priority**: This is the core success path that enables basic hook functionality and must work for any hook system to be useful.

**Independent Test**: Can be fully tested by executing a hook that returns exit code 0 and verifying stdout handling behavior varies by hook type using agent.messages validation.

**Acceptance Scenarios**:

1. **Given** a `UserPromptSubmit` hook returns exit code 0 with stdout content, **When** the hook completes, **Then** the stdout content is injected into Wave Agent's context and `agent.messages` contains two user role messages with the second containing hook stdout
2. **Given** any other hook type returns exit code 0 with stdout content, **When** the hook completes, **Then** the stdout content is ignored and not visible to Wave Agent
3. **Given** any hook returns exit code 0 with stderr content, **When** the hook completes, **Then** the stderr content is ignored and execution continues normally

---

### User Story 2 - Hook Blocking Error Handling (Priority: P1)

When a hook script encounters a critical error that should prevent further execution, users need the system to halt the operation and provide error feedback to the appropriate recipient.

**Why this priority**: Blocking errors are essential for maintaining system integrity and preventing unwanted operations from proceeding.

**Independent Test**: Can be fully tested by executing hooks that return exit code 2 and verifying different blocking behaviors per hook type through agent.messages validation patterns.

**Acceptance Scenarios**:

1. **Given** a `PreToolUse` hook returns exit code 2 with stderr, **When** the hook completes, **Then** the tool call is blocked and `agent.messages` includes a `ToolBlock` with stderr in the result field
2. **Given** a `PostToolUse` hook returns exit code 2 with stderr, **When** the hook completes, **Then** `agent.messages` includes a user role message with stderr content and AI continues processing
3. **Given** a `UserPromptSubmit` hook returns exit code 2 with stderr, **When** the hook completes, **Then** prompt processing is blocked, prompt is erased, and `agent.messages` contains an `ErrorBlock` in assistant message with stderr content (user-visible only)
4. **Given** a `Stop` hook returns exit code 2 with stderr, **When** the hook completes, **Then** stoppage is blocked and `agent.messages` contains a user role message with stderr content

---

### User Story 3 - Hook Non-Blocking Error Reporting (Priority: P2)

When a hook script encounters a non-critical error, users need to see the error information but the system should continue normal operation.

**Why this priority**: Non-blocking errors provide valuable debugging information without interrupting workflows, making them important but not critical.

**Independent Test**: Can be fully tested by executing hooks that return any exit code other than 0 or 2 and verifying error display with continued execution.

**Acceptance Scenarios**:

1. **Given** any hook returns an exit code other than 0 or 2 with stderr content, **When** the hook completes, **Then** stderr is displayed to the user and execution continues normally
2. **Given** any hook returns an exit code other than 0 or 2 with stdout content, **When** the hook completes, **Then** stdout is ignored and execution continues normally

---

### Edge Cases

- What happens when a hook script produces both stdout and stderr with exit code 0?
- How does the system handle hooks that produce no output (empty stdout/stderr)?
- What occurs when a hook script hangs or times out?
- How are extremely large stdout/stderr outputs managed?
- What happens when stderr contains non-UTF-8 or binary content?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST interpret hook exit code 0 as success status
- **FR-002**: System MUST interpret hook exit code 2 as blocking error status
- **FR-003**: System MUST interpret any other hook exit codes as non-blocking error status
- **FR-004**: System MUST capture stdout from `UserPromptSubmit` hooks when exit code is 0 and inject it into Wave Agent context
- **FR-005**: System MUST ignore stdout from all non-`UserPromptSubmit` hooks regardless of exit code
- **FR-006**: System MUST block tool execution when `PreToolUse` hook returns exit code 2
- **FR-007**: System MUST display stderr to Wave Agent when `PreToolUse` hook returns exit code 2
- **FR-008**: System MUST display stderr to Wave Agent via user role message when `PostToolUse` hook returns exit code 2 and allow AI to continue processing (tool already executed)
- **FR-009**: System MUST block prompt processing when `UserPromptSubmit` hook returns exit code 2
- **FR-010**: System MUST erase the current prompt when `UserPromptSubmit` hook returns exit code 2
- **FR-011**: System MUST display stderr to user only (not Wave Agent) when `UserPromptSubmit` hook returns exit code 2
- **FR-012**: System MUST block stoppage when `Stop` hook returns exit code 2
- **FR-013**: System MUST display stderr to Wave Agent when `Stop` hook returns exit code 2
- **FR-014**: System MUST display stderr to user and continue execution for non-blocking errors (exit codes other than 0 or 2)
- **FR-015**: System MUST distinguish between different hook event types (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`) for appropriate behavior

### Testing Validation Requirements

- **FR-016**: System MUST validate `UserPromptSubmit` success by checking that `agent.sendMessage()` results in `agent.messages` containing two user role messages, where the second message contains the hook stdout content
- **FR-017**: System MUST validate `PreToolUse` blocking errors by checking that `agent.messages` includes a `ToolBlock` with its result field containing the stderr content
- **FR-018**: System MUST validate `PostToolUse` error feedback by checking that `agent.messages` includes a user role message with stderr content
- **FR-019**: System MUST validate `UserPromptSubmit` blocking errors by checking that `agent.messages` does not contain the user role message and contains an `ErrorBlock` in the assistant message with stderr as content
- **FR-020**: System MUST ensure `ErrorBlock` content is not processed by `packages/agent-sdk/src/utils/convertMessagesForAPI.ts` so it remains user-visible only and is not sent to the agent
- **FR-021**: System MUST validate `Stop` hook blocking behavior by checking that `agent.messages` contains a user role message with stderr content

### Key Entities

- **Hook Event**: Represents the specific type of hook being executed (PreToolUse, PostToolUse, UserPromptSubmit, Stop), determines output behavior
- **Hook Output**: Contains exit code, stdout content, and stderr content from hook execution
- **Error Context**: Determines the recipient of error messages (Wave Agent vs. user) based on hook type and error severity
- **ToolBlock**: Data structure in agent messages that contains tool execution results and error information for PreToolUse and PostToolUse hooks
- **ErrorBlock**: Data structure in assistant messages that contains user-visible error information for UserPromptSubmit hooks, excluded from API conversion
- **Agent Message Collection**: The `agent.messages` array that serves as the primary validation point for testing hook behavior correctness

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All hook executions correctly interpret exit codes within 100ms of completion
- **SC-002**: UserPromptSubmit hook stdout injection occurs within 200ms for context under 10KB
- **SC-003**: Blocking errors prevent subsequent operations 100% of the time for affected hook types
- **SC-004**: Error messages reach the correct recipient (Wave Agent or user) 100% of the time based on hook type and exit code
- **SC-005**: Non-blocking errors allow continued execution in 100% of cases while still displaying error information to users
- **SC-006**: All hook behaviors are consistently testable through agent.messages validation patterns with 100% accuracy for determining correct implementation
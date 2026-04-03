# Feature Specification: Hooks Support

**Feature Branch**: `005-hooks`  
**Created**: 2024-12-19  
**Input**: User description: "Support hooks, refer to hooks.md"

## Hook Output

There are two ways for hooks to return output back to Wave Agent. The output communicates whether to block and any feedback that should be shown to Wave and the user.

### Simple: Exit Code

Hooks communicate status through exit codes, stdout, and stderr:

* **Exit code 0**: Success. stdout is added to the context only for `UserPromptSubmit`.
* **Exit code 2**: Blocking error. `stderr` is fed back to Wave to process automatically. See per-hook-event behavior below.
* **Other exit codes**: Non-blocking error. `stderr` is shown to the user and execution continues.

<Warning>
  Reminder: Wave Agent does not see stdout if the exit code is 0, except for the `UserPromptSubmit` hook where stdout is injected as context.
</Warning>

#### Exit Code 2 Behavior

| Hook Event         | Behavior                                                           |
| ------------------ | ------------------------------------------------------------------ |
| `PreToolUse`       | Blocks the tool call, shows stderr to Wave                       |
| `PostToolUse`      | Shows stderr to Wave and allows AI to continue (tool already ran) |
| `UserPromptSubmit` | Blocks prompt processing, erases prompt, shows stderr to user only |
| `Stop`             | Blocks stoppage (AI continues conversation), shows stderr to Wave |
| `SubagentStop`     | Blocks stoppage (Subagent continues), shows stderr to Wave |
| `PermissionRequest`| Blocks (denies) permission, shows stderr to user only |
| `WorktreeCreate`   | Shows stderr to user only (non-blocking) |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure Hook for Code Quality Checks (Priority: P1)

As a developer, I want to configure hooks that automatically run code quality checks after file editing operations, so that I can maintain consistent code standards without manual intervention.

**Why this priority**: This is the most common use case for hooks - automated quality assurance. It provides immediate value by catching issues early in the development process.

**Independent Test**: Can be fully tested by configuring a PostToolUse hook for Edit operations, editing a file, and verifying the quality check command executes and provides feedback.

**Acceptance Scenarios**:

1. **Given** a project with hooks configured for PostToolUse Edit operations, **When** I edit a file using the Edit tool, **Then** the configured code quality script executes automatically
2. **Given** multiple hooks configured for the same event, **When** the triggering event occurs, **Then** all matching hooks execute in the defined order
3. **Given** a hook command that fails, **When** the hook executes, **Then** the failure is logged but does not interrupt the main tool operation

---

### User Story 2 - Validate User Prompts Before Processing (Priority: P2)

As a project maintainer, I want to validate user prompts before Wave processes them, so that I can enforce project-specific guidelines or add contextual information automatically.

**Why this priority**: Enables proactive control over AI interactions and can improve response quality by adding context, but less immediately critical than post-action validation.

**Independent Test**: Can be fully tested by configuring a UserPromptSubmit hook, submitting various prompts, and verifying validation/context-addition logic executes correctly.

**Acceptance Scenarios**:

1. **Given** a UserPromptSubmit hook is configured, **When** a user submits a prompt, **Then** the validation script executes before Wave processes the prompt
2. **Given** a prompt validation script that modifies context, **When** the validation runs, **Then** the additional context is available to Wave's processing

---

### User Story 3 - Execute Tasks After AI Response Completion (Priority: P3)

As a developer, I want to run finalization tasks when Wave finishes generating its response (no more tool calls), so that I can perform post-processing or state updates after each AI interaction cycle.

**Why this priority**: Useful for post-response workflows like logging, state updates, or triggering follow-up processes, but not critical for basic hook functionality.

**Independent Test**: Can be fully tested by configuring a Stop hook, having Wave complete a response cycle with no further tool calls, and verifying the configured tasks execute properly.

**Acceptance Scenarios**:

1. **Given** a Stop hook is configured, **When** Wave finishes its response cycle with no more tool calls, **Then** the configured commands execute
2. **Given** a Stop hook with project-specific scripts, **When** the AI response is complete, **Then** the post-processing tasks run automatically

---

### User Story 4 - PreToolUse Hook Data Access (Priority: P1)

A developer creates a PreToolUse hook that needs to analyze the incoming tool command and its parameters before execution. The hook receives structured JSON data via stdin containing session context, tool information, and input parameters, allowing it to make informed decisions about whether to allow, modify, or block the tool execution.

**Why this priority**: This is the most common hook use case - intercepting and potentially modifying tool execution based on context and parameters.

**Independent Test**: Can be tested with `jq` by configuring a PreToolUse hook and verifying JSON fields are accessible: `jq -r '.session_id, .transcript_path, .cwd, .hook_event_name, .tool_name, .tool_input'`

**Acceptance Scenarios**:

1. **Given** a PreToolUse hook is configured and a Write tool is about to execute, **When** the hook process starts, **Then** it receives JSON via stdin containing session_id, transcript_path (path to ~/.wave/sessions/session_[id].json), cwd, hook_event_name "PreToolUse", tool_name "Write", and tool_input with file_path and content fields
2. **Given** a PreToolUse hook is configured and a Read tool is about to execute, **When** the hook process starts, **Then** it receives JSON via stdin with the appropriate tool_input schema for the Read tool

---

### User Story 5 - PostToolUse Hook Response Analysis (Priority: P2)

A developer creates a PostToolUse hook that needs to analyze tool execution results and potentially perform follow-up actions. The hook receives JSON data containing both the original tool input and the tool's response/output, enabling comprehensive post-execution processing.

**Why this priority**: Essential for audit trails, error handling, and automated follow-up actions based on tool results.

**Independent Test**: Can be tested with `jq` by configuring a PostToolUse hook and verifying JSON contains both input and response: `jq -r '.tool_input, .tool_response'`

**Acceptance Scenarios**:

1. **Given** a PostToolUse hook is configured and a Write tool has completed successfully, **When** the hook process starts, **Then** it receives JSON containing session context, tool_name "Write", original tool_input, and tool_response with success status and file path
2. **Given** a PostToolUse hook is configured and a tool execution fails, **When** the hook process starts, **Then** it receives JSON with tool_response containing error information

---

### User Story 6 - Session Access via Transcript Path (Priority: P2)

A hook needs to access the complete conversation history to make context-aware decisions. The hook uses the transcript_path field from the JSON input to load the full session data, enabling analysis of previous interactions and conversation context.

**Why this priority**: Critical for hooks that need conversation context for intelligent decision-making.

**Independent Test**: Can be tested with `jq` by configuring any hook and verifying session data can be loaded: `jq -r '.transcript_path' | xargs cat | jq '.state.messages'`

**Acceptance Scenarios**:

1. **Given** a hook receives JSON with transcript_path field, **When** the hook reads the file at that path, **Then** it successfully loads the complete session data including all messages and metadata
2. **Given** a long conversation session exists, **When** any hook is triggered, **Then** the transcript_path points to the current session file with all accumulated conversation history

---

### User Story 7 - UserPromptSubmit Hook Monitoring (Priority: P3)

A developer creates a UserPromptSubmit hook to monitor and analyze user inputs for security scanning, content filtering, or usage analytics. The hook receives JSON data containing the user's prompt text and session context.

**Why this priority**: Useful for security, compliance, and analytics but not essential for core functionality.

**Independent Test**: Can be tested with `jq` by configuring a UserPromptSubmit hook and verifying prompt text is accessible: `jq -r '.prompt'`

**Acceptance Scenarios**:

1. **Given** a UserPromptSubmit hook is configured, **When** a user submits a prompt, **Then** the hook receives JSON containing session_id, transcript_path, cwd, hook_event_name "UserPromptSubmit", and the user's prompt text
2. **Given** a UserPromptSubmit hook needs to access conversation history, **When** it loads the transcript_path, **Then** it can analyze the full conversation context along with the new prompt

---

### User Story 8 - Stop Hook Cleanup Actions (Priority: P3)

A developer creates a Stop hook to perform cleanup actions when a session ends. The hook receives minimal JSON data indicating the session termination and can perform final operations like saving summaries or cleaning up temporary resources.

**Why this priority**: Useful for cleanup and finalization but not critical for core operation.

**Independent Test**: Can be tested with `jq` by configuring a Stop hook and verifying event name is accessible: `jq -r '.hook_event_name'`

**Acceptance Scenarios**:

1. **Given** a Stop hook is configured, **When** a session ends, **Then** the hook receives JSON containing session_id, transcript_path, and hook_event_name "Stop"
2. **Given** a Stop hook needs to perform cleanup, **When** it receives the stop notification, **Then** it can access the final session state via transcript_path

---

### User Story 9 - Async Hook Execution (Priority: P2)

As a developer, I want to run long-running tasks like tests or background analysis as hooks without blocking Wave's response, so that I can continue my interaction while the tasks execute in the background.

**Why this priority**: Enables powerful background workflows without sacrificing the responsiveness of the AI agent.

**Independent Test**: Can be tested by configuring an async hook with a `sleep` command and verifying that Wave continues immediately without waiting for the sleep to complete.

**Acceptance Scenarios**:

1. **Given** an async hook is configured with `async: true`, **When** the triggering event occurs, **Then** the hook command starts executing in the background and Wave continues its workflow immediately.
2. **Given** an async hook with a custom `timeout`, **When** the hook executes, **Then** it is allowed to run up to the specified timeout before being terminated.
3. **Given** an async hook produces output, **When** it completes, **Then** its output is logged but not delivered to the conversation.

---

### User Story 10 - Permission Request Hook (Priority: P2)

As a developer, I want to run hooks when Wave requests permission to use a tool, so that I can automate permission granting or perform additional checks before I manually approve.

**Why this priority**: Enables automation of the permission flow and provides hooks with full context of the tool call being authorized.

**Independent Test**: Can be tested by configuring a PermissionRequest hook, triggering a tool that requires permission, and verifying the hook receives tool_name and tool_input.

**Acceptance Scenarios**:

1. **Given** a PermissionRequest hook is configured, **When** Wave needs permission to use a tool, **Then** the hook receives JSON containing session context, hook_event_name "PermissionRequest", tool_name, and tool_input.
2. **Given** a PermissionRequest hook that analyzes tool input, **When** it runs, **Then** it can use the provided tool_input to decide on further actions.

---

### User Story 11 - Hook Success Feedback (Priority: P1)

When a hook script executes successfully, users need to know the operation completed and any relevant context should be captured for downstream processing.

**Why this priority**: This is the core success path that enables basic hook functionality and must work for any hook system to be useful.

**Independent Test**: Can be fully tested by executing a hook that returns exit code 0 and verifying stdout handling behavior varies by hook type using agent.messages validation.

**Acceptance Scenarios**:

1. **Given** a `UserPromptSubmit` hook returns exit code 0 with stdout content, **When** the hook completes, **Then** the stdout content is injected into Wave Agent's context and `agent.messages` contains two user role messages with the second containing hook stdout
2. **Given** any other hook type returns exit code 0 with stdout content, **When** the hook completes, **Then** the stdout content is ignored and not visible to Wave Agent
3. **Given** any hook returns exit code 0 with stderr content, **When** the hook completes, **Then** the stderr content is ignored and execution continues normally

---

### User Story 12 - Hook Blocking Error Handling (Priority: P1)

When a hook script encounters a critical error that should prevent further execution, users need the system to halt the operation and provide error feedback to the appropriate recipient.

**Why this priority**: Blocking errors are essential for maintaining system integrity and preventing unwanted operations from proceeding.

**Independent Test**: Can be fully tested by executing hooks that return exit code 2 and verifying different blocking behaviors per hook type through agent.messages validation patterns.

**Acceptance Scenarios**:

1. **Given** a `PreToolUse` hook returns exit code 2 with stderr, **When** the hook completes, **Then** the tool call is blocked and `agent.messages` includes a `ToolBlock` with stderr in the result field
2. **Given** a `PostToolUse` hook returns exit code 2 with stderr, **When** the hook completes, **Then** `agent.messages` includes a user role message with stderr content and AI continues processing
3. **Given** a `UserPromptSubmit` hook returns exit code 2 with stderr, **When** the hook completes, **Then** prompt processing is blocked, prompt is erased, and `agent.messages` contains an `ErrorBlock` in assistant message with stderr content (user-visible only)
4. **Given** a `Stop` hook returns exit code 2 with stderr, **When** the hook completes, **Then** stoppage is blocked and `agent.messages` contains a user role message with stderr content

---

### User Story 13 - Hook Non-Blocking Error Reporting (Priority: P2)

When a hook script encounters a non-critical error, users need to see the error information but the system should continue normal operation.

**Why this priority**: Non-blocking errors provide valuable debugging information without interrupting workflows, making them important but not critical.

**Independent Test**: Can be fully tested by executing hooks that return any exit code other than 0 or 2 and verifying error display with continued execution.

**Acceptance Scenarios**:

1. **Given** any hook returns an exit code other than 0 or 2 with stderr content, **When** the hook completes, **Then** stderr is displayed to the user and execution continues normally
2. **Given** any hook returns an exit code other than 0 or 2 with stdout content, **When** the hook completes, **Then** stdout is ignored and execution continues normally

## Edge Cases

- What happens when a hook command fails or times out?
- How does the system handle hooks that modify files while Wave is still processing?
- What occurs when multiple hooks are configured for the same event with conflicting operations?
- How are environment variables handled in different execution contexts?
- What happens when hook scripts are not executable or missing?
- Malformed JSON data handling
- Hooks that don't read stdin
- What happens when a hook script produces both stdout and stderr with exit code 0?
- How does the system handle hooks that produce no output (empty stdout/stderr)?
- What occurs when a hook script hangs or times out?
- How are extremely large stdout/stderr outputs managed?
- What happens when stderr contains non-UTF-8 or binary content?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support configuring hooks in both user-level (~/.wave/settings.json) and project-level (.wave/settings.json) settings files
- **FR-002**: System MUST support PreToolUse hooks that execute before tool processing begins
- **FR-003**: System MUST support PostToolUse hooks that execute after successful tool completion
- **FR-004**: System MUST support UserPromptSubmit hooks that execute when users submit prompts
- **FR-005**: System MUST support Stop hooks that execute when Wave finishes its response cycle (no more tool calls to generate)
- **FR-025**: System MUST support PermissionRequest hooks that execute when Wave requests permission to use a tool
- **FR-026**: System MUST support SubagentStop hooks that execute when a subagent finishes its response cycle
- **FR-027**: System MUST support WorktreeCreate hooks that execute when a new worktree is created
- **FR-006**: System MUST support tool name pattern matching including exact strings (case-insensitive), glob patterns (using minimatch), and pipe-separated alternatives (e.g., "Edit|Write")
- **FR-007**: System MUST provide WAVE_PROJECT_DIR environment variable to hook commands for project-relative script execution
- **FR-008**: System MUST execute multiple hooks for the same event in the configured order
- **FR-009**: System MUST log hook execution results and errors without interrupting main tool operations
- **FR-010**: System MUST support command-type hooks with configurable bash commands
- **FR-011**: System MUST provide JSON data to hook processes via stdin containing session_id, transcript_path, cwd, and hook_event_name fields for all hook events.
- **FR-051**: System MUST provide environment variables to hook processes: `HOOK_EVENT`, `HOOK_TOOL_NAME` (if applicable), and `WAVE_PROJECT_DIR`.
- **FR-052**: System MUST inherit parent process environment variables for hook execution, including those from configuration `env` settings.
- **FR-012**: System MUST include tool_name and tool_input fields in JSON data for PreToolUse, PostToolUse, and PermissionRequest events
- **FR-013**: System MUST include tool_response field in JSON data for PostToolUse events containing the tool's execution result
- **FR-014**: System MUST include prompt field in JSON data for UserPromptSubmit events containing the user's submitted text
- **FR-028**: System MUST include subagent_type field in JSON data when a hook is executed by a subagent
- **FR-029**: System MUST include name field in JSON data for WorktreeCreate events
- **FR-015**: System MUST set transcript_path to the actual file path where session data is stored (format: ~/.wave/sessions/session_[shortId].json)
- **FR-016**: System MUST set cwd to the current working directory when the hook is invoked
- **FR-017**: System MUST ensure JSON data is properly formatted and valid before sending to hook processes
- **FR-018**: System MUST handle cases where hook processes don't read from stdin without blocking or causing errors
- **FR-019**: System MUST maintain backward compatibility with existing hooks that don't expect JSON input
- **FR-020**: System MUST organize hook components according to Constitution VII: HookManager in managers/, executor and settings as functions in services/hook.ts, matcher in utils/hookMatcher.ts, and types in types/hooks.ts.
- **FR-021**: System MUST ensure test file structure mirrors the source code structure.
- **FR-022**: System MUST support `async` field in hook configuration to allow background execution.
- **FR-023**: System MUST support `timeout` field (in seconds) in hook configuration to override the default 10-minute timeout.
- **FR-024**: System MUST NOT deliver stdout/stderr from async hooks to the conversation to prevent unexpected message injections from background tasks.
- **FR-030**: System MUST interpret hook exit code 0 as success status
- **FR-031**: System MUST interpret hook exit code 2 as blocking error status
- **FR-032**: System MUST interpret any other hook exit codes as non-blocking error status
- **FR-033**: System MUST capture stdout from `UserPromptSubmit` hooks when exit code is 0 and inject it into Wave Agent context
- **FR-034**: System MUST ignore stdout from all non-`UserPromptSubmit` hooks regardless of exit code
- **FR-035**: System MUST block tool execution when `PreToolUse` hook returns exit code 2
- **FR-036**: System MUST display stderr to Wave Agent when `PreToolUse` hook returns exit code 2
- **FR-037**: System MUST display stderr to Wave Agent via user role message when `PostToolUse` hook returns exit code 2 and allow AI to continue processing (tool already executed)
- **FR-038**: System MUST block prompt processing when `UserPromptSubmit` hook returns exit code 2
- **FR-039**: System MUST erase the current prompt when `UserPromptSubmit` hook returns exit code 2
- **FR-040**: System MUST display stderr to user only (not Wave Agent) when `UserPromptSubmit` hook returns exit code 2
- **FR-041**: System MUST block stoppage when `Stop` hook returns exit code 2
- **FR-042**: System MUST display stderr to Wave Agent when `Stop` hook returns exit code 2
- **FR-043**: System MUST display stderr to user and continue execution for non-blocking errors (exit codes other than 0 or 2)
- **FR-044**: System MUST distinguish between different hook event types (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`) for appropriate behavior

### Testing Validation Requirements

- **FR-045**: System MUST validate `UserPromptSubmit` success by checking that `agent.sendMessage()` results in `agent.messages` containing two user role messages, where the second message contains the hook stdout content
- **FR-046**: System MUST validate `PreToolUse` blocking errors by checking that `agent.messages` includes a `ToolBlock` with its result field containing the stderr content
- **FR-047**: System MUST validate `PostToolUse` error feedback by checking that `agent.messages` includes a user role message with stderr content
- **FR-048**: System MUST validate `UserPromptSubmit` blocking errors by checking that `agent.messages` does not contain the user role message and contains an `ErrorBlock` in the assistant message with stderr as content
- **FR-049**: System MUST ensure `ErrorBlock` content is not processed by `packages/agent-sdk/src/utils/convertMessagesForAPI.ts` so it remains user-visible only and is not sent to the agent
- **FR-050**: System MUST validate `Stop` hook blocking behavior by checking that `agent.messages` contains a user role message with stderr content

### Key Entities

- **Hook Configuration**: Settings structure containing event mappings, matchers, and command definitions
- **Hook Event**: Specific trigger points in Wave's execution cycle (PreToolUse, PostToolUse, UserPromptSubmit, Stop, PermissionRequest, SubagentStop, WorktreeCreate)
- **Hook Matcher**: Pattern matching system for determining which hooks apply to specific tool operations (located in utils/hookMatcher.ts)
- **Hook Executor**: Function-based service for executing hook commands (located in services/hook.ts)
- **Hook Settings**: Service for loading and merging hook configurations (located in services/hook.ts)
- **Hook Command**: Executable bash commands with access to Wave environment variables
- **Hook Input JSON**: Contains session context (session_id, transcript_path, cwd), event information (hook_event_name), and event-specific data (tool details, prompts, responses)
- **Session Data**: Complete conversation history and metadata accessible via transcript_path
- **Tool Context**: Information about tool execution including name, input parameters, and results for tool-related events
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

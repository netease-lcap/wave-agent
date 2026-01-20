# Feature Specification: Hooks Support

**Feature Branch**: `001-hooks-support`  
**Created**: 2024-12-19  
**Status**: Draft  
**Input**: User description: "Support hooks, refer to hooks.md"

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

### Edge Cases

- What happens when a hook command fails or times out?
- How does the system handle hooks that modify files while Wave is still processing?
- What occurs when multiple hooks are configured for the same event with conflicting operations?
- How are environment variables handled in different execution contexts?
- What happens when hook scripts are not executable or missing?
- Malformed JSON data handling
- Hooks that don't read stdin

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support configuring hooks in both user-level (~/.wave/settings.json) and project-level (.wave/settings.json) settings files
- **FR-002**: System MUST support PreToolUse hooks that execute before tool processing begins
- **FR-003**: System MUST support PostToolUse hooks that execute after successful tool completion
- **FR-004**: System MUST support UserPromptSubmit hooks that execute when users submit prompts
- **FR-005**: System MUST support Stop hooks that execute when Wave finishes its response cycle (no more tool calls to generate)
- **FR-006**: System MUST support tool name pattern matching including exact strings, regex patterns, and wildcard (*) matching
- **FR-007**: System MUST provide WAVE_PROJECT_DIR environment variable to hook commands for project-relative script execution
- **FR-008**: System MUST execute multiple hooks for the same event in the configured order
- **FR-009**: System MUST log hook execution results and errors without interrupting main tool operations
- **FR-010**: System MUST support command-type hooks with configurable bash commands
- **FR-011**: System MUST provide JSON data to hook processes via stdin containing session_id, transcript_path, cwd, and hook_event_name fields for all hook events
- **FR-012**: System MUST include tool_name and tool_input fields in JSON data for PreToolUse and PostToolUse events
- **FR-013**: System MUST include tool_response field in JSON data for PostToolUse events containing the tool's execution result
- **FR-014**: System MUST include prompt field in JSON data for UserPromptSubmit events containing the user's submitted text
- **FR-015**: System MUST set transcript_path to the actual file path where session data is stored (format: ~/.wave/sessions/session_[shortId].json)
- **FR-016**: System MUST set cwd to the current working directory when the hook is invoked
- **FR-017**: System MUST ensure JSON data is properly formatted and valid before sending to hook processes
- **FR-018**: System MUST handle cases where hook processes don't read from stdin without blocking or causing errors
- **FR-019**: System MUST maintain backward compatibility with existing hooks that don't expect JSON input
- **FR-020**: System MUST organize hook components according to Constitution VII: HookManager in managers/, executor and settings as functions in services/hook.ts, matcher in utils/hookMatcher.ts, and types in types/hooks.ts.
- **FR-021**: System MUST ensure test file structure mirrors the source code structure.

### Key Entities

- **Hook Configuration**: Settings structure containing event mappings, matchers, and command definitions
- **Hook Event**: Specific trigger points in Wave's execution cycle (PreToolUse, PostToolUse, UserPromptSubmit, Stop)
- **Hook Matcher**: Pattern matching system for determining which hooks apply to specific tool operations (located in utils/hookMatcher.ts)
- **Hook Executor**: Function-based service for executing hook commands (located in services/hook.ts)
- **Hook Settings**: Service for loading and merging hook configurations (located in services/hook.ts)
- **Hook Command**: Executable bash commands with access to Wave environment variables
- **Hook Input JSON**: Contains session context (session_id, transcript_path, cwd), event information (hook_event_name), and event-specific data (tool details, prompts, responses)
- **Session Data**: Complete conversation history and metadata accessible via transcript_path
- **Tool Context**: Information about tool execution including name, input parameters, and results for tool-related events


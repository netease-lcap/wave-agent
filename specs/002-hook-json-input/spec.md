# Feature Specification: Hook JSON Input Support

**Feature Branch**: `002-hook-json-input`  
**Created**: 2024-12-19  
**Status**: Draft  
**Input**: User description: "support Hook Input - Hooks receive JSON data via stdin containing session information and event-specific data with fields like session_id, transcript_path, cwd, hook_event_name, and event-specific data for PreToolUse, PostToolUse, UserPromptSubmit, and Stop events"

## Clarifications

### Session 2024-12-19

- Q: Should stop_hook_active field be included in Stop event JSON? → A: No, stop_hook_active is not needed
- Q: Should Edge Cases section be detailed? → A: No, Edge Cases are not important now - keep concise
- Q: What testing approach should be used? → A: All tests should be concise, only test JSON input using jq
- Q: How should JSON input be tested in hook commands? → A: JSON is piped directly to jq, not via echo $stdin_json variable

## User Scenarios & Testing *(mandatory)*

### User Story 1 - PreToolUse Hook Data Access (Priority: P1)

A developer creates a PreToolUse hook that needs to analyze the incoming tool command and its parameters before execution. The hook receives structured JSON data via stdin containing session context, tool information, and input parameters, allowing it to make informed decisions about whether to allow, modify, or block the tool execution.

**Why this priority**: This is the most common hook use case - intercepting and potentially modifying tool execution based on context and parameters.

**Independent Test**: Can be tested with `jq` by configuring a PreToolUse hook and verifying JSON fields are accessible: `jq -r '.session_id, .transcript_path, .cwd, .hook_event_name, .tool_name, .tool_input'`

**Acceptance Scenarios**:

1. **Given** a PreToolUse hook is configured and a Write tool is about to execute, **When** the hook process starts, **Then** it receives JSON via stdin containing session_id, transcript_path (path to ~/.wave/sessions/session_[id].json), cwd, hook_event_name "PreToolUse", tool_name "Write", and tool_input with file_path and content fields
2. **Given** a PreToolUse hook is configured and a Read tool is about to execute, **When** the hook process starts, **Then** it receives JSON via stdin with the appropriate tool_input schema for the Read tool

---

### User Story 2 - PostToolUse Hook Response Analysis (Priority: P2)

A developer creates a PostToolUse hook that needs to analyze tool execution results and potentially perform follow-up actions. The hook receives JSON data containing both the original tool input and the tool's response/output, enabling comprehensive post-execution processing.

**Why this priority**: Essential for audit trails, error handling, and automated follow-up actions based on tool results.

**Independent Test**: Can be tested with `jq` by configuring a PostToolUse hook and verifying JSON contains both input and response: `jq -r '.tool_input, .tool_response'`

**Acceptance Scenarios**:

1. **Given** a PostToolUse hook is configured and a Write tool has completed successfully, **When** the hook process starts, **Then** it receives JSON containing session context, tool_name "Write", original tool_input, and tool_response with success status and file path
2. **Given** a PostToolUse hook is configured and a tool execution fails, **When** the hook process starts, **Then** it receives JSON with tool_response containing error information

---

### User Story 3 - Session Access via Transcript Path (Priority: P2)

A hook needs to access the complete conversation history to make context-aware decisions. The hook uses the transcript_path field from the JSON input to load the full session data, enabling analysis of previous interactions and conversation context.

**Why this priority**: Critical for hooks that need conversation context for intelligent decision-making.

**Independent Test**: Can be tested with `jq` by configuring any hook and verifying session data can be loaded: `jq -r '.transcript_path' | xargs cat | jq '.state.messages'`

**Acceptance Scenarios**:

1. **Given** a hook receives JSON with transcript_path field, **When** the hook reads the file at that path, **Then** it successfully loads the complete session data including all messages and metadata
2. **Given** a long conversation session exists, **When** any hook is triggered, **Then** the transcript_path points to the current session file with all accumulated conversation history

---

### User Story 4 - UserPromptSubmit Hook Monitoring (Priority: P3)

A developer creates a UserPromptSubmit hook to monitor and analyze user inputs for security scanning, content filtering, or usage analytics. The hook receives JSON data containing the user's prompt text and session context.

**Why this priority**: Useful for security, compliance, and analytics but not essential for core functionality.

**Independent Test**: Can be tested with `jq` by configuring a UserPromptSubmit hook and verifying prompt text is accessible: `jq -r '.prompt'`

**Acceptance Scenarios**:

1. **Given** a UserPromptSubmit hook is configured, **When** a user submits a prompt, **Then** the hook receives JSON containing session_id, transcript_path, cwd, hook_event_name "UserPromptSubmit", and the user's prompt text
2. **Given** a UserPromptSubmit hook needs to access conversation history, **When** it loads the transcript_path, **Then** it can analyze the full conversation context along with the new prompt

---

### User Story 5 - Stop Hook Cleanup Actions (Priority: P3)

A developer creates a Stop hook to perform cleanup actions when a session ends. The hook receives minimal JSON data indicating the session termination and can perform final operations like saving summaries or cleaning up temporary resources.

**Why this priority**: Useful for cleanup and finalization but not critical for core operation.

**Independent Test**: Can be tested with `jq` by configuring a Stop hook and verifying event name is accessible: `jq -r '.hook_event_name'`

**Acceptance Scenarios**:

1. **Given** a Stop hook is configured, **When** a session ends, **Then** the hook receives JSON containing session_id, transcript_path, and hook_event_name "Stop"
2. **Given** a Stop hook needs to perform cleanup, **When** it receives the stop notification, **Then** it can access the final session state via transcript_path

---

### Edge Cases

- Malformed JSON data handling
- Hooks that don't read stdin

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide JSON data to hook processes via stdin containing session_id, transcript_path, cwd, and hook_event_name fields for all hook events
- **FR-002**: System MUST include tool_name and tool_input fields in JSON data for PreToolUse and PostToolUse events
- **FR-003**: System MUST include tool_response field in JSON data for PostToolUse events containing the tool's execution result
- **FR-004**: System MUST include prompt field in JSON data for UserPromptSubmit events containing the user's submitted text
- **FR-005**: System MUST set transcript_path to the actual file path where session data is stored (format: ~/.wave/sessions/session_[shortId].json)
- **FR-006**: System MUST set cwd to the current working directory when the hook is invoked
- **FR-007**: System MUST ensure JSON data is properly formatted and valid before sending to hook processes
- **FR-008**: System MUST handle cases where hook processes don't read from stdin without blocking or causing errors
- **FR-009**: System MUST maintain backward compatibility with existing hooks that don't expect JSON input

### Key Entities *(include if feature involves data)*

- **Hook Input JSON**: Contains session context (session_id, transcript_path, cwd), event information (hook_event_name), and event-specific data (tool details, prompts, responses)
- **Session Data**: Complete conversation history and metadata accessible via transcript_path
- **Tool Context**: Information about tool execution including name, input parameters, and results for tool-related events

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Hooks receive complete JSON data via stdin within 100ms of hook process startup
- **SC-002**: 100% of hook events (PreToolUse, PostToolUse, UserPromptSubmit, Stop) include all required JSON fields as specified
- **SC-003**: Hooks can successfully load session data from transcript_path in 95% of cases
- **SC-004**: JSON data structure remains consistent across all hook invocations for the same event type
- **SC-005**: System maintains hook execution performance with JSON input overhead under 50ms per hook
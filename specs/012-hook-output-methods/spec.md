# Feature Specification: Hook Output Methods

**Feature Branch**: `012-hook-output-methods`  
**Created**: 2025-11-14  
**Status**: Draft  
**Input**: User description: "refer to hooks-output.md to generate spec. both "Simple: Exit Code" and "Advanced: JSON Output" should be implemented. we have already implemented some specs about hooks, you can check them in specs dir."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Simple Exit Code Communication (Priority: P1)

As a developer, I want to use simple exit codes in my hooks to communicate success, blocking errors, and non-blocking errors, so that I can create straightforward hooks without needing complex JSON formatting.

**Why this priority**: This is the fundamental hook communication method that provides immediate value with minimal complexity. Most basic hooks only need to indicate success/failure and optionally block operations.

**Independent Test**: Can be fully tested by creating hooks that return different exit codes (0, 2, other) and verifying Wave responds appropriately - continuing on success, blocking on exit code 2, and showing errors for other codes.

**Acceptance Scenarios**:

1. **Given** a hook returns exit code 0, **When** the hook completes, **Then** Wave continues processing and stdout content is added to context for UserPromptSubmit hooks
2. **Given** a hook returns exit code 2, **When** the hook completes, **Then** Wave blocks the operation and automatically processes stderr content according to the hook event type
3. **Given** a hook returns any other exit code, **When** the hook completes, **Then** Wave shows stderr to the user and continues execution without blocking

---

### User Story 2 - Advanced JSON Output Control (Priority: P2)

As a developer, I want to return structured JSON from my hooks to have fine-grained control over Wave's behavior, including conditional blocking, custom messages, and operation modifications.

**Why this priority**: Essential for sophisticated hooks that need precise control over Wave's behavior, but builds on the foundation of exit code communication.

**Independent Test**: Can be fully tested by creating hooks that return JSON with various combinations of continue, stopReason, systemMessage, and hook-specific fields, then verifying Wave processes each field correctly.

**Acceptance Scenarios**:

1. **Given** a hook returns JSON with "continue": false, **When** the hook completes, **Then** Wave stops processing and displays the stopReason to the user
2. **Given** a hook returns JSON with systemMessage field, **When** the hook completes, **Then** Wave displays the warning message to the user
3. **Given** a hook returns JSON with both exit code behavior and JSON fields, **When** the hook completes, **Then** the JSON fields take precedence over exit code interpretation

---

### User Story 3 - PreToolUse Permission Control (Priority: P2)

As a developer, I want to use JSON output in PreToolUse hooks to allow, deny, or request user confirmation for tool calls, and optionally modify tool inputs before execution.

**Why this priority**: Critical for security and workflow control, allowing hooks to intercept and modify tool operations intelligently.

**Independent Test**: Can be fully tested by creating PreToolUse hooks with different permissionDecision values and updatedInput objects, then verifying tools are allowed/blocked/modified appropriately.

**Acceptance Scenarios**:

1. **Given** a PreToolUse hook returns JSON with "permissionDecision": "allow", **When** the hook completes, **Then** the tool executes without user intervention and the permissionDecisionReason is shown to the user but not Wave
2. **Given** a PreToolUse hook returns JSON with "permissionDecision": "deny", **When** the hook completes, **Then** the tool call is blocked and the permissionDecisionReason is shown to Wave
3. **Given** a PreToolUse hook returns JSON with "permissionDecision": "ask", **When** the hook completes, **Then** Wave prompts the user for confirmation and shows the permissionDecisionReason
4. **Given** a PreToolUse hook returns JSON with updatedInput object, **When** the tool executes, **Then** the tool receives the modified input parameters

---

### User Story 4 - PostToolUse Feedback Integration (Priority: P3)

As a developer, I want to use JSON output in PostToolUse hooks to provide automated feedback to Wave based on tool execution results and add additional context for Wave's consideration.

**Why this priority**: Valuable for automated error handling and context enhancement, but not essential for basic hook functionality.

**Independent Test**: Can be fully tested by creating PostToolUse hooks that return different decision values and additionalContext, then verifying Wave processes the feedback appropriately.

**Acceptance Scenarios**:

1. **Given** a PostToolUse hook returns JSON with "decision": "block", **When** the hook completes, **Then** Wave is automatically prompted with the reason field
2. **Given** a PostToolUse hook returns JSON with additionalContext, **When** the hook completes, **Then** Wave considers the additional information in its processing
3. **Given** a PostToolUse hook returns undefined decision, **When** the hook completes, **Then** Wave continues normally without automated prompting

---

### User Story 5 - UserPromptSubmit and Stop Event Control (Priority: P3)

As a developer, I want to use JSON output in UserPromptSubmit and Stop hooks to control prompt processing and session termination with custom logic and context injection.

**Why this priority**: Useful for advanced workflow control and session management, but not critical for core hook functionality.

**Independent Test**: Can be fully tested by creating UserPromptSubmit and Stop hooks with different decision values and context additions, then verifying the blocking/continuation behavior works correctly.

**Acceptance Scenarios**:

1. **Given** a UserPromptSubmit hook returns JSON with "decision": "block", **When** the hook completes, **Then** the prompt is erased from context and the reason is shown to the user only
2. **Given** a UserPromptSubmit hook returns JSON with additionalContext, **When** the hook completes and is not blocked, **Then** the additional context is added to Wave's processing context
3. **Given** a Stop hook returns JSON with "decision": "block", **When** the hook completes, **Then** Wave is prevented from stopping and must process the provided reason

---

### Edge Cases

- What happens when a hook returns both valid JSON and a meaningful exit code?
- How does the system handle malformed JSON output from hooks?
- What occurs when JSON fields conflict with each other (e.g., continue: false with permissionDecision: allow)?
- How are hook-specific fields validated for different event types?
- What happens when hooks don't produce any output (no stdout or stderr)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support exit code 0 to indicate success, with stdout added to context for UserPromptSubmit hooks only
- **FR-002**: System MUST support exit code 2 to indicate blocking errors, with stderr processed automatically according to hook event type
- **FR-003**: System MUST support all other exit codes as non-blocking errors, showing stderr to user and continuing execution
- **FR-004**: System MUST support JSON output in stdout with common fields: continue (boolean), stopReason (string), and systemMessage (string)
- **FR-005**: System MUST give JSON output precedence over exit code interpretation when valid JSON is present
- **FR-006**: System MUST support PreToolUse hook JSON with hookSpecificOutput containing hookEventName "PreToolUse", permissionDecision ("allow", "deny", "ask"), permissionDecisionReason, and updatedInput fields
- **FR-007**: System MUST support PostToolUse hook JSON with decision ("block" or undefined), reason, and hookSpecificOutput containing hookEventName "PostToolUse" and additionalContext fields
- **FR-008**: System MUST support UserPromptSubmit hook JSON with decision ("block" or undefined), reason, and hookSpecificOutput containing hookEventName "UserPromptSubmit" and additionalContext fields
- **FR-009**: System MUST support Stop hook JSON with decision ("block" or undefined) and required reason when blocking
- **FR-010**: System MUST handle malformed JSON gracefully by falling back to exit code interpretation
- **FR-011**: System MUST validate hook-specific JSON fields are appropriate for the hook event type
- **FR-012**: System MUST ensure continue: false takes precedence over any decision: "block" outputs in all hook types
- **FR-013**: System MUST implement specific exit code 2 behavior per hook event: PreToolUse blocks tool call and shows stderr to Wave, PostToolUse shows stderr to Wave, UserPromptSubmit blocks prompt processing and shows stderr to user only, Stop blocks stoppage and shows stderr to Wave
- **FR-014**: System MUST route permissionDecisionReason to user (not Wave) for "allow" and "ask" decisions, but to Wave for "deny" decisions
- **FR-015**: System MUST support two methods for UserPromptSubmit context injection: exit code 0 with stdout, or JSON with additionalContext field

### Key Entities

- **Hook Output**: Contains either exit code with optional stdout/stderr, or structured JSON with common and hook-specific fields
- **Permission Decision**: PreToolUse hook decision to allow, deny, or ask for user confirmation of tool calls
- **Tool Input Modification**: Mechanism for PreToolUse hooks to modify tool parameters before execution
- **Automated Feedback**: PostToolUse hook capability to provide automatic input to Wave based on tool results
- **Context Injection**: Ability for hooks to add information to Wave's processing context
- **Hook Specific Output**: Structured section of JSON output containing hookEventName and event-specific fields
- **Message Routing**: System for directing hook feedback to appropriate recipient (Wave or user) based on context

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Developers can implement basic hooks using exit codes within 2 minutes of reading documentation
- **SC-002**: Advanced JSON hooks can control Wave behavior with 100% reliability for all supported fields
- **SC-003**: Hook output processing adds less than 100ms overhead to hook execution time
- **SC-004**: 95% of hook output scenarios (exit codes, JSON fields, combinations) work as documented without errors
- **SC-005**: JSON output validation catches and handles 100% of malformed JSON cases without crashing Wave
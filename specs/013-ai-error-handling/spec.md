# Feature Specification: AI Error Handling

**Feature Branch**: `013-ai-error-handling`  
**Created**: 2026-03-03  
**Status**: Draft  
**Input**: User description: "remove 'AI response was truncated due to length limit. Please try to reduce the complexity of your request or split it into smaller parts.', instead, add a user role msg like this and continue: 'Your response was cut off because it exceeded the output token limit. Please break your work into smaller pieces. Continue from where you left off.'"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic Continuation on Truncation (Priority: P1)

As a user, I want the agent to automatically continue its response when it is cut off by the output token limit, so that I don't have to manually prompt it to finish its work.

**Why this priority**: This is the core functionality requested. It improves the user experience by making the agent more autonomous and reducing manual intervention.

**Independent Test**: Can be tested by simulating an AI response with `finish_reason: "length"` and verifying that the agent adds the continuation message and recurses.

**Acceptance Scenarios**:

1. **Given** the AI response is truncated due to length limit and no tools were called, **When** the agent processes the response, **Then** it should add a user message: "Your response was cut off because it exceeded the output token limit. Please break your work into smaller pieces. Continue from where you left off." and automatically initiate a new AI call.
2. **Given** the AI response is truncated due to length limit and tools WERE called, **When** the agent processes the response, **Then** it should NOT add the extra user message (as tool results serve as the reminder) but it SHOULD still automatically initiate a new AI call.

---

### User Story 2 - Error Block Removal (Priority: P2)

As a user, I want to remove the static error block that was previously shown when a response was truncated, as it is now replaced by the automatic continuation mechanism.

**Why this priority**: Cleans up the UI and reflects the new, more helpful behavior.

**Independent Test**: Verify that the string "AI response was truncated due to length limit" no longer appears in the UI when a truncation occurs.

**Acceptance Scenarios**:

1. **Given** a truncated AI response, **When** the agent handles it, **Then** no error block with the old truncation message should be added to the message history.

---

### Edge Cases

- **Infinite Recursion**: What happens if the AI keeps getting truncated?
  - *Assumption*: The existing recursion depth limit (if any) or the user's ability to abort should handle this.
- **Interruption**: What happens if the user aborts the session during a truncated response?
  - *Assumption*: The agent should respect the abort signal and stop recursion.
- **Backgrounded Tools**: What happens if a tool is backgrounded during a truncated response?
  - *Assumption*: The agent should stop recursion as it does for normal tool calls.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST detect when an AI response is truncated due to the output token limit (`finish_reason: "length"`).
- **FR-002**: If a response is truncated and no tools were called, the system MUST add a user message: "Your response was cut off because it exceeded the output token limit. Please break your work into smaller pieces. Continue from where you left off."
- **FR-003**: If a response is truncated, the system MUST automatically initiate a recursive AI call to continue the response.
- **FR-004**: If a response is truncated and tools were called, the system MUST NOT add the extra user message, but MUST still recurse after tool execution.
- **FR-005**: The system MUST NOT show the old error message: "AI response was truncated due to length limit. Please try to reduce the complexity of your request or split it into smaller parts."
- **FR-006**: The system MUST respect abort signals and backgrounded tools, stopping recursion even if a truncation occurred.

### Key Entities *(include if feature involves data)*

- **AI Response**: The result from the AI service, including content, tool calls, and the finish reason.
- **Message History**: The list of messages in the current session, which now includes automatic continuation prompts.

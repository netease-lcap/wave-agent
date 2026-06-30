# Feature Specification: AI Error Handling

**Feature Branch**: `012-ai-error-handling`  
**Created**: 2026-03-03  

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic Continuation on Truncation (Priority: P1)

As a user, I want the agent to automatically continue its response when it is cut off by the output token limit, so that I don't have to manually prompt it to finish its work. The continuation prompt should be hidden from the UI to keep the conversation clean.

**Why this priority**: This is the core functionality requested. It improves the user experience by making the agent more autonomous and reducing manual intervention.

**Independent Test**: Can be tested by simulating an AI response with `finish_reason: "length"` and verifying that the agent adds the hidden continuation message and recurses.

**Acceptance Scenarios**:

1. **Given** the AI response is truncated due to length limit, **When** the agent processes the response, **Then** it should add a hidden user message (with `isMeta: true`): "Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces." and automatically initiate a new AI call.

---

### User Story 2 - Truncation with Tool Calls (Priority: P1)

As a user, I want the agent to execute tools and then automatically continue its response when it is cut off by the output token limit, even if tools were called.

**Acceptance Scenarios**:

1. **Given** the AI response is truncated due to length limit and tools WERE called, **When** the agent processes the response, **Then** it should still add the hidden recovery message (with `isMeta: true`) and automatically initiate a new AI call after tool execution.

---

### User Story 3 - Resilience to Rate Limits (Priority: P2)

As a user, I want the agent to be resilient to temporary API rate limits (429 errors), so that my work is not interrupted by transient network or API issues.

**Acceptance Scenarios**:

1. **Given** the AI API returns a 429 error, **When** the agent makes a request, **Then** it should automatically retry the request with exponential backoff (up to 5 retries).

---

### User Story 4 - Debugging API Errors (Priority: P3)

As a developer, I want the system to save debug information when a 400 Bad Request error occurs, so that I can easily diagnose issues with malformed requests or invalid parameters.

**Acceptance Scenarios**:

1. **Given** the AI API returns a 400 error, **When** the agent makes a request, **Then** it should save the original messages, model configuration, and error details to a temporary directory for debugging.

---

### User Story 5 - Handling Malformed Tool Arguments (Priority: P2)

As a user, I want the agent to handle cases where the AI provides malformed JSON for tool arguments, especially when the response is truncated, so that I get a clear explanation of what went wrong.

**Acceptance Scenarios**:

1. **Given** the AI provides malformed JSON for tool arguments and the response was truncated (`finish_reason: "length"`), **When** the agent attempts to parse the arguments, **Then** it should show an error message that includes: `"(output truncated, please reduce your output)"`.

---

### User Story 6 - Recovering Truncated Tool Arguments (Priority: P2)

As a user, I want the agent to attempt to recover truncated tool arguments (e.g., Write/Edit with missing closing braces) so that the tool can still execute instead of failing outright.

**Why this priority**: Truncated tool arguments are common when `finish_reason` is `"length"`. Recovery avoids unnecessary failures and re-tries, improving reliability for Write/Edit operations.

**Independent Test**: Can be tested by providing a tool call with truncated JSON (missing closing braces) and verifying that `recoverTruncatedJson()` closes them, the tool executes, and a warning is appended.

**Acceptance Scenarios**:

1. **Given** the AI provides tool arguments with truncated JSON (missing closing `}` braces or `"` string), **When** the agent attempts to parse the arguments, **Then** it should attempt recovery via `recoverTruncatedJson()`, close unclosed strings and braces, and if the recovered JSON parses successfully, execute the tool with a truncation warning appended to the result.
2. **Given** the AI provides tool arguments with truncated JSON containing unclosed `[` brackets, **When** the agent attempts to parse the arguments, **Then** recovery should NOT be attempted (cannot guess array content) and the tool should fail with the standard error message.
3. **Given** the recovered JSON is still unparseable after recovery, **When** the agent attempts to parse the recovered arguments, **Then** it should fall back to the error message (with truncation hint if `finish_reason === "length"`).

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
- **FR-002**: If a response is truncated, the system MUST add a hidden user message (with `isMeta: true`): "Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces."
- **FR-003**: If a response is truncated, the system MUST automatically initiate a recursive AI call to continue the response.
- **FR-004**: The system MUST filter out messages with `isMeta: true` from the UI rendering.
- **FR-005**: The system MUST retry on 429 errors with exponential backoff (up to 5 retries).
- **FR-006**: The system MUST save debug data (messages, error details) to a temporary directory when a 400 error occurs.
- **FR-007**: The system MUST handle JSON parsing errors for tool arguments. If the response was truncated, the error message MUST include: `"(output truncated, please reduce your output)"`.
- **FR-007a**: The system MUST attempt to recover truncated tool arguments JSON by closing unclosed strings (`"`) and braces (`}`) before failing. Recovery MUST NOT be attempted when unclosed `[` brackets are detected (cannot guess array content).
- **FR-007b**: When recovered JSON parses successfully, the system MUST execute the tool and append a warning to the tool result: `"\n\n⚠️ Tool arguments were truncated (likely exceeded max output tokens). Please reduce your output or split into multiple tool calls."`.
- **FR-007c**: The `safeToolArguments()` function in `convertMessagesForAPI.ts` MUST also attempt `recoverTruncatedJson()` before falling back to `{"invalid_arguments": args}`.
- **FR-008**: The system MUST respect abort signals and backgrounded tools, stopping recursion even if a truncation occurred.
- **FR-009**: The system MUST detect if a new tool call is identical to a tool call in the previous turn (same tool name and arguments). If so, it MUST add a user message reminding the agent to avoid loops and consider changing its approach.
- **FR-010**: The system MUST retry transient server errors (HTTP 500, 502, 503, 504) with exponential backoff, using the same retry strategy as 429 errors.

### Key Entities *(include if feature involves data)*

- **AI Response**: The result from the AI service, including content, tool calls, and the finish reason.
- **Message History**: The list of messages in the current session, which now includes automatic continuation prompts and error blocks.
- **Debug Data**: Information saved during 400 errors, including original messages, model config, and error details.
- **Recovered Tool Arguments**: Tool arguments where truncated JSON was successfully repaired (unclosed strings/braces closed). A `jsonRecovered` flag tracks whether recovery occurred, and a warning is appended to the tool result.

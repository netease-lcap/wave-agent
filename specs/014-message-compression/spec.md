# Feature Specification: Message Compression

**Feature Branch**: `014-message-compression`  
**Created**: 2026-01-22  
**Input**: User description: "Manage conversation history and user input size"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic History Compression (Priority: P1)

As an AI agent, when the conversation history becomes too long, I want to automatically summarize older messages so that I stay within the model's token limits while maintaining context.

**Why this priority**: Essential for long-running sessions to prevent "context window exceeded" errors and reduce costs.

**Independent Test**: Mock token usage to exceed the threshold and verify that `AIManager` triggers a compression cycle and replaces old messages with a summary block.

**Acceptance Scenarios**:

1. **Given** the total token count exceeds `getMaxInputTokens()`, **When** the next message is processed, **Then** the agent MUST identify messages to compress.
2. **Given** messages are identified for compression, **When** the summarization is complete, **Then** the original messages MUST be replaced by a `compress` block followed by the last 2 API rounds of the old message list in the session.
3. **Given** a `compress` block exists, **When** sending messages to the API, **Then** it MUST be converted to a **user** message (matching Claude Code's auto-compact behavior).

---

### User Story 2 - Time-Based Microcompact (Priority: P1)

As an AI agent, before each API call, I want to clear old tool result content that is no longer relevant (e.g., from >30 minutes ago) so that I reduce token usage without AI summarization.

**Why this priority**: Reduces token costs proactively without requiring an extra API call for summarization.

**Independent Test**: Simulate a 30+ minute gap since the last tool result and verify that old tool results are replaced with `[Old tool result content cleared]` while the most recent N results are preserved.

**Acceptance Scenarios**:

1. **Given** the time since the last completed tool result exceeds 30 minutes, **When** preparing messages for an API call, **Then** all but the 3 most recent tool results MUST have their `result` and `shortResult` fields cleared.
2. **Given** no prior assistant messages with completed tools exist, **When** microcompact runs, **Then** messages MUST remain unchanged.
3. **Given** the time since the last tool result is within the 30-minute threshold, **When** microcompact runs, **Then** messages MUST remain unchanged.

---

### User Story 3 - Compression Circuit Breaker (Priority: P2)

As an AI agent, when compression repeatedly fails, I want to stop attempting compression so that I avoid wasting API calls on an irrecoverable context state.

**Why this priority**: Prevents cascading failures and unnecessary API costs when the context is corrupted.

**Independent Test**: Simulate 3 consecutive compression failures and verify that the 4th high-token-usage turn skips compression entirely.

**Acceptance Scenarios**:

1. **Given** compression has failed 3 consecutive times, **When** token usage again exceeds the threshold, **Then** compression MUST be skipped and a warning logged.
2. **Given** compression succeeds, **When** the next compression cycle runs, **Then** the consecutive failure counter MUST be reset to 0.

---

### User Story 4 - Post-Compact Context Restoration (Priority: P2)

As an AI agent, after compression replaces conversation history, I want important context re-injected so that I can continue working without losing track of files, directory, plan mode, skills, and background tasks.

**Why this priority**: Prevents the agent from losing critical environmental context after compression.

**Independent Test**: Verify that after compression, the summary includes sections for recent file reads, working directory, plan mode status, available skills, and background task status.

**Acceptance Scenarios**:

1. **Given** compression produces a summary, **When** the summary is applied, **Then** it MUST be augmented with recent file read contents (up to 5 files, 5000 tokens each).
2. **Given** compression is applied, **When** context restoration runs, **Then** the current working directory MUST be included.
3. **Given** the agent is in plan mode, **When** context restoration runs, **Then** the plan file path and existence status MUST be included.
4. **Given** skills have been invoked, **When** context restoration runs, **Then** available skills (name and description) MUST be listed.
5. **Given** background tasks are running, **When** context restoration runs, **Then** each agent's description and status MUST be listed.

---

### Edge Cases

- **Recursive Compression**: When compressing history that already contains a summary, the entire history (including the old summary) is replaced by a new continuation summary.
- **Image Handling**: Images MUST be stripped from messages before the compress API call to reduce token usage.
- **Token Limit Edge**: If the summary itself is too long (unlikely but possible), the system should handle it gracefully.
- **API Round Boundaries**: Compression MUST never split a tool_use/tool_result pair across the compaction boundary.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST monitor token usage after each AI response.
- **FR-002**: System MUST replace the conversation history with a single continuation summary and the last 2 API rounds of the old message list when token limits are reached.
- **FR-003**: System MUST use the AI to generate a summary of messages identified for compression.
- **FR-004**: System MUST replace compressed messages with a `compress` block in the session history.
- **FR-005**: System MUST convert `compress` blocks to user-role messages for API calls.
- **FR-006**: System MUST apply microcompact (clear old tool results) before each API call when the time threshold (>30 min) is exceeded.
- **FR-007**: System MUST skip compression after 3 consecutive compression failures (circuit breaker).
- **FR-008**: System MUST re-inject post-compact context (recent file reads, working directory, plan mode, skills, background tasks) into the compression summary.
- **FR-009**: System MUST strip images from messages before the compress API call.
- **FR-010**: System MUST use the fast model for compression API calls.
- **FR-011**: System MUST group messages by API round boundaries (not fixed count) when determining which messages to preserve after compression.
- **FR-012**: System MUST track recent `read` tool results for post-compact context restoration.

### Key Entities *(include if feature involves data)*

- **CompressBlock**: A message block containing a summary.
    - `type`: "compress"
    - `content`: The summary text, augmented with `[Context Restoration]` section.
- **ToolBlock**: Extended with `timestamp` field (Unix ms, set when tool result is finalized).
- **ApiRound**: A group of messages representing one API call-response cycle, with `messages: Message[]` and `estimatedTokens: number`.

### Key Entities *(include if feature involves data)*

- **CompressBlock**: A message block containing a summary.
    - `type`: "compress"
    - `content`: The summary text.

## Assumptions

- The AI model used for summarization is capable of producing concise and accurate summaries.
- The token counting utility is reasonably accurate.
- The fast model is capable of producing adequate compression summaries.
- Tool result timestamps are set accurately when tools complete execution.

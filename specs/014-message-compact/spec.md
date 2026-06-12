# Feature Specification: Message Compact

**Feature Branch**: `014-message-compact`  
**Created**: 2026-01-22  
"Manage conversation history and user input size"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic History Compact (Priority: P1)

As an AI agent, when the conversation history becomes too long, I want to automatically summarize older messages so that I stay within the model's token limits while maintaining context.

**Why this priority**: Essential for long-running sessions to prevent "context window exceeded" errors and reduce costs.

**Independent Test**: Mock token usage to exceed the threshold and verify that `AIManager` triggers a compact cycle and replaces old messages with a summary block.

**Acceptance Scenarios**:

1. **Given** the total token count exceeds `getMaxInputTokens()`, **When** the next message is processed, **Then** the agent MUST identify messages to compact.
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

### User Story 3 - Compact Circuit Breaker (Priority: P2)

As an AI agent, when compact repeatedly fails, I want to stop attempting compact so that I avoid wasting API calls on an irrecoverable context state.

**Why this priority**: Prevents cascading failures and unnecessary API costs when the context is corrupted.

**Independent Test**: Simulate 3 consecutive compact failures and verify that the 4th high-token-usage turn skips compact entirely.

**Acceptance Scenarios**:

1. **Given** compact has failed 3 consecutive times, **When** token usage again exceeds the threshold, **Then** compact MUST be skipped and a warning logged.
2. **Given** compact succeeds, **When** the next compact cycle runs, **Then** the consecutive failure counter MUST be reset to 0.

---

### User Story 4 - Post-Compact Context Restoration (Priority: P2)

As an AI agent, after compact replaces conversation history, I want important context re-injected so that I can continue working without losing track of files, directory, plan mode, skills, and background tasks.

**Why this priority**: Prevents the agent from losing critical environmental context after compact.

**Independent Test**: Verify that after compression, the summary includes sections for recent file reads, working directory, plan mode status, available skills, and background task status.

**Acceptance Scenarios**:

1. **Given** compression produces a summary, **When** the summary is applied, **Then** it MUST be augmented with recent file read contents (up to 5 files, 5000 tokens each).
2. **Given** compression is applied, **When** context restoration runs, **Then** the current working directory MUST be included.
3. **Given** the agent is in plan mode, **When** context restoration runs, **Then** the plan file path and existence status MUST be included.
4. **Given** skills have been invoked, **When** context restoration runs, **Then** available skills (name and description) MUST be listed.
5. **Given** background tasks are running, **When** context restoration runs, **Then** each agent's description and status MUST be listed.

---

### User Story 5 - Plan Mode Reminder Preservation After Compaction (Priority: P2)

As a user working in plan mode during a long session, I want the plan mode instructions to be re-injected after conversation compaction so that the agent retains its read-only constraints and workflow guidance even after the history is replaced with a summary.

**Why this priority**: Without re-injection, compaction removes all plan mode `<system-reminder>` messages from the conversation history. The agent would then have no awareness of plan mode constraints and might attempt to edit files or take actions outside the plan file.

**Independent Test**: Trigger compaction while in plan mode, then verify that the full plan mode `<system-reminder>` reminder is injected as a user message after compaction, and the agent continues to respect read-only constraints.

**Acceptance Scenarios**:

1. **Given** the agent is in plan mode and compaction occurs, **When** the compaction summary replaces the conversation history, **Then** the full plan mode `<system-reminder>` MUST be injected as a user message in the next API request.
2. **Given** the agent is in plan mode and compaction occurs, **When** the plan file exists, **Then** the re-injected plan mode reminder MUST include the plan file path and existence status.
3. **Given** the agent is NOT in plan mode, **When** compaction occurs, **Then** no plan mode reminder is injected.
4. **Given** the agent is in plan mode and compaction occurs, **When** the re-injected reminder is the first reminder after compaction, **Then** it MUST be the full instructions (not sparse), since all prior reminders were removed by compaction.

---

### User Story 6 - Manual `/compact` Command (Priority: P2)

As a user, I want to manually trigger conversation compaction with optional custom instructions, so that I can proactively reduce context usage and focus the summary on specific aspects of the conversation.

**Why this priority**: Gives users control over context management, enabling proactive compaction before auto-compaction triggers and allowing custom focus for the summary.

**Independent Test**: Type `/compact` or `/compact focus on the bug fix discussion`, verify compaction occurs with the optional instructions applied to the summary.

**Acceptance Scenarios**:

1. **Given** a conversation with messages, **When** the user types `/compact`, **Then** the conversation history MUST be compacted immediately regardless of token usage
2. **Given** a conversation with messages, **When** the user types `/compact focus on the API design`, **Then** the custom instructions MUST be passed to the compact API call and influence the summary
3. **Given** an AI response is in progress, **When** the user types `/compact`, **Then** the AI response MUST be aborted before compaction begins
4. **Given** compaction is already in progress, **When** the user types `/compact` again, **Then** the second compaction MUST be skipped (circuit breaker)

---

### User Story 7 - PreCompact and PostCompact Hook Events (Priority: P2)

As a developer, I want to configure hooks that run before and after conversation compaction, so that I can customize compaction behavior and react to compacted summaries programmatically.

**Why this priority**: Enables customization of the compaction process and allows downstream systems to react to conversation summaries, but not critical for basic functionality.

**Independent Test**: Configure PreCompact and PostCompact hooks, trigger compaction via `/compact` command or auto-compaction, verify PreCompact hooks execute before compaction and PostCompact hooks execute after.

**Acceptance Scenarios**:

1. **Given** a PreCompact hook is configured, **When** compaction is triggered, **Then** the hook MUST execute before the compact API call, receive `compact_instructions` in JSON input if custom instructions were provided, and its stdout MUST be merged as additional instructions
2. **Given** a PostCompact hook is configured, **When** compaction completes successfully, **Then** the hook MUST execute after the compact API call and receive `compact_summary` in JSON input containing the AI-generated summary
3. **Given** a PreCompact hook returns exit code 2, **When** the hook completes, **Then** the error MUST be shown to the user but compaction MUST continue (non-blocking)
4. **Given** a PostCompact hook returns exit code 2, **When** the hook completes, **Then** the error MUST be shown to the user but execution MUST continue (non-blocking)
5. **Given** both PreCompact and PostCompact hooks are configured, **When** compaction is triggered, **Then** PreCompact MUST run first, then compaction occurs, then SessionStart hooks run, then PostCompact runs last

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
- **FR-008**: System MUST re-inject post-compact context (recent file reads, working directory, plan mode, skills, background tasks) into the compression summary. When plan mode is active, the system MUST also re-inject the full plan mode `<system-reminder>` as a user message after compaction.
- **FR-009**: System MUST strip images from messages before the compress API call.
- **FR-010**: System MUST use the fast model for compression API calls.
- **FR-011**: System MUST group messages by API round boundaries (not fixed count) when determining which messages to preserve after compact.
- **FR-012**: System MUST track recent `read` tool results for post-compact context restoration.
- **FR-013**: System MUST re-inject plan mode `<system-reminder>` instructions after compaction when plan mode is active. This ensures the model does not lose its read-only constraints and workflow guidance after conversation history is replaced with a summary.
- **FR-014**: System MUST support a `/compact` slash command that manually triggers conversation compaction with optional custom instructions
- **FR-015**: System MUST pass custom instructions from `/compact [instructions]` to the compact API call to influence the generated summary
- **FR-016**: System MUST abort any running AI response before processing `/compact`
- **FR-017**: System MUST skip compaction if already in progress (circuit breaker for concurrent compaction)
- **FR-018**: System MUST support PreCompact hooks that execute before conversation compaction
- **FR-019**: System MUST support PostCompact hooks that execute after successful conversation compaction
- **FR-020**: System MUST provide `compact_instructions` field in JSON data for PreCompact events when custom instructions are provided
- **FR-021**: System MUST provide `compact_summary` field in JSON data for PostCompact events containing the AI-generated summary
- **FR-022**: System MUST merge PreCompact hook stdout with user-provided custom instructions as additional compaction instructions
- **FR-023**: System MUST treat PreCompact and PostCompact hook exit code 2 as non-blocking (compaction continues)
- **FR-024**: System MUST NOT require matchers for PreCompact and PostCompact hook configurations

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

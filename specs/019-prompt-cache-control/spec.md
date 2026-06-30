# Feature Specification: Prompt Cache Control

**Feature Branch**: `019-prompt-cache-control`  
**Created**: 2025-12-02  

## User Scenarios & Testing *(mandatory)*

### User Story 1 - System Message Cache Optimization (Priority: P1)

When developers use Claude models through the OpenAI provider, the system message (containing instructions, environment information, and memory context) should be automatically cached to reduce token costs and improve response times for subsequent requests within the same session.

**Why this priority**: System messages are typically large and reused across multiple requests in a conversation, making them prime candidates for caching. This delivers immediate cost savings and performance improvements.

**Independent Test**: Can be fully tested by making two consecutive agent calls with Claude models and verifying the system message includes cache_control markers and usage tracking shows cache creation/read tokens.

**Acceptance Scenarios**:

1. **Given** a Claude model is configured (model name contains "claude"), **When** an agent call is made, **Then** the system message content is wrapped in cache_control structure with type "ephemeral"
2. **Given** multiple agent calls with the same system message, **When** subsequent calls are made, **Then** usage tracking reports cache_read_input_tokens for the system message
3. **Given** a non-Claude model is configured, **When** an agent call is made, **Then** no cache_control markers are added to any messages

---

### User Story 2 - Last Message Cache Marker (Priority: P1)

When users engage in multi-turn conversations with cache-enabled models, the system maintains two cache markers: (1) the system message (always marked as the stable prefix), and (2) the last message with content (user or assistant, whichever comes last). The last-message marker moves forward by approximately 2 content blocks per turn as new messages are added. Because the API scans backward from each marker within a 20-block window, and normal conversations add fewer than 20 blocks per turn, the previous cache position always falls within the scan window, resulting in a cache hit.

**Why this priority**: Cache-enabled APIs (e.g. Qwen/Alibaba) use a back-to-front prefix matching strategy that scans the nearest 20 content blocks backward from each `cache_control` marker. By marking the last message with content, the entire prefix up to that point (system message, tools, and conversation history) is covered by the backward scan. The marker moves ~2 blocks per turn (one user message + one assistant response), which is well within the 20-block scan window, so the previous cache is always still reachable. This approach is stateless — no module-level state or bridge tracking is needed.

**Independent Test**: Can be fully tested by making agent calls with conversations of varying lengths and verifying that exactly two markers are present: one on the system message and one on the last message with content. The last message marker should advance each turn but cache hits should still occur.

**Acceptance Scenarios**:

1. **Given** a short conversation with a cache-enabled model, **When** the system processes the next interaction, **Then** both the system message and the last message with content receive cache_control markers
2. **Given** a long conversation with many turns, **When** the system processes the next interaction, **Then** the same two markers are present (system + last message), and the last-message marker has moved forward by ~2 blocks from the previous turn. The previous cache position is still within the 20-block scan window, so a cache hit occurs
3. **Given** a conversation has been compacted, **When** the next interaction is processed, **Then** the same 2-marker strategy applies with no state to reset (the strategy is purely stateless)
4. **Given** a non-cache-enabled model is configured, **When** an agent call is made, **Then** no cache_control markers are added to any messages
5. **Given** the last message with content is an assistant message (e.g., after a tool call round), **When** the system processes the next interaction, **Then** the assistant message receives the cache_control marker — there is no distinction between user and assistant roles for the last-message marker

---

### User Story 3 - Comprehensive Token Tracking for Cache-Enabled Models (Priority: P1)

When using cache-enabled models (Claude or others like Gemini/DeepSeek that return cache tokens), developers need accurate token tracking that includes all cache-related costs (cache reads, cache creation) in addition to the base prompt and completion tokens to understand the true cost and token usage of their requests.

**Why this priority**: Accurate cost tracking is critical for developers to understand the financial impact of caching and make informed decisions about their usage patterns. Without comprehensive token tracking, cache benefits might appear misleading.

**Independent Test**: Can be fully tested by making cached requests with any cache-enabled model and verifying that the displayed token count includes prompt_tokens + completion_tokens + cache_read_input_tokens + cache_creation_input_tokens.

**Acceptance Scenarios**:

1. **Given** a Claude model request with cache creation, **When** the response includes cache_creation_input_tokens (at the usage top level), **Then** latestTotalTokens shows total_tokens + cache_creation_input_tokens
2. **Given** a Claude model request with cache hits, **When** the response includes cache_read_input_tokens (at the usage top level), **Then** latestTotalTokens shows total_tokens + cache_read_input_tokens
3. **Given** a non-Claude model request (e.g., Gemini, DeepSeek), **When** the response includes prompt_tokens_details.cached_tokens, **Then** cache_read_input_tokens is populated from cached_tokens and latestTotalTokens includes it
4. **Given** a non-Claude model request, **When** the response includes prompt_tokens_details.cache_creation_input_tokens, **Then** cache_creation_input_tokens is populated from that field and latestTotalTokens includes it
5. **Given** a model response with both Claude top-level cache fields and prompt_tokens_details, **When** both are present, **Then** the Claude top-level fields take priority
6. **Given** a non-cached request or model with no cache tokens, **When** no cache tokens are present, **Then** latestTotalTokens shows only total_tokens as before

---

### User Story 4 - System Prompt Stability Across Mode Transitions (Priority: P1)

As a user who switches between permission modes (e.g., default → plan → acceptEdits), I want the system prompt to remain constant so that the cached system prompt prefix is not invalidated on every mode change, reducing token costs and improving response latency.

**Why this priority**: Plan mode previously appended instructions to the system prompt, invalidating the entire cache on every mode transition. For long sessions with frequent mode switches, this causes significant unnecessary token costs. Keeping the system prompt stable maximizes cache hit rates.

**Independent Test**: Enter plan mode, verify the system prompt is identical to the default mode system prompt, and check that plan mode instructions appear as `<system-reminder>` user messages instead.

**Acceptance Scenarios**:

1. **Given** a Claude model is configured and the system prompt has been cached, **When** the user enters plan mode, **Then** the system prompt MUST remain identical to the previous turn's system prompt (no plan mode text appended).
2. **Given** plan mode is active, **When** the system sends the next API request, **Then** plan mode instructions MUST appear as `<system-reminder>` wrapped user messages in the messages array, not in the system prompt.
3. **Given** the user exits plan mode, **When** the next API request is made, **Then** the system prompt MUST remain unchanged and usage tracking SHOULD show cache_read_input_tokens indicating a cache hit on the system message.
4. **Given** a non-Claude model is configured, **When** the user enters plan mode, **Then** plan mode instructions still appear as `<system-reminder>` user messages (the injection pattern is model-agnostic, but caching benefits only apply to Claude models).
5. **Given** a Claude model is configured and the system prompt has been cached, **When** the agent changes CWD via `cd subdir` in the Bash tool, **Then** the system prompt's `Primary working directory` field MUST remain unchanged (showing the original project root), and usage tracking SHOULD show cache_read_input_tokens indicating a cache hit on the system message.

---

### Edge Cases

- **Edge Case 1**: Model name detection MUST be case-insensitive ("Claude-3-Sonnet" and "claude-3-sonnet" both trigger cache_control marker injection). Cache token extraction from usage applies regardless of model name.
- **Edge Case 2**: Mixed content messages MUST apply cache_control only to text content parts, preserving images unchanged
- **Edge Case 3**: Streaming and non-streaming requests MUST apply identical cache_control transformation logic
- **Edge Case 4**: Token tracking MUST handle missing cache token fields gracefully (treat undefined as 0)
- **Edge Case 5**: CWD changes via `cd` in Bash MUST NOT change the system prompt's `Primary working directory` field (it uses immutable `originalWorkdir`), preserving the cached system prompt prefix
- **Edge Case 6**: The last message with content MUST receive a cache_control marker regardless of conversation length. If the last message has no content (e.g., an assistant message with only tool_calls and no text), the system walks backward to find the most recent message that has content. The marker is purely stateless — no module-level state tracks marker positions across requests.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST detect cache-supporting models for cache_control marker injection using the `WAVE_PROMPT_CACHE_REGEX` environment variable (default: "claude"), which allows configurable regex patterns for model matching. This gate controls ONLY the injection of `cache_control: {type: "ephemeral"}` markers into messages — it does NOT gate cache token extraction from usage responses, which applies to all models.
- **FR-002**: System MUST add cache_control markers with type "ephemeral" to the first system message when using cache-enabled models. This ensures core instructions are always cached as the stable prefix. The system prompt MUST remain constant across plan mode transitions — plan mode instructions are injected as `<system-reminder>` user messages rather than system prompt changes to preserve the cached system prompt prefix. The `<env>` section's `Primary working directory` field MUST use the immutable `originalWorkdir` (set once at session start) rather than the dynamic `workdir` (which tracks `cd` changes), so that CWD changes do not invalidate the cached system prompt.
- **FR-003**: System MUST maintain two cache markers: (1) the system message (always marked as the stable prefix), and (2) the last message with content (user or assistant, no role distinction). The strategy is purely stateless — no module-level state, no bridge tracking, no tools parameter. The `transformMessagesForExplicitCache` function takes only messages and model name. The last-message marker moves forward ~2 blocks per turn as new messages are added, but since the API scans backward from each marker within a 20-block window and normal conversations add fewer than 20 blocks per turn, the previous cache position always falls within the scan window, resulting in a cache hit. Tools are implicitly cached as part of the prefix covered by the last-message marker. Content blocks are counted precisely: string content = 1 block, array content = element count, null/undefined content = 0 blocks.
- **FR-004**: System MUST NOT add cache_control markers when using non-Claude models (as determined by `WAVE_PROMPT_CACHE_REGEX`). However, cache token extraction from usage (FR-005) applies to all models regardless of this gate.
- **FR-005**: System MUST extend usage tracking to include cache-related metrics for ALL models (not gated by `supportsPromptCaching`). Cache tokens are extracted from two sources with priority ordering: (1) Claude top-level fields (cache_read_input_tokens, cache_creation_input_tokens, cache_creation object) take priority, (2) OpenAI-standard prompt_tokens_details fields (cached_tokens → cache_read_input_tokens, cache_creation_input_tokens → cache_creation_input_tokens) serve as fallback for non-Claude models that return cache data via prompt_tokens_details
- **FR-006**: System MUST apply cache_control markers identically for both streaming and non-streaming requests during message preparation phase
- **FR-007**: System MUST maintain backward compatibility with existing message processing logic (except for the cache strategy itself which is a breaking change)

### Key Entities *(include if feature involves data)*

- **Conversation Thread**: Represents a sequence of messages between user and AI agent, with properties including message count and session context
- **Message Context**: Represents the combination of system prompt and tools that provide context for AI agent responses
- **Enhanced Usage Metrics**: Extended usage object including cache-related token counts and creation breakdown
- **Claude Model Detection**: Boolean determination based on case-insensitive model name matching. Gates cache_control marker injection only — cache token extraction applies to all models.
- **Structured Message Content**: Array-based message content format supporting cache_control on individual content parts
# Feature Specification: Prompt Cache Control

**Feature Branch**: `021-prompt-cache-control`  
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

### User Story 2 - Adaptive Cache Breakpoint Optimization (Priority: P1)

When users engage in multi-turn conversations with cache-enabled models, the system must place cache breakpoints adaptively based on conversation length. For short conversations (≤20 content blocks), the last user message receives a cache marker. For long conversations (>20 content blocks), a bridge marker is placed at approximately 18 blocks from the end to stay within the API's 20-block backward scan window, ensuring the cache can still be hit.

**Why this priority**: Cache-enabled APIs (e.g. Qwen/Alibaba) use a back-to-front prefix matching strategy that only scans the nearest 20 content blocks from each `cache_control` marker. In long agentic conversations (>20 tool rounds), placing the marker only on the last user message would be too far from the system message to hit the cache. An adaptive bridge marker strategy ensures cache hits regardless of conversation length.

**Independent Test**: Can be fully tested by making agent calls with varying conversation lengths and verifying that short conversations cache the last user message, while long conversations place a bridge marker within the 20-block scan window.

**Acceptance Scenarios**:

1. **Given** a conversation has ≤20 total content blocks, **When** the system processes the next interaction with a cache-enabled model, **Then** the last user message has cache_control with type "ephemeral" (within the 20-block scan window of the system message)
2. **Given** a conversation has >20 total content blocks, **When** the system processes the interaction, **Then** a bridge marker is placed on a message at approximately 18 blocks from the end (within the 20-block scan window), and the last user message does NOT receive a marker
3. **Given** a conversation has no user messages (only system or assistant), **When** the system processes the interaction, **Then** only the system message receives cache markers
4. **Given** a non-cache-enabled model is configured, **When** an agent call is made, **Then** no cache_control markers are added to any messages

---

### User Story 3 - Tool Definition Cache Optimization (Priority: P3)

Tool definitions (function schemas) should be cached for Claude models since they remain relatively static during a session and can be substantial in size when many tools are available.

**Why this priority**: While tool definitions can be large, they are less frequently used than system messages and user context, making this optimization valuable but not critical for initial implementation.

**Independent Test**: Can be fully tested by making agent calls with tools enabled using Claude models and verifying the last tool in the tools array has cache_control markers.

**Acceptance Scenarios**:

1. **Given** tools are available for a Claude model agent call, **When** the API request is made, **Then** the last tool definition in the tools array includes cache_control with type "ephemeral"
2. **Given** no tools are configured, **When** an agent call is made with Claude models, **Then** no tool-related cache_control markers are added
3. **Given** multiple tools are available, **When** an agent call is made, **Then** only the last tool receives cache_control markers

---

### User Story 4 - Comprehensive Token Tracking for Cache-Enabled Models (Priority: P1)

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

### User Story 5 - System Prompt Stability Across Mode Transitions (Priority: P1)

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
- **Edge Case 6**: In long conversations (>20 content blocks), the system MUST NOT place a cache marker on the last user message, as it would be outside the API's 20-block backward scan window and waste a marker slot. Instead, a bridge marker MUST be placed within the scan window.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST detect cache-supporting models for cache_control marker injection using the `WAVE_PROMPT_CACHE_REGEX` environment variable (default: "claude"), which allows configurable regex patterns for model matching. This gate controls ONLY the injection of `cache_control: {type: "ephemeral"}` markers into messages and tool definitions — it does NOT gate cache token extraction from usage responses, which applies to all models.
- **FR-002**: System MUST add cache_control markers with type "ephemeral" to the first system message when using Claude models. This ensures core instructions are always cached even if reminders are added later. The system prompt MUST remain constant across plan mode transitions — plan mode instructions are injected as `<system-reminder>` user messages rather than system prompt changes to preserve the cached system prompt prefix. The `<env>` section's `Primary working directory` field MUST use the immutable `originalWorkdir` (set once at session start) rather than the dynamic `workdir` (which tracks `cd` changes), so that CWD changes do not invalidate the cached system prompt.
- **FR-003**: System MUST place cache_control markers adaptively based on total content block count. For short conversations (≤20 content blocks): the last user message receives a cache marker (within the API's 20-block backward scan window of the system message). For long conversations (>20 content blocks): a bridge marker is placed at approximately 18 blocks from the end (totalBlocks - 20 + 2 safety margin) to stay within the 20-block scan window, and the last user message does NOT receive a marker. Content blocks are counted precisely: string content = 1 block, array content = element count, null/undefined content = 0 blocks. The bridge marker creates a rolling cache — each new request's bridge is only a few blocks from the previous one, ensuring cache continuity across long conversations.
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
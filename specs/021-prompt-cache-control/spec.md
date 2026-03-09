# Feature Specification: Prompt Cache Control for Claude Models

**Feature Branch**: `021-prompt-cache-control`  
**Created**: 2025-12-02  
**Status**: Implemented  
**Input**: User description: "Add cache_control functionality to the OpenAI provider when the model name contains "claude": Add cache_control markers to system messages Add cache_control markers to the last two user messages Add cache_control markers to the last tool definition cache control : { "cache_control": { "type": "ephemeral" } }, the usage is like :{ "usage": { "prompt_tokens": 10, // 普通 prompt_tokens 数量（原价） "completion_tokens": 336, "total_tokens": 346, // 等于 prompt_tokens + completion_tokens "cache_read_input_tokens": 0, // 缓存命中 token 数 "cache_creation_input_tokens": 2843, // 缓存创建 token 数，等于 ephemeral_5m_input_tokens + ephemeral_1h_input_tokens "cache_creation": { "ephemeral_5m_input_tokens": 2843, "ephemeral_1h_input_tokens": 0 } } }, more examples: { "role": "system", "content": [ { "type": "text", "text": "xxx", "cache_control": { "type": "ephemeral" } } ] }, { "role": "user", "content": [ { "type": "text", "text": "xxx", "cache_control": { "type": "ephemeral" } } ] } , in tools: { "type": "function", "function": { "name": "Bash", "description": "xxx", "parameters": { "type": "object", "properties": { "command": { "type": "string", "description": "xxx" }, }, "required": [ "command" ] } }, "cache_control": { "type": "ephemeral" } }"

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

### User Story 2 - Interval-Based Message Cache Optimization (Priority: P2)

When users engage in long-running tasks that involve many AI agent interactions, the system should automatically cache messages at 20-message intervals (every 20th message) regardless of role. This provides better context for extended work sessions while maintaining a sliding window approach where only the most recent interval is cached.

**Why this priority**: This strategy replaces the simpler "last 2 user messages" approach, providing more robust context for long conversations where user messages might be infrequent but agent/tool interactions are numerous.

**Independent Test**: Can be fully tested by initiating a conversation with 20 or more messages and verifying that the system applies cache markers at the 20th message position, and moves it to the 40th position when the conversation reaches 40 messages.

**Acceptance Scenarios**:

1. **Given** a conversation has exactly 19 messages, **When** the system processes the next interaction, **Then** no cache marker should be created for the interval strategy
2. **Given** a conversation has exactly 20 messages, **When** the system processes the interaction, **Then** a cache marker should be created at the 20th message position
3. **Given** a conversation has 39 messages, **When** the system processes the next interaction, **Then** the cache marker should remain at the 20th message position
4. **Given** a conversation has exactly 40 messages, **When** the system processes the interaction, **Then** the cache marker should move to the 40th message position (20th marker removed)

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

When using Claude models with cache control, developers need accurate token tracking that includes all cache-related costs (cache reads, cache creation) in addition to the base prompt and completion tokens to understand the true cost and token usage of their requests.

**Why this priority**: Accurate cost tracking is critical for developers to understand the financial impact of caching and make informed decisions about their usage patterns. Without comprehensive token tracking, cache benefits might appear misleading.

**Independent Test**: Can be fully tested by making cached requests with Claude models and verifying that the displayed token count includes prompt_tokens + completion_tokens + cache_read_input_tokens + cache_creation_input_tokens.

**Acceptance Scenarios**:

1. **Given** a Claude model request with cache creation, **When** the response includes cache_creation_input_tokens, **Then** latestTotalTokens shows total_tokens + cache_creation_input_tokens
2. **Given** a Claude model request with cache hits, **When** the response includes cache_read_input_tokens, **Then** latestTotalTokens shows total_tokens + cache_read_input_tokens
3. **Given** a Claude model request with both cache creation and reads, **When** the response includes both token types, **Then** latestTotalTokens shows total_tokens + cache_read_input_tokens + cache_creation_input_tokens
4. **Given** a non-cached request or non-Claude model, **When** no cache tokens are present, **Then** latestTotalTokens shows only total_tokens as before

---

### Edge Cases

- **Edge Case 1**: Model name detection MUST be case-insensitive ("Claude-3-Sonnet" and "claude-3-sonnet" both trigger caching)
- **Edge Case 2**: Mixed content messages MUST apply cache_control only to text content parts, preserving images unchanged
- **Edge Case 3**: Empty conversation history MUST skip user message caching, apply system message caching only
- **Edge Case 4**: Streaming and non-streaming requests MUST apply identical cache_control transformation logic
- **Edge Case 5**: Token tracking MUST handle missing cache token fields gracefully (treat undefined as 0)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST detect Claude models by checking if the model name contains "claude" (case-insensitive)
- **FR-002**: System MUST add cache_control markers with type "ephemeral" to the first system message when using Claude models. This ensures core instructions are always cached even if reminders are added later.
- **FR-003**: System MUST create a cache marker when total message count reaches multiples of 20 (20, 40, 60, etc.)
- **FR-004**: System MUST NOT create cache markers when total message count is below 20 or not a multiple of 20
- **FR-005**: System MUST maintain cache markers at the most recent multiple-of-20 message position (sliding window)
- **FR-006**: System MUST include cached messages in the context provided to the AI agent
- **FR-007**: System MUST not add cache_control markers when using non-Claude models
- **FR-008**: System MUST extend usage tracking to include cache-related metrics (cache_read_input_tokens, cache_creation_input_tokens, cache_creation object)
- **FR-009**: System MUST apply cache_control markers identically for both streaming and non-streaming requests during message preparation phase
- **FR-010**: System MUST maintain backward compatibility with existing message processing logic (except for the cache strategy itself which is a breaking change)
- **FR-011**: System MUST support caching for different message roles at interval positions:
    - For `tool` role: Add `cache_control` directly to the message.
    - For `assistant` role with `tool_calls`: Add `cache_control` to the last tool call.
    - For other roles: Add `cache_control` to the message content.

### Key Entities *(include if feature involves data)*

- **Conversation Thread**: Represents a sequence of messages between user and AI agent, with properties including message count, cache markers, and session context
- **Cache Marker**: Represents a point in the conversation where messages are preserved for context, containing the message position and associated conversation content
- **Message Context**: Represents the combination of system prompt, tools, and cached messages that provide context for AI agent responses
- **Enhanced Usage Metrics**: Extended usage object including cache-related token counts and creation breakdown
- **Claude Model Detection**: Boolean determination based on case-insensitive model name matching
- **Structured Message Content**: Array-based message content format supporting cache_control on individual content parts
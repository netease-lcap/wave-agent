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

### User Story 2 - Recent User Messages Cache Optimization (Priority: P2)

For Claude models, the last two user messages in the conversation should be automatically cached to optimize token usage for multi-turn conversations where recent context is frequently referenced.

**Why this priority**: Recent user messages often contain important context that gets referenced in follow-up questions, but this is less critical than system message caching since user messages are typically shorter.

**Independent Test**: Can be fully tested by creating a conversation with 3+ user messages using Claude models and verifying only the last two user messages have cache_control markers.

**Acceptance Scenarios**:

1. **Given** a conversation with multiple user messages using Claude models, **When** an agent call is made, **Then** only the last two user messages have cache_control markers with type "ephemeral"
2. **Given** a conversation with only one user message, **When** an agent call is made, **Then** that single user message has cache_control markers
3. **Given** conversations with both text and image content, **When** cache_control is applied, **Then** only text content parts receive cache_control markers

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
- **FR-002**: System MUST add cache_control markers with type "ephemeral" to system messages when using Claude models
- **FR-003**: System MUST add cache_control markers to the last two user messages in the conversation when using Claude models
- **FR-004**: System MUST add cache_control markers to the last tool definition when tools are available for Claude models
- **FR-005**: System MUST transform string content to structured content arrays when adding cache_control markers
- **FR-006**: System MUST preserve existing structured content while adding cache_control markers to text parts only
- **FR-007**: System MUST not add cache_control markers when using non-Claude models
- **FR-008**: System MUST extend usage tracking to include cache-related metrics (cache_read_input_tokens, cache_creation_input_tokens, cache_creation object)
- **FR-008b**: System MUST calculate latestTotalTokens as total_tokens + cache_read_input_tokens + cache_creation_input_tokens for accurate cost tracking
- **FR-009**: System MUST apply cache_control markers identically for both streaming and non-streaming requests during message preparation phase
- **FR-010**: System MUST maintain backward compatibility with existing message processing logic

### Key Entities *(include if feature involves data)*

- **Cache Control Marker**: Ephemeral cache directive with type "ephemeral" attached to message content or tool definitions
- **Enhanced Usage Metrics**: Extended usage object including cache-related token counts and creation breakdown
- **Claude Model Detection**: Boolean determination based on case-insensitive model name matching
- **Structured Message Content**: Array-based message content format supporting cache_control on individual content parts
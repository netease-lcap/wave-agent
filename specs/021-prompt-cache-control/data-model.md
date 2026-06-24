# Data Model: Prompt Cache Control

**Date**: 2025-12-02  
**Feature**: 021-prompt-cache-control  
**Purpose**: Define data structures and relationships for cache control functionality

## Core Entities

### Cache Control Marker

**Purpose**: Ephemeral cache directive attached to cacheable content

**Structure**:
```typescript
interface CacheControl {
  type: "ephemeral";
}
```

**Validation Rules**:
- `type` must be exactly "ephemeral" (only supported cache type)
- Applied only to text content parts, never to images or tool results
- Optional field - presence indicates content should be cached

**Relationships**:
- Attached to `ChatCompletionContentPartText` objects in the system message (always) and the last message with content (moves each turn)
- Not attached to tool definitions — tools are implicitly cached as part of the prefix covered by the last-message marker
- Not attached to other content types (images, tool results)

### Enhanced Usage Metrics

**Purpose**: Extended usage tracking including cache-related token counts from both Claude top-level fields and OpenAI-standard `prompt_tokens_details`

**Structure**:
```typescript
interface ExtendedPromptTokensDetails extends CompletionUsage.PromptTokensDetails {
  // Standard OpenAI fields (inherited): audio_tokens, cached_tokens
  // Extended field for models that return cache creation via prompt_tokens_details
  cache_creation_input_tokens?: number;
}

interface ClaudeUsage extends CompletionUsage {
  // Standard OpenAI usage fields (unchanged)
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;

  // Cache extensions (from Claude top-level OR OpenAI prompt_tokens_details)
  // Claude: usage.cache_read_input_tokens / OpenAI: usage.prompt_tokens_details.cached_tokens
  cache_read_input_tokens?: number;
  // Claude: usage.cache_creation_input_tokens / OpenAI: usage.prompt_tokens_details.cache_creation_input_tokens
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };

  // Override to include cache_creation_input_tokens in prompt_tokens_details
  prompt_tokens_details?: ExtendedPromptTokensDetails;
}
```

**Validation Rules**:
- All cache fields are optional (only present when cache is used)
- `cache_creation_input_tokens` equals sum of ephemeral cache tokens (Claude-specific)
- `cache_read_input_tokens` indicates tokens served from existing cache
- When both Claude top-level and `prompt_tokens_details` cache fields are present, top-level takes priority
- All token counts must be non-negative integers

**Extraction Priority**:
1. Claude top-level `cache_read_input_tokens` → used directly
2. OpenAI `prompt_tokens_details.cached_tokens` → mapped to `cache_read_input_tokens` as fallback
3. Claude top-level `cache_creation_input_tokens` → used directly
4. OpenAI `prompt_tokens_details.cache_creation_input_tokens` → mapped to `cache_creation_input_tokens` as fallback

**Relationships**:
- Extends existing `CompletionUsage` from OpenAI SDK
- Maintains backward compatibility with existing usage tracking
- Integrated into `CallAgentResult` interface

### Claude Model Detection

**Purpose**: Boolean determination of cache control applicability via configurable regex pattern

**Structure**:
```typescript
interface ModelCacheConfig {
  modelName: string;
  cachePattern: string; // From WAVE_PROMPT_CACHE_REGEX env var, default: "claude"
  supportsPromptCaching: boolean;
}
```

**Validation Rules**:
- Pattern matching via regex: `new RegExp(cachePattern, "i").test(modelName)`
- Default pattern is "claude" if `WAVE_PROMPT_CACHE_REGEX` is not set
- Invalid regex patterns fall back to simple includes check with default "claude"
- Model name cannot be empty or undefined

**Configuration**:
- Environment variable: `WAVE_PROMPT_CACHE_REGEX`
- Default value: `"claude"`
- Example patterns:
  - `"claude"` - matches any model with "claude" in name
  - `"claude|qwen"` - matches models with "claude" OR "qwen"
  - `"claude|qwen3\\.6-plus"` - matches "claude" or exact "qwen3.6-plus"

**Relationships**:
- Determines cache_control marker injection for the request (messages only — tools are implicitly cached as part of the prefix)
- Does NOT gate cache token extraction from usage — that applies to all models
- Affects message transformation

**Legacy Support**:
- `isClaudeModel()` is deprecated alias for `supportsPromptCaching()`
- Backward compatibility maintained for existing code

### Structured Message Content

**Purpose**: Array-based message content supporting selective cache control

**Structure**:
```typescript
// Extended OpenAI types for Claude cache support
interface ClaudeChatCompletionContentPartText extends ChatCompletionContentPartText {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}

type ClaudeMessageContent = string | Array<
  ClaudeChatCompletionContentPartText | 
  ChatCompletionContentPartImage
>;
```

**Validation Rules**:
- String content must be transformed to structured arrays when adding cache control
- Existing structured content preserved, cache control added selectively
- Only text content parts receive cache_control markers
- Image and other content types remain unchanged

**Relationships**:
- Replaces simple string content in OpenAI message format
- Maintains compatibility with existing message processing
- Enables selective caching based on content type

### Content Block Counting

**Purpose**: Understanding conversation size for diagnostics and observability

**Counting Rules**:
- String content → 1 block
- Array content (structured parts) → number of elements
- Null/undefined content (e.g. assistant messages with only tool_calls) → 0 blocks

**Relationships**:
- Block counting is used for understanding conversation size, not for cache strategy decisions
- The 2-marker strategy (system + last message) applies regardless of conversation length
- The API's 20-block backward scan window is a constraint that the strategy satisfies naturally: the last-message marker moves ~2 blocks per turn, well within the 20-block window
- Counted by iterating all messages and summing per-message block counts

## Entity State Transitions

### Message Content Transformation

```
String Content -> Structured Content + Cache Control
"system prompt" -> [{ type: "text", text: "system prompt", cache_control: { type: "ephemeral" } }]
```

### Cache Usage Lifecycle

```
Request 1: cache_creation_input_tokens > 0, cache_read_input_tokens = 0
Request 2+: cache_creation_input_tokens = 0, cache_read_input_tokens > 0 (cache hit)
```

### Model Detection Flow

```
ModelName -> supportsPromptCaching() -> shouldInjectCacheControlMarkers -> Message Transformation

Note: Cache token extraction from usage is NOT gated by supportsPromptCaching.
All models' usage responses are checked for cache tokens (Claude top-level + prompt_tokens_details).
```

## Data Flow Patterns

### Cache Control Application

1. **Input**: Original OpenAI message parameters
2. **Detection**: Model name analysis for cache support
3. **System Marker**: Add cache_control to the first system message's text content part
4. **Last Message Marker**: Find the last message with content (walking backward from the end), add cache_control to its last text content part
5. **Transformation**: String content → structured arrays + cache_control on the two marked messages
6. **Preservation**: Existing structured content maintained; non-marked messages unchanged
7. **Output**: Enhanced message parameters with 2 cache markers (stateless, no module-level state)

### Usage Tracking Extension

1. **Input**: Standard OpenAI usage response
2. **Detection**: Presence of cache-related fields (Claude top-level OR prompt_tokens_details)
3. **Extension**: Add cache metrics to existing usage object, extracting from both sources with priority
4. **Integration**: Maintain compatibility with existing usage tracking; extraction applies to all models (not just Claude)
5. **Output**: Enhanced usage object with cache information

## Validation Schema

### Cache Control Validation
```typescript
function isValidCacheControl(control: any): control is CacheControl {
  return control && 
         typeof control === 'object' && 
         control.type === 'ephemeral';
}
```

### Usage Metrics Validation
```typescript
function isValidClaudeUsage(usage: any): usage is ClaudeUsage {
  const hasStandardFields = typeof usage.prompt_tokens === 'number' &&
                           typeof usage.completion_tokens === 'number' &&
                           typeof usage.total_tokens === 'number';
  
  const hasCacheFields = usage.cache_read_input_tokens === undefined || 
                        typeof usage.cache_read_input_tokens === 'number';
  
  return hasStandardFields && hasCacheFields;
}
```

### Model Detection Validation  
```typescript
function isValidModelName(modelName: string): boolean {
  return typeof modelName === 'string' && 
         modelName.trim().length > 0;
}
```
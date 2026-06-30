# Quickstart: Cache Control Implementation

**Feature**: Prompt Cache Control for Claude Models  
**Date**: 2025-12-02  
**Estimated Implementation Time**: 4-6 hours  

## Overview

This feature adds automatic prompt cache control to cache-enabled models in the OpenAI provider, reducing token costs by 30-60% for repeated content. The implementation uses a 2-marker strategy matching Claude Code: system message (always marked as the stable prefix) and last message with content (marked each turn, moves ~2 blocks forward but stays within the API's 20-block scan window for cache hits).

## Implementation Steps

### Phase 1: Core Utilities (60 min)

**File**: `packages/agent-sdk/src/utils/cacheControlUtils.ts`

```typescript
// 1. Model detection utility (configurable via WAVE_PROMPT_CACHE_REGEX)
export function supportsPromptCaching(modelName: string): boolean {
  const cachePattern = process.env.WAVE_PROMPT_CACHE_REGEX || "claude";
  try {
    const regex = new RegExp(cachePattern, "i");
    return regex.test(modelName.trim());
  } catch {
    return modelName.toLowerCase().includes("claude");
  }
}

/** @deprecated Use supportsPromptCaching instead */
export const isClaudeModel = supportsPromptCaching;

// 2. Content transformation utilities  
export function addCacheControlToContent(
  content: string | ChatCompletionContentPart[],
  shouldCache: boolean
): ClaudeChatCompletionContentPartText[] {
  // Transform string content to structured arrays with cache_control
}
```

### Phase 2: Type Extensions (30 min)

**File**: `packages/agent-sdk/src/types/core.ts`

```typescript
// Extend existing interfaces with Claude cache support
export interface ClaudeUsage extends CompletionUsage {
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
}

export interface CacheControl {
  type: "ephemeral";
}
```

### Phase 3: AIService Integration (90 min)

**File**: `packages/agent-sdk/src/services/aiService.ts`

**Integration Point**: After line 183 (`openaiMessages` construction)

> **Important**: Cache control has two distinct concerns:
> 1. **Marker injection** (adding `cache_control: {type: "ephemeral"}` to messages/tools) — gated by `supportsPromptCaching`, only for Claude-like models
> 2. **Cache token extraction** (reading cache metrics from usage responses) — NOT gated, applies to all models

```typescript
// Marker injection: gated by supportsPromptCaching
if (supportsPromptCaching(model || modelConfig.model)) {
  openaiMessages = transformMessagesForExplicitCache(
    openaiMessages,
    model || modelConfig.model
  );
}
```

**Usage Extension**: Cache token extraction applies to all models (no gate)

```typescript
// Extend usage object with cache metrics (Claude top-level + OpenAI prompt_tokens_details)
if (totalUsage && response.usage) {
  totalUsage = extendUsageWithCacheMetrics(
    totalUsage,
    response.usage as Partial<ClaudeUsage>,
  );
}
```

### Phase 4: Message Transformation Logic (90 min)

**File**: `packages/agent-sdk/src/utils/cacheControlUtils.ts`

```typescript
/**
 * Counts total content blocks across all messages (for diagnostics).
 * String content = 1 block, array content = element count, null = 0.
 */
export function countContentBlocks(
  messages: ChatCompletionMessageParam[]
): number {
  let count = 0;
  for (const message of messages) {
    const content = message.content;
    if (typeof content === "string") count += 1;
    else if (Array.isArray(content)) count += content.length;
  }
  return count;
}

// Stateless 2-marker strategy — no module-level state needed

export function transformMessagesForExplicitCache(
  messages: ChatCompletionMessageParam[],
  modelName: string
): ChatCompletionMessageParam[] {
  if (!supportsPromptCaching(modelName)) return messages;

  const result = [...messages];

  // Marker 1: System message (always marked as stable prefix)
  const firstSystemIndex = result.findIndex(m => m.role === "system");
  if (firstSystemIndex !== -1) {
    result[firstSystemIndex] = addCacheMarkerToMessage(result[firstSystemIndex]);
  }

  // Marker 2: Last message with content (walks backward to find it)
  // This marker moves ~2 blocks per turn but stays within the 20-block
  // scan window, so the previous cache always hits.
  for (let i = result.length - 1; i >= 0; i--) {
    if (hasContent(result[i])) {
      result[i] = addCacheMarkerToMessage(result[i]);
      break;
    }
  }

  return result;
}

function hasContent(message: ChatCompletionMessageParam): boolean {
  const content = message.content;
  if (typeof content === "string") return content.length > 0;
  if (Array.isArray(content)) return content.length > 0;
  return false;
}

function addCacheMarkerToMessage(
  message: ChatCompletionMessageParam
): ChatCompletionMessageParam {
  // Transform string content to structured array with cache_control
  // on the last text content part
  // ...
}
```

### Phase 5: Testing (120 min)

**File**: `packages/agent-sdk/tests/services/aiService.cacheControl.test.ts`

```typescript
describe('Claude Cache Control', () => {
  test('should add cache control to system messages for Claude models', async () => {
    // Test system message transformation
  });
  
  test('should add cache control to last message with content', async () => {
    // Test last-message marker logic
  });
  
  test('should not add cache control for non-Claude models', async () => {
    // Test model detection and bypass logic
  });
  
  test('should extend usage tracking with cache metrics', async () => {
    // Test usage metrics extension
  });
});
```

## Key Implementation Details

### Cache Control Application Rules

1. **System Message**: Always marked for cache-enabled models (stable prefix)
2. **Last Message with Content**: The last message (user or assistant, no role distinction) that has content receives a cache_control marker. This marker moves ~2 blocks per turn but stays within the API's 20-block backward scan window
3. **Content Types**: Only text content parts receive cache_control markers, never images
4. **Stateless**: No module-level state, no bridge tracking, no tools parameter. The 2 markers are recomputed from scratch each request
5. **Content Block Counting**: String content = 1 block, array content = element count, null content = 0 blocks (used for diagnostics, not strategy decisions)

### Message Transformation Pattern

```typescript
// Before (string content)
{ role: "system", content: "You are helpful" }

// After (structured content + cache)
{ 
  role: "system", 
  content: [
    { 
      type: "text", 
      text: "You are helpful",
      cache_control: { type: "ephemeral" }
    }
  ] 
}
```

### Usage Tracking Extension

```typescript
// Standard OpenAI usage
{ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }

// Extended Claude usage (cache from Claude top-level fields)
{
  prompt_tokens: 100,
  completion_tokens: 50,
  total_tokens: 150,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 80,
  cache_creation: {
    ephemeral_5m_input_tokens: 80,
    ephemeral_1h_input_tokens: 0
  }
}

// Extended usage from non-Claude models (cache from prompt_tokens_details)
// Input: { prompt_tokens: 200, total_tokens: 250, prompt_tokens_details: { cached_tokens: 120 } }
// Output:
{
  prompt_tokens: 200,
  completion_tokens: 50,
  total_tokens: 250,
  cache_read_input_tokens: 120,  // extracted from prompt_tokens_details.cached_tokens
}
```

## Testing Strategy

### Test Cases by Priority

**P1 - Core Functionality**:
- Model detection (Claude vs non-Claude)
- System message caching 
- Basic content transformation

**P2 - Selection Logic**:
- Last message with content marker (user or assistant, no role distinction)
- Mixed content preservation
- Last-message marker advances correctly across turns
- Content block counting accuracy (for diagnostics)

**P3 - Edge Cases**:
- Empty conversations
- Image + text content
- Streaming vs non-streaming
- Assistant message with only tool_calls (no content) — marker walks backward to find content

### Mock Strategy

```typescript
// Mock OpenAI responses with cache metrics
vi.mocked(openai.chat.completions.create).mockResolvedValue({
  choices: [{ message: { content: "response" } }],
  usage: {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    cache_read_input_tokens: 30,
    cache_creation_input_tokens: 70
  }
});
```

## Expected Outcomes

### Performance Metrics
- **Latency Impact**: +25-50ms per request for cache transformation
- **Memory Overhead**: <25% increase for message processing
- **Cost Savings**: 30-60% token reduction after 2-3 requests

### Cache Hit Rates
- **System Messages**: 70% (highly reusable, always marked)
- **Conversation Prefix**: 60% (covered by last-message marker within scan window)

## Rollback Strategy

If issues arise:
1. **Feature Flag**: Add `DISABLE_CLAUDE_CACHE=true` environment variable
2. **Model Bypass**: Set `WAVE_PROMPT_CACHE_REGEX=""` to disable caching for all models
3. **Selective Rollback**: Disable individual components (system marker, last-message marker)

## Post-Implementation Verification

```bash
# 1. Build and test
cd packages/agent-sdk
pnpm build
pnpm test

# 2. Integration test with Claude model
cd packages/code  
pnpm tsx examples/cache-control-demo.ts

# 3. Verify usage tracking
# Check logs for cache_read_input_tokens and cache_creation_input_tokens
```

## Success Criteria

✅ **Functionality**: All tests pass, cache control applied correctly  
✅ **Performance**: <50ms latency increase, <25% memory overhead  
✅ **Compatibility**: Non-Claude models unchanged, existing usage tracking preserved  
✅ **Cost Efficiency**: Observable cache hit rates and token savings in usage metrics
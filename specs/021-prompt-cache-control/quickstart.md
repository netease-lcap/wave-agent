# Quickstart: Cache Control Implementation

**Feature**: Prompt Cache Control for Claude Models  
**Date**: 2025-12-02  
**Estimated Implementation Time**: 4-6 hours  

## Overview

This feature adds automatic prompt cache control to cache-enabled models in the OpenAI provider, reducing token costs by 30-60% for repeated content. The implementation applies cache markers to system messages, adaptively to the last user message (short conversations) or a bridge marker (long conversations), and tool definitions when using cache-enabled models.

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

// 3. Tool transformation utility
export function addCacheControlToLastTool(
  tools: ChatCompletionFunctionTool[]
): ClaudeChatCompletionFunctionTool[] {
  // Add cache_control to last tool only
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
    model || modelConfig.model,
    tools
  );

  if (tools && tools.length > 0) {
    tools = addCacheControlToLastTool(tools);
  }
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
 * Counts total content blocks across all messages.
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

export function transformMessagesForExplicitCache(
  messages: ChatCompletionMessageParam[],
  modelName: string
): ChatCompletionMessageParam[] {
  if (!supportsPromptCaching(modelName)) return messages;

  const firstSystemIndex = messages.findIndex(m => m.role === "system");
  const totalBlocks = countContentBlocks(messages);

  // Strategy: system marker always + adaptive second marker
  // Short (≤20 blocks): last user message (within scan window)
  // Long (>20 blocks): bridge at ~18 blocks from end (within 20-block scan window)
  const cacheIndices = new Set<number>();
  if (firstSystemIndex !== -1) cacheIndices.add(firstSystemIndex);

  if (totalBlocks <= 20) {
    // Last user message within scan window
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") { cacheIndices.add(i); break; }
    }
  } else {
    // Bridge marker: target = totalBlocks - 20 + 2 = totalBlocks - 18
    const targetBlocks = totalBlocks - 18;
    let cumulative = 0;
    for (let i = 0; i < messages.length; i++) {
      const content = messages[i].content;
      let blocks = 0;
      if (typeof content === "string") blocks = 1;
      else if (Array.isArray(content)) blocks = content.length;
      cumulative += blocks;
      if (i === firstSystemIndex || blocks === 0) continue;
      if (cumulative >= targetBlocks) { cacheIndices.add(i); break; }
    }
  }

  // Apply cache_control to selected indices...
}
```

### Phase 5: Testing (120 min)

**File**: `packages/agent-sdk/tests/services/aiService.cacheControl.test.ts`

```typescript
describe('Claude Cache Control', () => {
  test('should add cache control to system messages for Claude models', async () => {
    // Test system message transformation
  });
  
  test('should cache last tool definition', async () => {
    // Test tool caching logic
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

1. **System Messages**: Always cached for cache-enabled models
2. **Adaptive Breakpoint**: For short conversations (≤20 content blocks), the last user message is cached. For long conversations (>20 blocks), a bridge marker is placed at ~18 blocks from the end to stay within the API's 20-block backward scan window
3. **Tool Definitions**: Only the last tool in the tools array
4. **Content Types**: Only text content parts, never images
5. **Content Block Counting**: String content = 1 block, array content = element count, null content = 0 blocks

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
- Last tool definition caching
- Mixed content preservation
- Bridge marker placement for long conversations (>20 blocks)
- Content block counting accuracy

**P3 - Edge Cases**:
- Empty conversations
- Image + text content
- Streaming vs non-streaming
- Large tool arrays

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
- **System Messages**: 70% (highly reusable)
- **Tool Definitions**: 60% (moderately stable)

## Rollback Strategy

If issues arise:
1. **Feature Flag**: Add `DISABLE_CLAUDE_CACHE=true` environment variable
2. **Model Bypass**: Set `WAVE_PROMPT_CACHE_REGEX=""` to disable caching for all models
3. **Selective Rollback**: Disable individual components (system/user/tools)

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
# Quickstart: Claude Cache Control Implementation

**Feature**: Prompt Cache Control for Claude Models  
**Date**: 2025-12-02  
**Estimated Implementation Time**: 4-6 hours  

## Overview

This feature adds automatic prompt cache control to Claude models in the OpenAI provider, reducing token costs by 30-60% for repeated content. The implementation applies cache markers to system messages, recent user messages, and tool definitions when using Claude models.

## Implementation Steps

### Phase 1: Core Utilities (60 min)

**File**: `packages/agent-sdk/src/utils/cacheControlUtils.ts`

```typescript
// 1. Model detection utility
export function isClaudeModel(modelName: string): boolean {
  return modelName.toLowerCase().includes('claude');
}

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

```typescript
// Add before createParams construction (line ~195)
if (isClaudeModel(model || modelConfig.agentModel)) {
  openaiMessages = transformMessagesForClaudeCache(
    openaiMessages,
    model || modelConfig.agentModel,
    tools
  );
  
  if (tools && tools.length > 0) {
    tools = addCacheControlToLastTool(tools);
  }
}
```

**Usage Extension**: Modify usage processing (lines 246-252 and 484-486)

```typescript
// Extend usage object for Claude models
if (response.usage && isClaudeModel(model || modelConfig.agentModel)) {
  totalUsage = extendUsageWithCacheMetrics(response.usage, responseHeaders);
}
```

### Phase 4: Message Transformation Logic (90 min)

**File**: `packages/agent-sdk/src/utils/cacheControlUtils.ts`

```typescript
export function transformMessagesForClaudeCache(
  messages: ChatCompletionMessageParam[],
  modelName: string,
  tools?: ChatCompletionFunctionTool[]
): ChatCompletionMessageParam[] {
  if (!isClaudeModel(modelName)) {
    return messages; // No changes for non-Claude models
  }
  
  return messages.map((message, index) => {
    // System message: always cache
    if (message.role === 'system') {
      return {
        ...message,
        content: addCacheControlToContent(message.content, true)
      };
    }
    
    // User messages: cache last 2 only
    if (message.role === 'user') {
      const isRecentUser = index >= messages.length - 2;
      return {
        ...message, 
        content: addCacheControlToContent(message.content, isRecentUser)
      };
    }
    
    return message;
  });
}
```

### Phase 5: Testing (120 min)

**File**: `packages/agent-sdk/tests/services/aiService.cacheControl.test.ts`

```typescript
describe('Claude Cache Control', () => {
  test('should add cache control to system messages for Claude models', async () => {
    // Test system message transformation
  });
  
  test('should cache last two user messages only', async () => {
    // Test user message selection and transformation
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

1. **System Messages**: Always cached for Claude models
2. **User Messages**: Only last 2 messages in conversation 
3. **Tool Definitions**: Only the last tool in the tools array
4. **Content Types**: Only text content parts, never images

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

// Extended Claude usage  
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
```

## Testing Strategy

### Test Cases by Priority

**P1 - Core Functionality**:
- Model detection (Claude vs non-Claude)
- System message caching 
- Basic content transformation

**P2 - Selection Logic**:
- Last 2 user messages selection
- Last tool definition caching
- Mixed content preservation

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
- **User Messages**: 40% (context-dependent)
- **Tool Definitions**: 60% (moderately stable)

## Rollback Strategy

If issues arise:
1. **Feature Flag**: Add `DISABLE_CLAUDE_CACHE=true` environment variable
2. **Model Bypass**: Modify `isClaudeModel()` to return `false`
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
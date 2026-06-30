# Cache Control API Contract

**Version**: 1.0  
**Date**: 2025-12-02  
**Purpose**: Define interfaces and contracts for Claude cache control functionality

## Core Interfaces

### CacheControl

```typescript
/**
 * Cache control directive for Claude models
 * Only ephemeral caching is supported
 */
interface CacheControl {
  /** Cache type - only 'ephemeral' is supported */
  type: "ephemeral";
}
```

### Claude-Extended OpenAI Types

```typescript
/**
 * Extended text content part with cache control support
 */
interface ClaudeChatCompletionContentPartText extends ChatCompletionContentPartText {
  type: "text";
  text: string;
  /** Optional cache control directive */
  cache_control?: CacheControl;
}

/**
 * Extended tool definition with cache control support
 */
interface ClaudeChatCompletionFunctionTool extends ChatCompletionFunctionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: object;
  };
  /** Optional cache control directive */
  cache_control?: CacheControl;
}

/**
 * Message content supporting Claude cache control
 */
type ClaudeMessageContent = string | Array<
  ClaudeChatCompletionContentPartText | 
  ChatCompletionContentPartImage
>;
```

### Enhanced Usage Tracking

```typescript
/**
 * Extended prompt_tokens_details with cache_creation_input_tokens
 * Some models (e.g. Gemini, DeepSeek) return this field inside prompt_tokens_details
 */
interface ExtendedPromptTokensDetails extends CompletionUsage.PromptTokensDetails {
  cache_creation_input_tokens?: number;
}

/**
 * Extended usage metrics including cache information
 * Supports both Claude-specific top-level fields and OpenAI-standard prompt_tokens_details
 */
interface ClaudeUsage extends CompletionUsage {
  // Standard OpenAI fields
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;

  // Cache extensions (from Claude top-level OR OpenAI prompt_tokens_details)
  /** Tokens read from cache. Claude: cache_read_input_tokens / OpenAI: prompt_tokens_details.cached_tokens */
  cache_read_input_tokens?: number;

  /** Tokens used to create cache. Claude: cache_creation_input_tokens / OpenAI: prompt_tokens_details.cache_creation_input_tokens */
  cache_creation_input_tokens?: number;

  /** Detailed breakdown of cache creation (Claude-specific) */
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };

  /** Override to include cache_creation_input_tokens in prompt_tokens_details */
  prompt_tokens_details?: ExtendedPromptTokensDetails;
}
```

## Utility Functions Contract

### Model Detection

```typescript
/**
 * Determines if model supports prompt caching
 * Uses WAVE_PROMPT_CACHE_REGEX environment variable for configurable matching
 * @param modelName - Model identifier
 * @returns True if model name matches the configured pattern (default: contains 'claude')
 */
function supportsPromptCaching(modelName: string): boolean;

/**
 * Determines if model supports cache control
 * @param modelName - Model identifier
 * @returns True if model name matches the cache pattern
 * @deprecated Use supportsPromptCaching instead
 */
const isClaudeModel: typeof supportsPromptCaching;
```

**Environment Variable Configuration**:
- `WAVE_PROMPT_CACHE_REGEX`: Regex pattern for matching model names (default: "claude")
- Example: `WAVE_PROMPT_CACHE_REGEX="claude|qwen"` matches both claude and qwen models
- Invalid regex patterns fall back to simple "claude" matching

**Scope of `supportsPromptCaching`**: This function gates ONLY cache_control marker injection (adding `cache_control: {type: "ephemeral"}` to messages and tool definitions). It does NOT gate cache token extraction from usage responses — that applies to ALL models, since `prompt_tokens_details` is an OpenAI-standard field returned by Gemini, DeepSeek, and others.

### Cache Control Application

```typescript
/**
 * Adds cache control markers to message content
 * @param content - Original content (string or structured)
 * @param shouldCache - Whether to add cache control
 * @returns Structured content with cache control markers
 */
function addCacheControlToContent(
  content: string | ChatCompletionContentPart[],
  shouldCache: boolean
): ClaudeChatCompletionContentPartText[];

/**
 * Adds cache control to the last tool in tools array
 * @param tools - Array of tool definitions
 * @returns Tools array with cache control on last tool
 */
function addCacheControlToLastTool(
  tools: ChatCompletionFunctionTool[]
): ClaudeChatCompletionFunctionTool[];

/**
 * Counts the total number of content blocks across all messages.
 * String content = 1 block, array content = element count, null/undefined = 0.
 * @param messages - Array of chat messages
 * @returns Total content block count
 */
function countContentBlocks(
  messages: ChatCompletionMessageParam[]
): number;

/**
 * Transforms messages for explicit cache control with stable 3-breakpoint strategy.
 *
 * Marker strategy:
 * - System message: always marked
 * - Tools list: marked separately via addCacheControlToLastTool
 * - Block 20 bridge: when total prefix (system + tools + messages) > 20 blocks
 *   AND system+tools < 20 blocks, a bridge marker is placed at the 20th content
 *   block position. Placed ONCE, NEVER moves (module-level state).
 * - No last user message marker (removed entirely)
 *
 * @param messages - Original OpenAI message array
 * @param modelName - Model name for cache detection
 * @param tools - Optional tools array for accurate block counting
 * @returns Messages with cache control markers applied
 */
function transformMessagesForExplicitCache(
  messages: ChatCompletionMessageParam[],
  modelName: string,
  tools?: ChatCompletionFunctionTool[]
): ChatCompletionMessageParam[];

/**
 * Resets the bridge marker state (module-level).
 * Called when conversation drops to ≤20 blocks (e.g., after compaction)
 * or when starting a new conversation.
 */
function resetExplicitCacheState(): void;

```

### Usage Tracking Extension

```typescript
/**
 * Extends standard usage with cache metrics
 * Extracts cache tokens from both Claude-specific top-level fields and
 * OpenAI-standard prompt_tokens_details (used by Gemini, DeepSeek, etc.)
 *
 * Priority: Claude top-level fields > prompt_tokens_details fallback
 *
 * @param standardUsage - OpenAI usage response
 * @param cacheMetrics - Additional cache metrics from the API response
 * @returns Extended usage with cache information
 */
function extendUsageWithCacheMetrics(
  standardUsage: CompletionUsage,
  cacheMetrics?: Partial<ClaudeUsage>
): ClaudeUsage;

/**
 * Validates cache usage structure
 * @param usage - Usage object to validate
 * @returns True if usage structure is valid
 */
function isValidClaudeUsage(usage: unknown): usage is ClaudeUsage;
```

## Integration Points

### AIService Extension

```typescript
/**
 * Extended CallAgentResult with cache-aware usage
 */
interface CacheAwareCallAgentResult extends CallAgentResult {
  usage?: ClaudeUsage;
}

/**
 * Cache control integration point in callAgent function
 */
interface CacheControlIntegration {
  /** Point where cache control is applied to messages */
  applyToMessages(
    messages: ChatCompletionMessageParam[],
    modelName: string,
    tools?: ChatCompletionFunctionTool[]
  ): ChatCompletionMessageParam[];
  
  /** Point where usage is extended with cache metrics */
  extendUsage(
    standardUsage: CompletionUsage,
    responseHeaders?: Record<string, string>
  ): ClaudeUsage;
}
```

### Configuration Contract

```typescript
/**
 * Default cache control configuration
 */
const DEFAULT_CACHE_CONTROL_CONFIG: CacheControlConfig = {
  cacheSystemMessage: true,
  cacheLastTool: true,
};

/**
 * Cache control feature flags
 */
interface CacheControlFeatureFlags {
  /** Enable cache control for Claude models */
  enableCacheControl: boolean;
  /** Enable detailed cache metrics logging */
  enableCacheMetrics: boolean;
  /** Enable cache hit rate tracking */
  enableCacheTracking: boolean;
}
```

## Error Handling Contract

### Cache Control Errors

```typescript
/**
 * Cache control specific error types
 */
type CacheControlError = 
  | 'INVALID_CACHE_TYPE'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'CACHE_TRANSFORMATION_FAILED'
  | 'INVALID_USAGE_METRICS';

/**
 * Error handling for cache control operations
 */
interface CacheControlErrorHandler {
  handleTransformationError(error: Error, context: string): void;
  handleUsageExtensionError(error: Error, usage: unknown): void;
  validateCacheControl(control: unknown): control is CacheControl;
}
```

## Backward Compatibility Contract

### Compatibility Guarantees

```typescript
/**
 * Ensures backward compatibility with existing code
 */
interface BackwardCompatibilityContract {
  /** Non-Claude models remain unchanged */
  preserveNonClaudeModels(
    messages: ChatCompletionMessageParam[],
    modelName: string
  ): ChatCompletionMessageParam[];
  
  /** Existing usage tracking consumers unaffected */
  maintainUsageCompatibility(usage: ClaudeUsage): CompletionUsage;
  
  /** String content transformation is reversible */
  isReversibleTransformation(
    original: string,
    transformed: ClaudeChatCompletionContentPartText[]
  ): boolean;
}
```

## Performance Contract

### Performance Guarantees

```typescript
/**
 * Performance expectations for cache control operations
 */
interface CacheControlPerformanceContract {
  /** Maximum acceptable latency increase */
  maxLatencyIncrease: 50; // milliseconds
  
  /** Memory overhead limits */
  maxMemoryOverhead: 25; // percent increase
  
  /** Cache hit rate expectations */
  expectedCacheHitRate: {
    systemMessages: 0.7; // 70%
    toolDefinitions: 0.6; // 60%
  };
}
```
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
 * Extended usage metrics including Claude cache information
 */
interface ClaudeUsage extends CompletionUsage {
  // Standard OpenAI fields
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  
  // Claude cache extensions
  /** Tokens read from existing cache (cost savings) */
  cache_read_input_tokens?: number;
  
  /** Tokens used to create new cache entries */
  cache_creation_input_tokens?: number;
  
  /** Detailed breakdown of cache creation */
  cache_creation?: {
    /** Tokens cached for 5 minutes */
    ephemeral_5m_input_tokens: number;
    /** Tokens cached for 1 hour */
    ephemeral_1h_input_tokens: number;
  };
}
```

## Utility Functions Contract

### Model Detection

```typescript
/**
 * Determines if model supports cache control
 * @param modelName - Model identifier
 * @returns True if model name contains 'claude' (case-insensitive)
 */
function isClaudeModel(modelName: string): boolean;
```

### Cache Control Application

```typescript
/**
 * Configuration for cache control application
 */
interface CacheControlConfig {
  /** Whether to apply cache control to system messages */
  cacheSystemMessage: boolean;
  /** Number of recent user messages to cache */
  cacheUserMessageCount: number;
  /** Whether to cache the last tool definition */
  cacheLastTool: boolean;
}

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
 * Transforms messages for Claude cache control
 * @param messages - Original OpenAI message array
 * @param modelName - Model name for cache detection
 * @param config - Cache control configuration
 * @returns Messages with cache control markers applied
 */
function transformMessagesForClaudeCache(
  messages: ChatCompletionMessageParam[],
  modelName: string,
  config: CacheControlConfig
): ChatCompletionMessageParam[];
```

### Usage Tracking Extension

```typescript
/**
 * Extends standard usage with cache metrics
 * @param standardUsage - OpenAI usage response
 * @param cacheMetrics - Additional cache metrics from Claude
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
  cacheUserMessageCount: 2,
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
    userMessages: 0.4;   // 40%
    toolDefinitions: 0.6; // 60%
  };
}
```
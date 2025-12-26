/**
 * TypeScript Interface Definitions for Claude Cache Control
 * 
 * This file contains the core type definitions that will be implemented
 * in the agent-sdk package for Claude cache control functionality.
 */

import type { 
  ChatCompletionMessageParam, 
  ChatCompletionContentPart,
  ChatCompletionContentPartText,
  ChatCompletionContentPartImage,
  ChatCompletionFunctionTool,
  CompletionUsage 
} from 'openai/resources';

// ============================================================================
// Core Cache Control Types
// ============================================================================

/**
 * Cache control directive for Claude models
 * Only ephemeral caching is currently supported
 */
export interface CacheControl {
  /** Cache type - only 'ephemeral' is supported by Claude API */
  type: "ephemeral";
}

// ============================================================================
// Extended OpenAI Types for Claude Cache Support
// ============================================================================

/**
 * Extended text content part with optional cache control
 * Maintains compatibility with standard ChatCompletionContentPartText
 */
export interface ClaudeChatCompletionContentPartText extends ChatCompletionContentPartText {
  type: "text";
  text: string;
  /** Optional cache control directive for Claude models */
  cache_control?: CacheControl;
}

/**
 * Extended tool definition with optional cache control
 * Maintains compatibility with standard ChatCompletionFunctionTool
 */
export interface ClaudeChatCompletionFunctionTool extends ChatCompletionFunctionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: object;
  };
  /** Optional cache control directive for tool definitions */
  cache_control?: CacheControl;
}

/**
 * Message content type supporting Claude cache control
 * Allows both string and structured content formats
 */
export type ClaudeMessageContent = string | Array<
  ClaudeChatCompletionContentPartText | 
  ChatCompletionContentPartImage
>;

// ============================================================================
// Enhanced Usage Tracking Types
// ============================================================================

/**
 * Extended usage metrics including Claude cache information
 * Backward compatible with standard OpenAI CompletionUsage
 */
export interface ClaudeUsage extends CompletionUsage {
  // Standard OpenAI usage fields (inherited)
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  
  // Claude-specific cache extensions
  /** 
   * Number of tokens read from existing cache
   * Indicates cost savings from cache hits
   */
  cache_read_input_tokens?: number;
  
  /** 
   * Number of tokens used to create new cache entries
   * Investment in future cache hits
   */
  cache_creation_input_tokens?: number;
  
  /** 
   * Detailed breakdown of cache creation by duration
   */
  cache_creation?: {
    /** Tokens cached for 5 minute duration */
    ephemeral_5m_input_tokens: number;
    /** Tokens cached for 1 hour duration */
    ephemeral_1h_input_tokens: number;
  };
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration options for cache control application
 */
export interface CacheControlConfig {
  /** Whether to apply cache control to system messages */
  cacheSystemMessage: boolean;
  /** Number of recent user messages to cache (from end of conversation) */
  cacheUserMessageCount: number;
  /** Whether to cache the last tool definition in the tools array */
  cacheLastTool: boolean;
}

/**
 * Feature flags for cache control functionality
 */
export interface CacheControlFeatureFlags {
  /** Enable/disable cache control for Claude models */
  enableCacheControl: boolean;
  /** Enable detailed cache metrics in logs */
  enableCacheMetrics: boolean;
  /** Enable cache hit rate tracking and reporting */
  enableCacheTracking: boolean;
}

/**
 * Model detection configuration
 */
export interface ModelCacheConfig {
  /** The model name to analyze */
  modelName: string;
  /** Whether this model supports cache control */
  isClaudeModel: boolean;
  /** Whether cache control should be applied for this request */
  shouldApplyCache: boolean;
}

// ============================================================================
// Utility Function Types
// ============================================================================

/**
 * Type guard for cache control validation
 */
export type CacheControlValidator = (control: unknown) => control is CacheControl;

/**
 * Type guard for Claude usage validation  
 */
export type ClaudeUsageValidator = (usage: unknown) => usage is ClaudeUsage;

/**
 * Model detection function type
 */
export type ModelDetector = (modelName: string) => boolean;

/**
 * Content transformation function type
 */
export type ContentTransformer = (
  content: string | ChatCompletionContentPart[],
  shouldCache: boolean
) => ClaudeChatCompletionContentPartText[];

/**
 * Tool transformation function type
 */
export type ToolTransformer = (
  tools: ChatCompletionFunctionTool[]
) => ClaudeChatCompletionFunctionTool[];

/**
 * Message transformation function type
 */
export type MessageTransformer = (
  messages: ChatCompletionMessageParam[],
  modelName: string,
  config: CacheControlConfig
) => ChatCompletionMessageParam[];

/**
 * Usage extension function type
 */
export type UsageExtender = (
  standardUsage: CompletionUsage,
  cacheMetrics?: Partial<ClaudeUsage>
) => ClaudeUsage;

// ============================================================================
// Error Handling Types
// ============================================================================

/**
 * Cache control specific error categories
 */
export type CacheControlErrorType = 
  | 'INVALID_CACHE_TYPE'
  | 'UNSUPPORTED_CONTENT_TYPE' 
  | 'CACHE_TRANSFORMATION_FAILED'
  | 'INVALID_USAGE_METRICS'
  | 'MODEL_DETECTION_FAILED';

/**
 * Cache control error details
 */
export interface CacheControlError extends Error {
  readonly type: CacheControlErrorType;
  readonly context?: string;
  readonly originalError?: Error;
}

// ============================================================================
// Integration Types
// ============================================================================

/**
 * Extended CallAgentResult with cache-aware usage tracking
 */
export interface CacheAwareCallAgentResult {
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  /** Enhanced usage with cache metrics */
  usage?: ClaudeUsage;
  finish_reason?: "stop" | "length" | "tool_calls" | "content_filter" | "function_call" | null;
  response_headers?: Record<string, string>;
  additionalFields?: Record<string, unknown>;
}

/**
 * Cache control integration service interface
 */
export interface CacheControlIntegration {
  /** Apply cache control to messages before API call */
  applyToMessages(
    messages: ChatCompletionMessageParam[],
    modelName: string,
    tools?: ChatCompletionFunctionTool[]
  ): ChatCompletionMessageParam[];
  
  /** Extend usage response with cache metrics */
  extendUsage(
    standardUsage: CompletionUsage,
    responseHeaders?: Record<string, string>
  ): ClaudeUsage;
  
  /** Validate cache control configuration */
  validateConfig(config: CacheControlConfig): boolean;
  
  /** Get default configuration */
  getDefaultConfig(): CacheControlConfig;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default cache control configuration
 */
export const DEFAULT_CACHE_CONTROL_CONFIG: CacheControlConfig = {
  cacheSystemMessage: true,
  cacheUserMessageCount: 2,
  cacheLastTool: true,
} as const;

/**
 * Cache control performance thresholds
 */
export const CACHE_CONTROL_PERFORMANCE = {
  /** Maximum acceptable latency increase in milliseconds */
  MAX_LATENCY_INCREASE_MS: 50,
  /** Maximum memory overhead as percentage */
  MAX_MEMORY_OVERHEAD_PERCENT: 25,
  /** Expected cache hit rates by content type */
  EXPECTED_CACHE_HIT_RATES: {
    systemMessages: 0.7,    // 70%
    userMessages: 0.4,      // 40% 
    toolDefinitions: 0.6,   // 60%
  },
} as const;
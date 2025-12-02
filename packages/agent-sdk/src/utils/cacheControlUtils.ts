/**
 * Cache Control Utilities for Claude Models
 *
 * This module provides utilities for adding cache_control markers to Claude models
 * to optimize token usage and reduce costs. Cache control is only applied to Claude
 * models and preserves backward compatibility with existing message formats.
 */

import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
  ChatCompletionContentPartText,
  ChatCompletionFunctionTool,
  CompletionUsage,
} from "openai/resources";

// ============================================================================
// Core Types
// ============================================================================

/**
 * Cache control directive for Claude models
 */
export interface CacheControl {
  type: "ephemeral";
}

/**
 * Extended text content part with cache control support
 */
export interface ClaudeChatCompletionContentPartText
  extends ChatCompletionContentPartText {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}

/**
 * Extended tool definition with cache control support
 */
export interface ClaudeChatCompletionFunctionTool
  extends ChatCompletionFunctionTool {
  type: "function";
  function: ChatCompletionFunctionTool["function"];
  cache_control?: CacheControl;
}

/**
 * Enhanced usage metrics including Claude cache information
 */
export interface ClaudeUsage extends CompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;

  // Claude cache extensions
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
}

/**
 * Configuration for cache control application
 */
export interface CacheControlConfig {
  cacheSystemMessage: boolean;
  cacheUserMessageCount: number;
  cacheLastTool: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default cache control configuration
 */
export const DEFAULT_CACHE_CONTROL_CONFIG: CacheControlConfig = {
  cacheSystemMessage: true,
  cacheUserMessageCount: 2,
  cacheLastTool: true,
} as const;

// ============================================================================
// Utility Functions (Basic Structure - to be implemented)
// ============================================================================

/**
 * Determines if a model supports cache control
 * @param modelName - Model identifier
 * @returns True if model name contains 'claude' (case-insensitive)
 */
export function isClaudeModel(modelName: string): boolean {
  // Handle null, undefined, and non-string inputs
  if (!modelName || typeof modelName !== "string") {
    return false;
  }

  // Handle empty strings and whitespace-only strings
  const trimmed = modelName.trim();
  if (trimmed.length === 0) {
    return false;
  }

  return trimmed.toLowerCase().includes("claude");
}

/**
 * Validates cache control structure
 * @param control - Object to validate
 * @returns True if valid cache control object
 */
export function isValidCacheControl(control: unknown): control is CacheControl {
  return (
    control !== null &&
    typeof control === "object" &&
    control !== undefined &&
    "type" in control &&
    (control as { type: unknown }).type === "ephemeral"
  );
}

/**
 * Adds cache control markers to message content
 * @param content - Original content (string or structured)
 * @param shouldCache - Whether to add cache control
 * @returns Structured content with cache control markers
 */
export function addCacheControlToContent(
  content: string | ChatCompletionContentPart[],
  shouldCache: boolean,
): ClaudeChatCompletionContentPartText[] {
  // Handle null/undefined content
  if (content == null) {
    return [];
  }

  // If shouldCache is false, return content as text parts without cache control
  if (!shouldCache) {
    if (typeof content === "string") {
      return [{ type: "text", text: content }];
    }

    // Validate array input
    if (!Array.isArray(content)) {
      console.warn(
        "Invalid content type for cache control transformation:",
        typeof content,
      );
      return [];
    }

    // Filter and convert only text parts with validation
    return content
      .filter((part): part is ChatCompletionContentPartText => {
        if (!part || typeof part !== "object") {
          return false;
        }
        return part.type === "text" && typeof part.text === "string";
      })
      .map((part) => ({ type: "text", text: part.text }));
  }

  // shouldCache is true - add cache control markers
  if (typeof content === "string") {
    // Transform string content to structured array with cache control
    return [
      {
        type: "text",
        text: content,
        cache_control: { type: "ephemeral" },
      },
    ];
  }

  // Validate array input
  if (!Array.isArray(content)) {
    console.warn(
      "Invalid content type for cache control transformation:",
      typeof content,
    );
    return [];
  }

  // Handle structured content - preserve existing structure, add cache control to text parts
  return content
    .filter((part): part is ChatCompletionContentPartText => {
      if (!part || typeof part !== "object") {
        return false;
      }
      return part.type === "text" && typeof part.text === "string";
    })
    .map((part) => ({
      type: "text",
      text: part.text,
      cache_control: { type: "ephemeral" },
    }));
}

/**
 * Adds cache control to the last tool in tools array
 * @param tools - Array of tool definitions
 * @returns Tools array with cache control on last tool
 */
export function addCacheControlToLastTool(
  tools: ChatCompletionFunctionTool[],
): ClaudeChatCompletionFunctionTool[] {
  // Handle null, undefined, or empty arrays
  if (!tools || !Array.isArray(tools) || tools.length === 0) {
    return [];
  }

  // Validate tools structure
  const validTools = tools.filter((tool) => {
    if (!tool || typeof tool !== "object") {
      console.warn("Invalid tool structure detected, skipping:", tool);
      return false;
    }
    if (tool.type !== "function" || !tool.function) {
      console.warn(
        "Tool is not a function type or missing function property:",
        tool,
      );
      return false;
    }
    return true;
  });

  if (validTools.length === 0) {
    console.warn("No valid tools found for cache control");
    return [];
  }

  // Create a copy of the valid tools array
  const result = validTools.map((tool) => ({
    ...tool,
  })) as ClaudeChatCompletionFunctionTool[];

  // Add cache control to the last tool only
  const lastIndex = result.length - 1;
  result[lastIndex] = {
    ...result[lastIndex],
    cache_control: { type: "ephemeral" },
  };

  return result;
}

/**
 * Transforms messages for Claude cache control
 * @param messages - Original OpenAI message array
 * @param modelName - Model name for cache detection
 * @param config - Cache control configuration
 * @returns Messages with cache control markers applied
 */
export function transformMessagesForClaudeCache(
  messages: ChatCompletionMessageParam[],
  modelName: string,
  config: CacheControlConfig = DEFAULT_CACHE_CONTROL_CONFIG,
): ChatCompletionMessageParam[] {
  // Validate inputs
  if (!messages || !Array.isArray(messages)) {
    console.warn(
      "Invalid messages array provided to transformMessagesForClaudeCache",
    );
    return [];
  }

  if (messages.length === 0) {
    return [];
  }

  // Only apply cache control for Claude models
  if (!isClaudeModel(modelName)) {
    return messages;
  }

  // Validate config
  if (!config || typeof config !== "object") {
    console.warn("Invalid cache control config, using defaults");
    config = DEFAULT_CACHE_CONTROL_CONFIG;
  }

  const result = messages.map((message, index) => {
    // Validate message structure
    if (!message || typeof message !== "object" || !message.role) {
      console.warn("Invalid message structure at index", index, ":", message);
      return message; // Return as-is to avoid breaking the flow
    }

    // System message: cache if enabled in config
    if (message.role === "system" && config.cacheSystemMessage) {
      return {
        ...message,
        content: addCacheControlToContent(message.content, true),
      };
    }

    // User messages: cache last N messages based on config
    if (message.role === "user" && config.cacheUserMessageCount > 0) {
      const userMessageIndices: number[] = [];
      messages.forEach((msg, idx) => {
        if (msg.role === "user") {
          userMessageIndices.push(idx);
        }
      });

      // Check if this user message is among the last N
      const isRecentUser = userMessageIndices
        .slice(-config.cacheUserMessageCount)
        .includes(index);

      if (isRecentUser) {
        return {
          ...message,
          content: addCacheControlToContent(message.content, true),
        };
      }
    }

    // Return message unchanged
    return message;
  });

  return result;
}

/**
 * Extends standard usage with cache metrics
 * @param standardUsage - OpenAI usage response
 * @param cacheMetrics - Additional cache metrics from Claude
 * @returns Extended usage with cache information
 */
export function extendUsageWithCacheMetrics(
  standardUsage: CompletionUsage,
  cacheMetrics?: Partial<ClaudeUsage>,
): ClaudeUsage {
  const baseUsage: ClaudeUsage = {
    prompt_tokens: standardUsage.prompt_tokens,
    completion_tokens: standardUsage.completion_tokens,
    total_tokens: standardUsage.total_tokens,
  };

  // Add cache metrics if provided
  if (cacheMetrics) {
    if (typeof cacheMetrics.cache_read_input_tokens === "number") {
      baseUsage.cache_read_input_tokens = cacheMetrics.cache_read_input_tokens;
    }

    if (typeof cacheMetrics.cache_creation_input_tokens === "number") {
      baseUsage.cache_creation_input_tokens =
        cacheMetrics.cache_creation_input_tokens;
    }

    if (
      cacheMetrics.cache_creation &&
      typeof cacheMetrics.cache_creation.ephemeral_5m_input_tokens ===
        "number" &&
      typeof cacheMetrics.cache_creation.ephemeral_1h_input_tokens === "number"
    ) {
      baseUsage.cache_creation = {
        ephemeral_5m_input_tokens:
          cacheMetrics.cache_creation.ephemeral_5m_input_tokens,
        ephemeral_1h_input_tokens:
          cacheMetrics.cache_creation.ephemeral_1h_input_tokens,
      };
    }
  }

  return baseUsage;
}

/**
 * Validates Claude usage structure
 * @param usage - Usage object to validate
 * @returns True if usage structure is valid
 */
export function isValidClaudeUsage(usage: unknown): usage is ClaudeUsage {
  if (!usage || typeof usage !== "object") {
    return false;
  }

  const usageObj = usage as Record<string, unknown>;

  // Check required standard fields
  const hasStandardFields =
    typeof usageObj.prompt_tokens === "number" &&
    typeof usageObj.completion_tokens === "number" &&
    typeof usageObj.total_tokens === "number";

  if (!hasStandardFields) {
    return false;
  }

  // Check optional cache fields
  const hasCacheFields =
    (usageObj.cache_read_input_tokens === undefined ||
      typeof usageObj.cache_read_input_tokens === "number") &&
    (usageObj.cache_creation_input_tokens === undefined ||
      typeof usageObj.cache_creation_input_tokens === "number");

  if (!hasCacheFields) {
    return false;
  }

  // Check cache_creation object if present
  if (usageObj.cache_creation !== undefined) {
    const cacheCreation = usageObj.cache_creation as Record<string, unknown>;
    if (
      typeof cacheCreation !== "object" ||
      typeof cacheCreation.ephemeral_5m_input_tokens !== "number" ||
      typeof cacheCreation.ephemeral_1h_input_tokens !== "number"
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Adds cache control to the last N user messages in a conversation
 * This optimizes multi-turn conversations by caching recent user context
 *
 * @param messages - Array of chat completion messages
 * @param maxUserMessagesToCache - Maximum number of recent user messages to cache (default: 2)
 * @returns Modified messages array with cache control on recent user messages
 */
export function addCacheControlToRecentUserMessages(
  messages: ChatCompletionMessageParam[],
  maxUserMessagesToCache: number = 2,
): ChatCompletionMessageParam[] {
  // Validate inputs
  if (!messages || !Array.isArray(messages)) {
    console.warn(
      "Invalid messages array provided to addCacheControlToRecentUserMessages",
    );
    return [];
  }

  if (messages.length === 0 || maxUserMessagesToCache <= 0) {
    return messages;
  }

  // Validate maxUserMessagesToCache is a reasonable number
  if (maxUserMessagesToCache > 100) {
    console.warn(
      "maxUserMessagesToCache is unusually high:",
      maxUserMessagesToCache,
      "limiting to 100",
    );
    maxUserMessagesToCache = 100;
  }

  // Find all user message indices in reverse order (most recent first)
  const userMessageIndices: number[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    // Validate message structure
    if (!message || typeof message !== "object" || !message.role) {
      console.warn("Invalid message at index", i, ", skipping");
      continue;
    }

    if (message.role === "user") {
      userMessageIndices.push(i);
      if (userMessageIndices.length >= maxUserMessagesToCache) {
        break;
      }
    }
  }

  // If no user messages found, return unchanged
  if (userMessageIndices.length === 0) {
    return messages;
  }

  // Create a copy of messages and modify the identified user messages
  const modifiedMessages = [...messages];

  for (const index of userMessageIndices) {
    const message = modifiedMessages[index];
    if (message.role === "user" && message.content != null) {
      try {
        modifiedMessages[index] = {
          ...message,
          content: addCacheControlToContent(message.content, true),
        };
      } catch (error) {
        console.warn(
          "Failed to add cache control to user message at index",
          index,
          ":",
          error,
        );
        // Continue with original message if transformation fails
      }
    }
  }

  return modifiedMessages;
}

/**
 * Helper function to identify user message indices that should be cached
 * Used for testing and validation purposes
 *
 * @param messages - Array of chat completion messages
 * @param maxUserMessagesToCache - Maximum number of recent user messages to identify
 * @returns Array of indices for user messages that should be cached
 */
export function findRecentUserMessageIndices(
  messages: ChatCompletionMessageParam[],
  maxUserMessagesToCache: number = 2,
): number[] {
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    maxUserMessagesToCache <= 0
  ) {
    return [];
  }

  const userMessageIndices: number[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userMessageIndices.push(i);
      if (userMessageIndices.length >= maxUserMessagesToCache) {
        break;
      }
    }
  }

  // Return indices in original order (not reversed)
  return userMessageIndices.reverse();
}

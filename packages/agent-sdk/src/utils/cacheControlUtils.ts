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
  ChatCompletionMessageToolCall,
  CompletionUsage,
} from "openai/resources";
import { logger } from "./globalLogger.js";

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

// ============================================================================
// Default Configuration
// ============================================================================

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
 * Adds cache control to the last tool call in an array
 * @param toolCalls - Array of tool calls
 * @returns Tool calls array with cache control on the last tool call
 */
function addCacheControlToLastToolCall(
  toolCalls: ChatCompletionMessageToolCall[],
): ChatCompletionMessageToolCall[] {
  if (!toolCalls || toolCalls.length === 0) {
    return toolCalls;
  }

  const result = [...toolCalls];
  const lastIndex = result.length - 1;

  // Add cache control to the last tool call
  result[lastIndex] = {
    ...result[lastIndex],
    cache_control: { type: "ephemeral" },
  } as ChatCompletionMessageToolCall & { cache_control: CacheControl };

  return result;
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
      logger.warn(
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
    logger.warn(
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
      logger.warn("Invalid tool structure detected, skipping:", tool);
      return false;
    }
    if (tool.type !== "function" || !tool.function) {
      logger.warn(
        "Tool is not a function type or missing function property:",
        tool,
      );
      return false;
    }
    return true;
  });

  if (validTools.length === 0) {
    logger.warn("No valid tools found for cache control");
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
 * Finds the latest message index at 20-message intervals (sliding window approach)
 * @param messages - Array of chat completion messages
 * @returns Index of the latest interval message (20th, 40th, 60th, etc.) or -1 if none
 */
export function findIntervalMessageIndex(
  messages: ChatCompletionMessageParam[],
): number {
  if (!Array.isArray(messages) || messages.length === 0) {
    return -1;
  }

  const interval = 20; // Hardcoded interval
  const messageCount = messages.length;

  // Find the largest interval that fits within the message count
  // Math.floor(messageCount / interval) gives us how many complete intervals we have
  // Multiply by interval to get the position of the latest interval message
  const latestIntervalPosition = Math.floor(messageCount / interval) * interval;

  // If no complete intervals exist, return -1
  if (latestIntervalPosition === 0) {
    return -1;
  }

  // Convert from 1-based position to 0-based index
  return latestIntervalPosition - 1;
}

/**
 * Transforms messages for Claude cache control with hardcoded strategy
 * @param messages - Original OpenAI message array
 * @param modelName - Model name for cache detection
 * @returns Messages with cache control markers applied
 */
export function transformMessagesForClaudeCache(
  messages: ChatCompletionMessageParam[],
  modelName: string,
): ChatCompletionMessageParam[] {
  // Validate inputs
  if (!messages || !Array.isArray(messages)) {
    logger.warn(
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

  // Find the latest interval message index (20th, 40th, 60th, etc.)
  const intervalMessageIndex = findIntervalMessageIndex(messages);

  // Find last system message index
  let lastSystemIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "system") {
      lastSystemIndex = i;
      break;
    }
  }

  const result = messages.map((message, index) => {
    // Validate message structure
    if (!message || typeof message !== "object" || !message.role) {
      logger.warn("Invalid message structure at index", index, ":", message);
      return message; // Return as-is to avoid breaking the flow
    }

    // Last system message: always cached (hardcoded)
    if (message.role === "system" && index === lastSystemIndex) {
      return {
        ...message,
        content: addCacheControlToContent(
          (message.content as string | ChatCompletionContentPart[]) || "",
          true,
        ),
      } as ChatCompletionMessageParam;
    }

    // Interval-based message caching: cache message at latest interval position (sliding window)
    if (index === intervalMessageIndex) {
      // If the message is a tool role, add cache control directly to the message
      if (message.role === "tool") {
        return {
          ...message,
          cache_control: { type: "ephemeral" },
        } as ChatCompletionMessageParam;
      }
      // If the message has tool calls, cache the last tool call instead of content
      else if (
        message.role === "assistant" &&
        message.tool_calls &&
        message.tool_calls.length > 0
      ) {
        return {
          ...message,
          tool_calls: addCacheControlToLastToolCall(message.tool_calls),
        } as ChatCompletionMessageParam;
      } else {
        // For other message types without tool calls, cache the content
        return {
          ...message,
          content: addCacheControlToContent(
            (message.content as string | ChatCompletionContentPart[]) || "",
            true,
          ),
        } as ChatCompletionMessageParam;
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

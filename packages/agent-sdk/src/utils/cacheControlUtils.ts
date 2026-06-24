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
 * Extended prompt_tokens_details with cache_creation_input_tokens
 * Some models (e.g. Gemini, DeepSeek) return this field inside prompt_tokens_details
 */
export interface ExtendedPromptTokensDetails
  extends CompletionUsage.PromptTokensDetails {
  cache_creation_input_tokens?: number;
}

/**
 * Enhanced usage metrics including cache information
 * Supports both Claude-specific top-level fields and OpenAI-standard prompt_tokens_details
 */
export interface ClaudeUsage extends CompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;

  // Cache extensions (from Claude top-level or OpenAI prompt_tokens_details)
  cache_read_input_tokens?: number; // Claude: cache_read_input_tokens / OpenAI: prompt_tokens_details.cached_tokens
  cache_creation_input_tokens?: number; // Claude: cache_creation_input_tokens / OpenAI: prompt_tokens_details.cache_creation_input_tokens
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };

  // Override prompt_tokens_details to include cache_creation_input_tokens
  prompt_tokens_details?: ExtendedPromptTokensDetails;
}

// ============================================================================
// Default Configuration
// ============================================================================

// ============================================================================
// Utility Functions (Basic Structure - to be implemented)
// ============================================================================

/**
 * Determines if a model supports prompt caching
 * @param modelName - Model identifier
 * @returns True if model name matches the cache pattern (default: contains 'claude')
 */
export function supportsPromptCaching(modelName: string): boolean {
  // Handle null, undefined, and non-string inputs
  if (!modelName || typeof modelName !== "string") {
    return false;
  }

  // Handle empty strings and whitespace-only strings
  const trimmed = modelName.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const cachePattern = process.env.WAVE_PROMPT_CACHE_REGEX || "claude";
  try {
    const regex = new RegExp(cachePattern, "i");
    return regex.test(trimmed);
  } catch {
    // If regex is invalid, fall back to simple includes check with default
    return trimmed.toLowerCase().includes("claude");
  }
}

/**
 * Determines if a model supports cache control
 * @param modelName - Model identifier
 * @returns True if model name contains 'claude' (case-insensitive)
 * @deprecated Use supportsPromptCaching instead
 */
export const isClaudeModel = supportsPromptCaching;

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

  // Handle structured content - preserve all parts, add cache control to last text part only
  let lastTextIndex = -1;
  for (let i = content.length - 1; i >= 0; i--) {
    const part = content[i];
    if (
      part &&
      typeof part === "object" &&
      part.type === "text" &&
      typeof (part as ChatCompletionContentPartText).text === "string"
    ) {
      lastTextIndex = i;
      break;
    }
  }

  return content.map((part, index) => {
    if (
      index === lastTextIndex &&
      part &&
      typeof part === "object" &&
      part.type === "text" &&
      typeof (part as ChatCompletionContentPartText).text === "string"
    ) {
      return {
        ...(part as ChatCompletionContentPartText),
        cache_control: { type: "ephemeral" },
      };
    }
    return part;
  }) as ClaudeChatCompletionContentPartText[];
}

/**
 * Counts the total number of content blocks across all messages.
 * Each element in a message's content array counts as one block.
 * String content counts as one block. Null/undefined content counts as zero
 * (e.g. assistant messages with only tool_calls).
 * @param messages - Array of chat messages
 * @returns Total content block count
 */
export function countContentBlocks(
  messages: ChatCompletionMessageParam[],
): number {
  let count = 0;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const content = message.content;
    if (typeof content === "string") {
      count += 1;
    } else if (Array.isArray(content)) {
      count += content.length;
    }
  }
  return count;
}

/**
 * Transforms messages for explicit cache control.
 *
 * Cache breakpoints (following Claude Code's "last message marker" strategy):
 * 1. System message — always marked (stable prefix)
 * 2. Last message — the last user/assistant message with content is marked.
 *    The API scans backward from this marker within 20 blocks. Since each
 *    turn adds ~2 blocks (< 20), the previous request's marker position
 *    always falls within the scan window, ensuring cache hits.
 *
 * Tools are marked separately via addCacheControlToLastTool (called by aiService).
 *
 * @param messages - Original OpenAI message array
 * @param modelName - Model name for cache detection
 * @returns Messages with cache control markers applied
 */
export function transformMessagesForExplicitCache(
  messages: ChatCompletionMessageParam[],
  modelName: string,
): ChatCompletionMessageParam[] {
  // Validate inputs
  if (!messages || !Array.isArray(messages)) {
    logger.warn(
      "Invalid messages array provided to transformMessagesForExplicitCache",
    );
    return [];
  }

  if (messages.length === 0) {
    return [];
  }

  // Only apply cache control for models that support prompt caching
  if (!supportsPromptCaching(modelName)) {
    return messages;
  }

  // Find first system message index
  const firstSystemIndex = messages.findIndex((m) => m.role === "system");

  // Determine which message indices should receive cache_control markers
  const cacheIndices = new Set<number>();

  // Marker 1: First system message (always — stable prefix)
  if (firstSystemIndex !== -1) {
    cacheIndices.add(firstSystemIndex);
  }

  // Marker 2: Last message with content (user or assistant).
  // This marker moves each turn (~2 blocks), but since the move is < 20 blocks,
  // the previous marker position is always within the API's 20-block scan window.
  // This ensures the entire conversation prefix is cached.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;
    if (i === firstSystemIndex) continue;
    if (msg.role !== "user" && msg.role !== "assistant") continue;

    const content = msg.content;
    const hasContent =
      (typeof content === "string" && content.length > 0) ||
      (Array.isArray(content) && content.length > 0);

    if (hasContent) {
      cacheIndices.add(i);
      break;
    }
  }

  // Apply cache_control markers to selected messages
  const result = messages.map((message, index) => {
    // Validate message structure
    if (!message || typeof message !== "object" || !message.role) {
      logger.warn("Invalid message structure at index", index, ":", message);
      return message;
    }

    if (!cacheIndices.has(index)) {
      return message;
    }

    const content =
      (message.content as string | ChatCompletionContentPart[]) || "";

    // Idempotency: skip if content already has cache_control (system message)
    if (message.role === "system" && Array.isArray(content)) {
      const hasCacheControl = content.some(
        (part) =>
          part.type === "text" &&
          (part as ClaudeChatCompletionContentPartText).cache_control,
      );
      if (hasCacheControl) {
        return message;
      }
    }

    const transformedContent = addCacheControlToContent(content, true);

    return {
      ...message,
      content: transformedContent,
    } as ChatCompletionMessageParam;
  });

  return result;
}

/**
 * Extends standard usage with cache metrics
 * Extracts cache tokens from both Claude-specific top-level fields and
 * OpenAI-standard prompt_tokens_details (used by Gemini, DeepSeek, etc.)
 * @param standardUsage - OpenAI usage response
 * @param cacheMetrics - Additional cache metrics from the API response
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

  if (!cacheMetrics) {
    return baseUsage;
  }

  // Extract cache_read_input_tokens from Claude top-level field
  if (typeof cacheMetrics.cache_read_input_tokens === "number") {
    baseUsage.cache_read_input_tokens = cacheMetrics.cache_read_input_tokens;
  }
  // Fallback to prompt_tokens_details.cached_tokens (OpenAI standard)
  else if (cacheMetrics.prompt_tokens_details?.cached_tokens != null) {
    baseUsage.cache_read_input_tokens =
      cacheMetrics.prompt_tokens_details.cached_tokens;
  }

  // Extract cache_creation_input_tokens from Claude top-level field
  if (typeof cacheMetrics.cache_creation_input_tokens === "number") {
    baseUsage.cache_creation_input_tokens =
      cacheMetrics.cache_creation_input_tokens;
  }
  // Fallback to prompt_tokens_details.cache_creation_input_tokens
  else if (
    cacheMetrics.prompt_tokens_details?.cache_creation_input_tokens != null
  ) {
    baseUsage.cache_creation_input_tokens =
      cacheMetrics.prompt_tokens_details.cache_creation_input_tokens;
  }

  // Extract cache_creation breakdown (Claude-specific)
  if (
    cacheMetrics.cache_creation &&
    typeof cacheMetrics.cache_creation.ephemeral_5m_input_tokens === "number" &&
    typeof cacheMetrics.cache_creation.ephemeral_1h_input_tokens === "number"
  ) {
    baseUsage.cache_creation = {
      ephemeral_5m_input_tokens:
        cacheMetrics.cache_creation.ephemeral_5m_input_tokens,
      ephemeral_1h_input_tokens:
        cacheMetrics.cache_creation.ephemeral_1h_input_tokens,
    };
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

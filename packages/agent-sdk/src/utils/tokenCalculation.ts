import type { Usage } from "../types/index.js";

/**
 * Calculate comprehensive total tokens including cache-related tokens
 *
 * This function computes the true total token cost by including:
 * - Base total_tokens (prompt + completion)
 * - Cache read tokens (cost savings indicator)
 * - Cache creation tokens (cache investment)
 *
 * For accurate cost tracking with Claude models that support cache control.
 *
 * @param usage - Usage statistics from AI operation
 * @returns Comprehensive total including all cache-related tokens
 */
export function calculateComprehensiveTotalTokens(usage: Usage): number {
  const baseTokens = usage.total_tokens;
  const cacheReadTokens = usage.cache_read_input_tokens || 0;
  const cacheCreateTokens = usage.cache_creation_input_tokens || 0;

  return baseTokens + cacheReadTokens + cacheCreateTokens;
}

/**
 * Extract the latest total tokens from the last message with usage data
 * Uses comprehensive calculation that includes cache tokens for accurate tracking
 *
 * @param messages - Array of messages to search
 * @returns Comprehensive total tokens from the most recent usage data, or 0 if none found
 */
export function extractLatestTotalTokens(
  messages: Array<{ usage?: Usage }>,
): number {
  // Find the last message with usage data (iterate backwards for efficiency)
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.usage) {
      return calculateComprehensiveTotalTokens(message.usage);
    }
  }

  return 0; // No usage data found
}

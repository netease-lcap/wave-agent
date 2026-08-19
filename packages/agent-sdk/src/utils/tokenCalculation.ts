import type { Message, Usage } from "../types/index.js";
import { estimateTokens } from "./tokenEstimate.js";

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

/**
 * Estimate the full context size of a message list for pre-request
 * auto-compaction checks (aligned with Claude Code's tokenCountWithEstimation).
 *
 * Anchors on the most recent message carrying real usage (the last API
 * response): that response's total_tokens (OpenAI-compatible semantics —
 * already includes cache hits) plus a rough character-based estimate for
 * every message added after it. Falls back to a pure character estimate
 * when no usage anchor exists yet (e.g. the first request of a session).
 */
export function estimateContextTokens(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = messages[i].usage;
    if (usage) {
      return (
        usage.total_tokens + roughTokenCountForMessages(messages.slice(i + 1))
      );
    }
  }
  return roughTokenCountForMessages(messages);
}

/**
 * Rough per-message token estimate over all message blocks.
 * Used to estimate the messages added since the last usage-bearing response.
 * Image blocks are ignored (images are stripped before compaction) and file
 * history snapshots live on disk, so their content is not in the context.
 */
export function roughTokenCountForMessages(messages: Message[]): number {
  let total = 0;
  for (const message of messages) {
    for (const block of message.blocks) {
      switch (block.type) {
        case "text":
        case "reasoning":
        case "error":
        case "compact":
          total += estimateTokens(block.content);
          break;
        case "tool":
          if (block.parameters) {
            total += estimateTokens(block.parameters, "json");
          }
          if (block.result) {
            total += estimateTokens(block.result);
          }
          break;
        case "bang":
          if (block.command) {
            total += estimateTokens(block.command);
          }
          if (block.output) {
            total += estimateTokens(block.output);
          }
          break;
        case "task_notification":
          total += estimateTokens(block.summary);
          break;
        case "image":
        case "file_history":
          break;
      }
    }
  }
  return total;
}

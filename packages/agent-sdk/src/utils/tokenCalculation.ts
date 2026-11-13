import type { Message, Usage } from "../types/index.js";
import { estimateTokens } from "./tokenEstimate.js";

/**
 * Extract the latest total tokens from the last message with usage data.
 * Uses only `total_tokens` — OpenAI-compatible usage already includes cache
 * hits there, so adding cache fields would double-count (same semantics as
 * the auto-compaction threshold; keeps UI usage display aligned with it).
 *
 * @param messages - Array of messages to search
 * @returns Total tokens from the most recent usage data, or 0 if none found
 */
export function extractLatestTotalTokens(
  messages: Array<{ usage?: Usage }>,
): number {
  // Find the last message with usage data (iterate backwards for efficiency)
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.usage) {
      return message.usage.total_tokens;
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
 * every message added after it. The usage already covers the system prompt,
 * tool schema and injected dynamic context, so those must never be added
 * again as a fixed request overhead — doing so counts the same tokens twice
 * and triggers compaction well before the usage indicator reaches 100%.
 * Falls back to a pure character estimate when no usage anchor exists yet
 * (e.g. the first request of a session).
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
/** Maximum summary output reservation used by Claude Code's auto-compaction. */
export const COMPACTION_SUMMARY_MAX_OUTPUT_TOKENS = 20_000;

/** Safety buffer between the effective context window and auto-compaction. */
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;

/**
 * Calculate the context budget at which automatic compaction should start.
 * The context window is shared by a request's input and output, so the
 * summary output reservation is subtracted from it first; the ordinary
 * request output limit is the upper bound for that reservation, matching
 * Claude Code's effective-window semantics.
 */
export function getAutoCompactThreshold(
  contextWindow: number,
  maxOutputTokens: number,
): number {
  return Math.max(
    0,
    contextWindow -
      Math.min(maxOutputTokens, COMPACTION_SUMMARY_MAX_OUTPUT_TOKENS) -
      AUTOCOMPACT_BUFFER_TOKENS,
  );
}

/**
 * 上下文用量百分比：分母是**自动压缩阈值**，不是裸的上下文窗口。
 *
 * 与输入框旁那个用量环同一条规则（`packages/code` 的 `percentOf` 服务线上
 * 快照，另留了一份以容忍被整体 mock 的 SDK barrel）：环画到 100% 正是压缩要
 * 发生的地方，换成 `tokens / window` 会让环永远到不了头。
 */
export function contextUsagePercent(
  tokens: number,
  contextWindow: number,
  maxOutputTokens: number,
): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 0;
  const threshold = getAutoCompactThreshold(
    contextWindow,
    Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
      ? maxOutputTokens
      : 32_000,
  );
  const base = threshold > 0 ? threshold : contextWindow;
  return Math.min(100, Math.round((tokens / base) * 100));
}

export function roughTokenCountForMessages(messages: Message[]): number {
  let total = 0;
  for (const message of messages) {
    for (const block of message.blocks) {
      switch (block.type) {
        // `notice` blocks (errors included) are skipped: they are written for
        // the human and `convertMessagesForAPI` never sends them, so counting
        // them here would overstate what the next request costs.
        case "text":
        case "reasoning":
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

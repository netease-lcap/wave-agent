import type { Message, Usage } from "../types/index.js";
import { estimateTokens } from "./tokenEstimate.js";

/** 用量扫描看得见的形状：`usage` 加上足够认出压缩块的 `blocks`。 */
type UsageScanMessage = {
  usage?: Usage;
  blocks?: ReadonlyArray<{ type: string }>;
};

/**
 * 最后一条带 `compact` 块的消息的下标，也就是这份列表的压缩边界（没压过是
 * `-1`）。
 */
export function lastCompactBoundaryIndex(
  messages: ReadonlyArray<UsageScanMessage>,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].blocks?.some((block) => block.type === "compact")) {
      return i;
    }
  }
  return -1;
}

/**
 * Extract the latest total tokens from the last message with usage data.
 * Uses only `total_tokens` — OpenAI-compatible usage already includes cache
 * hits there, so adding cache fields would double-count (same semantics as
 * the auto-compaction threshold; keeps UI usage display aligned with it).
 *
 * 压缩边界及其之前一律不算：压缩是**追加**在它折掉的历史之后的，那串 usage 量的
 * 就是压缩前的上下文。压缩完还报它，正是用量环卡在 100% 不下来（会话列表也一直
 * 显示压缩前的总量）的来源 —— spec `core/message-compact.md` 场景 6 要求
 * 「压缩完成后…不能沿用压缩前百分比」。
 *
 * @param messages - Array of messages to search
 * @returns Total tokens from the most recent usage data, or 0 if none found
 */
export function extractLatestTotalTokens(
  messages: Array<UsageScanMessage>,
): number {
  // 压缩块所在的那条消息就是边界本身：它连同之前的一切都早于折叠（它自己的
  // usage 是压缩这次调用量到的数）。
  const boundary = lastCompactBoundaryIndex(messages);
  for (let i = messages.length - 1; i > boundary; i--) {
    const message = messages[i];
    if (message.usage) {
      return message.usage.total_tokens;
    }
  }

  return 0; // No usage data found after the boundary
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
 * (e.g. the first request of a session, or straight after a compaction).
 *
 * 锚点只在**最后压缩边界之后**找：压缩折表会把「压缩前那批响应」的轮次留在列表
 * 里（`[摘要, ...保留轮次]`），它们的 usage 量的是折掉的历史，拿来当锚点会让
 * 压缩后估算原样等于压缩前（真机实测 before 与 after 完全相等），于是下一次
 * 请求前检查又超阈值、再压一遍 —— spec `core/message-compact.md` 场景 6 与
 * 「压缩后估算基准」都要求以边界之后的上下文为准。
 */
export function estimateContextTokens(messages: Message[]): number {
  const boundary = lastCompactBoundaryIndex(messages);
  for (let i = messages.length - 1; i > boundary; i--) {
    const usage = messages[i].usage;
    if (usage) {
      return (
        usage.total_tokens + roughTokenCountForMessages(messages.slice(i + 1))
      );
    }
  }
  return roughTokenCountForMessages(messages.slice(boundary + 1));
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
 * 上下文**压缩压力**百分比：分母是**自动压缩阈值**，不是裸的上下文窗口，
 * 所以 100 正是压缩要发生的地方。
 *
 * 界面上的用量百分比**不**用这个（环与 `/context` 面板都以窗口为分母，同一个
 * 会话只有一个数）；CLI 那行 `N% until auto-compact` 与 `packages/code` 的 `remainingPercentOf`
 * 是这条口径的线上快照（另留一份以容忍被整体 mock 的 SDK barrel）。
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
        case "tool": {
          if (block.parameters) {
            total += estimateTokens(block.parameters, "json");
          }
          // 结果正文在 `result` 里（`data` 是剥过正文的骨架，不能拿来计数）：
          // 少算这一段会让上下文占用偏低，压缩迟迟不触发。
          const text = block.result;
          if (text) {
            total += estimateTokens(text);
          }
          break;
        }
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

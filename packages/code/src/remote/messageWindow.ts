/**
 * `getMessages` parameter validation, shared by every host that answers it.
 *
 * Two callers need this and must agree byte for byte: the daemon / stdio
 * bridge (multi-session registry) and the interactive CLI front end (one
 * session in React state). The phone's reconciliation rules — `since` is an
 * anchor, a vanished anchor means "re-pull the whole list", ids can repeat so
 * the anchor resolves to its **last** occurrence — are a property of the wire
 * contract, not of either host, so the arithmetic lives here once.
 *
 * The list itself lives in the SDK: it starts at the last compaction, and the
 * remote page takes a `limit`-sized tail of it because of the relay's frame
 * budget (a compacted session's tail is filled up to `limit` from the
 * transcript, so the cap is a message count, not a byte range). What is left
 * here is the one rule a misreading caller cannot notice on its own — a
 * malformed parameter must fail instead of silently widening into a full read.
 *
 * Described in docs/specs/remote/remote-channel.md (§5 白名单与增量拉取).
 */

import type { MessageWindow } from "wave-agent-sdk";

export type { MessageWindow, MessageWindowResult } from "wave-agent-sdk";

/** A malformed window. Hosts translate this into their own RPC error type. */
export class InvalidMessageWindowError extends Error {}

/**
 * Validate `window` and hand it on. Returns `undefined` when nothing was asked
 * for — the caller then answers with the whole list, read once.
 */
export function normalizeMessageWindow(
  window?: MessageWindow,
): MessageWindow | undefined {
  const since = window?.since;
  const before = window?.before;
  const from = window?.from;
  const rawLimit = window?.limit;
  if (rawLimit !== undefined && (!Number.isInteger(rawLimit) || rawLimit < 1)) {
    throw new InvalidMessageWindowError(
      `getMessages limit must be a positive integer, got ${String(rawLimit)}`,
    );
  }
  if (since !== undefined && before !== undefined) {
    throw new InvalidMessageWindowError(
      "getMessages takes either `since` or `before`, not both",
    );
  }
  // `from` 是第三种「这一页从哪算起」的锚点（大纲点未加载的刻度），与另外两种
  // 互斥。放行「同时传」的话，调用方以为拿到的是自己指的那一页，实际 SDK 只按
  // 其中一个分支答——页面就会「跳过去了，但落在别的轮次上」。
  if (from !== undefined && (since !== undefined || before !== undefined)) {
    throw new InvalidMessageWindowError(
      "getMessages takes either `from`, `since` or `before`, not more than one",
    );
  }
  if (
    since === undefined &&
    before === undefined &&
    from === undefined &&
    rawLimit === undefined
  ) {
    return undefined;
  }
  return {
    ...(since !== undefined ? { since } : {}),
    ...(before !== undefined ? { before } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(rawLimit !== undefined ? { limit: rawLimit } : {}),
  };
}

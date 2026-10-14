/**
 * Message-window slicing, shared by every host that answers `getMessages`.
 *
 * Two callers need this and must agree byte for byte: the daemon / stdio
 * bridge (multi-session registry) and the interactive CLI front end (one
 * session in React state). The phone's reconciliation rules — `since` is an
 * anchor, a vanished anchor means "re-pull the tail", ids can repeat so the
 * anchor resolves to its **last** occurrence — are a property of the wire
 * contract, not of either host, so the arithmetic lives here once.
 *
 * Described in docs/specs/ui/remote-control.md (§5 白名单与增量拉取).
 */

import type { Message } from "wave-agent-sdk";

export interface MessageWindow {
  /** Exclusive upper anchor: return the page ending just before this id. */
  before?: string;
  /** Exclusive lower anchor: return what arrived after this id. */
  since?: string;
  limit?: number;
}

export interface MessageWindowResult {
  messages: Message[];
  /** Older messages exist before the returned page. */
  hasMore?: boolean;
  /** The `since` anchor is gone — rebuild from the tail. */
  reset?: boolean;
  /** Total display messages held for the session. */
  total?: number;
}

/** A malformed window. Hosts translate this into their own RPC error type. */
export class InvalidMessageWindowError extends Error {}

/**
 * Slice `all` by `window`. Returns `undefined` when no window was asked for —
 * the caller then answers with the whole list, untouched.
 *
 * The validations are here rather than in either caller because silently
 * widening the read is the one failure mode a caller cannot notice: it asked
 * for a bounded page and got the thread back.
 */
export function sliceMessageWindow(
  all: Message[],
  window?: MessageWindow,
): MessageWindowResult | undefined {
  const before = window?.before;
  const since = window?.since;
  const rawLimit = window?.limit;
  if (rawLimit !== undefined && (!Number.isInteger(rawLimit) || rawLimit < 1)) {
    throw new InvalidMessageWindowError(
      `getMessages limit must be a positive integer, got ${String(rawLimit)}`,
    );
  }
  const limit = rawLimit;

  if (before === undefined && since === undefined && limit === undefined) {
    return undefined;
  }

  const lastIndexOfId = (id: string): number => {
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].id === id) return i;
    }
    return -1;
  };

  if (since !== undefined) {
    const at = lastIndexOfId(since);
    if (at === -1) {
      return { messages: [], reset: true, total: all.length };
    }
    const later = all.slice(at + 1);
    return {
      messages: limit === undefined ? later : later.slice(-limit),
      hasMore: false,
      total: all.length,
    };
  }

  // Backward paging; without `before` this is a tail read (`limit` only).
  const end = before === undefined ? all.length : lastIndexOfId(before);
  if (end === -1) {
    // The anchor is gone. Older history may have been truncated along with it,
    // so answer with an empty page: the caller stops paging rather than looping
    // on an anchor that will never resolve.
    return { messages: [], hasMore: false, total: all.length };
  }
  const start = limit === undefined ? 0 : Math.max(0, end - limit);
  return {
    messages: all.slice(start, end),
    hasMore: start > 0,
    total: all.length,
  };
}

/**
 * Message-window validation, shared by every host that answers `getMessages`.
 *
 * Two callers need this and must agree byte for byte: the daemon / stdio
 * bridge (multi-session registry) and the interactive CLI front end (one
 * session in React state). The phone's reconciliation rules — `since` is an
 * anchor, a vanished anchor means "re-pull the tail", ids can repeat so the
 * anchor resolves to its **last** occurrence — are a property of the wire
 * contract, not of either host, so the arithmetic lives here once.
 *
 * The paging itself lives in the SDK: pages are slices of the list the agent
 * holds (`Agent.getMessagePage`), and that list starts at the last compaction
 * — nothing older is read back. What is left here is the one rule a
 * misreading caller cannot notice on its own — a malformed window must fail
 * instead of silently widening into a full read.
 *
 * Described in docs/specs/ui/remote-control.md (§5 白名单与增量拉取).
 */

import type { MessageWindow } from "wave-agent-sdk";

export type { MessageWindow, MessageWindowResult } from "wave-agent-sdk";

/** A malformed window. Hosts translate this into their own RPC error type. */
export class InvalidMessageWindowError extends Error {}

/**
 * Validate `window` and hand it on. Returns `undefined` when no window was
 * asked for — the caller then answers with the whole thread, read once.
 *
 * `limit` is left alone when absent: the SDK fills in its default page size,
 * so a host that only anchors (`before` / `since`) still gets a bounded page
 * rather than everything on one side of the anchor.
 */
export function normalizeMessageWindow(
  window?: MessageWindow,
): MessageWindow | undefined {
  const before = window?.before;
  const since = window?.since;
  const rawLimit = window?.limit;
  if (rawLimit !== undefined && (!Number.isInteger(rawLimit) || rawLimit < 1)) {
    throw new InvalidMessageWindowError(
      `getMessages limit must be a positive integer, got ${String(rawLimit)}`,
    );
  }
  if (before === undefined && since === undefined && rawLimit === undefined) {
    return undefined;
  }
  return {
    ...(before !== undefined ? { before } : {}),
    ...(since !== undefined ? { since } : {}),
    ...(rawLimit !== undefined ? { limit: rawLimit } : {}),
  };
}

/**
 * One-frame budget for the frames this machine hands to the relay.
 *
 * Two relay-side limits stand behind every frame, and neither is ours to raise:
 * `maxPayload` (4 MiB by default) makes the relay close the connection with
 * `1009`, and — lower, and far easier to hit — the per-subscriber buffer
 * (1 MiB by default) makes it **drop that one frame** and ask for a resync.
 * The second failure is silent: no error, just a page the phone never sees, and
 * a phone that answers the resync by asking for the same page again.
 *
 * Hence the budget lives here, at half of that buffer, leaving room for the
 * frames already in flight. It is deliberately **not** derived from the relay's
 * number at runtime: the promise "nothing we send exceeds what the relay will
 * forward" has to hold without knowing which relay build is on the other side.
 */
export const REMOTE_MAX_FRAME_BYTES = 512 * 1024;

/** Serialized size of a frame, exactly as it goes on the wire. */
export function frameBytes(frame: unknown): number {
  const json = JSON.stringify(frame);
  return json === undefined ? 0 : Buffer.byteLength(json, "utf8");
}

/**
 * How many trailing items of a list still fit under the budget.
 *
 * The candidate list is always a page of messages, so the newest ones are the
 * ones worth keeping: a phone that asked for the tail is better served by the
 * last 80 messages than by the first 80. `fits` must be monotonic in the count
 * — it is, for a suffix of a JSON array — so this is a binary search rather
 * than one `stringify` per candidate length.
 */
export function trailingCountThatFits(
  total: number,
  fits: (count: number) => boolean,
): number {
  let low = 0;
  let high = total;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  return low;
}

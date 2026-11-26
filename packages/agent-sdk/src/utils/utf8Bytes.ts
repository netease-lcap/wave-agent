/**
 * Byte-accurate caps for text headed to the model.
 *
 * A cap counted in characters does not bound what the model pays for: 30,000
 * characters of Chinese is ~30,000 tokens, while 30,000 characters of ASCII is
 * ~7,500 — same cap, four times the load. Bytes are the monotonic proxy, and
 * bytes are what Claude Code caps on (`BASH_MAX_OUTPUT_LENGTH`, enforced by
 * reading that many bytes off the output file before decoding it). The memory
 * entrypoint is capped the same way, for the same reason
 * (`constants/memory.ts`).
 */

/** Length of `text` once encoded as UTF-8. */
export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** Whether `text` would take more than `maxBytes` encoded as UTF-8. */
export function exceedsUtf8Bytes(text: string, maxBytes: number): boolean {
  return utf8ByteLength(text) > maxBytes;
}

/**
 * `text` cut to at most `maxBytes` UTF-8 bytes.
 *
 * The cut backs off to the start byte of a character, so the result never ends
 * in a replacement character. A byte-exact cut would leave one whenever the
 * boundary lands mid-character — which is exactly what Claude Code's byte cap
 * does, and the one thing about it not worth copying.
 *
 * Only the first `maxBytes` characters are encoded: a character is at least a
 * byte, so that prefix already holds the whole budget, and a multi-megabyte
 * output is never encoded twice.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const head = text.slice(0, maxBytes);
  const bytes = Buffer.from(head, "utf8");
  if (bytes.length <= maxBytes) return head;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.toString("utf8", 0, end);
}

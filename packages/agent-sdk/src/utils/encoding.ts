/**
 * Streaming byte-to-text decoder for bash tool output on Windows.
 *
 * Git Bash (MSYS) tools emit UTF-8, but native Windows programs (taskkill,
 * powershell, ping, ...) write the system OEM code page — GBK (cp936) on
 * zh-CN systems. Node's default `data.toString()` decodes every stream as
 * UTF-8, so GBK bytes turn into U+FFFD mojibake (issue #1753).
 *
 * Strategy (per-chunk buffering, decide-once):
 * - Accumulate raw bytes; try strict UTF-8 (`fatal: true`) over everything
 *   buffered so far. If it decodes cleanly, emit the text.
 * - If strict UTF-8 fails, hold back exactly the tail that a chunk boundary
 *   can legitimately cut (an incomplete UTF-8 sequence, located by walking
 *   back to its lead byte) and decode the rest.
 * - Once even the head is not valid UTF-8, the stream is GBK: re-decode all
 *   buffered bytes with GBK and switch to GBK for every subsequent chunk.
 * - `flush()` ends the stream: it finishes the GBK decoder and decodes any
 *   leftover buffered bytes (leniently) at stream end.
 */
export class WindowsStreamDecoder {
  private pending = Buffer.alloc(0);
  private gbkDecoder: TextDecoder | null = null;

  push(data: Buffer): string {
    // Already determined GBK: decode each chunk as it arrives, keeping the
    // stream open so a double-byte character split across chunks survives.
    if (this.gbkDecoder) {
      return this.gbkDecoder.decode(data, { stream: true });
    }

    this.pending = Buffer.concat([this.pending, data]);

    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        this.pending,
      );
      this.pending = Buffer.alloc(0);
      return text;
    } catch {
      // Strict UTF-8 failed. The only legitimate reason to keep bytes back is
      // a UTF-8 sequence cut in half by the chunk boundary — measured from its
      // own lead byte, never by "how many high bytes are trailing" (that count
      // crosses into the last *complete* character and beheads it, which then
      // reads as invalid UTF-8 and pins the whole stream to GBK).
      const keep = incompleteUtf8TailLength(this.pending);
      const head = this.pending.subarray(0, this.pending.length - keep);
      if (head.length > 0) {
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(head);
          this.pending = Buffer.from(this.pending.subarray(head.length));
          return text;
        } catch {
          // Head is not valid UTF-8 → the whole stream is GBK. Re-decode
          // everything accumulated so far and commit to GBK.
          this.gbkDecoder = new TextDecoder("gbk");
          const text = this.gbkDecoder.decode(this.pending, { stream: true });
          this.pending = Buffer.alloc(0);
          return text;
        }
      }
      // Only the trailing incomplete sequence is in doubt: hold it.
      return "";
    }
  }

  /** Decode any bytes still held at stream end (an unfinished UTF-8 sequence). */
  flush(): string {
    if (this.gbkDecoder) {
      // Ends the GBK stream, emitting U+FFFD for a dangling half character
      // instead of silently dropping it.
      return this.gbkDecoder.decode();
    }
    if (this.pending.length === 0) return "";
    // Bytes only survive to the end as an unfinished sequence — anything whole
    // was already emitted — so they are UTF-8 that the writer cut off mid
    // character (e.g. `head -c`). Decode them leniently instead of guessing
    // GBK: a truncated 3-byte glyph is indistinguishable from a 2-byte GBK
    // character, and the GBK reading invents a real-looking character where
    // the bytes are simply missing (E6 B4 → 娲 rather than 活).
    const rest = this.pending;
    this.pending = Buffer.alloc(0);
    return rest.toString("utf-8");
  }
}

/**
 * How many trailing bytes of `buf` form an *incomplete* UTF-8 sequence — i.e.
 * how many bytes a chunk boundary is allowed to cut off and resume later.
 *
 * Walks back from the end to the closest lead byte (a non-continuation byte)
 * and asks it how long its sequence should be. Bytes that cannot lead a valid
 * sequence (a lone continuation 0x80-0xBF, 0xC0/0xC1, 0xF5-0xFF) are "cannot
 * be judged incomplete": they are left in the head so the stream gets classified
 * as GBK instead of being held back forever.
 */
function incompleteUtf8TailLength(buf: Buffer): number {
  const lastLead = Math.max(0, buf.length - 4);
  for (let i = buf.length - 1; i >= lastLead; i--) {
    const byte = buf[i];
    if ((byte & 0xc0) === 0x80) continue; // continuation — its lead is further back
    const expected = utf8SequenceLength(byte);
    if (expected === 0) return 0;
    const tail = buf.length - i;
    // Shorter than announced → genuinely incomplete; otherwise the sequence at
    // `i` is already complete (or malformed) and nothing needs holding back.
    return tail < expected ? tail : 0;
  }
  return 0;
}

/** Sequence length announced by a UTF-8 lead byte; 0 if it cannot lead one. */
function utf8SequenceLength(byte: number): number {
  if (byte < 0x80) return 1;
  if (byte >= 0xc2 && byte <= 0xdf) return 2;
  if (byte >= 0xe0 && byte <= 0xef) return 3;
  if (byte >= 0xf0 && byte <= 0xf4) return 4;
  return 0;
}

/** Decode a single complete byte sequence (used for non-streaming reads). */
export function decodeBytes(buf: Buffer): string {
  const utf8 = buf.toString("utf-8");
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    return new TextDecoder("gbk").decode(buf);
  } catch {
    return utf8;
  }
}

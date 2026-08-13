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
 * - If strict UTF-8 fails, hold back up to 3 trailing bytes (a UTF-8
 *   character split across chunk boundaries) and retry on the next chunk.
 * - Once even the head is not valid UTF-8, the stream is GBK: re-decode all
 *   buffered bytes with GBK and switch to GBK for every subsequent chunk.
 * - `flush()` decodes any leftover buffered bytes (leniently) at stream end.
 */
export class WindowsStreamDecoder {
  private pending = Buffer.alloc(0);
  private gbkDecoder: TextDecoder | null = null;

  /** Longest possible incomplete UTF-8 tail at a chunk boundary is 3 bytes. */
  private static readonly MAX_UTF8_TRAIL_BYTES = 3;

  push(data: Buffer): string {
    // Already determined GBK: decode each chunk as it arrives.
    if (this.gbkDecoder) {
      return this.gbkDecoder.decode(data);
    }

    this.pending = Buffer.concat([this.pending, data]);

    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        this.pending,
      );
      this.pending = Buffer.alloc(0);
      return text;
    } catch {
      // Strict UTF-8 failed. The trailing bytes may be a UTF-8 sequence split
      // across chunks: hold only the trailing run of non-ASCII bytes (max 3,
      // the longest incomplete UTF-8 tail). Everything before it is already
      // decodable and is emitted immediately.
      const n = this.pending.length;
      let keep = 0;
      while (
        keep < WindowsStreamDecoder.MAX_UTF8_TRAIL_BYTES &&
        keep < n &&
        this.pending[n - 1 - keep] >= 0x80
      ) {
        keep++;
      }
      const head = this.pending.subarray(0, n - keep);
      if (head.length > 0) {
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(head);
          this.pending = Buffer.from(this.pending.subarray(n - keep));
          return text;
        } catch {
          // Head is not valid UTF-8 → the whole stream is GBK. Re-decode
          // everything accumulated so far and commit to GBK.
          this.gbkDecoder = new TextDecoder("gbk");
          const text = this.gbkDecoder.decode(this.pending);
          this.pending = Buffer.alloc(0);
          return text;
        }
      }
      // Only the trailing bytes are suspect: hold them for the next chunk.
      return "";
    }
  }

  /** Decode any bytes still held at stream end (lenient UTF-8, else GBK). */
  flush(): string {
    if (this.pending.length === 0) return "";
    const rest = this.pending;
    this.pending = Buffer.alloc(0);
    if (this.gbkDecoder) {
      return this.gbkDecoder.decode(rest);
    }
    const utf8 = rest.toString("utf-8");
    if (!utf8.includes("\uFFFD")) return utf8;
    try {
      return new TextDecoder("gbk").decode(rest);
    } catch {
      return utf8;
    }
  }
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

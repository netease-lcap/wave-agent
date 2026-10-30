/**
 * On-demand text preview for the remote-control page.
 *
 * ## Why this exists
 *
 * Same missing channel as {@link readImagePreview}: the phone has no file
 * system, so "the agent wrote it to `/tmp/build.log`" is a path the user can
 * read nowhere. The image channel solved that for pictures; this one solves it
 * for everything else (spec `remote/remote-web.md`「点消息里的文件路径看内容」).
 *
 * ## The one gate
 *
 * The image channel is authorised by decoding: only a real raster container is
 * served, so a `/tmp/x.png` that is really a text file dies before any bytes
 * leave. Text has no equivalent — "it is text" is close to "anything can be
 * read" — so by decision (2026-11-01) this channel does **not** filter by
 * extension. What is left is: judge by *content* (a NUL byte or a mostly
 * undecodable payload means binary), never write, never delete, and cap what
 * one reply can carry. The consequences are spelled out in the spec's
 * 「文本预览不设扩展名白名单」 boundary note — read that before widening this.
 *
 * ## Why the cap is not the frame budget
 *
 * {@link TEXT_PREVIEW_MAX_BYTES} is 256 KiB: a single frame could carry roughly
 * twice that, but one screen of phone text is a few KiB, so anything past this
 * only makes the overlay slower to render. The cap is applied as "read this
 * much, then say you truncated", never as "refuse the file".
 */
import { open, stat } from "node:fs/promises";

/** Never read more than this for one preview; the rest is reported as cut. */
export const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;

/** The bytes are not text (NUL byte, or mostly undecodable as UTF-8). */
export const TEXT_PREVIEW_NOT_TEXT = -32016;
/** The path could not be read (missing, permission, a directory). */
export const TEXT_PREVIEW_READ_FAILED = -32017;

/**
 * Share of U+FFFD above which the payload is treated as binary rather than as
 * text with a bad encoding. A GBK log that is otherwise readable stays under
 * this; a JPEG/ELF renamed to `.log` lands far above it.
 */
const MAX_REPLACEMENT_RATIO = 0.1;

export interface TextPreviewResult {
  /** The path that was asked for, echoed for the page's header. */
  path: string;
  content: string;
  /** Size of the file on disk, for the "只显示前 X" line. */
  bytes: number;
  /** Bytes actually decoded (≤ {@link TEXT_PREVIEW_MAX_BYTES}). */
  returnedBytes: number;
  /** True when the file is larger than what was returned. */
  truncated: boolean;
  /** True when the decoded text contains replacement characters. */
  encodingIssue: boolean;
}

function fail(code: number, message: string): Error {
  const error = new Error(message) as Error & { code?: number };
  error.code = code;
  return error;
}

/**
 * Read the head of one file from **this machine** and decode it as UTF-8.
 *
 * Throws an `Error` carrying one of the `TEXT_PREVIEW_*` codes; the remote
 * error reply turns it into one visible line on the page.
 */
export async function readTextPreview(
  filePath: string,
): Promise<TextPreviewResult> {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    throw fail(TEXT_PREVIEW_READ_FAILED, "getTextPreview requires a path");
  }

  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      throw fail(TEXT_PREVIEW_READ_FAILED, `Not a file: ${filePath}`);
    }
    size = info.size;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "number"
    ) {
      throw error;
    }
    throw fail(TEXT_PREVIEW_READ_FAILED, `Could not read ${filePath}`);
  }

  const readBytes = Math.min(size, TEXT_PREVIEW_MAX_BYTES);
  let source: Buffer;
  try {
    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.allocUnsafe(readBytes);
      let filled = 0;
      // `read` may return short; loop until the head we asked for is in hand.
      while (filled < readBytes) {
        const { bytesRead } = await handle.read(
          buffer,
          filled,
          readBytes - filled,
          filled,
        );
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      source = buffer.subarray(0, filled);
    } finally {
      await handle.close();
    }
  } catch {
    throw fail(TEXT_PREVIEW_READ_FAILED, `Could not read ${filePath}`);
  }

  // The gate: content, not the name. UTF-16 files carry NUL bytes and are
  // rejected here too — this channel promises UTF-8, and saying so is better
  // than showing a screen of interleaved NULs.
  if (source.includes(0)) {
    throw fail(TEXT_PREVIEW_NOT_TEXT, `${filePath} is not a text file`);
  }

  const truncated = size > source.length;
  // With `stream: true` the decoder holds back an incomplete trailing sequence
  // instead of turning it into U+FFFD, so a cut never produces a broken last
  // character (场景 5：按字节截断、退回最近的字符边界).
  const content = new TextDecoder("utf-8").decode(source, {
    stream: truncated,
  });

  let replacements = 0;
  for (const char of content) {
    if (char === "\uFFFD") replacements++;
  }
  const length = content.length;
  if (length > 0 && replacements / length > MAX_REPLACEMENT_RATIO) {
    throw fail(TEXT_PREVIEW_NOT_TEXT, `${filePath} is not a text file`);
  }

  return {
    path: filePath,
    content,
    bytes: size,
    returnedBytes: source.length,
    truncated,
    encodingIssue: replacements > 0,
  };
}

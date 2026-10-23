/**
 * 从转录（session JSONL）里读一页消息。
 *
 * 为什么需要它：`displayMessages` 与宿主缓存过去都是全量，会话越长内存越大
 * （工具图片的 base64 会一直挂着）。现在两端都只留页，更早的页到这里来读。
 *
 * 做法是**从文件末尾按字节块往回读**，不是从头顺序流：
 *
 * - 首屏（没有锚点）：收满一页就停，成本是 O(页字节)，不读整份文件——这是最关键
 *   的一条，一个几百 MB 的会话不该为了画第一屏把整个文件扫一遍；
 * - `before`：往回读到锚点，再收满一页，成本是 O(锚点之后的字节)；
 * - `since`：往回读到锚点，收下锚点之后的部分。
 *
 * 没有索引，所以「读一页的成本与转录制长度同阶」是这套方案接受的代价（见
 * docs/specs/ui/message-rendering-system.md）。不因此额外维护索引。
 */
import { open } from "fs/promises";
import type { Message } from "../types/messaging.js";
import type { MessageWindow } from "../types/messageWindow.js";
import {
  MESSAGE_HISTORY_PAGE_SIZE,
  MESSAGE_PAGE_MAX_BYTES,
} from "../constants/messageWindow.js";
import { parseTranscriptLine } from "../services/sessionEntries.js";

const NEWLINE = 0x0a;
const DEFAULT_CHUNK_BYTES = 256 * 1024;

export interface TranscriptPage {
  messages: Message[];
  /** 这一页之前还有更早的消息。 */
  hasMore: boolean;
  /** `since` 锚点不在转录里（或落后太多）：调用方整份重取尾页。 */
  reset?: boolean;
}

interface CursorHit {
  message: Message;
  /** 这一行在文件里的字节数（不含换行）：一页的字节预算按它累计。 */
  bytes: number;
}

/**
 * 逐行往回读文件（行尾 → 行首）。按字节切块、只在换行处切行，所以 UTF-8 的
 * 多字节字符不会被切坏（换行是单字节，行一定是完整的）。
 */
export async function* transcriptLinesBackward(
  filePath: string,
  chunkBytes: number = DEFAULT_CHUNK_BYTES,
): AsyncGenerator<string> {
  const handle = await open(filePath, "r");
  try {
    const { size } = await handle.stat();
    let position = size;
    /** 已经读到、但还没有遇到换行的那截文件头（属于某一行的一部分）。 */
    let rest = Buffer.alloc(0);
    while (position > 0) {
      const length = Math.min(chunkBytes, position);
      const start = position - length;
      let chunk = Buffer.alloc(length);
      let filled = 0;
      while (filled < length) {
        const { bytesRead } = await handle.read(
          chunk,
          filled,
          length - filled,
          start + filled,
        );
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      if (filled < length) chunk = chunk.subarray(0, filled);
      position = start;
      const data = rest.length > 0 ? Buffer.concat([chunk, rest]) : chunk;
      let end = data.length;
      let index = data.lastIndexOf(NEWLINE, end - 1);
      while (index !== -1) {
        // `start === end` 是文件末尾那个换行切出来的空段（文件以换行结尾时总会
        // 出现），不是一行数据。
        if (index + 1 < end) {
          yield data.subarray(index + 1, end).toString("utf8");
        }
        end = index;
        index = end > 0 ? data.lastIndexOf(NEWLINE, end - 1) : -1;
      }
      rest = data.subarray(0, end);
    }
    if (rest.length > 0) yield rest.toString("utf8");
  } finally {
    await handle.close();
  }
}

async function endsWithNewline(filePath: string): Promise<boolean> {
  const handle = await open(filePath, "r");
  try {
    const { size } = await handle.stat();
    if (size === 0) return true;
    const byte = Buffer.alloc(1);
    await handle.read(byte, 0, 1, size - 1);
    return byte[0] === NEWLINE;
  } finally {
    await handle.close();
  }
}

interface TranscriptCursor {
  /** 往回的下一条消息；到文件头返回 undefined。 */
  nextMessage(): Promise<CursorHit | undefined>;
  close(): Promise<void>;
}

/**
 * 游标层负责三件与窗口无关的事：跳过保留条目（metadata / custom-title）、
 * 容忍「文件不以换行结尾时被打断的最后一行」、以及按 id 去重。
 *
 * 去重保留**最后一次出现**（往回读时先遇到的那份），与 `sliceMessageWindow`
 * 的锚点口径一致：老转录（append-only 修复前会在压缩点重复写入保留轮次）里
 * 同一个 id 出现两次，页面上只该有一份。
 */
async function createCursor(
  filePath: string,
  chunkBytes: number,
): Promise<TranscriptCursor> {
  const lines = transcriptLinesBackward(filePath, chunkBytes);
  const iterator = lines[Symbol.asyncIterator]();
  const seen = new Set<string>();
  let atFileEnd = true;
  let done = false;

  const close = async (): Promise<void> => {
    if (done) return;
    done = true;
    await iterator.return?.(undefined);
  };

  return {
    close,
    async nextMessage(): Promise<CursorHit | undefined> {
      for (;;) {
        const { value, done: exhausted } = await iterator.next();
        if (exhausted) return undefined;
        const isLastLineOfFile = atFileEnd;
        atFileEnd = false;
        let parsed;
        try {
          parsed = parseTranscriptLine(value);
        } catch (error) {
          // 文件不以换行结尾 + 正好是最后一行 = 被中断的 append 残留，丢掉它；
          // 其它位置的坏行是真损坏，照 `readMessagesAndCustomTitle` 抛出去。
          if (isLastLineOfFile && !(await endsWithNewline(filePath))) continue;
          throw error;
        }
        if (parsed.kind !== "message") continue;
        const id = parsed.message.id;
        if (id) {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        return {
          message: parsed.message,
          bytes: Buffer.byteLength(value, "utf8"),
        };
      }
    },
  };
}

function normaliseLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
    return MESSAGE_HISTORY_PAGE_SIZE;
  }
  return limit;
}

/** 从后往前收，收满条数或字节预算就停；至少收 1 条。 */
async function collectBackward(
  cursor: TranscriptCursor,
  limit: number,
  maxBytes: number,
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const collected: Message[] = [];
  let bytes = 0;
  for (;;) {
    const hit = await cursor.nextMessage();
    if (!hit) return { messages: collected.reverse(), hasMore: false };
    const overLimit = collected.length >= limit;
    const overBytes = collected.length > 0 && bytes + hit.bytes > maxBytes;
    if (overLimit || overBytes) {
      // 已经收满，而这一条是更早的消息：说明前面还有。
      return { messages: collected.reverse(), hasMore: true };
    }
    collected.push(hit.message);
    bytes += hit.bytes;
  }
}

/** 往回读到锚点（不含）为止；找不到返回 false。 */
async function skipToAnchor(
  cursor: TranscriptCursor,
  anchor: string,
): Promise<boolean> {
  for (;;) {
    const hit = await cursor.nextMessage();
    if (!hit) return false;
    if (hit.message.id === anchor) return true;
  }
}

export interface ReadTranscriptPageOptions {
  maxBytes?: number;
  chunkBytes?: number;
}

/**
 * 读一页。只看转录，不掺内存里的未落盘尾部——那一步由调用方
 * （`messageManager.getMessagePage`）叠加，因为它才知道哪些消息还没写盘。
 */
export async function readTranscriptPage(
  filePath: string,
  window: MessageWindow,
  options: ReadTranscriptPageOptions = {},
): Promise<TranscriptPage> {
  const limit = normaliseLimit(window.limit);
  const maxBytes = options.maxBytes ?? MESSAGE_PAGE_MAX_BYTES;
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;

  const cursor = await createCursor(filePath, chunkBytes);
  try {
    if (window.since) {
      const collected: Message[] = [];
      let bytes = 0;
      for (;;) {
        const hit = await cursor.nextMessage();
        // 锚点翻不到了：要么已被 rewind 裁掉，要么落得太远。
        if (!hit) return { messages: [], hasMore: false, reset: true };
        if (hit.message.id === window.since) break;
        collected.push(hit.message);
        bytes += hit.bytes;
        // 落后超过一页：不返回有洞的补差，让调用方整份重取尾页。
        if (collected.length > limit || bytes > maxBytes) {
          return { messages: [], hasMore: false, reset: true };
        }
      }
      return { messages: collected.reverse(), hasMore: false };
    }

    if (window.before && !(await skipToAnchor(cursor, window.before))) {
      // 锚点不在转录里（被 rewind 裁掉 / 从没见过）：到底。
      return { messages: [], hasMore: false };
    }

    return await collectBackward(cursor, limit, maxBytes);
  } catch (error) {
    // 还没有转录（新会话、或会话文件被删）：空页。带 `since` 的调用方按「锚点不
    // 在了」重建，其余按「没有更早的」处理。文件在读到一半时被删也走这里——对调用
    // 方来说与「转录是空的」没有区别。
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return window.since
        ? { messages: [], hasMore: false, reset: true }
        : { messages: [], hasMore: false };
    }
    throw error;
  } finally {
    await cursor.close();
  }
}

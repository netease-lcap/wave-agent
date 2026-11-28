/**
 * 从转录（session JSONL）里读一页消息。
 *
 * 为什么需要它：内存里的列表从最近一次压缩开始，压缩之前的历史只在转录里。
 * 首屏要按条数填满、用户上翻时要能一段段读到那里（spec
 * ui/message-rendering-system.md「首屏一页，上翻按需取更早」），读完只活在页面
 * 那一侧，不回填内存。
 *
 * 做法是**从文件末尾按字节块往回读**，不是从头顺序流：一页就是「往回读到锚点，
 * 再收满一页就停」，成本是 O(锚点之后的字节)；「还有没有更早」由同一趟读页带回
 * （收满时多遇到一行），不需要再扫一遍文件。
 *
 * 没有索引，所以「读一页的成本与锚点位置同阶」是这套方案接受的代价。不因此额外
 * 维护索引：转录是 append-only 的，索引的失效判据比它省下的字节更难写对。
 */
import { open, stat } from "fs/promises";
import type { Message } from "../types/messaging.js";
import type { MessageWindow } from "../types/messageWindow.js";
import {
  MESSAGE_PAGE_SIZE,
  MESSAGE_PAGE_SIZE_MAX,
  TRANSCRIPT_BYTES_MAX,
} from "../constants/messageWindow.js";
import { parseTranscriptLine } from "../services/sessionEntries.js";

const NEWLINE = 0x0a;
const DEFAULT_CHUNK_BYTES = 256 * 1024;

export interface TranscriptPage {
  messages: Message[];
  /** 这一页之前还有更早的消息。 */
  hasMore: boolean;
  /**
   * `before` 锚点在转录里找不到（被 rewind / clear 裁掉，或这条 id 从来没写
   * 过盘）。调用方应换一个更早的已知 id 重试，而不是当作「到底」——判错的代价
   * 是这段历史再也翻不出来。
   */
  anchorLost?: boolean;
  /** `since` 锚点不在转录里（或落后太多）：调用方整份重取尾页。 */
  reset?: boolean;
  /** 这一页之后还有更新的消息（只有 `from` 取页会给）。 */
  hasLater?: boolean;
  /**
   * 转录超过了 `TRANSCRIPT_BYTES_MAX`：这次读到的只是尾部那一段，比它更早的
   * 消息**读不出来**（不是「没有」）。界面要把这件事说出来，别让用户对着翻不动
   * 的顶部反复上翻。
   */
  truncated?: boolean;
}

interface CursorHit {
  message: Message;
}

/**
 * 逐行往回读文件（行尾 → 行首）。按字节切块、只在换行处切行，所以 UTF-8 的
 * 多字节字符不会被切坏（换行是单字节，行一定是完整的）。
 */
export async function* transcriptLinesBackward(
  filePath: string,
  chunkBytes: number = DEFAULT_CHUNK_BYTES,
  /** 读到这个字节位置就停（不含）：截断窗口的地板，见 `TRANSCRIPT_BYTES_MAX`。 */
  floorByte = 0,
): AsyncGenerator<string> {
  const handle = await open(filePath, "r");
  try {
    const { size } = await handle.stat();
    let position = size;
    /** 已经读到、但还没有遇到换行的那截文件头（属于某一行的一部分）。 */
    let rest = Buffer.alloc(0);
    while (position > floorByte) {
      const length = Math.min(chunkBytes, position - floorByte);
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
        // `index + 1 === end` 是文件末尾那个换行切出来的空段（文件以换行结尾时
        // 总会出现），不是一行数据。
        if (index + 1 < end) {
          yield data.subarray(index + 1, end).toString("utf8");
        }
        end = index;
        index = end > 0 ? data.lastIndexOf(NEWLINE, end - 1) : -1;
      }
      rest = data.subarray(0, end);
    }
    // 文件最开头那一行：只有从真正的 0 读起时它才是完整的一行。截断窗口的起点
    // 落在行中间，那半行属于读不到的历史，丢掉——否则界面上会多出一条残句。
    if (floorByte === 0 && rest.length > 0) yield rest.toString("utf8");
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
 * 去重保留**最后一次出现**（往回读时先遇到的那份），与内存侧的锚点口径一致：
 * 老转录（append-only 修复前会在压缩点重复写入保留轮次）里同一个 id 出现两次，
 * 页面上只该有一份。
 */
async function createCursor(
  filePath: string,
  chunkBytes: number,
  floorByte: number,
): Promise<TranscriptCursor> {
  const lines = transcriptLinesBackward(filePath, chunkBytes, floorByte);
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
        };
      }
    },
  };
}

function normaliseLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
    return MESSAGE_PAGE_SIZE;
  }
  return Math.min(limit, MESSAGE_PAGE_SIZE_MAX);
}

/**
 * 从后往前收一页。
 *
 * 条数收满就停，但**页首必须落在带 id 的行上**：调用方下一次上翻拿的就是页首
 * 那条的 id 当锚点，页首没有 id 的话这条路走到这儿就断了（再往上翻只能从头重
 * 读）。所以收满之后如果最早那条没有 id，继续往前收，直到出现带 id 的一行为止
 * —— 页会比 `limit` 多几条，换来的是翻页永远接得上。参考物的切片也是这么做的
 * （无 uuid 的行向前跳过）。
 */
async function collectBackward(
  cursor: TranscriptCursor,
  limit: number,
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const collected: Message[] = [];
  for (;;) {
    const hit = await cursor.nextMessage();
    if (!hit) return { messages: collected.reverse(), hasMore: false };
    if (collected.length < limit) {
      collected.push(hit.message);
      continue;
    }
    // 收满了：`collected` 是倒序的，最后一条就是这一页的页首。
    if (collected[collected.length - 1].id) {
      // 页首带 id，锚点可用；这一条（更早的）留在下一页。
      return { messages: collected.reverse(), hasMore: true };
    }
    collected.push(hit.message);
    if (hit.message.id) return { messages: collected.reverse(), hasMore: true };
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

/**
 * 以 `from` 为起点往后收一页（**含锚点**）。
 *
 * 文件是往回读的，所以「锚点之后的消息」反而是先遇到的：一路收到锚点为止，再取
 * 最靠近锚点的那 `limit` 条。成本是 O(锚点之后的字节)——跳得越远读得越多，与参考
 * 物按锚点分页的成本同阶。
 *
 * 三种结果：读到文件头都没遇到锚点 → `anchorLost`（被 rewind / clear 删掉了）；
 * 锚点之后不足一页 → 全给、`hasLater` 为假；超过一页 → 只给紧接锚点的那一页、
 * `hasLater` 为真（界面据此知道窗口停在历史里，场景 18）。
 */
async function collectForward(
  cursor: TranscriptCursor,
  from: string,
  limit: number,
): Promise<TranscriptPage> {
  /** 倒序（最新在前），只留最近 `limit` 条；更远的那些只计数。 */
  const recent: Message[] = [];
  /** 因为太新而被裁掉的条数：非零就说明页尾之下还有内容。 */
  let dropped = 0;
  for (;;) {
    const hit = await cursor.nextMessage();
    if (!hit) return { messages: [], hasMore: false, anchorLost: true };
    recent.push(hit.message);
    if (hit.message.id === from) break;
    // 批量裁，而不是逐条 shift：`limit` 最多 1000，逐条挪数组在长会话里是平方级。
    if (recent.length > limit) {
      const cut = recent.length - limit;
      recent.splice(0, cut);
      dropped += cut;
    }
  }
  // 锚点之上再探一条：答「这一页之前还有更早」用，探到的这条不属于本页。
  const probe = await cursor.nextMessage();
  const page = recent.slice(Math.max(0, recent.length - limit)).reverse();
  return {
    messages: page,
    hasMore: probe !== undefined,
    hasLater: dropped > 0,
  };
}

export interface ReadTranscriptPageOptions {
  chunkBytes?: number;
  /**
   * 能读的最大字节数（默认 `TRANSCRIPT_BYTES_MAX`）：文件更大时只读尾部这一段，
   * 更早的部分读不出来，回包里带上 `truncated`。给测试收窄用（与 `chunkBytes`
   * 同一性质），正常调用一律走默认值。
   */
  maxBytes?: number;
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
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;

  try {
    // 文件超过上限时只读尾部这一段，更早的部分读不出来：地板就是截断点（参考物
    // 的 floorCursor 是同一语义）。`truncated` 随每一页回给界面，由它明说。
    const maxBytes = options.maxBytes ?? TRANSCRIPT_BYTES_MAX;
    const { size } = await stat(filePath);
    const floorByte = size > maxBytes ? size - maxBytes : 0;
    const truncated = floorByte > 0 ? { truncated: true as const } : {};

    const cursor = await createCursor(filePath, chunkBytes, floorByte);
    try {
      if (window.since) {
        const collected: Message[] = [];
        for (;;) {
          const hit = await cursor.nextMessage();
          // 锚点翻不到了：要么已被 rewind 裁掉，要么落得太远。
          if (!hit) {
            return { messages: [], hasMore: false, reset: true, ...truncated };
          }
          if (hit.message.id === window.since) break;
          collected.push(hit.message);
          // 落后超过一页：不返回有洞的补差，让调用方整份重取尾页。
          if (collected.length > limit) {
            return { messages: [], hasMore: false, reset: true, ...truncated };
          }
        }
        return { messages: collected.reverse(), hasMore: false, ...truncated };
      }

      // `from` 与 `before` 语义互斥，同时传时以 `from` 为准（见 MessageWindow）。
      if (window.from) {
        return {
          ...(await collectForward(cursor, window.from, limit)),
          ...truncated,
        };
      }

      if (window.before && !(await skipToAnchor(cursor, window.before))) {
        // 锚点不在了：不判「到底」，让调用方换一个更早的已知 id 重试。
        return { messages: [], hasMore: false, anchorLost: true, ...truncated };
      }

      return { ...(await collectBackward(cursor, limit)), ...truncated };
    } finally {
      await cursor.close();
    }
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
  }
}

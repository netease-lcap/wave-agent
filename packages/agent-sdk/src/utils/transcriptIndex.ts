/**
 * 会话消息大纲的索引：扫一遍转录，留下每一条**带文本的用户消息**的 id 与文本
 * 首段（spec ui/transcript-outline.md 场景 16）。
 *
 * 为什么需要它：大纲要覆盖整条会话，而页面只加载了最近一页。把索引建在「已加载
 * 的消息」上，就是首版被客户反馈的那个问题（刻度只到最近 200 条）；把整份消息读
 * 进页面又太贵。索引是这两者之间最小的一份数据——只有 id 和一句话。
 *
 * 与 CC 桌面端的 `rows` 索引同形（它整份读进宿主进程、再在内存里切片），区别只在
 * 我们跨 stdio 传给页面，所以更省：它留整条消息，我们只留能画刻度的部分。
 *
 * 缓存口径同 `diskTranscriptCache`：按 (size, mtimeMs, ino) 判同一份转录。转录是
 * append-only 的，任何写入都会改 size 或 mtime，所以这三个值没变就不必重扫。
 */
import { stat } from "fs/promises";
import type { Message } from "../types/messaging.js";
import type { TranscriptOutlineEntry } from "../types/transcriptOutline.js";
import { OUTLINE_TEXT_LIMIT } from "../constants/messageWindow.js";
import { forEachTranscriptEntry } from "../services/sessionEntries.js";

interface CachedOutline {
  size: number;
  mtimeMs: number;
  ino: number;
  items: TranscriptOutlineEntry[];
}

/**
 * 缓存最多留几条转录的索引。桌面端同时挂几个 pane 就几份，几十份已经远超实
 * 际；超了先丢最旧的（Map 迭代顺序 = 插入顺序）。
 */
const MAX_CACHED_TRANSCRIPTS = 32;

const cache = new Map<string, CachedOutline>();

/**
 * 一条消息能否成为刻度，以及它的文本首段。
 *
 * **这个判据与 webview 的 `stickyAnchorText` 必须同源**（spec 场景 3）：吸顶条认
 * 它、大纲不认它这种分叉，正是吸顶条曾经整个消失的原因。两边各写一份是不得已
 * ——索引在 SDK 侧扫盘，不能反过来依赖页面（webview 只准 import `/types` 与
 * `/constants`）。所以两份实现都被单测钉住，改动时两边一起改。
 *
 * 返回空串 = 不成为刻度：助手消息、注入型 `isMeta` 用户消息（规则提醒、钩子上下
 * 文、任务通知）、没有任何 text 块的用户消息。
 */
export function outlineEntryText(message: Message): string {
  if (message.role !== "user" || message.isMeta) return "";
  const text = (message.blocks ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.content || "")
    .join(" ")
    .trim();
  return text.slice(0, OUTLINE_TEXT_LIMIT);
}

function sameTranscript(
  cached: CachedOutline,
  info: {
    size: number;
    mtimeMs: number;
    ino: number;
  },
): boolean {
  return (
    cached.size === info.size &&
    cached.mtimeMs === info.mtimeMs &&
    cached.ino === info.ino
  );
}

/**
 * 读一份转录的大纲索引，按出现顺序（旧 → 新）返回。
 *
 * 同一份转录被反复问（每次打开会话、每次补页后刷新）走缓存，不重复解析——这是
 * 场景 16 对宿主的要求。缓存失效后是一次正序全扫，成本与转录字节数同阶；扫描时
 * 一条消息都不留（除了能画刻度的那些），所以内存里只有索引本身。
 */
export async function readTranscriptOutline(
  filePath: string,
): Promise<TranscriptOutlineEntry[]> {
  let info;
  try {
    info = await stat(filePath);
  } catch (error) {
    // 还没有转录（新会话、文件被删）：空索引，不是错误（场景 2）。
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const cached = cache.get(filePath);
  if (cached && sameTranscript(cached, info)) {
    // 命中也要挪到队尾：这是「最近用过」的顺序。
    cache.delete(filePath);
    cache.set(filePath, cached);
    return cached.items;
  }

  /**
   * 按 id 去重、**保留最后一次出现**的文本，与 `transcriptPage` 的游标同口径：
   * 老转录（append-only 修复前会在压缩点重复写入保留轮次）里同一个 id 出现两次，
   * 页面上只该有一个刻度。用 Map 是因为它既去重又保序——覆盖不改变插入位置。
   */
  const byId = new Map<string, TranscriptOutlineEntry>();
  await forEachTranscriptEntry(filePath, (entry) => {
    if (entry.kind !== "message") return;
    const message = entry.message;
    if (!message.id) return;
    const text = outlineEntryText(message);
    if (!text) return;
    byId.set(message.id, { id: message.id, text });
  });

  const items = Array.from(byId.values());
  if (cache.size >= MAX_CACHED_TRANSCRIPTS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(filePath, {
    size: info.size,
    mtimeMs: info.mtimeMs,
    ino: info.ino,
    items,
  });
  return items;
}

/** 测试用：清掉索引缓存（生产代码不调用）。 */
export function clearTranscriptOutlineCache(): void {
  cache.clear();
}
